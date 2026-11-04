"""A public pickup is a fallible behavioural signal, never a revealed hand."""

from collections import OrderedDict

import pytest

from app import hausdepp_cpu_runner as runner
from app import hausdepp_engine as engine
from app.hausdepp_cpu_knowledge import PickupHint, PublicKnowledge
from tests.test_hausdepp_engine import scenario


def observed_pickup():
    state = scenario([["hearts-6", "hearts-A", "hearts-10"], ["acorns-A", "acorns-10"]],
                     discard=["bells-7", "leaves-U"], current="p1")
    memory = PublicKnowledge()
    before = engine.project_state(state, "p0")
    after = engine.apply_action(state, "p1", "pickup", version=state["version"])
    view = engine.project_state(after, "p0")
    memory.observe(before, view)
    return state, after, memory, before, view


def observe(memory, state, actor, action, cards=None):
    after = engine.apply_action(state, actor, action, cards=cards, version=state["version"])
    memory.observe(engine.project_state(state, "p0"), engine.project_state(after, "p0"))
    return after


def test_voluntary_pickup_describes_observation_without_proving_hand():
    _, after, memory, before, view = observed_pickup()
    # The person voluntarily picked up, although an ace and a ten were legal.
    assert {"acorns-A", "acorns-10"} <= set(after["players"][1]["hand"])
    assert memory.pickup_hint(view, "p1") == PickupHint("U", 2, after["version"])
    assert memory.known_cards(view, "p1") == ("bells-7", "leaves-U")
    assert memory.exact_hand(view, "p1") is None
    assert memory.counted_hand(view, "p1") is None
    assert memory.pickup_hint(before, "p1") is None
    assert memory.pickup_hint(view, "p0") is None
    assert memory.known_cards(view, "p0") == ()


def test_different_hidden_hands_produce_the_same_public_pickup_hint():
    results = []
    for hidden in (["acorns-A", "acorns-10"], ["acorns-K", "acorns-O"]):
        state = scenario([["hearts-6", "hearts-A", "hearts-10"], hidden],
                         discard=["bells-7", "leaves-U"], current="p1")
        memory = PublicKnowledge()
        state = observe(memory, state, "p1", "pickup")
        view = engine.project_state(state, "p0")
        results.append((view, memory.pickup_hint(view, "p1"), memory.known_cards(view, "p1")))
    assert results[0] == results[1]


def test_unrelated_play_preserves_hint_but_target_play_expires_it():
    _, state, memory, _, view = observed_pickup()
    original = memory.pickup_hint(view, "p1")
    state = observe(memory, state, "p0", "play", ["hearts-6"])
    view = engine.project_state(state, "p0")
    assert memory.pickup_hint(view, "p1") == original
    state = observe(memory, state, "p1", "play", ["bells-7"])
    view = engine.project_state(state, "p0")
    assert memory.pickup_hint(view, "p1") is None
    assert memory.known_cards(view, "p1") == ("leaves-U",)


def test_deduplication_and_skipped_transition_fail_closed():
    _, state, memory, before, view = observed_pickup()
    memory.observe(before, view)
    assert memory.pickup_hint(view, "p1") == PickupHint("U", 2, state["version"])
    next_state = engine.apply_action(state, "p0", "play", cards=["hearts-6"], version=state["version"])
    following = engine.apply_action(next_state, "p1", "play", cards=["bells-7"], version=next_state["version"])
    # Observation misses the first accepted action; no past signal survives.
    memory.observe(engine.project_state(next_state, "p0"), engine.project_state(following, "p0"))
    fresh = engine.project_state(following, "p0")
    assert memory.pickup_hint(fresh, "p1") is None
    assert memory.known_cards(fresh, "p1") == ()


def test_multiplayer_observation_survives_other_seats_and_a_new_pickup_replaces_it():
    state = scenario([["hearts-8", "hearts-A", "hearts-10"], ["acorns-A", "acorns-10"],
                      ["acorns-6", "acorns-K"]], discard=["bells-7", "leaves-U"], current="p1")
    memory = PublicKnowledge()
    state = observe(memory, state, "p1", "pickup")
    first = memory.pickup_hint(engine.project_state(state, "p0"), "p1")
    assert first == PickupHint("U", 2, state["version"])
    state = observe(memory, state, "p2", "play", ["acorns-6"])
    assert memory.pickup_hint(engine.project_state(state, "p0"), "p1") == first
    state = observe(memory, state, "p0", "play", ["hearts-8"])
    state = observe(memory, state, "p1", "pickup")
    view = engine.project_state(state, "p0")
    assert memory.pickup_hint(view, "p1") == PickupHint("8", 2, state["version"], known_playable=True)
    assert set(memory.known_cards(view, "p1")) == {"bells-7", "leaves-U", "acorns-6", "hearts-8"}
    assert memory.exact_hand(view, "p1") is None  # The original ace and ten remain unknown.


def test_visible_high_card_is_kept_as_counterevidence_after_pickup():
    state = scenario([["hearts-6", "hearts-A", "hearts-10"], ["acorns-7", "acorns-10"]],
                     discard=["bells-7", "leaves-A"], current="p1")
    memory = PublicKnowledge()
    state = observe(memory, state, "p1", "pickup")
    view = engine.project_state(state, "p0")
    assert memory.pickup_hint(view, "p1") == PickupHint("A", 2, state["version"])
    assert "leaves-A" in memory.known_cards(view, "p1")
    assert "acorns-10" not in memory.known_cards(view, "p1")
    assert memory.exact_hand(view, "p1") is None


def test_a_known_higher_card_proves_a_later_pickup_was_voluntary():
    state = scenario([["hearts-6", "hearts-A", "hearts-10", "hearts-U"], ["bells-7", "acorns-8"]],
                     discard=["leaves-K"], current="p1")
    memory = PublicKnowledge()
    state = observe(memory, state, "p1", "pickup")
    first_view = engine.project_state(state, "p0")
    # The newly picked king did not belong to the player before this pickup.
    assert not memory.pickup_hint(first_view, "p1").known_playable
    assert "leaves-K" in memory.known_cards(first_view, "p1")
    state = observe(memory, state, "p0", "play", ["hearts-U"])
    assert "leaves-K" in engine.project_state(state, "p1")["playable_cards"]
    state = observe(memory, state, "p1", "pickup")
    hint = memory.pickup_hint(engine.project_state(state, "p0"), "p1")
    assert hint == PickupHint("U", 1, state["version"], known_playable=True)


@pytest.mark.parametrize("wild", (False, True))
def test_a_known_quartet_is_a_legal_reply_only_when_the_table_allows_it(wild):
    state = scenario([["leaves-K", "hearts-K", "acorns-K", "hearts-A", "hearts-10", "hearts-6"],
                      ["bells-7", "acorns-8"]], discard=["bells-K"], current="p1")
    state["four_of_a_kind_as_ten"] = wild
    memory = PublicKnowledge()
    state = observe(memory, state, "p1", "pickup")
    for card in ("leaves-K", "hearts-K", "acorns-K"):
        state = observe(memory, state, "p0", "play", [card])
        state = observe(memory, state, "p1", "pickup")
    state = observe(memory, state, "p0", "play", ["hearts-A"])
    target_view = engine.project_state(state, "p1")
    assert bool(target_view["playable_groups"]) == wild
    assert not target_view["playable_cards"]
    state = observe(memory, state, "p1", "pickup")
    hint = memory.pickup_hint(engine.project_state(state, "p0"), "p1")
    assert hint.known_playable is wild


def test_counted_hand_before_pickup_is_also_evidence_of_a_legal_play():
    state = scenario([["hearts-6", "hearts-A", "hearts-10"], ["acorns-A", "acorns-10"]],
                     discard=["bells-7", "leaves-U"], current="p1")
    memory = PublicKnowledge()
    # Test fixture: exactly the previously observed public clearances. The
    # production observation stream fills this set from visible events only.
    memory._burned = set(state["burned"])
    memory._burn_version = state["version"]
    state = observe(memory, state, "p1", "pickup")
    view = engine.project_state(state, "p0")
    assert memory.pickup_hint(view, "p1").known_playable
    assert memory.known_cards(view, "p1") == ("bells-7", "leaves-U")


def test_a_pickup_with_stock_remaining_does_not_create_endgame_signal():
    state = scenario([["hearts-6", "hearts-A", "hearts-10"], ["acorns-A", "acorns-10"]],
                     discard=["bells-7", "leaves-U"], deck=["bells-A"], current="p1")
    memory = PublicKnowledge()
    before = engine.project_state(state, "p0")
    after = engine.apply_action(state, "p1", "pickup", version=state["version"])
    view = engine.project_state(after, "p0")
    memory.observe(before, view)
    assert memory.pickup_hint(view, "p1") is None
    assert memory.known_cards(view, "p1") == ()


@pytest.mark.parametrize("change", ("round", "roster", "game", "withdraw", "discard"))
def test_runner_context_change_discards_pickup_hints(monkeypatch, change):
    state, after, _, _, _ = observed_pickup()
    people = [{"id": "p0", "is_cpu": True, "user_id": None},
              {"id": "p1", "is_cpu": False, "user_id": 1}]
    game = {"_id": "hints", "_participants": people, "_hausdepp": after,
            "_hausdepp_tournament": {"round_number": 1}}
    monkeypatch.setattr(runner, "_MEMORIES", OrderedDict())
    monkeypatch.setattr(runner, "games", {"hints": game})
    runner.observe_accepted_transition(game, state, after)
    memory = runner._memories_for(game)["p0"].public
    assert memory.pickup_hint(engine.project_state(after, "p0"), "p1") is not None
    if change == "round":
        game["_hausdepp_tournament"]["round_number"] = 2
    elif change == "roster":
        people[1]["user_id"] = 2
    elif change == "withdraw":
        game["_hausdepp"] = {**after, "withdrawn_ids": ["p1"]}
    elif change == "discard":
        runner.discard_cpu_memories("hints")
    else:
        game = {**game}
        runner.games["hints"] = game
    replacement = runner._memories_for(game)["p0"].public
    assert replacement is not memory
    assert replacement.pickup_hint(engine.project_state(after, "p0"), "p1") is None

