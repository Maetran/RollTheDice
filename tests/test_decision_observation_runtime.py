"""Decision recording is derived from the acting seat's actual projection."""

import json
from types import SimpleNamespace

import pytest

from app.active_games import serializable_game_state
from app.decision_observation_runtime import prepare_hausdepp, prepare_watten
from app.hausdepp_engine import apply_action, make_deck, new_round
from app.watten_engine import EngineActor, EngineCommand, EngineRecipe, SeatBinding, apply_command, start_match
from app.watten_play import PlayProfile
from tests.test_watten_engine import dealt


def test_hausdepp_projection_excludes_other_hands_names_and_internal_ids():
    people = [{"id": "secret-human-id", "name": "secret-human-name", "is_cpu": False, "user_id": 777},
              {"id": "secret-cpu-id", "name": "secret-cpu-name", "is_cpu": True}]
    before = new_round(people, dealer_index=0, deck=make_deck())
    while before["phase"] == "peeking":
        before = apply_action(before, before["current_player_id"], "peek", version=before["version"])
    actor_id = before["current_player_id"]
    from app.hausdepp_engine import project_state

    view = project_state(before, actor_id)
    card = view["playable_cards"][0]
    command = {"action": "play", "cards": [card], "version": before["version"]}
    after = apply_action(before, actor_id, "play", cards=[card], version=before["version"])
    game = {"_participants": people}
    event = prepare_hausdepp(game, before, after, actor_id, command, policy_version=1)
    stored = json.dumps({key: value for key, value in event.items() if key not in {"eligible_user_ids", "actor_user_id"}})
    assert "secret-human" not in stored and "secret-cpu" not in stored and "777" not in stored
    opponent = next(player for player in before["players"] if player["id"] != actor_id)
    assert not set(opponent["hand"]).intersection(event["context"]["actor_hand"])
    assert event["context"]["actor_hand"] == view["hand"]
    assert event["action"] == {"kind": "play", "cards": [card]}
    assert event["eligible_user_ids"] == (777,)


def test_unpublished_projection_never_enters_hausdepp_checkpoint():
    game = {"_game_type": "hausdepp", "_players": [], "_decision_observation_pending": {
        "eligible_user_ids": [777], "context": {"actor_hand": ["secret-card"]}},
        "_decision_observation": {"id": "a" * 32, "round": 1, "sequence": 1}}
    serialized = json.dumps(serializable_game_state(game))
    assert "secret-card" not in serialized and "777" not in serialized
    assert "a" * 32 in serialized


def test_blind_watten_projection_uses_only_acting_seat_knowledge():
    bindings = (SeatBinding("secret-human-id", 777), SeatBinding("secret-cpu-id", None),
                SeatBinding("secret-other-id", 888), SeatBinding("secret-second-cpu-id", None))
    recipe = EngineRecipe(PlayProfile(4, "ladinisch", True, False), bindings,
                          (("secret-human-id", "secret-other-id"), ("secret-cpu-id", "secret-second-cpu-id")))
    before = start_match(recipe, "secret-deal-id", dealt(), first_dealer="secret-human-id")
    seat = sorted(before.inspectors)[0]
    binding = bindings[seat]
    actor = EngineActor(binding.player_id, binding.account_id)
    request = EngineCommand("secret-command-id", before.deal_id, before.opportunity, before.phase, "show_ready", None)
    after = apply_command(before, actor, request).state
    candidate = {"_watten": SimpleNamespace(engine=after, room=SimpleNamespace(
        recipe=SimpleNamespace(ruleset_id="watten-house", ruleset_version=1)))}
    event = prepare_watten(candidate, before, actor, request, policy_version=1)
    stored = json.dumps({key: value for key, value in event.items() if key not in {"eligible_user_ids", "actor_user_id"}})
    assert "secret-" not in stored and "777" not in stored and "888" not in stored
    assert event["context"]["actor_hand"] == ["back"] * 5
    assert event["context"]["inspection"] is None
    assert "partner_hand" not in event["context"] and "feedback" not in event["context"]
    assert event["actor_kind"] == ("cpu" if binding.account_id is None else "human")
    assert event["sequence"] == 1
    assert event["eligible_user_ids"] == (777, 888)


def test_unexpected_watten_action_value_fails_closed():
    from app.decision_observation_runtime import _watten_value

    with pytest.raises(ValueError):
        _watten_value("play_card", "secret-player-id")
    with pytest.raises(ValueError):
        _watten_value("bid", "secret-player-id")


def test_watten_accepted_actions_get_one_opaque_recording_and_replay_is_not_recorded(monkeypatch):
    from app.watten_runtime import _apply_engine_command, restore_watten_game, serialize_watten_game
    from tests.test_watten_match_evidence import NativeMatch

    match = NativeMatch(cpus=(1,), target=3)
    engine = match.engine
    from app.watten_cpu_runtime import observe_cpu_memories
    from app.watten_engine import announcement_roles

    monkeypatch.setattr("app.decision_observation_runtime.policy_version_for", lambda _eligible: 1)

    seat = engine.recipe.seats[announcement_roles(engine).strike_announcer]
    binding = next(item for item in engine.recipe.bindings if item.player_id == seat)
    command = match.command(seat, "announce_strike", "7")
    candidate, _ack, replayed, _private = _apply_engine_command(
        match.game, EngineActor(seat, binding.account_id), command)
    assert replayed is False
    event = candidate.pop("_decision_observation_pending")
    assert event["action"] == {"kind": "announce_strike", "value": "7"}
    assert event["sequence"] == 1
    candidate["_watten"] = observe_cpu_memories(candidate["_watten"])
    checkpoint = serialize_watten_game(candidate)
    restored = restore_watten_game(checkpoint)
    assert restored["_decision_observation"] == candidate["_decision_observation"]
    replay, _ack, replayed, _private = _apply_engine_command(restored, EngineActor(seat, binding.account_id), command)
    assert replayed is True
    assert "_decision_observation_pending" not in replay
    assert replay["_decision_observation"]["sequence"] == 1
