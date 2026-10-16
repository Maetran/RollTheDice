"""Confirmed Hausdepp rules, privacy boundary, and CPU integration contracts."""

from __future__ import annotations

import json
from copy import deepcopy
from random import Random
from unittest import TestCase

from app.hausdepp_cpu_strategy import choose_cpu_action
from app.hausdepp_engine import (
    HAUSDEPP_RANKS,
    HausdeppRuleError,
    apply_action,
    card_rank,
    make_deck,
    new_round,
    project_state,
)


def ordered_deck(*, top=(), bottom=()):
    fixed = [*top, *bottom]
    assert len(set(fixed)) == len(fixed)
    return [*top, *(card for card in make_deck() if card not in fixed), *bottom]


def scenario(hands, *, discard=(), deck=(), current="p0", afterthrow=None):
    """Keep complete physical card conservation even for tiny endgame scenes."""
    state = new_round([f"p{index}" for index in range(len(hands))], rng=Random(42))
    in_use = [card for hand in hands for card in hand] + list(discard) + list(deck)
    assert len(set(in_use)) == len(in_use)
    for player, hand in zip(state["players"], hands):
        player["hand"] = list(hand)
        player["finished"] = not hand and not deck
    state.update({
        "deck": list(deck), "discard": list(discard),
        "burned": [card for card in make_deck() if card not in in_use],
        "current_player_id": current, "afterthrow": afterthrow,
        "finished_order": [p["id"] for p in state["players"] if p["finished"]],
        "peek_information": {"player_id": "p1", "cards": [], "success": False},
    })
    return state


def command(state, actor, action, cards=None, *, complete_refill=True):
    """Finish a move's required stock tap unless the phase itself is tested."""
    result = apply_action(state, actor, action, cards=cards, version=state["version"])
    if complete_refill and result.get("pending_refill"):
        result = apply_action(result, actor, "draw", version=result["version"])
    return result


class HausdeppSetupTests(TestCase):
    def test_deck_has_four_suits_and_nine_confirmed_ranks(self):
        self.assertEqual(HAUSDEPP_RANKS, ("6", "7", "8", "9", "U", "O", "K", "A", "10"))
        self.assertEqual(len(make_deck()), 36)
        self.assertEqual(len(set(make_deck())), 36)
        self.assertEqual({rank: sum(card_rank(card) == rank for card in make_deck()) for rank in HAUSDEPP_RANKS},
                         dict.fromkeys(HAUSDEPP_RANKS, 4))

    def test_two_to_six_players_but_never_solo(self):
        for count in range(2, 7):
            state = new_round([f"p{i}" for i in range(count)], rng=Random(2))
            self.assertEqual(len(state["players"]), count)
            self.assertTrue(all(len(p["hand"]) >= 3 for p in state["players"]))
            self.assertEqual(state["current_player_id"], "p1")
        for players in ([], ["p0"], ["p0"] * 2, [f"p{i}" for i in range(7)], "p0p1", 4):
            with self.assertRaises(HausdeppRuleError):
                new_round(players)

    def test_successful_bottom_ace_chain_is_taken_only_through_first_ten(self):
        # Viewed from bottom: hearts A, bells A, leaves 10.  The king below
        # that ten (towards the top) must never be inspected or taken.
        cards = ordered_deck(bottom=["acorns-K", "leaves-10", "bells-A", "hearts-A"])
        state = new_round(["p0", "p1", "p2"], dealer_index=0, deck=cards, rng=Random(1))
        self.assertEqual(state["peek_information"], {
            "player_id": "p2", "cards": ["hearts-A", "bells-A", "leaves-10"], "success": True,
        })
        self.assertEqual(state["players"][2]["hand"], ["hearts-A", "bells-A", "leaves-10"])
        self.assertEqual(state["deck"][-1], "acorns-K")
        self.assertEqual(project_state(state, "p0")["peek"]["cards"], state["players"][2]["hand"])

    def test_five_card_bottom_chain_is_not_capped_at_three_or_dealt_extra_cards(self):
        chain = ["hearts-A", "bells-A", "leaves-A", "acorns-A", "hearts-10"]
        state = new_round(["p0", "p1"], deck=ordered_deck(bottom=list(reversed(chain))), rng=Random(1))
        self.assertEqual(state["players"][1]["hand"], chain)
        self.assertEqual(len(state["deck"]), 27)

    def test_bottom_ten_is_compulsory_and_deal_only_tops_up_to_three(self):
        top = ["hearts-6", "hearts-7", "hearts-8", "hearts-9", "hearts-U"]
        state = new_round(["p0", "p1"], deck=ordered_deck(top=top, bottom=["acorns-10"]), rng=Random(1))
        self.assertEqual(state["players"][1]["hand"], ["acorns-10", "hearts-6", "hearts-8"])
        self.assertEqual(state["players"][0]["hand"], ["hearts-7", "hearts-9", "hearts-U"])

    def test_unsuccessful_bottom_peek_keeps_original_order_and_is_private(self):
        bottom = ["acorns-K", "bells-A", "hearts-A"]
        state = new_round(["p0", "p1", "p2"], deck=ordered_deck(bottom=bottom), rng=Random(1))
        self.assertFalse(state["peek_information"]["success"])
        self.assertEqual(state["deck"][-3:], bottom)
        self.assertEqual(project_state(state, "p2")["private_peek"], list(reversed(bottom)))
        self.assertEqual(project_state(state, "p0")["private_peek"], [])
        self.assertNotIn("cards", project_state(state, None)["peek"])
        self.assertEqual(project_state(state, "p0")["peek_information"]["cards"], [])

    def test_every_initial_ten_is_reinserted_at_random_position_and_only_tens(self):
        class ReinsertAtBottom:
            def randrange(self, stop):
                return stop - 1

        dealt = ["hearts-6", "hearts-7", "hearts-8", "hearts-9", "hearts-U", "hearts-O"]
        starters = ["hearts-10", "bells-10", "leaves-10", "hearts-A"]
        state = new_round(["p0", "p1"], deck=ordered_deck(top=dealt + starters, bottom=["acorns-6"]),
                          rng=ReinsertAtBottom())
        self.assertEqual(state["discard"], ["hearts-A"])
        self.assertEqual(state["deck"][-3:], starters[:3])
        self.assertEqual(state["last_event"]["initial_tens_reinserted"], 3)

    def test_dealer_position_determines_peeker_and_clockwise_starter(self):
        state = new_round(["p0", "p1", "p2", "p3"], dealer_index=2, rng=Random(8))
        self.assertEqual(state["dealer_id"], "p2")
        self.assertEqual(state["current_player_id"], "p3")
        self.assertEqual(state["peek_information"]["player_id"], "p1")

    def test_invalid_or_duplicate_deck_is_rejected(self):
        with self.assertRaises(HausdeppRuleError):
            new_round(["p0", "p1"], deck=make_deck()[:-1])
        with self.assertRaises(HausdeppRuleError):
            new_round(["p0", "p1"], deck=[make_deck()[0]] * 36)


class HausdeppMoveTests(TestCase):
    def test_lower_card_rejected_equal_and_higher_allowed_and_ten_beats_ace(self):
        state = scenario([["hearts-U", "bells-A", "hearts-10"], ["acorns-6"]], discard=["leaves-A"])
        before = deepcopy(state)
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_rank_too_low"):
            command(state, "p0", "play", ["hearts-U"])
        self.assertEqual(state, before)
        equal = command(state, "p0", "play", ["bells-A"])
        self.assertEqual(equal["discard"][-1], "bells-A")
        ten = command(state, "p0", "play", ["hearts-10"])
        self.assertEqual(ten["discard"], [])
        self.assertEqual(ten["current_player_id"], "p0")

    def test_mixed_missing_and_duplicate_cards_are_rejected(self):
        state = scenario([["hearts-8", "bells-8", "hearts-9"], ["acorns-6"]], discard=["leaves-7"])
        for selection in (["hearts-8", "hearts-9"], ["hearts-8", "hearts-8"], ["acorns-8"], [],
                          "hearts-8", 7, {"hearts-8": True}):
            with self.assertRaises(HausdeppRuleError):
                command(state, "p0", "play", selection)

    def test_multiple_cards_legal_and_refill_from_top_before_next_player(self):
        state = scenario([["hearts-U", "bells-U", "hearts-A"], ["acorns-6"]],
                         discard=["leaves-9"], deck=["hearts-6", "bells-7", "acorns-O"])
        result = command(state, "p0", "play", ["hearts-U", "bells-U"])
        self.assertEqual(result["players"][0]["hand"], ["hearts-A", "hearts-6", "bells-7"])
        self.assertEqual(result["deck"], ["acorns-O"])
        self.assertEqual(result["current_player_id"], "p1")
        self.assertEqual(result["afterthrow"], {"player_id": "p0", "rank": "U"})
        self.assertEqual(result["last_event"]["drawn_count"], 2)

    def test_pickup_is_always_available_even_with_playable_cards_and_ends_turn(self):
        state = scenario([["hearts-A"], ["acorns-6"]], discard=["hearts-7", "bells-8"])
        result = command(state, "p0", "pickup")
        self.assertEqual(result["players"][0]["hand"], ["hearts-A", "hearts-7", "bells-8"])
        self.assertEqual(result["discard"], [])
        self.assertEqual(result["current_player_id"], "p1")
        self.assertIsNone(result["afterthrow"])

    def test_gamble_is_forced_and_success_allows_same_rank_follow(self):
        state = scenario([["hearts-U", "hearts-6", "hearts-A"], ["acorns-6"]],
                         discard=["leaves-9"], deck=["bells-U", "acorns-7"])
        result = command(state, "p0", "gamble")
        self.assertEqual(result["discard"], ["leaves-9", "bells-U"])
        self.assertEqual(result["players"][0]["hand"], state["players"][0]["hand"])
        result = command(result, "p0", "afterthrow", ["hearts-U"])
        self.assertEqual(result["discard"][-2:], ["bells-U", "hearts-U"])
        self.assertEqual(result["players"][0]["hand"], ["hearts-6", "hearts-A", "acorns-7"])

    def test_failed_gamble_collects_entire_packet_including_new_card(self):
        state = scenario([["hearts-7", "hearts-8", "hearts-9"], ["acorns-6"]],
                         discard=["leaves-K", "bells-A"], deck=["acorns-U"])
        result = command(state, "p0", "gamble")
        self.assertEqual(result["players"][0]["hand"][-3:], ["leaves-K", "bells-A", "acorns-U"])
        self.assertEqual(result["discard"], [])
        self.assertEqual(result["current_player_id"], "p1")
        self.assertFalse(result["last_event"]["success"])

    def test_gambled_ten_burns_packet_without_spending_hand_cards_and_replays(self):
        state = scenario([["hearts-6", "hearts-7", "hearts-8"], ["acorns-6"]],
                         discard=["leaves-A"], deck=["hearts-10", "bells-U"])
        result = command(state, "p0", "gamble")
        self.assertEqual(result["discard"], [])
        self.assertEqual(result["players"][0]["hand"], ["hearts-6", "hearts-7", "hearts-8"])
        self.assertEqual(result["deck"], ["bells-U"])
        self.assertEqual(result["current_player_id"], "p0")
        self.assertEqual(result["last_event"]["burn_reason"], "ten")

    def test_four_consecutive_same_ranks_across_players_burn_and_replay(self):
        state = scenario([["acorns-U", "hearts-6"], ["acorns-6"]],
                         discard=["leaves-9", "hearts-U", "bells-U", "leaves-U"])
        result = command(state, "p0", "play", ["acorns-U"])
        self.assertEqual(result["discard"], [])
        self.assertEqual(result["current_player_id"], "p0")
        self.assertEqual(result["last_event"]["burned_count"], 5)
        self.assertEqual(result["last_event"]["burn_reason"], "four_of_a_kind")

    def test_four_from_hand_still_cannot_be_played_below_top_rank(self):
        fours = [f"{suit}-U" for suit in ("hearts", "bells", "leaves", "acorns")]
        state = scenario([fours, ["acorns-6"]], discard=["hearts-A"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_rank_too_low"):
            command(state, "p0", "play", fours)
        state["discard"] = []
        result = command(state, "p0", "play", fours)
        self.assertEqual(result["phase"], "finished")

    def test_afterthrow_can_repeat_after_drawing_or_use_retained_cards(self):
        state = scenario([["hearts-U", "bells-U", "hearts-A"], ["acorns-6"]],
                         discard=["leaves-9"], deck=["leaves-U", "acorns-U", "hearts-6", "bells-7"])
        result = command(state, "p0", "play", ["hearts-U"])
        result = command(result, "p0", "afterthrow", ["bells-U"])
        result = command(result, "p0", "afterthrow", ["leaves-U"])
        result = command(result, "p0", "afterthrow", ["acorns-U"])
        self.assertEqual(result["discard"], [])
        self.assertEqual(result["current_player_id"], "p0")
        self.assertIsNone(result["afterthrow"])
        self.assertEqual(len(result["players"][0]["hand"]), 3)

    def test_next_accepted_play_pickup_or_gamble_closes_previous_afterthrow(self):
        for action in ("play", "pickup", "gamble"):
            with self.subTest(action=action):
                state = scenario([["hearts-U", "bells-U", "hearts-6"], ["hearts-A", "hearts-8", "hearts-9"]],
                                 discard=["leaves-9"], deck=["acorns-7", "bells-K", "acorns-A"])
                state = command(state, "p0", "play", ["hearts-U"])
                state = command(state, "p1", action, ["hearts-A"] if action == "play" else None)
                with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_afterthrow_expired"):
                    command(state, "p0", "afterthrow", ["bells-U"])

    def test_invalid_or_stale_next_action_does_not_close_afterthrow(self):
        state = scenario([["hearts-U", "bells-U", "hearts-6"], ["hearts-7", "hearts-8", "hearts-9"]],
                         discard=["leaves-9"], deck=["acorns-7", "bells-K", "acorns-A"])
        state = command(state, "p0", "play", ["hearts-U"])
        snapshot = deepcopy(state)
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_rank_too_low"):
            command(state, "p1", "play", ["hearts-7"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_stale_version"):
            apply_action(state, "p1", "pickup", version=state["version"] - 1)
        self.assertEqual(state, snapshot)
        result = command(state, "p0", "afterthrow", ["bells-U"])
        self.assertEqual(result["discard"][-1], "bells-U")

    def test_wrong_rank_afterthrow_and_out_of_turn_actions_rejected(self):
        state = scenario([["hearts-U", "bells-U", "hearts-A"], ["hearts-6"]], discard=["leaves-9"])
        state = command(state, "p0", "play", ["hearts-U"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_afterthrow_wrong_rank"):
            command(state, "p0", "afterthrow", ["hearts-A"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_not_your_turn"):
            command(state, "p0", "play", ["hearts-A"])


class HausdeppEndgameTests(TestCase):
    def test_empty_hand_with_remaining_deck_must_refill_and_is_not_finished(self):
        state = scenario([["hearts-9"], ["acorns-6"]], discard=["hearts-8"],
                         deck=["bells-6", "bells-7", "bells-8", "bells-9"])
        result = command(state, "p0", "play", ["hearts-9"])
        self.assertEqual(result["players"][0]["hand"], ["bells-6", "bells-7", "bells-8"])
        self.assertFalse(result["players"][0]["finished"])
        self.assertEqual(result["phase"], "playing")

    def test_partial_refill_exhausts_deck_without_finishing(self):
        state = scenario([["hearts-9"], ["acorns-6"]], discard=["hearts-8"], deck=["bells-6"])
        result = command(state, "p0", "play", ["hearts-9"])
        self.assertEqual(result["players"][0]["hand"], ["bells-6"])
        self.assertEqual(result["deck"], [])
        self.assertEqual(result["finished_order"], [])

    def test_last_ten_also_refills_before_empty_hand_check(self):
        state = scenario([["hearts-10"], ["acorns-6"]], discard=["hearts-A"], deck=["bells-6"])
        result = command(state, "p0", "play", ["hearts-10"])
        self.assertEqual(result["players"][0]["hand"], ["bells-6"])
        self.assertFalse(result["players"][0]["finished"])
        self.assertEqual(result["current_player_id"], "p0")

    def test_finished_players_are_skipped_and_last_ten_passes_replay_right(self):
        state = scenario([["hearts-10"], [], ["hearts-6"], ["bells-7"]], discard=["hearts-A"])
        result = command(state, "p0", "play", ["hearts-10"])
        self.assertTrue(result["players"][0]["finished"])
        self.assertEqual(result["current_player_id"], "p2")
        self.assertEqual(result["discard"], [])

    def test_round_finishes_immediately_when_one_player_remains_with_open_packet(self):
        state = scenario([["hearts-9"], ["acorns-6"]], discard=["hearts-8"])
        result = command(state, "p0", "play", ["hearts-9"])
        self.assertEqual(result["phase"], "finished")
        self.assertEqual(result["loser_id"], "p1")
        self.assertEqual(result["discard"], ["hearts-8", "hearts-9"])
        self.assertIsNone(result["current_player_id"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_round_finished"):
            command(result, "p1", "pickup")

    def test_afterthrow_can_finish_a_player(self):
        state = scenario([["hearts-9", "bells-9"], ["acorns-6"]], discard=["hearts-8"])
        result = command(state, "p0", "play", ["hearts-9"])
        result = command(result, "p0", "afterthrow", ["bells-9"])
        self.assertEqual(result["phase"], "finished")
        self.assertEqual(result["finished_order"], ["p0"])

    def test_empty_table_cannot_be_collected_or_used_as_a_pass(self):
        state = scenario([["hearts-6"], ["bells-7"]])
        self.assertEqual(project_state(state, "p0")["available_actions"], ["play"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_empty_discard"):
            command(state, "p0", "pickup")
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_empty_deck"):
            command(state, "p0", "gamble")
        self.assertEqual(command(state, "p0", "play", ["hearts-6"])["loser_id"], "p1")


class HausdeppManualRefillTests(TestCase):
    def test_one_stock_tap_refills_all_missing_cards_and_gates_every_other_action(self):
        state = scenario([["hearts-U", "bells-U", "hearts-A"], ["acorns-6", "acorns-7", "acorns-8"]],
                         discard=["leaves-9"], deck=["hearts-6", "bells-7", "acorns-O"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_no_refill_pending"):
            command(state, "p0", "draw")
        result = command(state, "p0", "play", ["hearts-U", "bells-U"], complete_refill=False)
        self.assertEqual(result["players"][0]["hand"], ["hearts-A"])
        self.assertEqual(result["deck"], state["deck"])
        self.assertEqual(result["current_player_id"], "p0")
        self.assertEqual(result["pending_refill"], {
            "player_id": "p0", "remaining": 2, "continuation": "advance", "rank": "U",
        })
        self.assertEqual(project_state(result, "p0")["available_actions"], ["draw"])
        self.assertEqual(project_state(result, "p1")["available_actions"], [])
        snapshot = deepcopy(result)
        for actor, action, cards in (("p0", "gamble", None), ("p0", "pickup", None),
                                     ("p0", "play", ["hearts-A"]), ("p1", "pickup", None)):
            with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_refill_required"):
                command(result, actor, action, cards)
        self.assertEqual(result, snapshot)
        drawn = command(result, "p0", "draw")
        self.assertEqual(drawn["version"], result["version"] + 1)
        self.assertEqual(drawn["players"][0]["hand"], ["hearts-A", "hearts-6", "bells-7"])
        self.assertEqual(drawn["deck"], ["acorns-O"])
        self.assertIsNone(drawn["pending_refill"])
        self.assertEqual(drawn["current_player_id"], "p1")
        self.assertEqual(drawn["afterthrow"], {"player_id": "p0", "rank": "U"})
        self.assertEqual(drawn["last_event"], {"type": "draw", "player_id": "p0", "drawn_count": 2})
        self.assertNotIn("cards", project_state(drawn, "p1")["last_event"])

    def test_empty_hand_cannot_finish_until_required_stock_tap_even_if_only_one_card_remains(self):
        state = scenario([["hearts-9"], ["acorns-6"]], discard=["hearts-8"], deck=["bells-6"])
        result = command(state, "p0", "play", ["hearts-9"], complete_refill=False)
        self.assertEqual(result["players"][0]["hand"], [])
        self.assertFalse(result["players"][0]["finished"])
        self.assertEqual(result["phase"], "playing")
        self.assertEqual(result["pending_refill"]["remaining"], 1)
        result = command(result, "p0", "draw")
        self.assertEqual(result["players"][0]["hand"], ["bells-6"])
        self.assertEqual(result["deck"], [])
        self.assertFalse(result["players"][0]["finished"])

    def test_afterthrow_window_begins_only_after_stock_tap_and_can_require_another_tap(self):
        state = scenario([["hearts-U", "bells-U", "hearts-A"], ["acorns-6"]],
                         discard=["leaves-9"], deck=["leaves-U", "acorns-U", "hearts-6"])
        result = command(state, "p0", "play", ["hearts-U"], complete_refill=False)
        self.assertIsNone(result["afterthrow"])
        with self.assertRaisesRegex(HausdeppRuleError, "hausdepp_refill_required"):
            command(result, "p0", "afterthrow", ["bells-U"])
        result = command(result, "p0", "draw")
        self.assertIn("afterthrow", project_state(result, "p0")["available_actions"])
        result = command(result, "p0", "afterthrow", ["bells-U"], complete_refill=False)
        self.assertEqual(result["current_player_id"], "p0")
        self.assertEqual(project_state(result, "p0")["available_actions"], ["draw"])
        result = command(result, "p0", "draw")
        self.assertIn("afterthrow", project_state(result, "p0")["available_actions"])

    def test_ten_burn_then_refill_grants_a_fresh_turn_that_can_gamble_on_empty_table(self):
        state = scenario([["hearts-10", "hearts-A", "bells-A"], ["acorns-7"]],
                         discard=["leaves-K"], deck=["leaves-A", "acorns-6"])
        burned = command(state, "p0", "play", ["hearts-10"], complete_refill=False)
        self.assertEqual(burned["discard"], [])
        self.assertEqual(burned["pending_refill"]["continuation"], "replay")
        self.assertEqual(project_state(burned, "p0")["available_actions"], ["draw"])
        result = command(burned, "p0", "draw")
        self.assertEqual(result["players"][0]["hand"], ["hearts-A", "bells-A", "leaves-A"])
        self.assertEqual(result["current_player_id"], "p0")
        self.assertIn("gamble", project_state(result, "p0")["available_actions"])
        self.assertNotIn("draw", project_state(result, "p0")["available_actions"])
        result = command(result, "p0", "gamble")
        self.assertEqual(result["discard"], ["acorns-6"])
        self.assertTrue(result["last_event"]["success"])
        self.assertEqual(result["players"][0]["hand"], ["hearts-A", "bells-A", "leaves-A"])

    def test_four_of_a_kind_also_requires_stock_tap_before_replaying(self):
        fours = [f"{suit}-U" for suit in ("hearts", "bells", "leaves", "acorns")]
        state = scenario([fours, ["acorns-6"]], discard=["leaves-9"], deck=["hearts-A", "bells-A", "leaves-A"])
        result = command(state, "p0", "play", fours, complete_refill=False)
        self.assertEqual(result["players"][0]["hand"], [])
        self.assertEqual(result["pending_refill"]["remaining"], 3)
        self.assertFalse(result["players"][0]["finished"])
        self.assertEqual(project_state(result, "p0")["available_actions"], ["draw"])
        self.assertEqual(choose_cpu_action(project_state(result, "p0")), {"action": "draw", "version": result["version"]})
        result = command(result, "p0", "draw")
        self.assertEqual(result["players"][0]["hand"], ["hearts-A", "bells-A", "leaves-A"])
        self.assertEqual(result["current_player_id"], "p0")


class HausdeppPrivacyAndCpuTests(TestCase):
    def test_projection_allowlist_hides_all_opponent_hands_and_deck_order(self):
        state = new_round(["p0", {"id": "p1", "name": "Computer", "is_cpu": True}], rng=Random(9))
        state["unexpected_future_secret"] = "not visible"
        view = project_state(state, "p0")
        self.assertEqual(view["hand"], state["players"][0]["hand"])
        self.assertNotIn("deck", view)
        self.assertNotIn("burned", view)
        self.assertNotIn("unexpected_future_secret", view)
        self.assertTrue(all("hand" not in player for player in view["players"]))
        self.assertEqual(project_state(state, None)["hand"], [])
        self.assertEqual(project_state(state, "unknown")["available_actions"], [])
        json.dumps(state)
        json.dumps(view)
        view["hand"].clear()
        self.assertTrue(state["players"][0]["hand"])

    def test_cpu_uses_low_legal_multiples_and_saves_ten_while_drawing(self):
        state = scenario([["hearts-U", "bells-U", "hearts-A", "hearts-10"], ["acorns-6"]],
                         discard=["leaves-9"], deck=["bells-6"])
        move = choose_cpu_action(project_state(state, "p0"))
        self.assertEqual(move["action"], "play")
        self.assertEqual(set(move["cards"]), {"hearts-U", "bells-U"})

    def test_cpu_spends_ten_to_finish_with_matching_remaining_cards(self):
        state = scenario([["hearts-K", "bells-K", "hearts-10"], ["acorns-6"]], discard=["leaves-9"])
        move = choose_cpu_action(project_state(state, "p0"))
        self.assertEqual(move["cards"], ["hearts-10"])
        result = command(state, "p0", move["action"], move.get("cards"))
        move = choose_cpu_action(project_state(result, "p0"))
        self.assertEqual(set(move["cards"]), {"hearts-K", "bells-K"})
        result = command(result, "p0", move["action"], move.get("cards"))
        self.assertEqual(result["loser_id"], "p1")

    def test_cpu_gambles_or_collects_when_no_legal_hand_card(self):
        state = scenario([["hearts-6", "hearts-7", "hearts-8"], ["acorns-6"]],
                         discard=["leaves-A"], deck=["bells-U"])
        self.assertEqual(choose_cpu_action(project_state(state, "p0"))["action"], "gamble")
        state["deck"] = []
        self.assertEqual(choose_cpu_action(project_state(state, "p0"))["action"], "pickup")
        self.assertIsNone(choose_cpu_action(project_state(state, "p1")))

    def test_seeded_complete_cpu_rounds_preserve_every_card_and_finish(self):
        for count in (2, 3, 5, 6):
            with self.subTest(players=count):
                state = new_round([f"p{i}" for i in range(count)], rng=Random(37 + count))
                for _ in range(4000):
                    if state["phase"] == "finished":
                        break
                    following = state["afterthrow"]
                    actor = following["player_id"] if following else state["current_player_id"]
                    move = choose_cpu_action(project_state(state, actor))
                    if move is None:
                        actor = state["current_player_id"]
                        move = choose_cpu_action(project_state(state, actor))
                    self.assertIsNotNone(move)
                    previous = deepcopy(state)
                    state = apply_action(state, actor, **move)
                    self.assertEqual(previous["version"] + 1, state["version"])
                    cards = state["deck"] + state["discard"] + state["burned"]
                    cards += [card for player in state["players"] for card in player["hand"]]
                    self.assertEqual(sorted(cards), sorted(make_deck()))
                    if state["deck"]:
                        refill_owner = (state.get("pending_refill") or {}).get("player_id")
                        self.assertTrue(all(len(p["hand"]) >= 3 for p in state["players"]
                                            if not p["finished"] and p["id"] != refill_owner))
                self.assertEqual(state["phase"], "finished")
                self.assertEqual(len(state["finished_order"]), count - 1)
                self.assertTrue(next(p for p in state["players"] if p["id"] == state["loser_id"])["hand"])
