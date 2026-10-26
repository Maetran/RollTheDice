"""Accepted dragon claims paint the table, without changing game decisions."""
import asyncio
import json
from itertools import count
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.database import session_scope
from app.game_state import games
from app.models import ActiveGame, WattenTableSurpriseClaim
from app.watten_runtime import copy_game, lobby_entry, restore_watten_json, serialize_watten_game, snapshot_watten
from app.watten_surprises import handle_surprise, table_effects_projection
from app.watten_websocket import _handle_locked
from tests import test_watten_runtime as runtime_tests

server = runtime_tests.server


def live_table(server):
    game_id, owners, sessions = runtime_tests.local_started(server, count_players=2, target=11)
    numbers = count()
    runtime_tests.advance_to_play(game_id, sessions, numbers)
    game = games[game_id]
    identities = {session.websocket: session.auth_identity for session in sessions}
    data = {"action": "watten_table_surprise", "deal_id": game["_watten"].engine.deal_id, "effect": "dragon"}
    for session in sessions:
        session.websocket.messages.clear()
    return game, owners, sessions, identities.get, data, numbers


def test_committed_dragon_is_shared_restored_and_kept_for_later_deals_but_not_a_new_table(server):
    game, owners, sessions, identity, data, numbers = live_table(server)
    before = serialize_watten_game(game)
    assert table_effects_projection(game) == {"scorched_cards": False}
    with patch("app.watten_surprises.eligible_effect", return_value="dragon"):
        asyncio.run(handle_surprise(sessions[0], data, identity))
        with pytest.raises(ValueError, match="watten_action_unavailable"):
            asyncio.run(handle_surprise(sessions[1], data, identity))
    assert serialize_watten_game(game) == before
    for session in sessions:
        events = [item for item in session.websocket.messages if "watten_table_surprise" in item]
        assert len(events) == 1
        assert events[0]["watten_table_effects"] == {"scorched_cards": True}
        assert snapshot_watten(game, session.player_id)["table_effects"] == {"scorched_cards": True}
    assert snapshot_watten(game)["table_effects"] == {"scorched_cards": True}
    with session_scope() as db:
        checkpoint = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    restored = restore_watten_json(checkpoint)
    assert snapshot_watten(restored, sessions[0].player_id)["table_effects"] == {"scorched_cards": True}
    by_player = {session.player_id: session for session in sessions}
    for _ in range(20):
        if game["_watten"].engine.phase == "deal_complete":
            break
        player, command = runtime_tests.next_move(game["_id"], numbers)
        asyncio.run(_handle_locked(by_player[player], command["action"], command))
    state = game["_watten"].engine
    assert state.phase == "deal_complete"
    command = runtime_tests.room_command(game["_id"], "watten_next_deal", next(numbers),
                                         deal_id=state.deal_id, opportunity=state.opportunity)
    asyncio.run(_handle_locked(sessions[0], command["action"], command))
    assert game["_watten"].engine.deal_id != data["deal_id"]
    assert snapshot_watten(game, sessions[0].player_id)["table_effects"] == {"scorched_cards": True}
    fresh = games[runtime_tests.create_game(server, owners[0])]
    assert snapshot_watten(fresh)["table_effects"] == {"scorched_cards": False}


@pytest.mark.parametrize("rejection", ("wrong_deal", "stale_checkpoint", "unauthorized", "rollback", "commit_failure"))
def test_rejected_or_rolled_back_activation_never_scorches_or_broadcasts(server, rejection):
    game, _owners, sessions, identity, data, _numbers = live_table(server)
    assert table_effects_projection(game) == {"scorched_cards": False}
    if rejection == "wrong_deal":
        data["deal_id"] += "-old"
    if rejection == "stale_checkpoint":
        with session_scope() as db:
            db.scalar(select(ActiveGame).where(ActiveGame.game_id == game["_id"])).state_json = json.dumps({"stale": True})
    resolver = (lambda _socket: None) if rejection == "unauthorized" else identity
    with patch("app.watten_surprises.eligible_effect", return_value="dragon"), \
            patch("app.watten_surprises.session_scope", wraps=session_scope) as accesses:
        if rejection == "rollback":
            # Failure after the claim flush must roll the whole claim back.
            with patch("app.watten_surprises.WattenTableSurpriseWitness", side_effect=RuntimeError("witness failed")):
                with pytest.raises(RuntimeError, match="witness failed"):
                    asyncio.run(handle_surprise(sessions[0], data, resolver))
        elif rejection == "commit_failure":
            with patch("sqlalchemy.orm.Session.commit", side_effect=RuntimeError("commit failed")):
                with pytest.raises(RuntimeError, match="commit failed"):
                    asyncio.run(handle_surprise(sessions[0], data, resolver))
        else:
            with pytest.raises(ValueError, match="watten_(?:action_unavailable|stale_revision)"):
                asyncio.run(handle_surprise(sessions[0], data, resolver))
        before_projection = accesses.call_count
        assert table_effects_projection(game) == {"scorched_cards": False}
        assert accesses.call_count == before_projection == (0 if rejection in {"wrong_deal", "unauthorized"} else 1)
    assert all(not session.websocket.messages for session in sessions)
    with session_scope() as db:
        assert db.scalar(select(WattenTableSurpriseClaim).where(WattenTableSurpriseClaim.game_id == game["_id"])) is None


def test_a_valid_other_effect_does_not_scorch_the_table(server):
    game, _owners, sessions, identity, data, _numbers = live_table(server)
    data["effect"] = "hammer"
    with patch("app.watten_surprises.eligible_effect", return_value="hammer"):
        asyncio.run(handle_surprise(sessions[0], data, identity))
    assert table_effects_projection(game) == {"scorched_cards": False}
    assert all(session.websocket.messages[0]["watten_table_effects"] == {"scorched_cards": False} for session in sessions)


def test_a_loaded_game_hydrates_once_across_recipients_lobby_and_native_copies(server):
    game, owners, sessions, _identity, _data, _numbers = live_table(server)
    source = json.dumps(serialize_watten_game(game))
    loaded = restore_watten_json(source)
    with patch("app.watten_surprises.session_scope", wraps=session_scope) as reads:
        for _ in range(5):
            for session in sessions:
                assert snapshot_watten(loaded, session.player_id)["table_effects"] == {"scorched_cards": False}
            assert snapshot_watten(loaded)["table_effects"] == {"scorched_cards": False}
            lobby_entry(loaded, owners[0][0].user_id)
            assert table_effects_projection(copy_game(loaded)) == {"scorched_cards": False}
        assert reads.call_count == 1
    assert json.dumps(serialize_watten_game(loaded)) == source


def test_accepted_dragon_updates_hydrated_cache_without_a_second_read_and_fresh_restore_rehydrates(server):
    game, _owners, sessions, identity, data, _numbers = live_table(server)
    source = json.dumps(serialize_watten_game(game))
    assert table_effects_projection(game) == {"scorched_cards": False}
    with patch("app.watten_surprises.eligible_effect", return_value="dragon"), \
            patch("app.watten_surprises.session_scope", wraps=session_scope) as writes:
        asyncio.run(handle_surprise(sessions[0], data, identity))
        assert writes.call_count == 1, "the accepted transaction updates cache only after commit; event projection does not read again"
        for _ in range(10):
            assert table_effects_projection(game) == {"scorched_cards": True}
            assert table_effects_projection(copy_game(game)) == {"scorched_cards": True}
        assert writes.call_count == 1
    assert json.dumps(serialize_watten_game(game)) == source
    # Recovery/takeover starts with the same original checkpoint, without a
    # process-global cached false or speculative replay of the dragon event.
    recovered = restore_watten_json(source)
    with patch("app.watten_surprises.session_scope", wraps=session_scope) as reads:
        for _ in range(10):
            assert table_effects_projection(recovered) == {"scorched_cards": True}
        assert reads.call_count == 1


def test_a_failed_hydration_or_unready_schema_does_not_poison_a_later_read(server):
    game, _owners, _sessions, _identity, _data, _numbers = live_table(server)
    loaded = restore_watten_json(json.dumps(serialize_watten_game(game)))
    with patch("app.watten_surprises.database_schema_ready", return_value=False), \
            patch("app.watten_surprises.session_scope", wraps=session_scope) as reads:
        assert table_effects_projection(loaded) == {"scorched_cards": False}
        assert reads.call_count == 0
    with patch("app.watten_surprises.session_scope", side_effect=RuntimeError("read failed")):
        with pytest.raises(RuntimeError, match="read failed"):
            table_effects_projection(loaded)
    with patch("app.watten_surprises.session_scope", wraps=session_scope) as reads:
        assert table_effects_projection(loaded) == {"scorched_cards": False}
        assert table_effects_projection(loaded) == {"scorched_cards": False}
        assert reads.call_count == 1
