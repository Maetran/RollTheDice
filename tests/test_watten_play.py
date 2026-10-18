"""Confirmed Watten card play after the call: duty roles, turns, tricks and the deal end."""

import random
from dataclasses import FrozenInstanceError

import pytest

from app.watten_bidding import BidState, DealParties, WattenBiddingError, award_deal, bid, new_score_ledger, respond
from app.watten_cards import WATTEN_NORMAL_RANKS, WATTEN_SUITS, WELI, deal_cards, make_deck
from app.watten_play import (
    TRICKS_TO_WIN,
    PlayProfile,
    PlayState,
    WattenPlayError,
    deal_progress,
    finish_deal,
    legal_cards,
    official_knower_seats,
    play_card,
    start_play,
)
from app.watten_rules import WELI_STRIKE, CardKind, WattenCall, card_kind, trick_winner

# Participant IDs are deliberately unlike the numeric card seat indices.
IDS = ("north", "east", "south", "west")
VALID_SHAPES = ((2, "normal", False), (2, "ladinisch", False), (3, "normal", False),
                (4, "normal", False), (4, "ladinisch", False), (4, "ladinisch", True))
NINE_OF_BELLS = WattenCall("9", "bells")
ACE_OF_HEARTS = WattenCall("A", "hearts")


def parties(count, dealer=0, reverse=False):
    seats = IDS[:count]
    ring = [seats[(dealer + offset) % count] for offset in range(count)]
    if count == 2:
        groups = ((ring[0],), (ring[1],))
    elif count == 3:
        groups = ((ring[0], ring[2]), (ring[1],))
    else:
        groups = ((ring[0], ring[2]), (ring[1], ring[3]))
    return DealParties(seats, ring[0], groups[::-1] if reverse else groups)


def profile(count, determination="normal", *, blind=False, critical=False):
    return PlayProfile(count, determination, blind=blind, critical=critical)


def explicit_deal(*hands):
    """Test-only allocation in clockwise seat order; each hand's last card is its original bottom."""
    used = [card for hand in hands for card in hand]
    deck = used + [card for card in make_deck() if card not in used]
    schedule = [seat for seat in range(len(hands)) for _ in range(5)]
    return deal_cards(deck, player_count=len(hands), recipient_order=schedule)


def shuffled_deal(count, rng):
    deck = list(make_deck())
    rng.shuffle(deck)
    return deal_cards(deck, player_count=count, recipient_order=[seat for seat in range(count) for _ in range(5)])


def begin(hands, play_profile, *, call=None, dealer=0, reverse=False):
    roles = parties(len(hands), dealer, reverse)
    return start_play("deal-1", explicit_deal(*hands), roles, play_profile, call=call), BidState("deal-1", roles)


def play(state, bids, *cards):
    for card in cards:
        state = play_card(state, bids, state.current_player_id, card)
    return state


def assert_rejected(code, state, bids, player, card):
    before = (state.plays, state.hands, state.trick_cards, state.party_tricks)
    with pytest.raises(WattenPlayError) as caught:
        play_card(state, bids, player, card)
    assert caught.value.code == code
    assert (state.plays, state.hands, state.trick_cards, state.party_tricks) == before


@pytest.mark.parametrize("shape", VALID_SHAPES)
@pytest.mark.parametrize("critical", (False, True))
def test_only_confirmed_profiles_are_accepted(shape, critical):
    count, determination, blind = shape
    assert profile(count, determination, blind=blind, critical=critical).critical is critical


@pytest.mark.parametrize("args, code", (
    ((2, "normal", True, False), "watten_blind_requires_four_player_ladinisch"),
    ((2, "ladinisch", True, False), "watten_blind_requires_four_player_ladinisch"),
    ((3, "normal", True, False), "watten_blind_requires_four_player_ladinisch"),
    ((4, "normal", True, False), "watten_blind_requires_four_player_ladinisch"),
    ((3, "ladinisch", False, False), "watten_three_player_requires_normal"),
    ((1, "normal", False, False), "watten_invalid_profile"),
    ((5, "normal", False, False), "watten_invalid_profile"),
    (("4", "normal", False, False), "watten_invalid_profile"),
    ((True, "normal", False, False), "watten_invalid_profile"),
    ((4, "open", False, False), "watten_invalid_profile"),
    ((4, "normal", 0, False), "watten_invalid_profile"),
    ((4, "normal", False, "no"), "watten_invalid_profile"),
))
def test_unconfirmed_or_malformed_profiles_are_rejected(args, code):
    with pytest.raises(WattenPlayError) as caught:
        PlayProfile(*args)
    assert caught.value.code == code


@pytest.mark.parametrize("count, determination, blind", VALID_SHAPES)
def test_open_play_informs_every_seat_and_blind_play_exactly_dealer_and_successor(count, determination, blind):
    for dealer in range(count):
        knowers = official_knower_seats(profile(count, determination, blind=blind), dealer)
        assert knowers == ({dealer, (dealer + 1) % count} if blind else set(range(count)))


OWNER_HANDS = (
    ("hearts-9", "bells-A", "acorns-8", "leaves-10", "bells-8"),  # north, dealer: bottom names bells
    ("bells-7", "hearts-8", "acorns-10", "leaves-U", "leaves-9"),  # east, first: bottom names strike nine
    ("hearts-K", "hearts-A", "acorns-A", "leaves-A", "hearts-10"),  # south
    ("acorns-K", "bells-O", "acorns-O", "leaves-O", "hearts-O"),  # west, holds ordinary trump bells-O
)


@pytest.mark.parametrize("critical", (True, False))
@pytest.mark.parametrize("count, determination, blind", (
    (4, "ladinisch", True), (4, "ladinisch", False), (4, "normal", False), (3, "normal", False)))
def test_owner_example_allows_a_non_winning_strike_after_a_critical_overtrick(count, determination, blind, critical):
    call = None if determination == "ladinisch" else NINE_OF_BELLS
    state, bids = begin(OWNER_HANDS[:count], profile(count, determination, blind=blind, critical=critical), call=call)
    assert state.call == NINE_OF_BELLS
    state = play(state, bids, "bells-7", "hearts-K")
    if count == 4 and blind:
        # West holds ordinary trump but knows nothing officially; inference never binds.
        assert legal_cards(state, bids, "west") == OWNER_HANDS[3]
        state = play(state, bids, "acorns-K")
    elif count == 4:
        # The critical overtrick does not lift the duty triggered by the ordinary trump lead.
        assert legal_cards(state, bids, "west") == ("bells-O",)
        assert_rejected("watten_trump_required", state, bids, "west", "acorns-K")
        state = play(state, bids, "bells-O")
    assert legal_cards(state, bids, "north") == ("hearts-9", "bells-A", "bells-8")
    assert_rejected("watten_trump_required", state, bids, "north", "acorns-8")
    state = play(state, bids, "hearts-9")
    assert state.tricks[0].winner == (2 if critical else 0)
    assert state.current_player_id == ("south" if critical else "north")


def duel(call, critical, lead, north_hand):
    """Two open players: east leads first, dealer north is an officially informed follower."""
    fillers = [card for card in make_deck() if card not in north_hand and card != lead][:4]
    state, bids = begin((tuple(north_hand), (lead, *fillers)), profile(2, critical=critical), call=call)
    return play(state, bids, lead), bids


FREE = None
DUTY_CASES = (
    pytest.param(WattenCall("U", "hearts"), False, "hearts-U",
                 ("hearts-8", "acorns-9", "acorns-10", "leaves-U", "acorns-O"), ("hearts-8", "leaves-U"),
                 id="led-rechter-binds-and-strike-is-an-alternative"),
    pytest.param(WattenCall("A", "leaves"), False, "leaves-8",
                 (WELI, "acorns-8", "acorns-9", "acorns-10", "acorns-O"), (WELI,),
                 id="weli-is-the-smallest-called-trump-without-criticals"),
    pytest.param(NINE_OF_BELLS, True, "bells-7",
                 ("bells-A", "hearts-9", "hearts-K", "acorns-8", "leaves-10"), ("bells-A", "hearts-9", "hearts-K"),
                 id="trump-strike-and-critical-all-satisfy-the-duty"),
    pytest.param(WattenCall(WELI_STRIKE, "acorns"), False, WELI,
                 ("acorns-8", "hearts-9", "hearts-10", "hearts-U", "hearts-O"), ("acorns-8",),
                 id="freely-called-weli-is-the-sole-rechter-and-binds-as-lead"),
    pytest.param(WattenCall("U", "hearts"), False, "hearts-7",
                 ("hearts-U", "acorns-8", "acorns-9", "acorns-10", "acorns-O"), FREE,
                 id="rechter-is-never-forced"),
    pytest.param(WattenCall("9", "hearts"), True, "hearts-7",
                 ("hearts-K", "acorns-8", "acorns-10", "acorns-U", "acorns-O"), FREE,
                 id="critical-is-never-forced"),
    pytest.param(WattenCall(WELI_STRIKE, "bells"), False, "bells-7",
                 (WELI, "acorns-8", "acorns-9", "acorns-10", "acorns-O"), FREE,
                 id="weli-rechter-is-never-forced"),
    pytest.param(WattenCall("U", "hearts"), False, "hearts-7",
                 ("leaves-U", "acorns-8", "acorns-9", "acorns-10", "acorns-O"), FREE,
                 id="strike-alone-is-never-forced"),
    pytest.param(ACE_OF_HEARTS, True, "hearts-7",
                 ("acorns-7", WELI, "bells-8", "bells-9", "bells-10"), FREE,
                 id="only-critical-cards-stay-free"),
    pytest.param(WattenCall("U", "hearts"), False, "leaves-U",
                 ("hearts-8", "acorns-9", "acorns-10", "acorns-O", "bells-7"), FREE,
                 id="led-plain-strike-does-not-bind"),
    pytest.param(WattenCall("U", "hearts"), False, "acorns-7",
                 ("hearts-8", "acorns-9", "acorns-10", "acorns-O", "bells-7"), FREE,
                 id="led-normal-card-does-not-bind"),
    pytest.param(WattenCall("K", "hearts"), True, "hearts-K",
                 ("hearts-8", "acorns-9", "acorns-10", "acorns-U", "acorns-O"), FREE,
                 id="critical-lead-overlapping-the-rechter-stays-free"),
    pytest.param(WattenCall("K", "hearts"), False, "hearts-K",
                 ("hearts-8", "acorns-9", "acorns-10", "acorns-U", "acorns-O"), ("hearts-8",),
                 id="same-card-as-rechter-binds-without-criticals"),
    pytest.param(WattenCall("A", "acorns"), True, "acorns-7",
                 ("acorns-8", "leaves-9", "hearts-9", "hearts-10", "hearts-U"), FREE,
                 id="critical-lead-in-printed-trump-suit-stays-free"),
    pytest.param(WattenCall("A", "acorns"), False, "acorns-7",
                 ("acorns-8", "leaves-9", "hearts-9", "hearts-10", "hearts-U"), ("acorns-8",),
                 id="same-card-as-ordinary-trump-binds-without-criticals"),
    pytest.param(WattenCall("A", "leaves"), True, WELI,
                 ("leaves-8", "acorns-9", "acorns-10", "acorns-U", "acorns-O"), FREE,
                 id="critical-weli-lead-stays-free"),
    pytest.param(WattenCall("A", "leaves"), False, WELI,
                 ("leaves-8", "acorns-9", "acorns-10", "acorns-U", "acorns-O"), ("leaves-8",),
                 id="weli-trump-lead-binds-without-criticals"),
)


@pytest.mark.parametrize("call, critical, lead, hand, expected", DUTY_CASES)
def test_trump_duty_for_an_officially_informed_follower(call, critical, lead, hand, expected):
    state, bids = duel(call, critical, lead, hand)
    expected = hand if expected is FREE else expected
    assert legal_cards(state, bids, "north") == expected
    for card in hand:
        if card in expected:
            after = play_card(state, bids, "north", card)
            assert len(after.tricks) == 1 and after.trick_cards == ()
        else:
            assert_rejected("watten_trump_required", state, bids, "north", card)


def test_only_the_first_trick_card_can_trigger_the_duty():
    hands = (("hearts-8", "leaves-9", "leaves-10", "leaves-U", "leaves-O"),  # north, dealer
             ("acorns-8", "acorns-9", "acorns-10", "acorns-U", "acorns-O"),  # east, solo and first
             ("hearts-7", "bells-7", "bells-8", "bells-9", "bells-10"))  # south
    state, bids = begin(hands, profile(3), call=ACE_OF_HEARTS)
    state = play(state, bids, "acorns-8", "hearts-7")
    assert legal_cards(state, bids, "north") == hands[0]


WELI_LADINISCH_HANDS = (
    ("hearts-7", "acorns-8", "acorns-9", "acorns-10", "hearts-9"),  # north, dealer: bottom names hearts
    ("leaves-7", "leaves-8", "leaves-9", "leaves-10", WELI),  # east: bottom forces the Weli strike
    ("bells-7", "bells-8", "bells-9", "bells-10", "bells-U"),
    ("bells-O", "bells-K", "bells-A", "leaves-U", "leaves-O"),
)


@pytest.mark.parametrize("critical", (True, False))
def test_ladinisch_forced_weli_strike_stays_allowed_and_creates_no_other_strike(critical):
    state, bids = begin(WELI_LADINISCH_HANDS, profile(4, "ladinisch", blind=True, critical=critical))
    assert state.call == WattenCall(WELI_STRIKE, "hearts")
    assert card_kind(WELI, state.rules) == (CardKind.CRITICAL if critical else CardKind.RECHTER)
    others = {card_kind(card, state.rules) for card in make_deck() if card != WELI}
    assert not others & {CardKind.RECHTER, CardKind.STRIKE}
    state = play(state, bids, WELI, "bells-7", "bells-O")
    assert legal_cards(state, bids, "north") == (WELI_LADINISCH_HANDS[0] if critical else ("hearts-7", "hearts-9"))


@pytest.mark.parametrize("count", (2, 3, 4))
def test_free_weli_strike_is_rejected_only_with_criticals(count):
    roles, deal = parties(count), shuffled_deal(count, random.Random(count))
    call = WattenCall(WELI_STRIKE, "hearts")
    with pytest.raises(WattenPlayError) as caught:
        start_play("deal-1", deal, roles, profile(count, critical=True), call=call)
    assert caught.value.code == "watten_free_weli_strike_with_critical"
    assert start_play("deal-1", deal, roles, profile(count, critical=False), call=call).call == call


def test_ladinisch_call_comes_only_from_the_original_bottom_cards():
    hands = (("hearts-7", "hearts-9", "hearts-10", "hearts-U", WELI),  # north, dealer: Weli names bells
             ("acorns-7", "acorns-9", "acorns-10", "acorns-U", "hearts-8"))  # east: strike eight
    state, _ = begin(hands, profile(2, "ladinisch"))
    assert state.call == WattenCall("8", "bells")
    assert begin(hands, profile(2, "ladinisch"), call=WattenCall("8", "bells"))[0] == state
    with pytest.raises(WattenPlayError) as caught:
        begin(hands, profile(2, "ladinisch"), call=WattenCall("9", "bells"))
    assert caught.value.code == "watten_call_mismatch"


def test_start_requires_a_completed_normal_call_and_matching_seat_counts():
    with pytest.raises(WattenPlayError) as caught:
        start_play("deal-1", shuffled_deal(4, random.Random(4)), parties(4), profile(4))
    assert caught.value.code == "watten_call_required"
    for deal_count, party_count, profile_count in ((4, 3, 3), (3, 3, 4), (3, 4, 4)):
        with pytest.raises(WattenPlayError) as caught:
            start_play("deal-1", shuffled_deal(deal_count, random.Random(0)), parties(party_count),
                       profile(profile_count), call=ACE_OF_HEARTS)
        assert caught.value.code == "watten_player_count_mismatch"


@pytest.mark.parametrize("count", (2, 3, 4))
def test_clockwise_turns_start_after_the_dealer_and_reject_every_foreign_action(count):
    for dealer in range(count):
        roles = parties(count, dealer)
        state = start_play("deal-1", shuffled_deal(count, random.Random(dealer)), roles, profile(count),
                           call=ACE_OF_HEARTS)
        bids = BidState("deal-1", roles)
        for offset in range(1, count + 1):
            seat = (dealer + offset) % count
            player = IDS[seat]
            assert state.current_player_id == player and state.current_seat == seat
            for other in IDS[:count]:
                if other != player:
                    assert legal_cards(state, bids, other) == ()
                    assert_rejected("watten_not_your_turn", state, bids, other, state.hands[IDS.index(other)][0])
            # A numeric card seat index is never accepted as a participant identity.
            assert_rejected("watten_not_your_turn", state, bids, seat, state.hands[seat][0])
            foreign = state.hands[(seat + 1) % count][0]
            for card in (foreign, state.deal.stock[0], "bells-6x", None, [state.hands[seat][0]]):
                assert_rejected("watten_card_not_in_hand", state, bids, player, card)
            state = play_card(state, bids, player, legal_cards(state, bids, player)[0])
        assert state.tricks[0].leader == (dealer + 1) % count
        assert state.current_seat == state.tricks[0].winner


SWEEP = (
    ("acorns-7", "acorns-8", "acorns-9", "bells-7", "bells-8"),  # north, dealer: never trumps
    ("hearts-A", "hearts-K", "hearts-O", "leaves-7", "leaves-8"),  # east leads and wins every trick
)


def test_open_bid_freezes_cards_and_the_third_party_trick_ends_and_scores_once():
    state, bids = begin(SWEEP, profile(2), call=ACE_OF_HEARTS)
    state = play(state, bids, "hearts-A")
    bids = bid(bids, "north", deal_progress(state), gestrichen=frozenset())
    assert legal_cards(state, bids, "north") == ()
    assert_rejected("watten_bid_response_pending", state, bids, "north", "acorns-7")
    bids = respond(bids, "east", "hold", deal_progress(state))
    with pytest.raises(WattenPlayError) as caught:
        finish_deal(state, bids)
    assert caught.value.code == "watten_deal_not_finished"
    state = play(state, bids, "acorns-7", "hearts-K", "acorns-8", "hearts-O", "acorns-9")
    assert state.ended and state.winning_party == bids.roles.party_of("east")
    assert state.party_tricks[state.winning_party] == TRICKS_TO_WIN and len(state.tricks) == 3
    assert state.current_player_id is None and state.hands == (("bells-7", "bells-8"), ("leaves-7", "leaves-8"))
    assert deal_progress(state).ended and deal_progress(state).cards_played == 6
    for player, card in (("east", "leaves-7"), ("north", "bells-7")):
        assert legal_cards(state, bids, player) == ()
        assert_rejected("watten_deal_finished", state, bids, player, card)
    with pytest.raises(WattenBiddingError, match="watten_deal_finished"):
        bid(bids, "east", deal_progress(state), gestrichen=frozenset())
    finished = finish_deal(state, bids)
    result = finished.result
    assert (result.winning_party, result.points, result.reason) == (state.winning_party, 3, "tricks")
    with pytest.raises(WattenPlayError) as caught:
        finish_deal(state, finished)
    assert caught.value.code == "watten_deal_finished"
    assert_rejected("watten_deal_finished", state, finished, "east", "leaves-7")
    ledger = award_deal(new_score_ledger(bids.roles, target=11), finished)
    assert {account.members: account.points for account in ledger.accounts} == {("north",): 0, ("east",): 3}


def test_going_after_a_bid_finishes_the_deal_for_every_card():
    state, bids = begin(SWEEP, profile(2), call=ACE_OF_HEARTS)
    state = play(state, bids, "hearts-A")
    bids = respond(bid(bids, "north", deal_progress(state), gestrichen=frozenset()), "east", "go",
                   deal_progress(state))
    assert legal_cards(state, bids, "north") == ()
    assert_rejected("watten_deal_finished", state, bids, "north", "acorns-7")


POOL = (
    ("hearts-A", "acorns-9", "hearts-K", "bells-7", "bells-8"),  # north, dealer
    ("leaves-7", "acorns-7", "leaves-8", "leaves-9", "acorns-8"),  # east, solo and first
    ("leaves-10", "hearts-O", "leaves-U", "bells-9", "bells-10"),  # south, north's partner
)


@pytest.mark.parametrize("reverse", (False, True))
def test_three_player_partners_pool_tricks_and_both_receive_the_points(reverse):
    state, bids = begin(POOL, profile(3), call=ACE_OF_HEARTS, reverse=reverse)
    state = play(state, bids, "leaves-7", "leaves-10", "hearts-A",
                 "acorns-9", "acorns-7", "hearts-O",
                 "leaves-U", "hearts-K", "leaves-8")
    assert [trick.winner for trick in state.tricks] == [0, 2, 0]
    partners = bids.roles.party_of("north")
    assert state.ended and state.winning_party == partners
    assert state.party_tricks[partners] == 3 and state.party_tricks[1 - partners] == 0
    ledger = award_deal(new_score_ledger(bids.roles, target=11), finish_deal(state, bids))
    assert {account.members: account.points for account in ledger.accounts} == {
        ("north",): 2, ("east",): 0, ("south",): 2}


def test_card_actions_require_the_matching_bid_state():
    state, bids = begin(SWEEP, profile(2), call=ACE_OF_HEARTS)
    for other in (BidState("deal-2", bids.roles), BidState("deal-1", parties(2, reverse=True)),
                  BidState("deal-1", parties(2, dealer=1))):
        assert_rejected("watten_bid_state_mismatch", state, other, "east", "hearts-A")
        for action in (lambda: legal_cards(state, other, "east"), lambda: finish_deal(state, other)):
            with pytest.raises(WattenPlayError, match="watten_bid_state_mismatch"):
                action()
    assert_rejected("watten_invalid_bid_state", state, None, "east", "hearts-A")


def test_reconstruction_rejects_histories_the_engine_would_not_accept():
    state, bids = begin(OWNER_HANDS, profile(4, "ladinisch", blind=True, critical=True))
    base = (state.deal_id, state.deal, state.parties, state.profile, state.call)
    for plays in (("hearts-K",), ("bells-7", "bells-7"), ("bells-7", "hearts-K", "acorns-K", "acorns-8"),
                  ["bells-7"], (None,)):
        with pytest.raises(WattenPlayError, match="watten_invalid_play_history"):
            PlayState(*base, plays)
    accepted = play(state, bids, "bells-7", "hearts-K", "acorns-K", "hearts-9")
    assert PlayState(*base, accepted.plays) == accepted
    with pytest.raises(WattenPlayError, match="watten_call_mismatch"):
        PlayState(*base[:4], ACE_OF_HEARTS)
    swept, sweep_bids = begin(SWEEP, profile(2), call=ACE_OF_HEARTS)
    swept = play(swept, sweep_bids, "hearts-A", "acorns-7", "hearts-K", "acorns-8", "hearts-O", "acorns-9")
    with pytest.raises(WattenPlayError, match="watten_invalid_play_history"):
        PlayState(swept.deal_id, swept.deal, swept.parties, swept.profile, swept.call, (*swept.plays, "leaves-7"))


def test_states_are_frozen_and_never_print_hidden_cards():
    state, bids = begin(OWNER_HANDS, profile(4, "ladinisch", blind=True, critical=True))
    after = play(state, bids, "bells-7")
    assert state.plays == () and state.hands == state.deal.hands
    assert after.plays == ("bells-7",) and after.hands[1] == ("hearts-8", "acorns-10", "leaves-U", "leaves-9")
    with pytest.raises(FrozenInstanceError):
        state.plays = ("bells-7",)
    assert repr(after) == "PlayState(deal_id='deal-1', cards_played=1, ended=False)"


@pytest.mark.parametrize("critical", (False, True))
@pytest.mark.parametrize("count, determination, blind", VALID_SHAPES)
def test_random_full_deals_keep_cards_turns_duty_roles_and_the_end_consistent(count, determination, blind, critical):
    rng = random.Random(f"{count}-{determination}-{blind}-{critical}")
    strikes = (*WATTEN_NORMAL_RANKS, *(() if critical else (WELI_STRIKE,)))
    for _ in range(20):
        dealer = rng.randrange(count)
        roles = parties(count, dealer, reverse=rng.random() < 0.5)
        deal = shuffled_deal(count, rng)
        call = WattenCall(rng.choice(strikes), rng.choice(WATTEN_SUITS)) if determination == "normal" else None
        state = start_play("deal-x", deal, roles, profile(count, determination, blind=blind, critical=critical),
                           call=call)
        bids, rules = BidState("deal-x", roles), state.rules
        knowers = official_knower_seats(state.profile, dealer)
        won = [0, 0]
        while not state.ended:
            seat, player, hand = state.current_seat, state.current_player_id, state.hands[state.current_seat]
            assert player == roles.seats[seat]
            legal = legal_cards(state, bids, player)
            assert legal and set(legal) <= set(hand)
            if seat not in knowers:
                assert legal == hand
            excluded = [card for card in hand if card not in legal]
            if excluded:
                assert card_kind(state.trick_cards[0], rules) in {CardKind.TRUMP, CardKind.RECHTER}
                assert any(card_kind(card, rules) == CardKind.TRUMP for card in legal)
                assert {card_kind(card, rules) for card in excluded} == {CardKind.NORMAL}
                for card in excluded:
                    assert_rejected("watten_trump_required", state, bids, player, card)
            previous = state
            state = play_card(state, bids, player, rng.choice(legal))
            played = [card for trick in state.tricks for card in trick.cards] + list(state.trick_cards)
            remaining = [card for cards in state.hands for card in cards]
            assert sorted([*played, *remaining, *deal.stock]) == sorted(make_deck())
            if len(state.tricks) > len(previous.tricks):
                trick = state.tricks[-1]
                assert trick.leader == (previous.tricks[-1].winner if previous.tricks else (dealer + 1) % count)
                assert trick.winner == (trick.leader + trick_winner(trick.cards, rules=rules)) % count
                won[roles.party_of(roles.seats[trick.winner])] += 1
                assert state.party_tricks == tuple(won)
                assert state.ended == (TRICKS_TO_WIN in won)
                if not state.ended:
                    assert state.current_seat == trick.winner
        assert len(state.tricks) <= 5 and state.trick_cards == ()
        assert all(len(hand) == 5 - len(state.tricks) for hand in state.hands)
        assert all(legal_cards(state, bids, player) == () for player in roles.seats)
        assert PlayState("deal-x", deal, roles, state.profile, state.call, state.plays) == state
        result = finish_deal(state, bids).result
        assert (result.winning_party, result.points, result.reason) == (won.index(TRICKS_TO_WIN), 2, "tricks")
