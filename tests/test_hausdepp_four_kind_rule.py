"""Optional table rule: four equal cards played together from a hand act like a ten."""

from __future__ import annotations

import json
from copy import deepcopy
from random import Random
from unittest import TestCase

from app.hausdepp_cpu_strategy import CpuMemory, choose_cpu_action
from app.hausdepp_engine import (
    HausdeppRuleError,
    apply_action,
    make_deck,
    project_state,
)
from app.hausdepp_engine import new_round as begin_round

SUITS = ("hearts", "bells", "leaves", "acorns")
Q7 = [f"{suit}-7" for suit in SUITS]
Q8 = [f"{suit}-8" for suit in SUITS]


def scenario(hands, *, discard=(), deck=(), current="p0", afterthrow=None, rule=False):
    state = begin_round([f"p{index}" for index in range(len(hands))], rng=Random(42),
                        four_of_a_kind_as_ten=rule)
    while state["phase"] == "peeking":
        state = apply_action(state, state["current_player_id"], "peek",
                             version=state["version"], rng=Random(42))
    in_use = [card for hand in hands for card in hand] + list(discard) + list(deck)
    assert len(set(in_use)) == len(in_use)
    for player, hand in zip(state["players"], hands):
        player["hand"] = list(hand)
        player["finished"] = not hand and not deck
    state.update({
        "deck": list(deck), "discard": list(discard), "pending_refills": {}, "pending_refill": None,
        "burned": [card for card in make_deck() if card not in in_use],
        "current_player_id": current, "afterthrow": afterthrow,
        "finished_order": [p["id"] for p in state["players"] if p["finished"]],
        "peek_information": {"player_id": "p1", "cards": [], "success": False, "complete": True},
    })
    return state


def play(state, actor, cards, action="play"):
    return apply_action(state, actor, action, cards=cards, version=state["version"])


class FourKindRuleEngineTests(TestCase):
    def over_king(self, *, rule, extra=("hearts-9",), deck=("hearts-A", "bells-A", "leaves-A")):
        return scenario([Q7 + list(extra), ["bells-6", "hearts-8"]], discard=["leaves-K"],
                        deck=list(deck), rule=rule)

    def test_default_off_and_strict_bool(self):
        self.assertIs(begin_round(["a", "b"])["four_of_a_kind_as_ten"], False)
        self.assertIs(begin_round(["a", "b"], four_of_a_kind_as_ten=True)["four_of_a_kind_as_ten"], True)
        for bad in (1, 0, "true", None, [], "yes"):
            with self.assertRaises(HausdeppRuleError) as raised:
                begin_round(["a", "b"], four_of_a_kind_as_ten=bad)
            self.assertEqual(raised.exception.code, "hausdepp_invalid_rule")

    def test_off_rejects_lower_quartet_immutably(self):
        state = self.over_king(rule=False)
        before = deepcopy(state)
        with self.assertRaises(HausdeppRuleError) as raised:
            play(state, "p0", Q7)
        self.assertEqual(raised.exception.code, "hausdepp_rank_too_low")
        self.assertEqual(state, before)

    def test_on_quartet_burns_replays_and_refills(self):
        state = self.over_king(rule=True)
        result = play(state, "p0", Q7)
        event = result["last_event"]
        self.assertEqual(event["burn_reason"], "four_of_a_kind")
        self.assertEqual(event["burned_count"], 5)
        self.assertEqual(result["discard"], [])
        self.assertTrue(set(Q7) <= set(result["burned"]))
        self.assertEqual(result["current_player_id"], "p0")
        self.assertIsNone(result["afterthrow"])
        self.assertEqual(result["players"][0]["hand"], ["hearts-9"])
        debt = result["pending_refills"]["p0"]
        self.assertEqual((debt["continuation"], debt["remaining"]), ("replay", 2))
        drawn = apply_action(result, "p0", "draw", version=result["version"])
        self.assertEqual(len(drawn["players"][0]["hand"]), 3)
        self.assertEqual(drawn["current_player_id"], "p0")

    def test_on_quartet_over_equal_or_lower_pile_is_still_a_four_clear(self):
        state = scenario([Q7 + ["hearts-9"], ["bells-6", "hearts-8"]], discard=["leaves-6"],
                         deck=["hearts-A"], rule=True)
        self.assertEqual(play(state, "p0", Q7)["last_event"]["burn_reason"], "four_of_a_kind")

    def test_on_still_rejects_one_to_three_lower_cards(self):
        state = self.over_king(rule=True)
        for count in (1, 2, 3):
            with self.subTest(count=count):
                before = deepcopy(state)
                with self.assertRaises(HausdeppRuleError) as raised:
                    play(state, "p0", Q7[:count])
                self.assertEqual(raised.exception.code, "hausdepp_rank_too_low")
                self.assertEqual(state, before)

    def test_on_atomic_rejections(self):
        state = scenario([Q7[:3] + ["hearts-9", "hearts-8"], ["acorns-7", "bells-6"]],
                         discard=["leaves-K"], deck=["hearts-A"], rule=True)
        cases = {
            "duplicate": (Q7[:3] + [Q7[0]], "hausdepp_invalid_selection"),
            "missing": (Q7, "hausdepp_invalid_selection"),  # acorns-7 is p1's card
            "foreign": (Q7[:3] + ["acorns-A"], "hausdepp_invalid_selection"),
            "mixed": (Q7[:3] + ["hearts-8"], "hausdepp_mixed_ranks"),
        }
        for name, (cards, code) in cases.items():
            with self.subTest(name):
                before = deepcopy(state)
                with self.assertRaises(HausdeppRuleError) as raised:
                    play(state, "p0", cards)
                self.assertEqual(raised.exception.code, code)
                self.assertEqual(state, before)

    def test_no_out_of_turn_wildcard(self):
        state = scenario([["bells-6", "hearts-8"], Q7 + ["hearts-9"]], discard=["leaves-K"],
                         deck=["hearts-A"], rule=True)
        with self.assertRaises(HausdeppRuleError) as raised:
            play(state, "p1", Q7)
        self.assertEqual(raised.exception.code, "hausdepp_not_your_turn")

    def test_last_hand_quartet_finishes(self):
        state = scenario([Q7, ["bells-6", "hearts-8"]], discard=["leaves-K"], rule=True)
        result = play(state, "p0", Q7)
        self.assertEqual(result["phase"], "finished")
        self.assertEqual(result["finished_order"], ["p0"])
        self.assertEqual(result["loser_id"], "p1")
        self.assertEqual(result["last_event"]["burn_reason"], "four_of_a_kind")

    def test_accumulated_four_still_clears_with_option_off(self):
        state = scenario([["acorns-7", "hearts-9"], ["bells-6", "hearts-8"]],
                         discard=["hearts-7", "bells-7", "leaves-7"], deck=["hearts-A"], rule=False)
        result = play(state, "p0", ["acorns-7"])
        self.assertEqual(result["last_event"]["burn_reason"], "four_of_a_kind")
        self.assertEqual(result["current_player_id"], "p0")

    def test_quartet_of_tens_keeps_ten_reason(self):
        tens = [f"{suit}-10" for suit in SUITS]
        state = scenario([tens + ["hearts-9"], ["bells-6", "hearts-8"]], discard=["leaves-K"],
                         deck=["hearts-A"], rule=True)
        self.assertEqual(play(state, "p0", tens)["last_event"]["burn_reason"], "ten")

    def test_afterthrow_keeps_timing_and_rank(self):
        opportunity = {"player_id": "p0", "rank": "7"}
        hand = Q7 + Q8
        state = scenario([hand, ["bells-6", "hearts-9"]], discard=["leaves-K"], deck=["hearts-A"],
                         current="p1", afterthrow=opportunity, rule=True)
        with self.assertRaises(HausdeppRuleError) as raised:
            play(state, "p0", Q8, "afterthrow")
        self.assertEqual(raised.exception.code, "hausdepp_afterthrow_wrong_rank")
        with self.assertRaises(HausdeppRuleError) as raised:
            play(state, "p0", Q7, "play")
        self.assertEqual(raised.exception.code, "hausdepp_not_your_turn")
        result = play(state, "p0", Q7, "afterthrow")
        self.assertEqual(result["last_event"]["burn_reason"], "four_of_a_kind")
        off = deepcopy(state)
        off["four_of_a_kind_as_ten"] = False
        with self.assertRaises(HausdeppRuleError) as raised:
            play(off, "p0", Q7, "afterthrow")
        self.assertEqual(raised.exception.code, "hausdepp_rank_too_low")

    def test_legacy_state_means_off(self):
        state = self.over_king(rule=True)
        legacy = deepcopy(state)
        del legacy["four_of_a_kind_as_ten"]
        self.assertIs(project_state(legacy, "p0")["four_of_a_kind_as_ten"], False)
        self.assertEqual(project_state(legacy, "p0")["playable_groups"], [])
        with self.assertRaises(HausdeppRuleError):
            play(legacy, "p0", Q7)
        legacy["four_of_a_kind_as_ten"] = "true"
        with self.assertRaises(HausdeppRuleError):
            play(legacy, "p0", Q7)


class FourKindRuleProjectionTests(TestCase):
    def test_groups_are_own_only_and_separate_from_single_legality(self):
        state = scenario([Q7, ["bells-6", "hearts-8"]], discard=["leaves-K"], deck=["hearts-A"], rule=True)
        own = project_state(state, "p0")
        self.assertIs(own["four_of_a_kind_as_ten"], True)
        self.assertEqual(own["playable_cards"], [])
        self.assertEqual(own["playable_groups"], [Q7])
        self.assertIn("play", own["available_actions"])
        own["playable_groups"][0].clear()
        self.assertEqual(project_state(state, "p0")["playable_groups"], [Q7])
        for viewer in ("p1", None, "nobody"):
            with self.subTest(viewer=viewer):
                other = project_state(state, viewer)
                self.assertIs(other["four_of_a_kind_as_ten"], True)
                self.assertEqual(other["playable_groups"], [])
                self.assertNotIn("play", other["available_actions"])
                dump = json.dumps(other)
                self.assertFalse(any(card in dump for card in Q7))

    def test_off_has_no_groups_and_no_play_action(self):
        state = scenario([Q7, ["bells-6", "hearts-8"]], discard=["leaves-K"], deck=["hearts-A"], rule=False)
        own = project_state(state, "p0")
        self.assertIs(own["four_of_a_kind_as_ten"], False)
        self.assertEqual(own["playable_groups"], [])
        self.assertNotIn("play", own["available_actions"])

    def test_not_current_player_gets_no_groups(self):
        state = scenario([Q7, ["bells-6", "hearts-8"]], discard=["leaves-K"], deck=["hearts-A"],
                         current="p1", rule=True)
        self.assertEqual(project_state(state, "p0")["playable_groups"], [])

    def test_afterthrow_groups_only_for_matching_rank(self):
        state = scenario([Q7 + Q8, ["bells-6", "hearts-9"]], discard=["leaves-K"], deck=["hearts-A"],
                         current="p1", afterthrow={"player_id": "p0", "rank": "7"}, rule=True)
        own = project_state(state, "p0")
        self.assertEqual(own["playable_groups"], [Q7])
        self.assertIn("afterthrow", own["available_actions"])


class FourKindRuleCpuTests(TestCase):
    def test_cpu_plays_offered_quartet_over_higher_pile(self):
        state = scenario([Q7 + ["hearts-6"], ["bells-9", "hearts-8"]], discard=["leaves-K"],
                         deck=["hearts-A", "bells-A"], rule=True)
        move = choose_cpu_action(project_state(state, "p0"))
        self.assertEqual((move["action"], move["cards"]), ("play", sorted(Q7)))
        self.assertEqual(play(state, "p0", move["cards"])["last_event"]["burn_reason"], "four_of_a_kind")

    def test_cpu_does_not_use_quartet_when_off(self):
        state = scenario([Q7 + ["hearts-6"], ["bells-9", "hearts-8"]], discard=["leaves-K"],
                         deck=["hearts-A", "bells-A"], rule=False)
        move = choose_cpu_action(project_state(state, "p0"))
        self.assertNotEqual(move["action"], "play")

    def test_cpu_ignores_group_hint_when_rule_is_not_public(self):
        state = scenario([Q7 + ["hearts-6"], ["bells-9", "hearts-8"]], discard=["leaves-K"],
                         deck=["hearts-A", "bells-A"], rule=True)
        projection = project_state(state, "p0")
        projection["four_of_a_kind_as_ten"] = False
        move = choose_cpu_action(projection)
        self.assertNotEqual(move["action"], "play")

    def test_empty_stock_finish_uses_quartet_first(self):
        state = scenario([Q7 + ["hearts-A"], ["bells-9", "hearts-8"]], discard=["leaves-K"], rule=True)
        move = choose_cpu_action(project_state(state, "p0"))
        self.assertEqual((move["action"], move["cards"]), ("play", sorted(Q7)))
        after = play(state, "p0", move["cards"])
        self.assertEqual(after["current_player_id"], "p0")
        self.assertEqual(after["players"][0]["hand"], ["hearts-A"])
        final = choose_cpu_action(project_state(after, "p0"))
        self.assertEqual(final["cards"], ["hearts-A"])

    def test_empty_stock_without_rule_cannot_assume_the_clear(self):
        state = scenario([Q7 + ["hearts-A"], ["bells-9", "hearts-8"]], discard=["leaves-K"], rule=False)
        move = choose_cpu_action(project_state(state, "p0"))
        self.assertFalse(move["action"] == "play" and set(move.get("cards", [])) & set(Q7))

    def test_memory_positions_distinguish_rule_and_groups(self):
        on = scenario([Q7, ["bells-9", "hearts-8"]], discard=["leaves-K"], deck=["hearts-A"], rule=True)
        projection_on = project_state(on, "p0")
        projection_off = deepcopy(projection_on)
        projection_off["four_of_a_kind_as_ten"] = False
        projection_off["playable_groups"] = []
        memory = CpuMemory()
        memory.remember(projection_on, {"action": "play", "cards": Q7})
        self.assertEqual(memory.visits(projection_on), 1)
        self.assertEqual(memory.visits(projection_off), 0)
