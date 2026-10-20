"""Actual native follow-up authority, restart, two-row atomicity and safe seats."""

import json
from dataclasses import replace
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import SQLAlchemyError

from app import watten_rematch as rematch
from app.database import session_scope
from app.game_state import games
from app.models import ActiveGame
from app.security import hash_password, utcnow
from app.watten_room import close_expired
from app.watten_runtime import (
    _sync,
    admit_account,
    apply_runtime_action,
    persist_watten_game,
    restore_watten_json,
    snapshot_watten,
)
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch
from tests.test_watten_progression_store import counts

server = native.server


def source_for(*, players=2, cpus=(), password=None, closed=False):
    owners = [native.account(f"FollowHuman{index}") for index in range(players - len(cpus))]
    match = NativeMatch(players, cpus=cpus, target=3, start=not closed)
    if closed:
        room = replace(match.runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1))
        _sync(match.game, replace(match.runtime, room=close_expired(room, revision=room.revision, now=utcnow())), public=True)
    else:
        match.ready()
        match.finish()
    if password:
        room = replace(match.runtime.room, recipe=replace(match.runtime.room.recipe, password_required=True))
        match.game["_watten"] = replace(match.runtime, room=room)
        match.game["_passphrase"] = hash_password(password)
    persist_watten_game(match.game, creating=True)
    games[match.game["_id"]] = match.game
    return match, owners


def command(source, *, protection=None, command_id="follow-up-request"):
    return {"command_id": command_id, "revision": source["_watten"].room.revision,
            "protection": {"mode": "disabled"} if protection is None else protection}


def post(client, source, owner, data, **headers):
    identity, cookie = owner
    return client.post(f"/api/watten/games/{source['_id']}/rematch", json=data,
        headers={"Cookie": cookie, "Origin": native.LOCAL, "X-CSRF-Token": identity.csrf_token, "X-Watten-Expected-Account-Id": str(identity.user_id), **headers})


def checkpoints():
    with session_scope() as db:
        return dict(db.execute(select(ActiveGame.game_id, ActiveGame.state_json)).all())


@pytest.mark.parametrize("players,cpus", ((2, ()), (3, (2,)), (4, (3,))))
def test_real_host_follow_up_copies_canonical_recipe_without_moving_starting_or_revaluing(server, players, cpus, monkeypatch):
    match, owners = source_for(players=players, cpus=cpus)
    source, recipe = match.game, match.runtime.room.recipe
    from app import watten_completion

    monkeypatch.setattr(watten_completion, "store_completion_progress", lambda *_args: pytest.fail("rematch revalued source progress"))
    data = command(source)
    with session_scope() as db:
        journal = counts(db)
    result = post(server, source, owners[0], data)
    assert result.status_code == 200, result.text
    follow = result.json()
    target = games[follow["game_id"]]
    room = target["_watten"].room
    assert follow["created"] and room.rematch_of == source["_id"] and room.status == "waiting"
    assert room.recipe == replace(recipe, password_required=False)
    assert room.members[0].account_id == owners[0][0].user_id and room.members[0].seat is None and len(room.members) == 1
    assert tuple(cpu.seat for cpu in room.cpus) == cpus and target["_watten"].engine is None
    assert not target["_started"] and not target["_completion_persisted"] and target["_watten_result"] is None
    assert source["_watten"].room.rematch_room_id == target["_id"]
    assert room.series == replace(source["_watten"].room.series, continuation_locked=True) and room.series.completed_games == 1
    stored = checkpoints()
    assert len(stored) == 2
    restored_target = restore_watten_json(stored[target["_id"]])
    assert restored_target["_watten"].room.series == room.series
    assert tuple(item.player_id for item in restored_target["_watten"].cpu_memories) == tuple(item.participant_id for item in room.cpus)
    retry = post(server, source, owners[0], data)
    assert retry.status_code == 200 and retry.json()["game_id"] == target["_id"] and not retry.json()["created"]
    with session_scope() as db:
        assert counts(db) == journal
    if len(owners) > 1:
        own = snapshot_watten(target, viewer_account_id=owners[1][0].user_id)["room"]["reservation"]
        assert own["seat"] == next(item.seat for item in match.runtime.room.members if item.account_id == owners[1][0].user_id)
        detail = server.get(f"/api/games/{target['_id']}", headers={"Cookie": owners[1][1]})
        assert detail.status_code == 200 and detail.json()["room"]["reservation"] == own
        stranger = native.account("NoForeignReservation")
        detail = server.get(f"/api/games/{target['_id']}", headers={"Cookie": stranger[1]})
        assert detail.status_code == 200 and detail.json()["room"]["reservation"] is None and "engine" not in detail.json()
        assert server.get(f"/api/games/{target['_id']}?check=1", headers={"Cookie": stranger[1]}).status_code == 403
    public = snapshot_watten(target)
    assert public["room"]["reservation"] is None
    assert all(key not in json.dumps(public) for key in ('"account_id"', '"user_id"', '"reservations"'))
    candidate, player = admit_account(target, owners[0][0], room.revision, None)
    if players == 4:
        with pytest.raises(ValueError, match="team_confirmation"):
            apply_runtime_action(candidate, owners[0][0].user_id, player,
                {"action": "watten_take_seat", "command_id": "bad-team", "revision": candidate["_watten"].room.revision,
                 "lifecycle_revision": 0, "seat": 0, "team": None})
    assert not candidate["_started"]


def test_lost_ack_restart_and_different_command_id_reuse_exact_same_persisted_target(server, monkeypatch):
    match, owners = source_for()
    source, calls = match.game, []
    monkeypatch.setattr(rematch, "enforce_game_creation_rate_limit", lambda _request: calls.append("new-table"))
    data = command(source)
    first = post(server, source, owners[0], data).json()
    assert calls == ["new-table"]
    raw = checkpoints()
    games.clear()
    games.update({key: restore_watten_json(value) for key, value in raw.items()})
    restored = games[source["_id"]]
    repeated = post(server, restored, owners[0], data)
    assert repeated.status_code == 200 and repeated.json()["game_id"] == first["game_id"] and not repeated.json()["created"]
    newer = post(server, restored, owners[0], command(restored, command_id="another-tab"))
    assert newer.status_code == 200 and newer.json()["game_id"] == first["game_id"]
    assert calls == ["new-table"] and checkpoints() == raw


def test_password_free_rematch_uses_fixed_account_membership_instead_of_the_source_password(server):
    match, owners = source_for(password="old-source-only")
    old_hash = match.game["_passphrase"]
    data = {"command_id": "fixed-rematch", "revision": match.runtime.room.revision}
    response = post(server, match.game, owners[0], data)
    assert response.status_code == 200, response.text
    target = games[response.json()["game_id"]]
    assert target["_passphrase"] is None and not target["_watten"].room.recipe.password_required
    assert target["_watten"].room.series.roster_locked and match.game["_passphrase"] == old_hash
    assert "old-source-only" not in json.dumps(checkpoints()) and old_hash not in json.dumps(response.json())
    stranger = native.account("ForeignRematchAccount")
    with pytest.raises(ValueError, match="wrong_passphrase"):
        admit_account(target, stranger[0], target["_watten"].room.revision, None)
    assert post(server, match.game, owners[0], data).json()["game_id"] == target["_id"]
    assert post(server, match.game, owners[0], command(match.game)).status_code == 200
    assert post(server, match.game, owners[0], command(match.game, protection={"mode": "fresh_password", "password": "unused"})).status_code == 409


def test_closed_waiting_and_running_matches_have_no_completed_match_rematch_shortcut(server):
    match, owners = source_for(closed=True)
    assert match.game["_aborted"] and match.runtime.engine is None
    response = post(server, match.game, owners[0], command(match.game))
    assert response.status_code == 409
    ongoing = NativeMatch()
    ongoing.game["_id"] = "ongoing-is-not-aborted"
    # Use a fully fresh canonical room ID rather than editing engine identity.
    # Its actual start/checkpoint is valid and has no awarded result.
    ongoing.game["_watten"] = replace(ongoing.runtime, room=replace(ongoing.runtime.room, room_id=ongoing.game["_id"]))
    persist_watten_game(ongoing.game, creating=True)
    games[ongoing.game["_id"]] = ongoing.game
    blocked = post(server, ongoing.game, owners[0], command(ongoing.game))
    assert blocked.status_code == 409 and "requires_finished" in blocked.text


def test_failed_target_write_rolls_back_source_link_and_no_live_state_is_installed(server, monkeypatch):
    match, owners = source_for()
    before, data, real = checkpoints(), command(match.game), rematch._write_checkpoint

    def fail_target(db, checkpoint, **kwargs):
        if kwargs.get("creating"):
            raise SQLAlchemyError("injected target checkpoint write failure")
        return real(db, checkpoint, **kwargs)

    monkeypatch.setattr(rematch, "_write_checkpoint", fail_target)
    failed = post(server, match.game, owners[0], data)
    assert failed.status_code == 503 and checkpoints() == before and len(games) == 1
    assert match.game["_watten"].room.rematch_room_id is None
    monkeypatch.setattr(rematch, "_write_checkpoint", real)
    assert post(server, match.game, owners[0], data).status_code == 200


def test_independent_stale_session_losing_source_cas_reloads_winning_target_without_duplicate(server, monkeypatch):
    match, owners = source_for()
    data, real, winning = command(match.game), rematch._write_checkpoint, []

    def interleave(db, checkpoint, **kwargs):
        if kwargs.get("expected_json") is not None and not winning:
            winning.append("in-progress")
            winner = rematch.create_follow_up(match.game["_id"], owners[0][0], data)
            winning[0] = winner.target["_id"]
        return real(db, checkpoint, **kwargs)

    monkeypatch.setattr(rematch, "_write_checkpoint", interleave)
    result = rematch.create_follow_up(match.game["_id"], owners[0][0], data)
    assert result.target["_id"] == winning[0] and not result.created
    assert set(checkpoints()) == {match.game["_id"], winning[0]}
    assert restore_watten_json(checkpoints()[match.game["_id"]])["_watten"].room.rematch_room_id == winning[0]


def test_access_csrf_host_creation_blocks_and_strict_payload_fail_before_mutation(server, monkeypatch):
    match, owners = source_for()
    source, data, before = match.game, command(match.game), checkpoints()
    assert server.post(f"/api/watten/games/{source['_id']}/rematch", json=data).status_code == 401
    assert post(server, source, owners[0], data, **{"X-CSRF-Token": "wrong"}).status_code == 403
    assert post(server, source, owners[1], data).status_code == 409
    assert post(server, source, owners[0], {**data, "account_id": owners[1][0].user_id}).status_code == 409
    assert post(server, source, owners[0], {**data, "revision": True}).status_code == 409
    for expected in (str(owners[1][0].user_id), "01", "true", "-1"):
        if expected.isascii():
            changed = post(server, source, owners[0], data, **{"X-Watten-Expected-Account-Id": expected})
            assert changed.status_code == 409 and changed.json()["detail"] == "watten_account_changed"
            assert changed.headers["cache-control"] == "no-store"
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    assert post(server, source, owners[0], data).status_code == 404
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "1")
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    assert post(server, source, owners[0], data).status_code == 404
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", native.LOCAL)
    assert post(server, source, owners[0], data, Host="evil.invalid").status_code == 404

    def block_creation(_request):
        raise HTTPException(status_code=429, detail="game_creation_temporarily_blocked")

    monkeypatch.setattr(rematch, "enforce_game_creation_rate_limit", block_creation)
    assert post(server, source, owners[0], data).status_code == 429
    assert checkpoints() == before and match.game["_watten"].room.rematch_room_id is None


def test_source_authority_select_emits_postgresql_for_update_without_claiming_a_live_pg_server():
    queries = []

    class Capture:
        def scalar(self, statement):
            queries.append(str(statement.compile(dialect=postgresql.dialect())))
            return None

    with pytest.raises(rematch.WattenRematchError, match="source_unavailable"):
        rematch._stored(Capture(), "a" * 16, lock=True)
    assert "FOR UPDATE" in queries[0]


def test_failure_at_actual_transaction_commit_keeps_both_checkpoints_and_live_source_unchanged(server, monkeypatch):
    from sqlalchemy.orm import Session

    match, owners = source_for()
    before, data = checkpoints(), command(match.game)

    def fail_commit(_db):
        raise SQLAlchemyError("injected final rematch commit failure")

    with monkeypatch.context() as fault:
        fault.setattr(Session, "commit", fail_commit)
        with pytest.raises(SQLAlchemyError, match="final rematch commit"):
            rematch.create_follow_up(match.game["_id"], owners[0][0], data)
    assert checkpoints() == before and len(games) == 1
    assert match.game["_watten"].room.rematch_room_id is None


@pytest.mark.parametrize("stage", ("body", "source_lock"))
def test_revoked_original_cookie_during_await_cannot_create_under_another_logged_in_account(server, monkeypatch, stage):
    import asyncio

    from starlette.requests import Request

    from app.auth import login, logout
    from app.watten_runtime import game_lock

    match, owners = source_for()
    source, before = match.game, checkpoints()
    identity, cookie = owners[0]
    body = json.dumps(command(source)).encode()
    template = native.request_for(host="localhost:8127", origin=native.LOCAL, cookie=cookie, csrf=identity.csrf_token)
    scope = {**template.scope, "method": "POST", "path": f"/api/watten/games/{source['_id']}/rematch",
             "headers": [*template.scope["headers"], (b"x-watten-expected-account-id", str(identity.user_id).encode())]}
    monkeypatch.setattr(rematch, "enforce_game_creation_rate_limit", lambda _request: pytest.fail("revoked caller reached creation"))

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def receive():
            entered.set()
            if stage == "body":
                await release.wait()
            return {"type": "http.request", "body": body, "more_body": False}

        lock = game_lock(source)
        if stage == "source_lock":
            await lock.acquire()
        request = Request(scope, receive)
        task = asyncio.create_task(rematch.watten_rematch(source["_id"], request))
        await asyncio.wait_for(entered.wait(), timeout=2)
        logout(cookie.split("=", 1)[1])
        login(native.request_for(host="localhost:8127", origin=native.LOCAL), owners[1][0].username,
              "runtime-account-password-123")
        if stage == "source_lock":
            lock.release()
        release.set()
        with pytest.raises(HTTPException) as failed:
            await asyncio.wait_for(task, timeout=2)
        assert failed.value.status_code == 401 and failed.value.detail == "authentication_required"

    asyncio.run(scenario())
    assert checkpoints() == before and len(games) == 1 and source["_watten"].room.rematch_room_id is None


def test_stale_native_terminal_rejoin_cannot_erase_durable_follow_up_link(server):
    import asyncio

    from app.game_ws_session import GameSocketSession
    from app.watten_runtime import copy_game
    from app.watten_websocket import _handle_locked

    match, owners = source_for()
    stale = copy_game(match.game)
    data = command(stale)
    first = post(server, match.game, owners[0], data)
    target_id = first.json()["game_id"]
    before = checkpoints()
    # A second process still has the old terminal source and legitimately
    # reauthenticates/rejoins it. Its normal writer must not remove S -> T.
    socket = native.CapturingSocket(owners[0])
    session = GameSocketSession(socket, stale, owners[0][0])
    with pytest.raises(ValueError, match="watten_stale_checkpoint"):
        asyncio.run(_handle_locked(session, "rejoin_game", {"action": "rejoin_game", "revision": data["revision"],
            "expected_account_id": owners[0][0].user_id}))
    assert checkpoints() == before and stale["_watten"].room.rematch_room_id is None
    games[stale["_id"]] = stale
    retry = post(server, stale, owners[0], data)
    assert retry.status_code == 200 and retry.json()["game_id"] == target_id and not retry.json()["created"]
    assert set(checkpoints()) == {stale["_id"], target_id}
    assert games[stale["_id"]]["_watten"].room.rematch_room_id == target_id


def test_normal_checkpoint_cas_cannot_overwrite_a_follow_up_committed_after_its_read(server, monkeypatch):
    from sqlalchemy.orm import Session
    from sqlalchemy.sql.dml import Update

    from app.watten_runtime import _write_checkpoint, copy_game

    match, owners = source_for()
    stale, data, winner = copy_game(match.game), command(match.game), []
    real = Session.execute

    def interleave(db, statement, *args, **kwargs):
        if isinstance(statement, Update) and statement.table.name == "active_games" and not winner:
            winner.append("pending")
            committed = rematch.create_follow_up(stale["_id"], owners[0][0], data)
            winner[0] = committed.target["_id"]
        return real(db, statement, *args, **kwargs)

    with monkeypatch.context() as fault:
        fault.setattr(Session, "execute", interleave)
        with pytest.raises(ValueError, match="watten_stale_checkpoint"), session_scope() as db:
            _write_checkpoint(db, stale)
    stored = checkpoints()
    assert set(stored) == {stale["_id"], winner[0]}
    assert restore_watten_json(stored[stale["_id"]])["_watten"].room.rematch_room_id == winner[0]
