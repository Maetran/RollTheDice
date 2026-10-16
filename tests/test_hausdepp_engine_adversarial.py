"""Seeded human-like timing: refills, follow-ups and hand plays interleave."""

from __future__ import annotations

import json
from collections import defaultdict
from copy import deepcopy
from random import Random

import pytest

from app.hausdepp_engine import HausdeppRuleError, apply_action, card_rank, make_deck, new_round, project_state
from tests.test_hausdepp_engine import command, scenario


def assert_invariants(state):
    physical = state["deck"] + state["discard"] + state["burned"]
    physical += [card for player in state["players"] for card in player["hand"]]
    assert sorted(physical) == sorted(make_deck())
    assert len(set(state["finished_order"])) == len(state["finished_order"])
    assert all(not player["hand"] for player in state["players"] if player["finished"])
    if state["deck"]:
        assert all(not player["finished"] for player in state["players"])
        if state["phase"] == "playing":
            assert all(len(player["hand"]) >= 3 or player["id"] in state["pending_refills"]
                       for player in state["players"])
    oldest = next(iter(state["pending_refills"]), None)
    for player in state["players"]:
        actions = project_state(state, player["id"])["available_actions"]
        assert ("draw" in actions) is bool(oldest == player["id"])
        if oldest:
            assert "gamble" not in actions
    assert project_state(state, None)["available_actions"] == []
    if state["phase"] == "finished":
        assert len(state["finished_order"]) == len(state["players"]) - 1
        assert next(player for player in state["players"] if player["id"] == state["loser_id"])["hand"]
    else:
        assert state["current_player_id"] in {player["id"] for player in state["players"] if not player["finished"]}


@pytest.mark.parametrize("count", range(2, 7))
def test_seeded_interleaved_human_actions_preserve_cards_fifo_finishes_and_privacy(count):
    for seed in range(5):
        random = Random(9000 + count * 100 + seed)
        state = new_round([f"p{index}" for index in range(count)], rng=random)
        for step in range(1000):
            assert_invariants(state)
            if state["phase"] == "finished":
                break
            candidates, weights = [], []
            for player in state["players"]:
                view = project_state(state, player["id"])
                assert "achievement_evidence" not in view
                assert "deck" not in view
                assert all("hand" not in other for other in view["players"])
                groups = defaultdict(list)
                for card in view["playable_cards"]:
                    groups[card_rank(card)].append(card)
                for action in view["available_actions"]:
                    if action in {"play", "afterthrow"}:
                        for group in groups.values():
                            cards = random.sample(group, random.randint(1, len(group)))
                            candidates.append((player["id"], {"action": action, "cards": cards,
                                                              "version": view["version"]}))
                            weights.append(4)
                    else:
                        candidates.append((player["id"], {"action": action, "version": view["version"]}))
                        weights.append({"draw": .65, "peek": 6, "gamble": 1, "pickup": .2}[action])
            assert candidates, (count, seed, step)
            actor, move = random.choices(candidates, weights)[0]
            previous = deepcopy(state)
            if step % 11 == 0:
                with pytest.raises(HausdeppRuleError):
                    apply_action(state, actor, "play", cards=["nonexistent-6"], version=state["version"])
                assert state == previous
            state = apply_action(state, actor, **move, rng=random)
            assert state["version"] == previous["version"] + 1
            # Reloading persisted evidence and debts must not change legality.
            if step % 13 == 0:
                state = json.loads(json.dumps(state))
        else:
            pytest.fail(f"Seeded round did not finish: {count} seats, seed {seed}")


def test_collecting_the_packet_can_resolve_oldest_debt_without_touching_stock():
    state = scenario([["hearts-6", "bells-6", "hearts-A"], ["hearts-7", "bells-7", "bells-A"],
                      ["hearts-8", "bells-8", "leaves-A"]],
                     discard=["acorns-6"], deck=["leaves-6", "leaves-7", "leaves-8"])
    for actor, rank in (("p0", "6"), ("p1", "7"), ("p2", "8")):
        state = command(state, actor, "play", [f"hearts-{rank}", f"bells-{rank}"], complete_refill=False)
    assert list(state["pending_refills"]) == ["p0", "p1", "p2"]
    stock = list(state["deck"])
    state = command(state, "p0", "pickup", complete_refill=False)
    assert state["deck"] == stock
    assert list(state["pending_refills"]) == ["p1", "p2"]
    state = command(state, "p1", "draw")
    assert state["players"][1]["hand"] == ["bells-A", "leaves-6", "leaves-7"]
    state = command(state, "p2", "draw")
    assert state["players"][2]["hand"] == ["leaves-A", "leaves-8"]
    assert not state["deck"]
    assert not state["pending_refills"]
    assert_invariants(state)


def test_delayed_predecessor_draw_preserves_fresh_followup_fourer_and_own_replay():
    state = scenario([["hearts-6", "hearts-7", "hearts-8"],
                      ["hearts-10", "hearts-A", "bells-A"], ["hearts-9", "bells-9", "leaves-9"]],
                     discard=["acorns-6"], deck=["leaves-6", "leaves-A", "acorns-A", "acorns-7"])
    state = command(state, "p0", "play", ["hearts-6"], complete_refill=False)
    state = command(state, "p1", "play", ["hearts-10"], complete_refill=False)
    # A burn's continuation can still use held cards while the older draw waits.
    state = command(state, "p1", "play", ["hearts-A"], complete_refill=False)
    previous = deepcopy(state)
    with pytest.raises(HausdeppRuleError, match="hausdepp_stock_refill_wait"):
        command(state, "p1", "draw")
    assert state == previous
    state = command(state, "p0", "draw")
    assert state["afterthrow"] == {"player_id": "p1", "rank": "A"}
    state = command(state, "p1", "draw")
    state = command(state, "p1", "afterthrow", ["bells-A", "leaves-A", "acorns-A"], complete_refill=False)
    assert state["last_event"]["burn_reason"] == "four_of_a_kind"
    assert state["current_player_id"] == "p1"
    assert not state["players"][1]["finished"]
    assert not state["players"][1]["hand"]
    state = command(state, "p1", "draw")
    assert state["players"][1]["hand"] == ["acorns-7"]
    assert state["current_player_id"] == "p1"
    state = command(state, "p1", "play", ["acorns-7"])
    assert state["players"][1]["finished"]
    assert state["current_player_id"] == "p2"
    assert_invariants(state)
