"""Event evidence follows accepted rules, hidden knowledge, and deferred finishes."""

from __future__ import annotations

import json
from copy import deepcopy

import pytest

from app.hausdepp_engine import HausdeppRuleError, apply_action, make_deck, new_round, project_state
from app.hausdepp_results import validate_hausdepp_evidence


def scene(hands, *, deck=(), discard=(), current="p0"):
    state = new_round([f"p{index}" for index in range(len(hands))], deck=make_deck())
    cards = [card for hand in hands for card in hand] + list(deck) + list(discard)
    assert len(cards) == len(set(cards))
    for player, hand in zip(state["players"], hands):
        player["hand"] = list(hand)
    state.update(phase="playing", deck=list(deck), discard=list(discard),
                 burned=[card for card in make_deck() if card not in cards],
                 current_player_id=current, peek_information={"player_id": "p1", "cards": [], "success": False,
                                                              "complete": True})
    return state


def act(state, actor, action, cards=None):
    return apply_action(state, actor, action, cards, version=state["version"])


def flags(state, actor="p0"):
    return {int(flag.rsplit("_", 1)[1]) for flag in state["achievement_evidence"]["players"][actor]["flags"]}


@pytest.mark.parametrize("aces,stop,expected", [(0, "hearts-10", 17), (1, "hearts-10", 18),
                                               (2, "hearts-10", 19), (1, "hearts-K", 20)])
def test_private_active_peek_chain(aces, stop, expected):
    chain = ["bells-A", "leaves-A"][:aces] + [stop]
    state = new_round(["p0", "p1"], deck=[card for card in make_deck() if card not in chain] + chain[::-1])
    for _ in chain:
        state = act(state, "p1", "peek")
    assert expected in flags(state, "p1")
    for viewer in ("p0", "p1", None):
        public = json.dumps(project_state(state, viewer))
        assert "achievement_evidence" not in public
        assert "hausdepp_20" not in public
    if expected == 20:
        assert "hearts-K" not in json.dumps(project_state(state, "p0"))


@pytest.mark.parametrize("top,drawn,hand,expected", [
    (["hearts-9"], "bells-9", ["hearts-6"], {21}),
    (["hearts-A"], "bells-A", ["hearts-6"], {21, 22}),
    (["hearts-A"], "bells-10", ["hearts-6"], {22, 25, 26}),
    ([], "hearts-6", ["hearts-A", "bells-A", "leaves-A"], {23, 24}),
])
def test_successful_gamble_conditions(top, drawn, hand, expected):
    state = scene([hand, ["acorns-7"]], deck=[drawn], discard=top)
    assert flags(act(state, "p0", "gamble")) >= expected


def test_ten_clear_size_all_four_and_uninterrupted_clear_chain():
    tens = [f"{suit}-10" for suit in ("hearts", "bells", "leaves", "acorns")]
    pile = [card for card in make_deck() if card not in tens and card != "acorns-A"][:15]
    state = scene([tens + ["acorns-A"], ["leaves-A"]], discard=[card for card in pile if card != "leaves-A"])
    # First burn contains at least 16 physical cards including this ten.
    for card in tens:
        state = act(state, "p0", "play", [card])
    assert flags(state) >= {25, 27, 28, 31, 32, 47, 48}
    assert state["achievement_evidence"]["players"]["p0"]["ten_clears"] == 4


def test_ten_then_empty_table_gamble_and_refill_do_not_interrupt_chain():
    state = scene([["hearts-10", "hearts-A", "bells-A"], ["acorns-7"]],
                  deck=["hearts-6", "bells-10", "leaves-8"], discard=["acorns-A"])
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p0", "draw")
    state = act(state, "p0", "gamble")
    assert flags(state) >= {25, 26, 30, 31, 47}


def test_other_players_refill_does_not_interrupt_clear_continuation():
    state = scene([["hearts-10", "bells-10", "hearts-A"], ["hearts-7"]], deck=["leaves-8", "acorns-9"])
    state["pending_refills"] = {"p1": {"player_id": "p1", "remaining": 2, "continuation": "advance", "rank": "7"}}
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p1", "draw")
    state = act(state, "p0", "play", ["bells-10"])
    assert {31, 47} <= flags(state)


def test_other_players_accepted_play_breaks_clear_chain():
    state = scene([["hearts-10", "hearts-6", "bells-10", "hearts-A"], ["bells-6", "hearts-7"]])
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p0", "play", ["hearts-6"])
    state = act(state, "p1", "play", ["bells-6"])
    state = act(state, "p0", "play", ["bells-10"])
    assert not {31, 47, 48} & flags(state)


@pytest.mark.parametrize("rank,extra", [("6", {37}), ("A", {38})])
def test_four_cards_from_own_hand(rank, extra):
    four = [f"{suit}-{rank}" for suit in ("hearts", "bells", "leaves", "acorns")]
    state = scene([four + ["hearts-10"], ["bells-7"]])
    state = act(state, "p0", "play", four)
    assert flags(state) >= {33, 34, 45, 46} | extra


def test_fourer_origins_from_four_different_players_and_from_three_other_cards():
    state = scene([["hearts-9", "hearts-A"], ["bells-9", "bells-A"],
                   ["leaves-9", "leaves-A"], ["acorns-9", "acorns-A"]])
    for index, suit in enumerate(("hearts", "bells", "leaves", "acorns")):
        state = act(state, f"p{index}", "play", [f"{suit}-9"])
    assert flags(state, "p3") >= {33, 35, 36}
    assert 34 not in flags(state, "p3")


def test_fourth_same_card_by_gambling_and_unknown_original_cards_not_attributed():
    state = scene([["hearts-A"], ["bells-A"]], deck=["acorns-9"],
                  discard=["hearts-9", "bells-9", "leaves-9"])
    state = act(state, "p0", "gamble")
    assert flags(state) >= {21, 33, 40}
    assert not {34, 35, 36} & flags(state)


def test_fresh_refill_afterthrow_fourer_and_two_refill_delivery_chain():
    state = scene([["hearts-9", "hearts-A", "bells-A"], ["acorns-7"]],
                  deck=["bells-9", "leaves-9", "acorns-9", "hearts-6"])
    state = act(state, "p0", "play", ["hearts-9"])
    for card in ("bells-9", "leaves-9", "acorns-9"):
        state = act(state, "p0", "draw")
        state = act(state, "p0", "afterthrow", [card])
    assert flags(state) >= {33, 34, 39, 41, 42, 43, 44, 45, 46}


def test_two_afterthrows_from_one_refill_are_not_two_refill_cycles():
    state = scene([["hearts-9", "bells-9", "hearts-A"], ["acorns-7"]],
                  deck=["leaves-9", "acorns-9", "hearts-6"])
    state = act(state, "p0", "play", ["hearts-9", "bells-9"])
    state = act(state, "p0", "draw")
    state = act(state, "p0", "afterthrow", ["leaves-9"])
    state = act(state, "p0", "afterthrow", ["acorns-9"])
    assert 43 in flags(state)
    assert 44 not in flags(state)


def test_afterthrow_expiration_and_stock_fifo_stay_authoritative():
    state = scene([["hearts-9", "hearts-A", "bells-A"], ["bells-9", "leaves-A", "acorns-A"]],
                  deck=["leaves-9", "acorns-9", "hearts-6"])
    state = act(state, "p0", "play", ["hearts-9"])
    state = act(state, "p1", "play", ["bells-9"])
    before = deepcopy(state)
    with pytest.raises(HausdeppRuleError, match="hausdepp_stock_refill_wait"):
        act(state, "p1", "draw")
    with pytest.raises(HausdeppRuleError, match="hausdepp_afterthrow_expired"):
        act(state, "p0", "afterthrow", ["hearts-A"])
    assert state == before
    state = act(state, "p0", "draw")
    assert 42 not in flags(state)


def test_failed_gamble_twice_then_finish_records_misfortune_and_recovery():
    state = scene([["hearts-10", "bells-10"], ["hearts-A", "bells-A", "acorns-A", "leaves-K"]],
                  deck=["hearts-6", "bells-6"], discard=["leaves-A"])
    state = act(state, "p0", "gamble")
    state = act(state, "p1", "play", ["hearts-A"])
    state = act(state, "p0", "gamble")
    assert flags(state) >= {49, 50, 51, 54}
    state = act(state, "p1", "play", ["bells-A"])
    state = act(state, "p0", "play", ["hearts-10"])
    for cards in (["hearts-6", "bells-6"], ["hearts-A", "leaves-A"], ["bells-10"]):
        if state["current_player_id"] != "p0":
            state = act(state, "p1", "pickup")
        state = act(state, "p0", "play", cards)
    assert 64 in flags(state)


def test_large_endgame_pickup_and_finishing_after_large_hand():
    pile = [card for card in make_deck() if not card.endswith("-10")][:17]
    state = scene([["hearts-10"], ["bells-10", "acorns-K", "acorns-A"]], discard=pile)
    state = act(state, "p0", "pickup")
    assert flags(state) >= {52, 53, 55}
    state = act(state, "p1", "play", ["bells-10"])
    state = act(state, "p1", "play", ["acorns-K"])
    state = act(state, "p0", "play", ["hearts-10"])
    for rank in ("6", "7", "8", "9", "U", "O", "K", "A"):
        cards = [card for card in state["players"][0]["hand"] if card.endswith(f"-{rank}")]
        state = act(state, "p0", "play", cards)
        if state["phase"] == "playing":
            state = act(state, "p1", "pickup")
    assert {63, 65, 67, 68, 76} <= flags(state)


@pytest.mark.parametrize("card,expected", [("hearts-6", 58), ("hearts-10", 59)])
def test_single_last_card_and_no_ten_negative_fact(card, expected):
    state = scene([[card], ["bells-7"]])
    state = act(state, "p0", "play", [card])
    assert expected in flags(state)
    assert (62 in flags(state)) is (expected == 58)


def test_finish_three_can_be_split_between_placement_and_afterthrows():
    state = scene([["hearts-9", "bells-9", "leaves-9"], ["acorns-A"]])
    state = act(state, "p0", "play", ["hearts-9"])
    state = act(state, "p0", "afterthrow", ["bells-9"])
    state = act(state, "p0", "afterthrow", ["leaves-9"])
    assert flags(state) >= {43, 45, 46, 60, 62}


def test_endgame_ten_then_rest_of_hand_finishes():
    state = scene([["hearts-10", "hearts-6", "bells-6"], ["acorns-A"]], discard=["hearts-A"])
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p0", "play", ["hearts-6", "bells-6"])
    assert 61 in flags(state)


def test_last_stock_draw_settles_another_players_empty_hand_and_terminal_evidence():
    state = scene([["hearts-6"], ["bells-7", "hearts-A"]], deck=["leaves-8"])
    state = act(state, "p0", "play", ["hearts-6"])
    assert not state["players"][0]["finished"]
    assert not {58, 62} & flags(state)
    # A later player is allowed to play first but must respect the FIFO draw.
    state = act(state, "p1", "play", ["bells-7"])
    # Simulate a reconnect of the oldest outstanding draw with a stale snapshot:
    # the accepted stock tap consumes the final card; no premature finish.
    state = act(state, "p0", "draw")
    assert not state["players"][0]["finished"]
    assert not {58, 62} & flags(state)


def test_deferred_empty_hand_finishes_when_older_player_draws_last_stock_card():
    state = scene([["bells-6"], ["hearts-6", "hearts-A"]], deck=["leaves-8"], current="p1")
    state = act(state, "p1", "play", ["hearts-6"])
    state = act(state, "p0", "play", ["bells-6"])
    assert not state["players"][0]["finished"]
    assert not {58, 62} & flags(state)
    state = act(state, "p1", "draw")
    assert state["players"][0]["finished"]
    assert {58, 62} <= flags(state)


def test_unknown_legacy_past_does_not_prove_no_ten_or_fabricate_previous_peek():
    state = scene([["hearts-6"], ["bells-7"]])
    del state["achievement_evidence"]
    original = deepcopy(state)
    with pytest.raises(HausdeppRuleError):
        act(state, "p1", "play", ["bells-7"])
    assert state == original
    state = act(state, "p0", "play", ["hearts-6"])
    assert state["achievement_evidence"]["complete"] is False
    assert flags(state) == {58}


def test_json_reconnect_keeps_private_counters_and_fourer_origins():
    state = scene([["hearts-9", "hearts-A"], ["bells-9", "bells-A"],
                   ["leaves-9", "leaves-A"], ["acorns-9", "acorns-A"]])
    for index, suit in enumerate(("hearts", "bells", "leaves", "acorns")):
        state = act(json.loads(json.dumps(state)), f"p{index}", "play", [f"{suit}-9"])
    assert {35, 36} <= flags(state, "p3")
    assert len(json.dumps(state["achievement_evidence"])) < 3000


def test_finish_after_twenty_four_cards_without_any_ten():
    reserve = {"hearts-6", "hearts-10", "acorns-K", "acorns-A"}
    pile = [card for card in make_deck() if not card.endswith("-10") and card not in reserve][:23]
    state = scene([["hearts-6"], ["hearts-10", "acorns-K", "acorns-A"]], discard=pile)
    state = act(state, "p0", "pickup")
    state = act(state, "p1", "play", ["hearts-10"])
    state = act(state, "p1", "play", ["acorns-K"])
    aces = [card for card in state["players"][0]["hand"] if card.endswith("-A")]
    state = act(state, "p0", "play", aces)
    state = act(state, "p1", "pickup")
    for rank in ("6", "7", "8", "9", "U", "O", "K"):
        cards = [card for card in state["players"][0]["hand"] if card.endswith(f"-{rank}")]
        state = act(state, "p0", "play", cards)
        if state["phase"] == "playing" and state["current_player_id"] == "p1":
            state = act(state, "p1", "pickup")
    assert state["players"][0]["finished"]
    assert flags(state) >= {62, 63, 65, 66, 67, 68, 75, 76}
    assert 84 not in flags(state)


def test_three_failed_gambles_then_finish_without_tens():
    state = scene([["hearts-7"], ["hearts-A", "bells-A", "acorns-A", "leaves-K", "acorns-K"]],
                  deck=["hearts-6", "bells-6", "leaves-6"], discard=["leaves-A"])
    for ace in ("hearts-A", "bells-A", "acorns-A"):
        state = act(state, "p0", "gamble")
        state = act(state, "p1", "play", [ace])
    for suffix in ("-A", "-6", "-7"):
        cards = [card for card in state["players"][0]["hand"] if card.endswith(suffix)]
        state = act(state, "p0", "play", cards)
        if state["phase"] == "playing" and state["current_player_id"] == "p1":
            state = act(state, "p1", "pickup")
    assert flags(state) >= {49, 50, 51, 54, 62, 64, 69, 70, 71, 73, 74}


def test_stock_exhaustion_leader_in_cards_can_recover():
    hand = [card for card in make_deck() if card.startswith("hearts-") and not card.endswith("-10")] + ["bells-6"]
    state = scene([hand, ["acorns-6", "acorns-7", "acorns-8"]], deck=["acorns-9"], current="p1")
    state = act(state, "p1", "play", ["acorns-6"])
    state = act(state, "p1", "draw")
    assert state["achievement_evidence"]["players"]["p0"]["stock_comeback"]
    for rank in ("6", "7", "8", "9", "U", "O", "K", "A"):
        cards = [card for card in state["players"][0]["hand"] if card.endswith(f"-{rank}")]
        state = act(state, "p0", "play", cards)
        if state["phase"] == "playing":
            state = act(state, "p1", "pickup")
    assert 72 in flags(state)


@pytest.mark.parametrize("players,expected", [(2, True), (3, False)])
def test_large_hand_comeback_requires_an_actual_final_duel(players, expected):
    state = scene([["hearts-6"], ["bells-A"], *([["leaves-A"]] if players == 3 else [])])
    state["achievement_evidence"]["players"]["p0"]["max_hand"] = 12
    state = act(state, "p0", "play", ["hearts-6"])
    assert (76 in flags(state)) is expected


@pytest.mark.parametrize("rank,expected", [("U", 77), ("O", 78)])
def test_picture_card_quartets(rank, expected):
    cards = [f"{suit}-{rank}" for suit in ("hearts", "bells", "leaves", "acorns")]
    state = act(scene([cards, ["hearts-A"]]), "p0", "play", cards)
    assert expected in flags(state)


@pytest.mark.parametrize("separately", [False, True])
def test_last_four_kings_finish_by_batch_or_individual_taps(separately):
    cards = [f"{suit}-K" for suit in ("hearts", "bells", "leaves", "acorns")]
    state = scene([cards, ["hearts-A"]])
    if separately:
        for index, card in enumerate(cards):
            state = act(state, "p0", "play" if index == 0 else "afterthrow", [card])
    else:
        state = act(state, "p0", "play", cards)
    assert 79 in flags(state)


def test_completing_opponents_kings_with_one_last_king_is_not_own_four_king_finish():
    state = scene([["hearts-K"], ["hearts-A"]], discard=["bells-K", "leaves-K", "acorns-K"])
    state = act(state, "p0", "play", ["hearts-K"])
    assert 79 not in flags(state)


def test_two_quartets_and_mixed_ten_quartet_clear():
    under = [f"{suit}-U" for suit in ("hearts", "bells", "leaves", "acorns")]
    upper = [f"{suit}-O" for suit in ("hearts", "bells", "leaves", "acorns")]
    state = scene([["hearts-10", *under, *upper], ["hearts-A"]])
    for cards in (["hearts-10"], under, upper):
        state = act(state, "p0", "play", cards)
    assert flags(state) >= {77, 78, 80, 82}


@pytest.mark.parametrize("separately", [False, True])
def test_finishing_only_tens_allows_tap_single_cards(separately):
    state = scene([["hearts-10", "bells-10"], ["hearts-A"]])
    if separately:
        state = act(state, "p0", "play", ["hearts-10"])
        assert 81 not in flags(state)
        state = act(state, "p0", "play", ["bells-10"])
    else:
        state = act(state, "p0", "play", ["hearts-10", "bells-10"])
    assert 81 in flags(state)


@pytest.mark.parametrize("drawn", ["hearts-A", "hearts-10"])
def test_gambling_above_a_king(drawn):
    state = scene([["hearts-6"], ["bells-7"]], deck=[drawn], discard=["bells-K"])
    assert 83 in flags(act(state, "p0", "gamble"))


def test_new_no_pickup_achievement_requires_complete_pickup_tracking():
    state = scene([["hearts-6"], ["bells-7"]])
    assert 84 in flags(act(state, "p0", "play", ["hearts-6"]))
    for evidence in state["achievement_evidence"]["players"].values():
        del evidence["pickups_known"]
    result = act(state, "p0", "play", ["hearts-6"])
    assert 62 in flags(result)
    assert 84 not in flags(result)


NINES = [f"{suit}-9" for suit in ("hearts", "bells", "leaves", "acorns")]


@pytest.mark.parametrize("order", [(["hearts-10"], NINES), (NINES, ["hearts-10"])])
def test_mixed_ten_and_quartet_clear_chain_in_either_order(order):
    state = scene([["hearts-10", *NINES, "hearts-A"], ["bells-7"]])
    state = act(state, "p0", "play", order[0])
    assert 137 not in flags(state)
    state = act(state, "p0", "play", order[1])
    assert {47, 82, 137} <= flags(state)
    stored = validate_hausdepp_evidence(json.loads(json.dumps(state["achievement_evidence"])), {"p0", "p1"})
    assert "hausdepp_137" in stored["players"]["p0"]["flags"]


def test_two_ten_clears_in_a_row_are_not_the_mixed_chain():
    state = scene([["hearts-10", "bells-10", "hearts-A"], ["bells-7"]])
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p0", "play", ["bells-10"])
    assert {31, 47} <= flags(state)
    assert 137 not in flags(state)


def test_other_players_accepted_play_breaks_mixed_chain_but_not_round_combination():
    state = scene([["hearts-10", "hearts-6", "leaves-6", "acorns-6"], ["bells-6", "hearts-7"]])
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p0", "play", ["hearts-6"])
    state = act(state, "p1", "play", ["bells-6"])
    state = act(state, "p0", "play", ["leaves-6", "acorns-6"])
    assert 82 in flags(state)
    # Two final cards are not a single last card, although p1 helped build the four.
    assert not {137, 138} & flags(state)


def test_other_players_refill_does_not_break_mixed_chain():
    state = scene([["hearts-10", *NINES, "hearts-A"], ["hearts-7"]], deck=["leaves-8", "acorns-8"])
    state["pending_refills"] = {"p1": {"player_id": "p1", "remaining": 2, "continuation": "advance", "rank": "7"}}
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p1", "draw")
    state = act(state, "p0", "play", NINES)
    assert 137 in flags(state)


def test_own_non_clearing_play_then_own_afterthrow_quartet_keeps_chain_like_47():
    # Same uninterrupted-chain semantics as #47: no other player acted in between.
    state = scene([["hearts-10", *NINES, "hearts-A"], ["bells-7"]])
    state = act(state, "p0", "play", ["hearts-10"])
    state = act(state, "p0", "play", NINES[:3])
    state = act(state, "p0", "afterthrow", NINES[3:])
    assert {33, 47, 137} <= flags(state)


def four_seat_nines(last_hand, *, deck=()):
    hands = [["hearts-9", "hearts-A"], ["bells-9", "bells-A"], ["leaves-9", "leaves-A"], last_hand]
    state = scene(hands, deck=deck)
    for index, card in enumerate(("hearts-9", "bells-9", "leaves-9")):
        state = act(state, f"p{index}", "play", [card])
    return state


def test_single_last_hand_card_completes_others_quartet_and_finishes():
    state = act(four_seat_nines(["acorns-9"]), "p3", "play", ["acorns-9"])
    assert state["players"][3]["finished"]
    assert {33, 35, 36, 138} <= flags(state, "p3")
    # The accepted engine evidence passes the stored-result validator, which
    # keeps the award and strips the private terminal marker.
    stored = validate_hausdepp_evidence(json.loads(json.dumps(state["achievement_evidence"])),
                                        {"p0", "p1", "p2", "p3"})
    assert "hausdepp_138" in stored["players"]["p3"]["flags"]
    assert "quartet_finish" not in json.dumps(stored) and "terminal" not in json.dumps(stored)


def test_quartet_with_last_card_while_stock_remains_is_not_the_empty_stock_finish():
    state = act(four_seat_nines(["acorns-9"], deck=["hearts-6"]), "p3", "play", ["acorns-9"])
    assert 33 in flags(state, "p3")
    assert 138 not in flags(state, "p3")


def test_all_own_quartet_finish_is_not_the_shared_quartet_finish():
    state = scene([NINES, ["bells-7"]])
    state = act(state, "p0", "play", NINES[:3])
    state = act(state, "p0", "afterthrow", NINES[3:])
    assert state["players"][0]["finished"]
    assert 34 in flags(state)
    assert 138 not in flags(state)


def test_unknown_pile_origins_never_count_as_another_player():
    state = scene([["acorns-9"], ["hearts-A"]], discard=NINES[:3])
    state = act(state, "p0", "play", ["acorns-9"])
    assert state["players"][0]["finished"]
    assert 33 in flags(state)
    assert 138 not in flags(state)


def test_two_last_cards_completing_others_quartet_is_not_single():
    state = scene([["hearts-9", "hearts-A"], ["bells-9", "bells-A"], ["leaves-9", "acorns-9"]])
    state = act(state, "p0", "play", ["hearts-9"])
    state = act(state, "p1", "play", ["bells-9"])
    state = act(state, "p2", "play", ["leaves-9", "acorns-9"])
    assert state["players"][2]["finished"]
    assert 35 not in flags(state, "p2")
    assert 138 not in flags(state, "p2")


def test_saved_terminal_without_new_marker_stays_unknown_false():
    state = scene([["bells-6"], ["hearts-6", "hearts-A"]], deck=["leaves-8"], current="p1")
    state = act(state, "p1", "play", ["hearts-6"])
    state = act(state, "p0", "play", ["bells-6"])
    assert not state["players"][0]["finished"]
    state = json.loads(json.dumps(state))
    del state["achievement_evidence"]["players"]["p0"]["terminal"]["quartet_finish"]
    state = act(state, "p1", "draw")
    assert state["players"][0]["finished"]
    assert 58 in flags(state)
    assert 138 not in flags(state)


def test_ten_only_finish_chain_must_already_start_with_only_tens():
    kings = [f"{suit}-K" for suit in ("hearts", "bells", "leaves", "acorns")]
    state = scene([[*kings, "hearts-10", "bells-10"], ["hearts-A"]])
    for cards in (kings, ["hearts-10"], ["bells-10"]):
        state = act(state, "p0", "play", cards)
    assert 81 not in flags(state)
