"""Closed HTTP boundary and durable general-call foundation, fake transport only."""

import asyncio
import importlib.util
import io
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from dataclasses import asdict, replace
from datetime import timedelta
from pathlib import Path
from threading import Event, local

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import delete, event, select, update
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import OperationalError
from sqlalchemy.schema import CreateTable

from alembic import command
from app import main
from app import watten_open_seat as calls
from app.auth import logout
from app.database import get_engine, session_scope
from app.game_state import games
from app.models import ActiveGame, User, WattenOpenSeatClaim
from app.security import utcnow
from app.watten_recipe import WattenRecipe
from app.watten_room import SeatReservation, admit, close_expired, create_room, take_seat
from app.watten_runtime import (
    _sync,
    _write_checkpoint,
    admit_account,
    apply_runtime_action,
    copy_game,
    persist_watten_game,
)
from app.web_push import PUSH_DELIVERY_CONTEXTS, claim_game_invite_push
from tests import test_watten_runtime as native
from tests.test_watten_rematch import checkpoints

server = native.server
BASE = Path(__file__).resolve().parents[1]


def headers(owner, **extra):
    return {"Cookie": owner[1], "Origin": native.LOCAL, "X-CSRF-Token": owner[0].csrf_token,
            "X-Watten-Expected-Account-Id": str(owner[0].user_id), **extra}


def setup(server, *, players=2, cpus=(), seated=True, owner=None, password=None):
    owner = native.account("CallHost") if owner is None else owner
    game = games[native.create_game(server, owner, count=players, cpus=cpus, password=password)]
    if seated:
        seat(server, game, owner, 0)
    return game, owner


def seat(_server, game, owner, number):
    candidate, participant = admit_account(game, owner[0], game["_watten"].room.revision, None)
    room = candidate["_watten"].room
    candidate, *_rest = apply_runtime_action(candidate, owner[0].user_id, participant,
        {"action": "watten_take_seat", "command_id": f"call-seat-{number}", "revision": room.revision,
         "lifecycle_revision": candidate["_watten"].lifecycle_revision,
         "seat": number, "team": number % 2 if room.recipe.player_count == 4 else None})
    persist_watten_game(candidate)
    game.clear()
    game.update(candidate)


def post(server, game, owner, **extra):
    return server.post(f"/api/games/{game['_id']}/notify-open-seat", headers=headers(owner, **extra),
                       json={"revision": game["_watten"].room.revision})


def claims():
    with session_scope() as db:
        return ([(row.game_id, row.claimed_at) for row in db.scalars(select(WattenOpenSeatClaim)).all()],
                list(db.execute(select(User.id, User.game_invite_push_last_sent_at).order_by(User.id)).all()))


def claim(db, game, owner, **options):
    return calls.claim_open_seat_in_session(db, game["_id"], owner[0].user_id, game["_watten"].room.revision, **options)


@pytest.mark.parametrize("count", (2, 3, 4))
def test_pure_eligibility_accepts_explicit_cpu_replacement_without_mutating_or_exposing_room(count):
    now = utcnow()
    room = create_room("pure-call", WattenRecipe(count, "normal", False, False, cpu_seats=tuple(range(1, count))),
                       host_account=1, now=now, wait_seconds=3600)
    with pytest.raises(calls.WattenOpenSeatError, match="not_player"):
        calls.eligible_open_seat(room, 1, now=now)  # Host admission alone is insufficient.
    room = take_seat(room, revision=room.revision, account_id=1, seat=0,
                     team=0 if count == 4 else None, now=now)
    before = asdict(room)
    assert calls.eligible_open_seat(room, 1, now=now) is None
    assert asdict(room) == before and len(room.cpus) == count - 1
    for actor in (True, 0, "1", None, 999):
        with pytest.raises(calls.WattenOpenSeatError, match="not_player"):
            calls.eligible_open_seat(room, actor, now=now)


def test_pure_admitted_unseated_capacity_and_live_reservations_take_priority_over_visual_empty_seats():
    now = utcnow()
    room = create_room("pure-call", WattenRecipe(2, "normal", False, False), host_account=1, now=now, wait_seconds=3600)
    room = take_seat(room, revision=room.revision, account_id=1, seat=0, team=None, now=now)
    full = admit(room, revision=room.revision, account_id=2, now=now).room
    held = replace(room, reservations=(SeatReservation(2, 1, now + timedelta(seconds=30)),))
    for unavailable in (full, held):
        with pytest.raises(calls.WattenOpenSeatError, match="no_open_seat"):
            calls.eligible_open_seat(unavailable, 1, now=now)
    assert calls.eligible_open_seat(held, 1, now=now + timedelta(seconds=30)) is None
    for unavailable, code in ((replace(room, recipe=replace(room.recipe, password_required=True)), "private_room"),
                              (replace(room, status="closed"), "not_waiting"),
                              (replace(room, wait_expires_at=now), "not_waiting")):
        with pytest.raises(calls.WattenOpenSeatError, match=code):
            calls.eligible_open_seat(unavailable, 1, now=now)


def test_http_is_unavailable_before_all_claim_delivery_activity_or_generic_mutations_even_after_restart(server, monkeypatch):
    game, owner = setup(server, cpus=(1,))
    before = checkpoints(), claims()
    def forbidden(*_args, **_kwargs):
        pytest.fail("closed native route reached claim/send/generic sweep")
    monkeypatch.setattr(calls, "claim_open_seat_in_session", forbidden)
    for name in ("sweep_timeouts", "web_push_available", "claim_game_invite_push", "game_invite_push_recipients",
                 "mark_game_invite_push_sent", "save_active_game", "dispatch_game_invite_push"):
        monkeypatch.setattr(main, name, forbidden)
    for retired in (False, True):
        if retired:
            games.clear()
        response = post(server, game, owner)
        assert response.status_code == 503 and response.json() == {"detail": "watten_push_unavailable"}
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["x-robots-tag"] == "noindex, nofollow"
        assert (checkpoints(), claims()) == before
    assert game["_id"] not in games and "watten" not in PUSH_DELIVERY_CONTEXTS


@pytest.mark.parametrize("gate", ("flag", "origin", "raw_host", "fixed_host", "forwarded_host"))
def test_native_local_gates_reject_before_auth_database_or_any_claim(server, monkeypatch, gate):
    game, owner = setup(server)
    extra = {}
    if gate == "flag":
        monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    elif gate == "origin":
        monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    else:
        extra["Host"] = "watten.zockdiewandan.online" if gate == "fixed_host" else "attacker.invalid"
        if gate == "forwarded_host":
            extra["X-Forwarded-Host"] = "localhost:8127"
    monkeypatch.setattr(calls, "_http_identity", lambda *_args: pytest.fail("closed gate resolved account"))
    monkeypatch.setattr(calls, "_stored", lambda *_args: pytest.fail("closed gate read checkpoint"))
    # The fixed production hostname is intercepted by the closed-host middleware.
    assert post(server, game, owner, **extra).status_code == (503 if gate == "fixed_host" else 404)


def test_expected_binding_csrf_actual_member_and_strict_body_never_consume_claims(server):
    game, owner = setup(server)
    stranger = native.account("CallSpectator")
    path, before = f"/api/games/{game['_id']}/notify-open-seat", claims()
    assert server.post(path, json={"revision": 1}).status_code == 401
    assert post(server, game, owner, **{"X-CSRF-Token": "bad"}).status_code == 403
    assert post(server, game, stranger).status_code == 403
    for value in ("", "01", "true", b"\xef\xbc\x91", str(stranger[0].user_id)):
        assert post(server, game, owner, **{"X-Watten-Expected-Account-Id": value}).status_code == 409
    without = headers(owner)
    without.pop("X-Watten-Expected-Account-Id")
    assert server.post(path, json={"revision": 1}, headers=without).status_code == 409
    duplicate = list(headers(owner).items()) + [("X-Watten-Expected-Account-Id", str(owner[0].user_id))]
    assert server.post(path, json={"revision": 1}, headers=duplicate).status_code == 409
    for value in ({"revision": True}, {"revision": -1}, {"revision": 0}, {"revision": "1"},
                  {"revision": game["_watten"].room.revision, "password": "NEVER_ACCEPT"}):
        assert server.post(path, json=value, headers=headers(owner)).status_code == 409
    for text in ('{"revision":1,"revision":1}', 'not json', '{"revision":NaN}', '"' + "x" * 300 + '"'):
        assert server.post(path, content=text, headers=headers(owner)).status_code == 409
    assert claims() == before


def test_malformed_native_marker_after_restart_never_uses_legacy_routing_or_changes_checkpoint(server, monkeypatch):
    game, owner = setup(server)
    original, before = checkpoints()[game["_id"]], claims()
    games.clear()

    def forbidden():
        pytest.fail("malformed native checkpoint fell through to legacy Push")

    monkeypatch.setattr(main, "web_push_available", forbidden)
    for marker in (None, "zdwa"):
        value = json.loads(original)
        if marker is None:
            value.pop("_game_type")
        else:
            value["_game_type"] = marker
        raw = json.dumps(value)
        with session_scope() as db:
            db.execute(update(ActiveGame).where(ActiveGame.game_id == game["_id"]).values(state_json=raw))
        response = post(server, game, owner)
        assert response.status_code == 503 and response.json() == {"detail": "watten_storage_unavailable"}
        assert checkpoints()[game["_id"]] == raw and claims() == before


@pytest.mark.parametrize("boundary", ("body", "lock"))
def test_real_logout_after_body_or_lock_await_revokes_actor_before_closed_response_or_claim(server, monkeypatch, boundary):
    game, owner = setup(server)
    before = claims(), checkpoints()
    if boundary == "body":
        original = calls._body

        async def revoked_body(request):
            value = await original(request)
            logout(owner[1].split("=", 1)[1])
            return value

        monkeypatch.setattr(calls, "_body", revoked_body)
    else:
        original = calls.game_lock

        @asynccontextmanager
        async def revoked_lock(current):
            async with original(current):
                logout(owner[1].split("=", 1)[1])
                yield

        monkeypatch.setattr(calls, "game_lock", revoked_lock)
    assert post(server, game, owner).status_code == 401
    assert (claims(), checkpoints()) == before


def test_claims_commit_together_survive_restart_and_do_not_change_native_checkpoint_or_activity(server):
    game, owner = setup(server, cpus=(1,))
    now, before = utcnow(), checkpoints()
    with session_scope() as db:
        receipt = claim(db, game, owner, now=now)
        assert set(asdict(receipt)) == {"game_id", "sender_user_id", "room_revision", "claimed_at"}
    first = claims()
    games.clear()
    with session_scope() as db, pytest.raises(calls.WattenOpenSeatError, match="game_invite_cooldown") as error:
        claim(db, game, owner, now=now + timedelta(seconds=59, milliseconds=100))
    assert error.value.retry_after == 541 and claims() == first
    assert checkpoints() == before
    with session_scope() as db:
        claim(db, game, owner, now=now + timedelta(seconds=600))
    assert checkpoints() == before and len(claims()[0]) == 1


@pytest.mark.parametrize("prior_write", (False, True), ids=("fresh-caller", "prior-user-write"))
def test_caller_rollback_and_caught_account_cooldown_leave_no_half_claim_or_implicit_commit(server, prior_write):
    game, owner = setup(server)
    other, _ = setup(server, owner=owner)
    before, stored, now = claims(), checkpoints(), utcnow()
    with pytest.raises(RuntimeError, match="outer abort"), session_scope() as db:
        if prior_write:
            db.execute(update(User).where(User.id == owner[0].user_id).values(preferred_language="en"))
        claim(db, game, owner, now=now)
        raise RuntimeError("outer abort")
    assert claims() == before and checkpoints() == stored
    with session_scope() as db:
        assert db.get(User, owner[0].user_id).preferred_language == "de"
    # A legacy-product claim shares the same actual account barrier.
    assert claim_game_invite_push(owner[0].user_id) == 0
    claimed = claims()
    with session_scope() as db:
        with pytest.raises(calls.WattenOpenSeatError, match="account_cooldown"):
            claim(db, other, owner)
    assert claims() == claimed and checkpoints() == stored  # Catch+commit cannot leave a room half-claim.


def test_real_unseated_host_and_inactive_account_cannot_claim_and_private_room_cannot_call(server):
    game, owner = setup(server, seated=False)
    before = claims()
    with session_scope() as db, pytest.raises(calls.WattenOpenSeatError, match="not_player"):
        claim(db, game, owner)
    assert post(server, game, owner).status_code == 403
    private, _ = setup(server, owner=owner, password="private-call-must-never-send")
    assert post(server, private, owner).status_code == 409
    seat(server, game, owner, 0)
    with session_scope() as db:
        db.get(User, owner[0].user_id).is_active = False
    with session_scope() as db, pytest.raises(calls.WattenOpenSeatError, match="not_player"):
        claim(db, game, owner)
    assert claims() == before


def test_claim_revalidates_stored_seats_and_revision_instead_of_stale_or_forged_runtime(server):
    game, owner = setup(server)
    before = claims()
    for actor, revision in ((True, game["_watten"].room.revision), (owner[0].user_id, True),
                            (owner[0].user_id, 0), (999, game["_watten"].room.revision)):
        with session_scope() as db, pytest.raises(calls.WattenOpenSeatError):
            calls.claim_open_seat_in_session(db, game["_id"], actor, revision)
    closed = copy_game(game)
    runtime = closed["_watten"]
    room = replace(runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1))
    _sync(closed, replace(runtime, room=close_expired(room, revision=room.revision, now=utcnow())), public=True)
    persist_watten_game(closed)
    with session_scope() as db, pytest.raises(calls.WattenOpenSeatError, match="stale_room_revision"):
        claim(db, game, owner)
    assert claims() == before
    assert post(server, game, owner).status_code == 409


def test_actual_concurrent_room_claim_has_one_winner_and_does_not_consume_losing_account(server):
    game, owner = setup(server, players=3)
    other = native.account("OtherSeatedCaller")
    seat(server, game, other, 1)
    now, thread = utcnow(), local()
    before = checkpoints()
    # Six cooldown windows remain inside the actual one-hour waiting deadline.
    for number in range(6):
        winner, loser = (owner, other) if number % 2 == 0 else (other, owner)
        ready, commit = Event(), Event()
        previous = dict(claims()[1])[loser[0].user_id]

        def handoff(_connection, _cursor, statement, _parameters, _context, _many):
            # Hold a real uncommitted winning write. A writer-first loser
            # hands off at its reservation attempt, before reading anything.
            # A deferred loser instead reads the old snapshot and fails its
            # UPDATE; no retry or tolerated busy error can hide that failure.
            if getattr(thread, "loser", False) and statement == "BEGIN IMMEDIATE":
                commit.set()

        def winning_claim():
            with session_scope() as db:
                claim(db, game, winner, now=now + timedelta(seconds=600 * number))
                ready.set()
                assert commit.wait(timeout=5), "loser never attempted its write reservation"
            return "claimed"

        def losing_claim():
            thread.loser = True
            try:
                with session_scope() as db:
                    claim(db, game, loser, now=now + timedelta(seconds=600 * number))
                return "unexpected second claim"
            except calls.WattenOpenSeatError as exc:
                return str(exc)
            finally:
                commit.set()

        event.listen(get_engine(), "before_cursor_execute", handoff)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                first = pool.submit(winning_claim)
                if not ready.wait(timeout=5):
                    first.result(timeout=0)  # Surface an actual writer error instead of hiding it behind the event.
                    pytest.fail("winner never acquired the actual database write")
                second = pool.submit(losing_claim)
                assert second.result(timeout=5) == "game_invite_cooldown"
                assert first.result(timeout=5) == "claimed"
        finally:
            commit.set()
            event.remove(get_engine(), "before_cursor_execute", handoff)
        rows, accounts = claims()
        assert len(rows) == 1 and dict(accounts)[loser[0].user_id] == previous
        assert checkpoints() == before


def test_coordinator_uses_explicit_fake_transport_only_after_commit_and_retains_barrier_on_uncertain_failure(server):
    game, owner = setup(server)
    before, received = checkpoints(), []

    async def transport(receipt):
        rows, accounts = claims()
        assert len(rows) == 1 and accounts[0][1] is not None  # Different actual DB session sees commit.
        assert set(asdict(receipt)) == {"game_id", "sender_user_id", "room_revision", "claimed_at"}
        assert checkpoints() == before
        received.append(receipt)
        raise RuntimeError("uncertain fake delivery")

    with pytest.raises(RuntimeError, match="uncertain fake delivery"):
        asyncio.run(calls.coordinate_open_seat(game["_id"], game["_watten"].room.revision,
                    resolve_actor=lambda: owner[0].user_id, transport=transport))
    with pytest.raises(calls.WattenOpenSeatError, match="game_invite_cooldown"):
        asyncio.run(calls.coordinate_open_seat(game["_id"], game["_watten"].room.revision,
                    resolve_actor=lambda: owner[0].user_id, transport=transport))
    assert len(received) == 1 and checkpoints() == before


def test_successful_coordinator_returns_only_coarse_fake_outcome_and_commits_even_when_nobody_reachable(server):
    for number, notified in enumerate((False, True)):
        owner = native.account(f"FakeCallOwner{number}")
        game, _ = setup(server, owner=owner)
        before = checkpoints()

        async def transport(receipt):
            assert receipt.sender_user_id == owner[0].user_id
            assert len(claims()[0]) == number + 1
            return notified

        assert asyncio.run(calls.coordinate_open_seat(game["_id"], game["_watten"].room.revision,
                           resolve_actor=lambda: owner[0].user_id, transport=transport)) == {"ok": True, "notified": notified}
        assert checkpoints() == before


def test_coordinator_account_change_after_lock_never_claims_or_calls_fake_transport(server):
    game, owner = setup(server)
    actors = iter((owner[0].user_id, owner[0].user_id + 1))

    async def transport(_claim):
        pytest.fail("changed actor reached transport")

    before = claims()
    with pytest.raises(calls.WattenOpenSeatError, match="account_changed"):
        asyncio.run(calls.coordinate_open_seat(game["_id"], game["_watten"].room.revision,
                    resolve_actor=lambda: next(actors), transport=transport))
    assert claims() == before


def test_actual_interleaved_checkpoint_closure_beats_source_cas_and_prevents_fake_delivery(server):
    game, owner = setup(server)
    candidate = copy_game(game)
    runtime = candidate["_watten"]
    room = replace(runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1))
    _sync(candidate, replace(runtime, room=close_expired(room, revision=room.revision, now=utcnow())), public=True)
    ready, commit, thread = Event(), Event(), local()
    original, before = checkpoints()[game["_id"]], claims()

    def handoff(_connection, _cursor, statement, _parameters, _context, _many):
        if getattr(thread, "claiming", False) and statement == "BEGIN IMMEDIATE":
            commit.set()

    def close_checkpoint():
        with session_scope() as db:
            assert _write_checkpoint(db, candidate, expected_json=original)
            ready.set()
            assert commit.wait(timeout=5), "claim never attempted its writer reservation"

    async def transport(_claim):
        pytest.fail("closed source reached fake delivery")

    def attempt():
        thread.claiming = True
        return asyncio.run(calls.coordinate_open_seat(game["_id"], game["_watten"].room.revision,
                           resolve_actor=lambda: owner[0].user_id, transport=transport))

    event.listen(get_engine(), "before_cursor_execute", handoff)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            closing = pool.submit(close_checkpoint)
            assert ready.wait(timeout=5), "closure never acquired the actual write"
            claiming = pool.submit(attempt)
            with pytest.raises(calls.WattenOpenSeatError, match="stale_room_revision"):
                claiming.result(timeout=5)
            closing.result(timeout=5)
    finally:
        commit.set()
        event.remove(get_engine(), "before_cursor_execute", handoff)
    closed = checkpoints()[game["_id"]]
    assert json.loads(closed)["_watten"]["room"]["status"] == "closed" and claims() == before
    # Exact source CAS still rejects a genuinely obsolete checkpoint, even
    # though ordinary competing writers now serialize before taking snapshots.
    with session_scope() as db, pytest.raises(calls.WattenOpenSeatError, match="open_seat_retry"):
        calls._claim_source(db, game["_id"], original)
    assert checkpoints()[game["_id"]] == closed and claims() == before


def test_existing_caller_read_snapshot_is_not_silently_restarted_or_committed(server):
    game, owner = setup(server)
    original, before = checkpoints()[game["_id"]], claims()
    candidate = copy_game(game)
    runtime = candidate["_watten"]
    room = replace(runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1))
    _sync(candidate, replace(runtime, room=close_expired(room, revision=room.revision, now=utcnow())), public=True)
    with session_scope() as db:
        connection = db.connection()
        connection.exec_driver_sql("BEGIN")  # Deliberate existing caller-owned read transaction.
        assert db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])) == original
        persist_watten_game(candidate)  # Different real DB connection commits a newer source.
        with pytest.raises(OperationalError) as error:
            claim(db, game, owner)
        assert getattr(error.value.orig, "sqlite_errorcode", None) == sqlite3.SQLITE_BUSY_SNAPSHOT
        assert connection.connection.driver_connection.in_transaction
        # The helper preserved the caller's original snapshot; only the caller
        # may abandon it. Neither cooldown barrier was partly committed.
        assert db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])) == original
        assert claims() == before
        db.rollback()
    assert json.loads(checkpoints()[game["_id"]])["_watten"]["room"]["status"] == "closed"


def test_model_fk_cascade_and_postgresql_sql_compile_without_claiming_server_verification(server):
    game, owner = setup(server)
    with session_scope() as db:
        claim(db, game, owner)
    for dialect in (sqlite.dialect(), postgresql.dialect()):
        ddl = str(CreateTable(WattenOpenSeatClaim.__table__).compile(dialect=dialect))
        upsert = str(calls._room_upsert(dialect.name, game["_id"], utcnow()).compile(dialect=dialect))
        assert "REFERENCES active_games (game_id) ON DELETE CASCADE" in ddl
        assert "ON CONFLICT (game_id) DO UPDATE" in upsert and "WHERE" in upsert
    with session_scope() as db:
        db.execute(delete(ActiveGame).where(ActiveGame.game_id == game["_id"]))
    assert claims()[0] == []


def test_additive_leaf_migration_preserves_existing_rows_and_refuses_lossy_downgrade(tmp_path):
    filename = tmp_path / "call-migration.sqlite3"
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{filename}")
    command.upgrade(config, "20261018_0073")
    with sqlite3.connect(filename, isolation_level=None) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("INSERT INTO active_games(game_id,state_json,created_at,updated_at) "
                   "VALUES ('preserved','unchanged','2026-10-18','2026-10-18')")
        before = db.execute("SELECT * FROM active_games").fetchall()
        command.upgrade(config, "20261018_0074")
        assert db.execute("SELECT * FROM active_games").fetchall() == before
        with pytest.raises(sqlite3.IntegrityError, match="FOREIGN KEY"):
            db.execute("INSERT INTO watten_open_seat_claims VALUES ('missing','2026-10-18')")
        db.execute("INSERT INTO watten_open_seat_claims VALUES ('preserved','2026-10-18')")
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, "20261018_0073")
        assert db.execute("SELECT * FROM active_games").fetchall() == before
        db.execute("DELETE FROM active_games WHERE game_id='preserved'")
        assert db.execute("SELECT COUNT(*) FROM watten_open_seat_claims").fetchone() == (0,)
        command.downgrade(config, "20261018_0073")
        command.upgrade(config, "20261018_0074")
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    spec = importlib.util.spec_from_file_location("watten_call_migration", BASE / "alembic/versions/20261018_0074_watten_open_seat_claims.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    buffer = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buffer})
    with Operations.context(context):
        module.upgrade()
    assert "CREATE TABLE watten_open_seat_claims" in buffer.getvalue()
    assert "ON DELETE CASCADE" in buffer.getvalue()
