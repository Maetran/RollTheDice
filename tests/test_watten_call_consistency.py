"""Audit frozen/showed calls against references, scoring and an independent oracle."""

import json
import random
from itertools import permutations

import pytest

from app.watten_bidding import retourschneider_candidate
from app.watten_cards import DealtCards, deal_cards, make_deck
from app.watten_engine import (
    announcement_roles,
    apply_command,
    next_deal,
    preplay_seats,
    restore_storage,
    start_match,
    storage_payload,
)
from app.watten_play import legal_cards
from app.watten_rules import WattenCall
from app.watten_views import member_view, spectator_view
from tests.test_watten_engine import actor, command, dealt, recipe, step


def restored(state):
    return restore_storage(json.loads(json.dumps(storage_payload(state))))


def shuffled(count, rng):
    deck = list(make_deck())
    rng.shuffle(deck)
    return deal_cards(deck, player_count=count, recipient_order=tuple(range(count)) * 5)


def source_call(state):
    """Expected call from the actual displayed source IDs, without rule helpers."""
    roles = announcement_roles(state)
    strike = state.deal.bottom_cards[roles.strike_announcer]
    colour = state.deal.bottom_cards[roles.suit_announcer]
    return WattenCall("weli" if strike == "bells-6" else strike.split("-")[1], colour.split("-")[0])


def oracle_winner(cards, call, critical):
    """Owner-approved hierarchy; independent of card_kind/strength/trick_winner."""
    ranks = ("7", "8", "9", "10", "U", "O", "K", "A")
    critical_power = {"hearts-K": 3, "bells-6": 2, "acorns-7": 1}
    lead_suit = call.trump_suit if cards[0] == "bells-6" else cards[0].split("-")[0]

    def power(card):
        suit, rank = card.split("-")
        if critical and card in critical_power:
            return 4, critical_power[card]
        if (call.strike_rank == "weli" and card == "bells-6") or (
                rank == call.strike_rank and suit == call.trump_suit):
            return 3, 0
        if rank == call.strike_rank:
            return 2, 0
        if card == "bells-6" or suit == call.trump_suit:
            return 1, -1 if card == "bells-6" else ranks.index(rank)
        return (0, ranks.index(rank)) if suit == lead_suit else (-1, 0)

    return max(range(len(cards)), key=lambda index: power(cards[index]))


def check_call(state, expected):
    assert state.call == expected
    if state.play is not None:
        assert state.play.call == expected
        for trick in state.play.tricks:
            assert trick.winner == (trick.leader + oracle_winner(
                trick.cards, expected, state.recipe.profile.critical)) % len(state.recipe.seats)
    if state.phase in {"deal_complete", "match_complete"}:
        matching = "bells-6" if expected.strike_rank == "weli" else f"{expected.trump_suit}-{expected.strike_rank}"
        critical = state.recipe.profile.critical and matching in {"hearts-K", "bells-6", "acorns-7"}
        summary = {"strike_rank": expected.strike_rank, "trump_suit": expected.trump_suit,
                   "rechter": None if critical else matching}
        assert spectator_view(state)["round_summary"] == summary
        for seat, player in enumerate(state.recipe.seats):
            assert member_view(state, account_id=seat + 1, player_id=player)["round_summary"] == summary


def show_and_ack(state, *, reverse=False):
    expected = source_call(state)
    order = sorted(state.inspectors, reverse=reverse)
    for seat in order:
        state = restored(step(state, state.recipe.seats[seat], "show_ready"))
    roles = announcement_roles(state)
    cards = [{"role": "strike", "card": state.deal.bottom_cards[roles.strike_announcer]},
             {"role": "colour", "card": state.deal.bottom_cards[roles.suit_announcer]}]
    for seat in order:
        assert member_view(state, account_id=seat + 1, player_id=state.recipe.seats[seat])["inspection"]["cards"] == cards
    assert state.call == expected
    for seat in reversed(order):
        state = restored(step(state, state.recipe.seats[seat], "inspection_ack"))
    check_call(state, expected)
    return state, expected


def play_round(state, expected, rng):
    while state.phase == "play":
        player = state.play.current_player_id
        state = step(state, player, "play_card", rng.choice(legal_cards(state.play, state.bid_state, player)))
        check_call(state, expected)
        if len(state.play.plays) % len(state.recipe.seats) == 0:
            state = restored(state)
            check_call(state, expected)
    assert state.phase in {"deal_complete", "match_complete"}
    return state


@pytest.mark.parametrize("dealer", range(4))
@pytest.mark.parametrize("reverse", (False, True))
@pytest.mark.parametrize("bloedeln", (False, True))
@pytest.mark.parametrize("swap_roles", (False, True))
def test_reported_pair_uses_the_rank_and_suit_of_its_actual_roles(dealer, reverse, bloedeln, swap_roles, record_property):
    bottoms = [None] * 4
    bottoms[dealer], bottoms[(dealer + 1) % 4] = ("leaves-7", "bells-A") if swap_roles else ("bells-A", "leaves-7")
    for seat in range(4):
        if bottoms[seat] is None:
            bottoms[seat] = ("hearts-8", "acorns-9")[seat % 2]
    state = start_match(recipe(4, "ladinisch", True, show_rechter=True), "reported-call",
                        dealt(4, bottoms=bottoms), first_dealer="ABCD"[dealer])
    if bloedeln:
        requester, responder = preplay_seats(state, "bloedeln")
        state = step(state, state.recipe.seats[requester], "request_bloedeln")
        state = restored(step(state, state.recipe.seats[responder], "preplay_accept"))
    state, expected = show_and_ack(state, reverse=reverse)
    assert expected == (WattenCall("A", "leaves") if swap_roles else WattenCall("7", "bells"))
    rechter = "leaves-A" if swap_roles else "bells-7"
    for seat in state.inspectors:
        assert member_view(state, account_id=seat + 1, player_id=state.recipe.seats[seat])["reference_card"] == {
            "face": "card", "card": rechter}
    state = play_round(state, expected, random.Random(dealer))
    assert spectator_view(state)["round_summary"] == {
        "strike_rank": expected.strike_rank, "trump_suit": expected.trump_suit, "rechter": rechter}
    record_property("rounds", 1)
    record_property("tricks", len(state.play.tricks))


@pytest.mark.parametrize("dealer", range(4))
@pytest.mark.parametrize("reverse", (False, True))
@pytest.mark.parametrize("critical", (False, True))
def test_every_distinct_bottom_pair_derives_the_displayed_rank_and_suit(dealer, reverse, critical, record_property):
    # 33 * 32 * 4 dealers * 2 show orders * 2 critical settings = 16,896 calls.
    for strike, colour in permutations(make_deck(), 2):
        remaining = iter(card for card in make_deck() if card not in {strike, colour})
        bottoms = [None] * 4
        bottoms[dealer], bottoms[(dealer + 1) % 4] = colour, strike
        for seat in range(4):
            if bottoms[seat] is None:
                bottoms[seat] = next(remaining)
        state = start_match(recipe(4, "ladinisch", True, critical), "all-call-pairs",
                            dealt(4, bottoms=bottoms), first_dealer="ABCD"[dealer])
        order = sorted(state.inspectors, reverse=reverse)
        for seat in order:
            state = step(state, state.recipe.seats[seat], "show_ready")
        assert state.call == source_call(state)
        roles = announcement_roles(state)
        view = member_view(state, account_id=dealer + 1, player_id=state.recipe.seats[dealer])
        assert view["inspection"]["cards"] == [{"role": "strike", "card": strike}, {"role": "colour", "card": colour}]
        assert view["announcement_roles"] == {"strike": roles.strike_announcer, "colour": roles.suit_announcer,
                                               "first_player": roles.first_player}
    record_property("inspected_calls", 33 * 32)


PROFILES = ((2, "normal", False), (3, "normal", False), (4, "normal", False),
            (2, "ladinisch", False), (4, "ladinisch", False), (4, "ladinisch", True))
CONFIGURATIONS = [(count, determination, blind, dealer, critical) for count, determination, blind in PROFILES
                  for dealer in range(count) for critical in (False, True)]


@pytest.mark.parametrize("count,determination,blind,dealer,critical", CONFIGURATIONS)
@pytest.mark.parametrize("seed", range(4))
def test_complete_seeded_games_keep_call_tricks_and_round_summary_consistent(count, determination, blind, dealer, critical, seed, record_property):
    rng = random.Random(seed * 100 + dealer * 10 + count)
    completed_tricks = 0
    options = dict.fromkeys(("schoeneres_accept", "schoeneres_decline", "schlagwechsel", "bloedeln_accept",
                             "bloedeln_decline", "retourschneider_accept", "retourschneider_decline"), 0)
    state = start_match(recipe(count, determination, blind, critical, show_rechter=True, trick_history=True,
                               schoeneres_enabled=count != 3), "audit-first", shuffled(count, rng), first_dealer="ABCD"[dealer])
    for round_number in range(20):
        assert state.call is None and state.play is None
        # Cover accepted/declined redeals and caller swaps, through storage.
        if count != 3 and (round_number + seed) % 3 == 0:
            requesters = preplay_seats(state, "schoeneres")
            state = restored(step(state, state.recipe.seats[requesters[0]], "request_schoeneres"))
            if seed % 2:
                options["schoeneres_decline"] += 1
                state = restored(step(state, state.recipe.seats[requesters[1]], "preplay_decline"))
            else:
                options["schoeneres_accept"] += 1
                callers = set(requesters)
                pool = [*state.deal.stock, *(card for seat in sorted(callers) for card in state.deal.hands[seat])]
                rng.shuffle(pool)
                hands = list(state.deal.hands)
                for seat in sorted(callers):
                    hands[seat], pool = tuple(pool[:5]), pool[5:]
                replacement = DealtCards(tuple(hands), tuple(pool), tuple(hand[-1] for hand in hands))
                responder = state.recipe.seats[requesters[1]]
                state = restored(apply_command(state, actor(state, responder), command(state, responder, "preplay_accept"),
                                               replacement_deal=replacement).state)
                assert state.call is None and state.shown == frozenset() and state.play is None
        if determination == "normal":
            if count != 3 and (round_number + seed) % 2:
                options["schlagwechsel"] += 1
                requester, responder = preplay_seats(state, "schlagwechsel")
                state = step(state, state.recipe.seats[requester], "request_schlagwechsel")
                state = restored(step(state, state.recipe.seats[responder], "preplay_accept"))
            roles = announcement_roles(state)
            expected = WattenCall(rng.choice(("7", "8", "9", "10", "U", "O", "K", "A")),
                                 rng.choice(("hearts", "bells", "leaves", "acorns")))
            state = restored(step(state, state.recipe.seats[roles.strike_announcer], "announce_strike", expected.strike_rank))
            state = restored(step(state, state.recipe.seats[roles.suit_announcer], "announce_colour", expected.trump_suit))
        else:
            if blind and (round_number + seed) % 2:
                options["bloedeln_accept" if seed % 2 else "bloedeln_decline"] += 1
                requester, responder = preplay_seats(state, "bloedeln")
                state = step(state, state.recipe.seats[requester], "request_bloedeln")
                state = restored(step(state, state.recipe.seats[responder], "preplay_accept" if seed % 2 else "preplay_decline"))
            state, expected = show_and_ack(state, reverse=bool((round_number + seed) % 2))
        state = play_round(state, expected, rng)
        completed_tricks += len(state.play.tricks)
        if state.phase == "match_complete":
            assert state.ledger.winners
            record_property("rounds", round_number + 1)
            record_property("tricks", completed_tricks)
            for kind, amount in options.items():
                record_property(kind, amount)
            return
        previous_dealer = state.dealer_seat
        candidate = retourschneider_candidate(state.ledger)
        if candidate is not None:
            options["retourschneider_accept" if seed % 2 else "retourschneider_decline"] += 1
            # Both explicit decisions are exercised by deterministic seeds.
            for player in candidate if seed % 2 else candidate[:1]:
                state = restored(step(state, player, "retourschneider", "accept" if seed % 2 else "decline"))
        state = restored(next_deal(state, f"audit-round-{round_number + 1}", shuffled(count, rng)))
        assert state.dealer_seat == (previous_dealer + 1) % count
    pytest.fail("seeded match did not finish within 20 rounds")
