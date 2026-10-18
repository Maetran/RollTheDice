"""Native owned checkpoints survive registry retirement without new results."""

import json
from dataclasses import replace
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.database import session_scope
from app.game_state import games
from app.models import ActiveGame
from app.security import utcnow
from app.watten_recovery import restore_owned_watten_game
from app.watten_room import close_expired
from app.watten_runtime import _sync, admit_account, apply_runtime_action, persist_watten_game
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch
from tests.test_watten_progression_store import counts
from tests.test_watten_rematch import checkpoints, command, post
from tests.test_watten_social import attach, history, message
from tests.test_watten_social import call as social_call

server = native.server
SOURCE = "0123456789abcdef"


def source_for(*, status="finished"):
    owners = [native.account(f"Recovery{index}") for index in range(3)]
    match = NativeMatch(target=3, start=status in {"running", "finished"}, game_id=SOURCE)
    if status == "finished":
        match.ready()
        match.finish()
    elif status == "closed":
        room = replace(match.runtime.room, wait_expires_at=utcnow() - timedelta(seconds=1))
        _sync(match.game, replace(match.runtime, room=close_expired(room, revision=room.revision, now=utcnow())), public=True)
    persist_watten_game(match.game, creating=True)
    games[SOURCE] = match.game
    return match.game, owners


def detail(client, owner):
    return client.get(f"/api/games/{SOURCE}", headers={"Cookie": owner[1], "X-Watten-Expected-Account-Id": str(owner[0].user_id)})


@pytest.mark.parametrize("read_source_first", (False, True))
def test_retired_source_and_target_reuse_one_follow_up_without_revaluing(server, read_source_first):
    source, owners = source_for()
    data = command(source)
    first = post(server, source, owners[0], data)
    assert first.status_code == 200, first.text
    target_id = first.json()["game_id"]
    stored = checkpoints()
    with session_scope() as db:
        journal = counts(db)
    games.clear()
    if read_source_first:
        response = detail(server, owners[0])
        assert response.status_code == 200, response.text
        assert response.json()["room"]["rematch"]["game_id"] == target_id
    again = post(server, source, owners[0], {**data, "command_id": "new-tab-after-retirement"})
    assert again.status_code == 200, again.text
    assert again.json()["game_id"] == target_id and not again.json()["created"]
    assert set(games) == {SOURCE, target_id} and checkpoints() == stored
    assert games[target_id]["_watten"].room.status == "waiting" and not games[target_id]["_started"]
    with session_scope() as db:
        assert counts(db) == journal


def test_foreign_finished_checkpoint_is_not_decoded_or_exposed(server, monkeypatch):
    source, owners = source_for()
    games.clear()
    monkeypatch.setattr("app.watten_runtime.restore_watten_json", lambda *_args: pytest.fail("foreign checkpoint decoded"))
    response = detail(server, owners[2])
    assert response.status_code == 200 and response.json() == {"exists": False}
    assert post(server, source, owners[2], command(source)).status_code == 404
    assert SOURCE not in games


@pytest.mark.parametrize("status,recovered", (("running", False), ("waiting", True), ("closed", True)))
def test_only_owned_waiting_or_terminal_rooms_recover_without_resuming(server, status, recovered):
    _source, owners = source_for(status=status)
    stored = checkpoints()
    games.clear()
    assert restore_owned_watten_game(SOURCE, owners[2][0].user_id) is None
    assert SOURCE not in games
    response = detail(server, owners[0])
    assert response.status_code == 200, response.text
    assert bool(response.json()["exists"]) is recovered
    assert (SOURCE in games) is recovered and checkpoints() == stored
    if recovered:
        assert games[SOURCE]["_watten"].room.status == status


def test_retired_corrupt_native_checkpoint_is_retained_and_does_not_fall_back(server):
    _source, owners = source_for()
    with session_scope() as db:
        row = db.scalar(select(ActiveGame).where(ActiveGame.game_id == SOURCE))
        damaged = json.loads(row.state_json)
        damaged["_watten"] = {"bad": "native"}
        row.state_json = json.dumps(damaged)
    games.clear()
    before = checkpoints()
    response = detail(server, owners[0])
    assert response.status_code == 503 and response.json()["detail"] == "watten_storage_unavailable"
    assert response.headers["cache-control"] == "no-store" and "noindex" in response.headers["x-robots-tag"]
    assert checkpoints() == before and SOURCE not in games


@pytest.mark.parametrize("damaged", (False, True))
def test_wrong_expected_account_rejects_before_private_recovery_or_decode(server, monkeypatch, damaged):
    _source, owners = source_for()
    if damaged:
        with session_scope() as db:
            db.scalar(select(ActiveGame).where(ActiveGame.game_id == SOURCE)).state_json = "damaged native JSON"
    games.clear()
    monkeypatch.setattr("app.watten_runtime.restore_watten_json", lambda *_args: pytest.fail("mismatched account decoded"))
    response = server.get(f"/api/games/{SOURCE}", headers={"Cookie": owners[0][1],
                          "X-Watten-Expected-Account-Id": str(owners[1][0].user_id)})
    assert response.status_code == 409 and response.json()["detail"] == "watten_account_changed"
    assert response.headers["cache-control"] == "no-store" and SOURCE not in games


def test_creating_a_follow_up_preserves_live_source_chat_and_retry_channel(server):
    source, owners = source_for()
    sessions = attach(source, owners[:2])
    stream = history(sessions[0])
    social_call(sessions[0], message(stream, text="See you at the next table"))
    cache = source["_watten_social"]
    response = post(server, source, owners[0], command(source))
    assert response.status_code == 200, response.text
    assert source["_watten_social"] is cache
    restored = history(sessions[0])
    assert restored["channel_id"] == stream["channel_id"] and restored["next_nonce"] == 2
    assert restored["events"][0]["text"] == "See you at the next table"
    assert "_watten_social" not in json.loads(checkpoints()[SOURCE])


def test_retry_does_not_reactivate_an_evicted_running_target_without_its_coordinator(server):
    source, owners = source_for()
    data = command(source)
    first = post(server, source, owners[0], data).json()
    target = games[first["game_id"]]
    for seat, owner in enumerate(owners[:2]):
        target, player_id = admit_account(target, owner[0], target["_watten"].room.revision, None)
        target, *_ = apply_runtime_action(target, owner[0].user_id, player_id,
            {"action": "watten_take_seat", "command_id": f"seat-{seat}", "revision": target["_watten"].room.revision,
             "lifecycle_revision": target["_watten"].lifecycle_revision, "seat": seat, "team": None})
    target, *_ = apply_runtime_action(target, owners[0][0].user_id, target["_watten"].room.host_participant_id,
        {"action": "watten_start", "command_id": "start-target", "revision": target["_watten"].room.revision,
         "lifecycle_revision": target["_watten"].lifecycle_revision})
    persist_watten_game(target)
    assert target["_watten"].room.status == "started"
    stored = checkpoints()
    games.clear()
    again = post(server, source, owners[0], data)
    assert again.status_code == 200 and again.json()["game_id"] == first["game_id"] and not again.json()["created"]
    assert set(games) == {SOURCE} and checkpoints() == stored


@pytest.mark.parametrize("raw", ('{"_game_type":"hausdepp"}', '{"legacy":true}', 'broken legacy JSON'))
def test_other_products_keep_the_existing_missing_game_response(server, raw):
    owner = native.account("LegacyRecovery")
    with session_scope() as db:
        db.add(ActiveGame(game_id=SOURCE, state_json=raw, created_at=utcnow(), updated_at=utcnow()))
    response = detail(server, owner)
    assert response.status_code == 200 and response.json() == {"exists": False}
    assert SOURCE not in games and checkpoints() == {SOURCE: raw}
