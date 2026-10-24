"""Explicit private follow-up consent, native gates and fixed account access."""

import importlib.util
import io
import json
import sqlite3
from contextlib import ExitStack
from dataclasses import replace
from datetime import datetime, timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.schema import CreateTable

from alembic import command
from app import watten_invitations as invites
from app.auth import logout
from app.database import session_scope
from app.game_state import games
from app.models import ActiveGame, User, WattenPersonalInvitation
from app.security import utcnow
from app.watten_runtime import (
    _sync,
    admit_account,
    apply_runtime_action,
    persist_watten_game,
    restore_watten_json,
    serialize_watten_game,
)
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch
from tests.test_watten_progression_store import counts
from tests.test_watten_rematch import checkpoints, source_for
from tests.test_watten_rematch import command as rematch_command
from tests.test_watten_rematch import post as rematch_post
from tests.test_watten_results_migration import snapshot, user

server = native.server
BASE = Path(__file__).resolve().parents[1]


def headers(owner, **extra):
    return {"Cookie": owner[1], "Origin": native.LOCAL, "X-CSRF-Token": owner[0].csrf_token,
            "X-Watten-Expected-Account-Id": str(owner[0].user_id), **extra}


def setup(server, *, players=2, cpus=()):
    match, owners = source_for(players=players, cpus=cpus)
    result = rematch_post(server, match.game, owners[0], rematch_command(match.game))
    assert result.status_code == 200, result.text
    return match.game, games[result.json()["game_id"]], owners


def create(server, target, owner, participant="p2", **extra):
    return server.post(f"/api/watten/games/{target['_id']}/invitations", json={"recipient_participant_id": participant},
                       headers=headers(owner, **extra))


def respond(server, row, owner, decision="accepted", **extra):
    return server.post(f"/api/watten/invitations/{row['id']}/respond", json={"decision": decision}, headers=headers(owner, **extra))


def get_detail(server, target, owner, **query):
    return server.get(f"/api/games/{target['_id']}", params=query, headers=headers(owner))


def row_data():
    with session_scope() as db:
        return [(row.id, row.status, row.created_at, row.expires_at, row.responded_at)
                for row in db.scalars(select(WattenPersonalInvitation)).all()]


@pytest.mark.parametrize("players,cpus", ((2, ()), (3, (2,)), (4, (3,))))
def test_explicit_host_choice_previous_humans_only_and_acceptance_changes_no_game_or_progress(server, players, cpus):
    source, target, owners = setup(server, players=players, cpus=cpus)
    with session_scope() as db:
        journal = counts(db)
    before = checkpoints()
    listing = server.get(f"/api/watten/games/{target['_id']}/invitations", headers=headers(owners[0]))
    assert listing.status_code == 200
    assert listing.json()["candidates"] == [{"participant_id": member.participant_id, "name": owners[index][0].username}
        for index, member in enumerate(source["_watten"].room.members) if index > 0]
    assert listing.json()["invitations"] == []
    assert row_data() == []  # Reading/creating a rematch never automatically invites.
    recipient = source["_watten"].room.members[1].participant_id
    response = create(server, target, owners[0], recipient)
    assert response.status_code == 200, response.text
    row = response.json()["invitation"]
    assert row["status"] == "pending" and not row["access_granted"]
    assert not {"account_id", "user_id", "password", "hand", "engine", "recipe", "reservations"} & set(row)
    assert "private-target-only" not in response.text
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    accepted = respond(server, row, owners[1])
    assert accepted.status_code == 200 and accepted.json()["invitation"]["access_granted"]
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    detail = get_detail(server, target, owners[1]).json()
    assert detail["viewer"] is None and detail["engine"] is None
    assert len(target["_watten"].room.members) == 1 and target["_watten"].room.members[0].seat == 0
    assert not target["_started"] and not target["_completion_persisted"] and checkpoints() == before
    with session_scope() as db:
        assert counts(db) == journal
    assert serialize_watten_game(target) == serialize_watten_game(restore_watten_json(before[target["_id"]]))
    assert not any(key in json.dumps(detail) for key in ('"recipient_user_id"', '"sender_user_id"', '"invitations"'))
    if players == 4:
        candidate, player = admit_account(target, owners[1][0], target["_watten"].room.revision, None)
        data = {"action": "watten_take_seat", "command_id": "manual-seat", "revision": candidate["_watten"].room.revision,
                "lifecycle_revision": 0, "seat": 1, "team": 0}
        with pytest.raises(ValueError, match="team_confirmation"):
            apply_runtime_action(candidate, owners[1][0].user_id, player, data)
        with pytest.raises(ValueError, match="roster_locked"):
            apply_runtime_action(candidate, owners[1][0].user_id, player, {**data, "seat": 2})


def test_lost_ack_restart_create_accept_and_decline_are_one_monotonic_identity_without_renewal(server):
    _source, target, owners = setup(server)
    row = create(server, target, owners[0]).json()["invitation"]
    stored = checkpoints()
    assert create(server, target, owners[0]).json()["invitation"] == row
    assert respond(server, row, owners[1]).status_code == 200
    accepted_rows = row_data()
    games.clear()
    games.update({key: restore_watten_json(value) for key, value in stored.items()})
    assert respond(server, row, owners[1]).json()["invitation"]["status"] == "accepted"
    assert respond(server, row, owners[1], "declined").status_code == 409
    assert row_data() == accepted_rows and len(row_data()) == 1 and checkpoints() == stored
    assert create(server, target, owners[0]).json()["invitation"]["id"] == row["id"]


def test_declined_invites_preserve_fixed_roster_but_foreign_opaque_ids_grant_no_access(server):
    _source, target, owners = setup(server)
    stranger = native.account("NeverInvited")
    row = create(server, target, owners[0]).json()["invitation"]
    assert respond(server, row, stranger).status_code == 404
    assert server.get(f"/api/watten/invitations/{row['id']}", headers=headers(stranger)).status_code == 404
    assert server.get(f"/api/watten/games/{target['_id']}/invitations", headers=headers(owners[1])).status_code == 409
    assert server.get("/api/watten/account/invitations", headers=headers(stranger)).json()["invitations"] == []
    assert respond(server, row, owners[1], "declined").status_code == 200
    before = row_data()
    assert respond(server, row, owners[1], "declined").status_code == 200
    assert respond(server, row, owners[1]).status_code == 409
    assert row_data() == before
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    assert get_detail(server, target, stranger, check=1).status_code == 403
    assert get_detail(server, target, stranger, check=1, **{"pass": "private-target-only"}).status_code == 403


def test_fixed_roster_http_and_websocket_access_needs_no_password_or_invitation_acceptance(server):
    _source, target, owners = setup(server)
    stranger = native.account("NeverInOriginalRoster")
    row = create(server, target, owners[0]).json()["invitation"]
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    assert get_detail(server, target, stranger, check=1).status_code == 403
    with ExitStack() as stack:
        denied = stack.enter_context(server.websocket_connect(f"ws://localhost:8127/ws/{target['_id']}", headers=headers(stranger)))
        hello = denied.receive_json()
        for action in ("join_game", "spectate_game"):
            denied.send_json({"action": action, "expected_account_id": stranger[0].user_id,
                              **({"revision": hello["room_revision"]} if action == "join_game" else {})})
            assert denied.receive_json()["error_code"] == "watten_wrong_passphrase"
        spectator = stack.enter_context(server.websocket_connect(f"ws://localhost:8127/ws/{target['_id']}", headers=headers(owners[1])))
        spectator.receive_json()
        spectator.send_json({"action": "spectate_game", "expected_account_id": owners[1][0].user_id})
        assert native.receive(spectator, "spectator_id")["spectator"] is True
        assert len(target["_watten"].room.members) == 1
        assert respond(server, row, owners[1]).status_code == 200
        socket = stack.enter_context(server.websocket_connect(f"ws://localhost:8127/ws/{target['_id']}", headers=headers(owners[1])))
        hello = socket.receive_json()
        socket.send_json({"action": "join_game", "revision": hello["room_revision"], "expected_account_id": owners[1][0].user_id})
        player = native.receive(socket, "player_id")["player_id"]
        assert next(item for item in target["_watten"].room.members if item.participant_id == player).seat == 1
    other = native.create_game(server, owners[0], password="another-target")
    assert get_detail(server, games[other], owners[1], check=1).status_code == 403


def test_fixed_pending_deadline_read_expiry_no_write_and_accepted_grant_outlives_pending_deadline(server, monkeypatch):
    _source, target, owners = setup(server)
    now = utcnow()
    monkeypatch.setattr(invites, "utcnow", lambda: now)
    row = create(server, target, owners[0]).json()["invitation"]
    assert datetime.fromisoformat(row["expires_at"]) <= now + timedelta(minutes=5)
    assert respond(server, row, owners[1]).status_code == 200
    monkeypatch.setattr(invites, "utcnow", lambda: now + timedelta(minutes=6))
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    before = row_data()
    assert server.get("/api/watten/account/invitations", headers=headers(owners[1])).json()["invitations"][0]["status"] == "accepted"
    assert row_data() == before


def test_pending_expires_at_earlier_wait_deadline_retry_never_extends_and_no_late_acceptance(server, monkeypatch):
    _source, target, owners = setup(server, players=3)
    now = utcnow()
    runtime = target["_watten"]
    target["_watten"] = replace(runtime, room=replace(runtime.room, wait_expires_at=now + timedelta(seconds=20)))
    persist_watten_game(target)
    monkeypatch.setattr(invites, "utcnow", lambda: now)
    row = create(server, target, owners[0]).json()["invitation"]
    assert row["expires_at"] == target["_watten"].room.wait_expires_at.isoformat()
    before = row_data(), checkpoints()
    monkeypatch.setattr(invites, "utcnow", lambda: now + timedelta(seconds=21))
    own = server.get("/api/watten/account/invitations", headers=headers(owners[1]))
    assert own.json()["invitations"][0]["status"] == "expired"
    assert create(server, target, owners[0]).json()["invitation"]["id"] == row["id"]
    assert create(server, target, owners[0], "p3").status_code == 409
    assert respond(server, row, owners[1]).status_code == 409
    assert (row_data(), checkpoints()) == before


def test_accepted_access_recovers_retired_waiting_target_after_reservation_expires_without_running_resume(server):
    _source, target, owners = setup(server)
    row = create(server, target, owners[0]).json()["invitation"]
    assert respond(server, row, owners[1]).status_code == 200
    room = target["_watten"].room
    target["_watten"] = replace(target["_watten"], room=replace(room, reservations=()))
    persist_watten_game(target)
    before = checkpoints()
    games.clear()
    detail = get_detail(server, target, owners[1])
    assert detail.status_code == 200 and detail.json()["exists"] and detail.json()["viewer"] is None
    assert target["_id"] in games and checkpoints() == before
    assert server.get(f"/api/watten/invitations/{row['id']}", headers=headers(owners[1])).status_code == 200


def test_full_capacity_reservations_host_change_inactive_and_cpu_recipients_cannot_be_bypassed(server):
    source, target, owners = setup(server, players=4, cpus=(3,))
    assert create(server, target, owners[0], source["_watten"].room.cpus[0].participant_id).status_code == 409
    assert create(server, target, owners[0], "p999").status_code == 409
    assert create(server, target, owners[0], "p1").status_code == 409
    with session_scope() as db:
        db.get(User, owners[2][0].user_id).is_active = False
    assert create(server, target, owners[0], source["_watten"].room.members[2].participant_id).status_code == 404
    row = create(server, target, owners[0], source["_watten"].room.members[1].participant_id).json()["invitation"]
    # The future host joins deliberately through the fixed account binding; then the
    # original host leaves through the pure room transition and durable writer.
    candidate, _player = admit_account(target, owners[1][0], target["_watten"].room.revision, None)
    candidate, *_ = apply_runtime_action(candidate, owners[0][0].user_id, "p1",
        {"action": "leave_waiting_game", "command_id": "old-host-leaves", "revision": candidate["_watten"].room.revision,
         "lifecycle_revision": 0}, eligible_accounts=frozenset({owners[1][0].user_id}))
    persist_watten_game(candidate)
    target.update(candidate)
    assert create(server, target, owners[0]).status_code == 409
    assert respond(server, row, owners[1]).status_code == 200
    assert server.get(f"/api/watten/games/{target['_id']}/invitations", headers=headers(owners[1])).status_code == 200


def test_foreign_capacity_cannot_replace_original_roster_and_pending_invite_expires_at_start(server):
    _source, target, owners = setup(server)
    row = create(server, target, owners[0]).json()["invitation"]
    outsider = native.account("TakesUnreservedCapacity")
    target["_watten"] = replace(target["_watten"], room=replace(target["_watten"].room, reservations=()))
    persist_watten_game(target)
    with pytest.raises(ValueError, match="wrong_passphrase"):
        admit_account(target, outsider[0], target["_watten"].room.revision, "private-target-only")
    candidate, _ = admit_account(target, owners[1][0], target["_watten"].room.revision, None)
    for seat, owner in enumerate(owners):
        assert next(item for item in candidate["_watten"].room.members if item.account_id == owner[0].user_id).seat == seat
    candidate, *_ = apply_runtime_action(candidate, owners[0][0].user_id, "p1",
        {"action": "watten_start", "command_id": "filled-start", "revision": candidate["_watten"].room.revision, "lifecycle_revision": 0})
    persist_watten_game(candidate)
    target.update(candidate)
    assert respond(server, row, owners[1]).status_code == 409
    assert create(server, target, owners[0], "p2").json()["invitation"]["status"] == "expired"
    assert row_data()[0][1] == "pending"


def test_closed_or_finished_target_revokes_only_invitation_access_and_cannot_grant_new_membership(server):
    _source, target, owners = setup(server)
    row = create(server, target, owners[0]).json()["invitation"]
    assert respond(server, row, owners[1]).status_code == 200
    from app.watten_room import close_expired

    runtime = target["_watten"]
    expired = replace(runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1))
    _sync(target, replace(runtime, room=close_expired(expired, revision=expired.revision, now=utcnow())), public=True)
    persist_watten_game(target)
    assert not invites.accepted_invitation_access(target, owners[1][0].user_id)
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    retry = respond(server, row, owners[1])
    assert retry.status_code == 200 and retry.json()["invitation"]["status"] == "accepted" and not retry.json()["invitation"]["access_granted"]
    with pytest.raises(ValueError, match="room_closed"):
        admit_account(target, owners[1][0], target["_watten"].room.revision, None)


def test_invalid_invitation_checkpoint_fails_closed_without_replacing_fixed_account_access(server, monkeypatch):
    _source, target, owners = setup(server)
    row = create(server, target, owners[0]).json()["invitation"]
    assert respond(server, row, owners[1]).status_code == 200
    with session_scope() as db:
        checkpoint = db.scalar(select(ActiveGame).where(ActiveGame.game_id == target["_id"]))
        raw = json.loads(checkpoint.state_json)
        raw["_game_type"] = "hausdepp"
        checkpoint.state_json = json.dumps(raw)
    # Existing roster authority is independent of invitation consent.
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    assert respond(server, row, owners[1]).status_code == 503
    with pytest.raises(ValueError):
        invites.accepted_invitation_access(target, owners[1][0].user_id)
    monkeypatch.setattr(invites, "_pair", lambda *_args, **_kwargs: (_ for _ in ()).throw(SQLAlchemyError("denied database")))
    assert get_detail(server, target, owners[1], check=1).status_code == 200
    with pytest.raises(SQLAlchemyError):
        invites.accepted_invitation_access(target, owners[1][0].user_id)
    stranger = native.account("NoFallbackFromCorruptInvite")
    assert get_detail(server, target, stranger, check=1).status_code == 403


def test_invitation_access_ends_at_completion_but_original_roster_keeps_its_history(server):
    _source, target, owners = setup(server)
    row = create(server, target, owners[0]).json()["invitation"]
    assert respond(server, row, owners[1]).status_code == 200
    outsider = native.account("CannotJoinInstead")
    target["_watten"] = replace(target["_watten"], room=replace(target["_watten"].room, reservations=()))
    with pytest.raises(ValueError, match="wrong_passphrase"):
        admit_account(target, outsider[0], target["_watten"].room.revision, None)
    candidate, _ = admit_account(target, owners[1][0], target["_watten"].room.revision, None)
    for seat, owner in enumerate(owners):
        assert next(item for item in candidate["_watten"].room.members if item.account_id == owner[0].user_id).seat == seat
    candidate, *_ = apply_runtime_action(candidate, owners[0][0].user_id, "p1",
        {"action": "watten_start", "command_id": "manual-start", "revision": candidate["_watten"].room.revision, "lifecycle_revision": 0})
    persist_watten_game(candidate)
    target.update(candidate)
    assert invites.accepted_invitation_access(target, owners[1][0].user_id)
    with pytest.raises(ValueError, match="wrong_passphrase"):
        admit_account(target, outsider[0], target["_watten"].room.revision, None)
    with ExitStack() as stack:
        spectator, _ = native.join(server, stack, target["_id"], owners[1], spectate=True)
        spectator.send_json({"action": "get_state"})
        assert native.receive(spectator, "scoreboard")["scoreboard"]["viewer"] is None
    match = NativeMatch(start=False)
    match.game = target
    match.ready()
    match.finish()
    persist_watten_game(match.game)
    games[target["_id"]] = match.game
    assert not invites.accepted_invitation_access(match.game, owners[1][0].user_id)
    assert get_detail(server, match.game, owners[1], check=1).status_code == 200
    assert get_detail(server, match.game, outsider, check=1).status_code == 403


@pytest.mark.parametrize("operation", ("create", "accept"))
def test_real_interleaved_target_closure_beats_invitation_cas_without_creating_access(server, monkeypatch, operation):
    from app.watten_room import close_expired
    from app.watten_runtime import copy_game

    _source, target, owners = setup(server)
    row = create(server, target, owners[0]).json()["invitation"] if operation == "accept" else None
    original, interleaved = invites._claim_target, []

    def close_before_cas(db, target_id, raw):
        if not interleaved:
            interleaved.append(True)
            candidate = copy_game(target)
            runtime = candidate["_watten"]
            expired = replace(runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1))
            _sync(candidate, replace(runtime, room=close_expired(expired, revision=expired.revision, now=utcnow())), public=True)
            persist_watten_game(candidate)
        return original(db, target_id, raw)

    monkeypatch.setattr(invites, "_claim_target", close_before_cas)
    result = respond(server, row, owners[1]) if row else create(server, target, owners[0])
    assert result.status_code == 409 and interleaved
    assert not row_data() if row is None else row_data()[0][1] == "pending"
    assert not invites.accepted_invitation_access(target, owners[1][0].user_id)


def test_real_interleaved_creation_reloads_same_unique_invitation_without_new_deadline(server, monkeypatch):
    _source, target, owners = setup(server)
    original, winner = invites._claim_target, []

    def create_first(db, target_id, raw):
        if not winner:
            winner.append(None)
            winner[0] = invites.create_invitation(target_id, owners[0][0].user_id, "p2")
        return original(db, target_id, raw)

    monkeypatch.setattr(invites, "_claim_target", create_first)
    result = create(server, target, owners[0])
    assert result.status_code == 200, result.text
    assert result.json()["invitation"] == winner[0] and len(row_data()) == 1


def test_http_fresh_identity_expected_id_csrf_local_gates_and_strict_payload_before_mutation(server, monkeypatch):
    _source, target, owners = setup(server)
    before = checkpoints()
    path = f"/api/watten/games/{target['_id']}/invitations"
    assert server.post(path, json={"recipient_participant_id": "p2"}).status_code == 401
    assert create(server, target, owners[0], **{"X-CSRF-Token": "wrong"}).status_code == 403
    assert create(server, target, owners[0], **{"X-Watten-Expected-Account-Id": str(owners[1][0].user_id)}).status_code == 409
    for body in ({"recipient_participant_id": True}, {"recipient_participant_id": "p2", "account_id": 2},
                 {"recipient_participant_id": "p2", "schema_version": 2}):
        assert server.post(path, json=body, headers=headers(owners[0])).status_code == 409
    assert server.post(path, content='{"recipient_participant_id":"p2","recipient_participant_id":"p2"}', headers=headers(owners[0])).status_code == 409
    assert server.post(path, content="invalid json", headers=headers(owners[0])).status_code == 409
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    monkeypatch.setattr(invites, "_http_identity", lambda *_args: pytest.fail("closed local gate resolved auth"))
    assert create(server, target, owners[0]).status_code == 404
    assert server.get("/api/watten/account/invitations", headers=headers(owners[1])).status_code == 404
    assert row_data() == [] and checkpoints() == before


def test_actual_session_revocation_during_body_rejects_create_and_accept_without_changes(server, monkeypatch):
    _source, target, owners = setup(server)
    original = invites._body

    async def revoke_host(request, fields):
        data = await original(request, fields)
        logout(owners[0][1].split("=", 1)[1])
        return data

    monkeypatch.setattr(invites, "_body", revoke_host)
    assert create(server, target, owners[0]).status_code == 401 and row_data() == []
    # A separate fresh real host session can create; the recipient's original
    # session is then revoked in the actual response-body boundary.
    from app.auth import login
    from tests.test_user_accounts import request_for

    identity, token = login(request_for(host="localhost:8127", origin=native.LOCAL), owners[0][0].username, "runtime-account-password-123")
    fresh_host = identity, owners[0][1].split("=", 1)[0] + "=" + token
    monkeypatch.setattr(invites, "_body", original)
    row = create(server, target, fresh_host).json()["invitation"]
    before = row_data()

    async def revoke_recipient(request, fields):
        data = await original(request, fields)
        logout(owners[1][1].split("=", 1)[1])
        return data

    monkeypatch.setattr(invites, "_body", revoke_recipient)
    assert respond(server, row, owners[1]).status_code == 401 and row_data() == before


def test_failed_transaction_and_lost_exact_target_cas_leave_no_speculative_grant(server, monkeypatch):
    from sqlalchemy.orm import Session

    _source, target, owners = setup(server)
    original = Session.commit

    def fail_commit(_session):
        raise SQLAlchemyError("commit rejected")

    monkeypatch.setattr(Session, "commit", fail_commit)
    with pytest.raises(SQLAlchemyError):
        invites.create_invitation(target["_id"], owners[0][0].user_id, "p2")
    monkeypatch.setattr(Session, "commit", original)
    assert row_data() == []
    row = create(server, target, owners[0]).json()["invitation"]
    monkeypatch.setattr(Session, "commit", fail_commit)
    with pytest.raises(SQLAlchemyError):
        invites.respond_to_invitation(row["id"], owners[1][0].user_id, "accepted")
    monkeypatch.setattr(Session, "commit", original)
    assert row_data()[0][1] == "pending"
    monkeypatch.setattr(invites, "_claim_target", lambda *_args: (_ for _ in ()).throw(invites._LostCAS()))
    assert respond(server, row, owners[1]).status_code == 409
    assert row_data()[0][1] == "pending"


def test_invitation_ddl_compiles_for_postgresql_without_claiming_a_live_server():
    for dialect in (postgresql.dialect(), sqlite.dialect()):
        ddl = str(CreateTable(WattenPersonalInvitation.__table__).compile(dialect=dialect))
        assert "UNIQUE (target_game_id, recipient_user_id)" in ddl
        assert "REFERENCES active_games (game_id) ON DELETE CASCADE" in ddl
        assert "REFERENCES users (id) ON DELETE CASCADE" in ddl
    queries = []

    class Capture:
        def scalar(self, statement):
            queries.append(str(statement.compile(dialect=postgresql.dialect())))
            return None

    with pytest.raises(invites.WattenInvitationError):
        invites._pair(Capture(), "a" * 16, lock=True)
    assert "FOR UPDATE" in queries[0]


def test_additive_sqlite_upgrade_retains_existing_rows_and_downgrade_refuses_invitation_loss(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    path = tmp_path / "personal-invitations.sqlite3"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261018_0072")
    with sqlite3.connect(path, isolation_level=None) as db:
        db.execute("PRAGMA foreign_keys=ON")
        own = user(db)
        db.execute("INSERT INTO active_games (game_id,state_json,created_at,updated_at) VALUES ('kept','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        db.execute("INSERT INTO active_games (game_id,state_json,created_at,updated_at) VALUES ('target','{}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")
        before = db.execute("SELECT * FROM active_games").fetchall()
        old_accounts = snapshot(db)
        command.upgrade(config, "20261018_0073")
        assert db.execute("SELECT * FROM active_games").fetchall() == before
        assert snapshot(db) == old_accounts
        command.downgrade(config, "20261018_0072")
        command.upgrade(config, "20261018_0073")
        params = ("a" * 32, "kept", "target", own, own, "p2", "pending", "2026-10-18T10:00:00Z", "2026-10-18T10:05:00Z", None)
        sql = "INSERT INTO watten_personal_invitations VALUES (?,?,?,?,?,?,?,?,?,?)"
        db.execute(sql, params)
        with pytest.raises(sqlite3.IntegrityError):
            db.execute(sql, ("b" * 32, *params[1:]))
        for key, value in ((6, "unknown"), (9, "2026-10-18T10:01:00Z"), (2, "missing")):
            invalid = list(params)
            invalid[0], invalid[key] = "c" * 32, value
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(sql, invalid)
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, "20261018_0072")
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "20261018_0073"
        db.execute("DELETE FROM users WHERE id=?", (own,))
        assert db.execute("SELECT * FROM watten_personal_invitations").fetchall() == []
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    spec = importlib.util.spec_from_file_location("personal_invitation_migration", BASE / "alembic/versions/20261018_0073_watten_personal_invitations.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        module.upgrade()
    assert "CREATE TABLE watten_personal_invitations" in output.getvalue()
