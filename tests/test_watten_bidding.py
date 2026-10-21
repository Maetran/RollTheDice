"""Confirmed bidding examples, party decision rights and immutable scoring."""

from dataclasses import FrozenInstanceError, replace

import pytest

from app.watten_bidding import (
    BidState,
    DealParties,
    DealProgress,
    Offer,
    ScoreAccount,
    ScoreLedger,
    WattenBiddingError,
    award_deal,
    bid,
    finish_deal_from_trusted_engine,
    new_score_ledger,
    require_gameplay_allowed,
    respond,
)


def roles(count=4, dealer="A", reverse_parties=False):
    seats = tuple("ABCD"[:count])
    index = seats.index(dealer)
    next_player = seats[(index + 1) % count]
    if count == 2:
        parties = ((dealer,), (next_player,))
    elif count == 3:
        parties = ((dealer, seats[(index + 2) % count]), (next_player,))
    else:
        parties = ((dealer, seats[(index + 2) % count]), (next_player, seats[(index + 3) % count]))
    return DealParties(seats, dealer, parties[::-1] if reverse_parties else parties)


def turn(player="A", cards=1, ended=False):
    return DealProgress(player, cards, ended)


def opened(count=4, actor="A", deal_id="deal-1"):
    state = BidState(deal_id, roles(count))
    return bid(state, actor, turn(actor), gestrichen=frozenset())


def finished(count=4, winner=0, deal_id="deal-1"):
    return finish_deal_from_trusted_engine(BidState(deal_id, roles(count)), winner, turn(None, 12, True))


@pytest.mark.parametrize("count", (2, 3, 4))
def test_every_dealer_and_party_order_uses_the_confirmed_decider(count):
    for dealer in "ABCD"[:count]:
        for reverse in (False, True):
            context = roles(count, dealer, reverse)
            for party, members in enumerate(context.parties):
                expected = members[0] if count == 2 else dealer if dealer in members else context.next_to_dealer
                assert context.decider(party) == expected
                assert context.decider(party) in members


@pytest.mark.parametrize("count", (2, 3, 4))
@pytest.mark.parametrize("cards", (0, 1))
def test_any_current_player_can_offer_three_from_the_opening_card_turn(count, cards):
    for actor in "ABCD"[:count]:
        initial = BidState("first", roles(count))
        state = bid(initial, actor, turn(actor, cards), gestrichen=frozenset())
        assert initial.pending is None
        assert state.accepted_stake == 2
        assert state.pending == Offer(state.roles.party_of(actor), 3)
        assert state.gameplay_frozen
        with pytest.raises(WattenBiddingError, match="response_pending"):
            require_gameplay_allowed(state)
        with pytest.raises(WattenBiddingError, match="response_pending"):
            bid(state, actor, turn(actor), gestrichen=frozenset())


@pytest.mark.parametrize("progress,error", (
    (turn("B"), "card_turn_required"),
    (turn(None), "card_turn_required"),
    (turn("A", ended=True), "deal_finished"),
))
def test_no_off_turn_or_terminal_offer(progress, error):
    with pytest.raises(WattenBiddingError, match=error):
        bid(BidState("first", roles()), "A", progress, gestrichen=frozenset())


@pytest.mark.parametrize("dealer", tuple("ABCD"))
@pytest.mark.parametrize("reverse", (False, True))
def test_blind_current_player_and_informed_partner_can_bid_but_only_knower_answers(dealer, reverse):
    context = roles(4, dealer, reverse)
    for party, members in enumerate(context.parties):
        decider = context.decider(party)
        blind_partner = next(member for member in members if member != decider)
        for card_player in members:
            initial = BidState("blind-offer", context)
            state = bid(initial, decider, turn(card_player, 0), gestrichen=frozenset(), allow_partner_decider=True)
            assert state.pending == Offer(party, 3)
            if card_player == blind_partner:
                own_offer = bid(initial, blind_partner, turn(card_player, 0), gestrichen=frozenset(), allow_partner_decider=True)
                assert own_offer.pending == Offer(party, 3)
                opponent = context.parties[1 - party]
                blind_opponent = next(member for member in opponent if member != context.decider(1 - party))
                with pytest.raises(WattenBiddingError, match="designated_decider"):
                    respond(own_offer, blind_opponent, "hold", turn(card_player))
                assert respond(own_offer, context.decider(1 - party), "hold", turn(card_player)).accepted_stake == 3
            else:
                with pytest.raises(WattenBiddingError, match="card_turn_required"):
                    bid(initial, blind_partner, turn(card_player), gestrichen=frozenset(), allow_partner_decider=True)
        for card_player in context.parties[1 - party]:
            with pytest.raises(WattenBiddingError, match="card_turn_required"):
                bid(BidState("blind-offer", context), decider, turn(card_player),
                    gestrichen=frozenset(), allow_partner_decider=True)
        with pytest.raises(WattenBiddingError, match="gestrichen_cannot_open"):
            bid(BidState("blind-offer", context), decider, turn(blind_partner),
                gestrichen=frozenset(members), allow_partner_decider=True)


def test_blind_later_raises_stay_with_same_deciders_on_partner_card_turns():
    initial = BidState("blind-raises", roles())
    three = bid(initial, "A", turn("C"), gestrichen=frozenset(), allow_partner_decider=True)
    held = respond(three, "B", "hold", turn("C"))
    four = bid(held, "B", turn("D", 3), gestrichen=frozenset(), allow_partner_decider=True)
    held = respond(four, "A", "hold", turn("D", 3))
    five = bid(held, "A", turn("C", 6), gestrichen=frozenset(), allow_partner_decider=True)
    assert five.pending == Offer(0, 5) and five.accepted_stake == 4


@pytest.mark.parametrize("count", (2, 3, 4))
@pytest.mark.parametrize("action", ("hold", "go", "counter"))
@pytest.mark.parametrize("cards", (0, 1))
def test_only_assigned_opponent_decider_responds_immediately_independent_of_card_turn(count, action, cards):
    for actor in "ABCD"[:count]:
        state = opened(count, actor)
        other_party = 1 - state.pending.party
        decider = state.roles.decider(other_party)
        # The bidder still owns the card turn: answering does not wait for it.
        changed = respond(state, decider, action, turn(actor, cards))
        assert changed != state
        for wrong_actor in (*state.roles.seats, "unknown"):
            if wrong_actor == decider:
                continue
            with pytest.raises(WattenBiddingError, match="designated_decider"):
                respond(state, wrong_actor, action, turn(actor))


def test_three_player_dealer_not_partner_controls_the_pair_response():
    state = opened(3, "B")
    assert state.roles.parties == (("A", "C"), ("B",))
    assert respond(state, "A", "hold", turn("B")).accepted_stake == 3
    with pytest.raises(WattenBiddingError, match="designated_decider"):
        respond(state, "C", "counter", turn("B"))


def test_go_awards_previous_accepted_stake_including_direct_counter():
    state = opened()
    assert respond(state, "B", "go", turn("A")).result.points == 2
    four = respond(state, "B", "counter", turn("A"))
    assert four.accepted_stake == 3
    assert four.pending == Offer(1, 4)
    result = respond(four, "A", "go", turn("A")).result
    assert (result.winning_party, result.points, result.reason) == (1, 3, "go")
    five = respond(four, "A", "counter", turn("A"))
    assert five.accepted_stake == 4
    assert five.pending == Offer(0, 5)
    assert respond(five, "B", "go", turn("A")).result.points == 4


def test_holding_accepts_new_stake_and_later_opposite_party_can_raise_one_on_own_turn():
    held = respond(opened(), "B", "hold", turn("A"))
    assert not held.gameplay_frozen
    assert held.accepted_stake == 3
    require_gameplay_allowed(held)
    for same_party in ("A", "C"):
        with pytest.raises(WattenBiddingError, match="alternating_bid"):
            bid(held, same_party, turn(same_party), gestrichen=frozenset())
    later_four = bid(held, "D", turn("D", 7), gestrichen=frozenset())
    assert later_four.pending == Offer(1, 4)
    assert later_four.accepted_stake == 3
    later_held = respond(later_four, "A", "hold", turn("D", 7))
    later_five = bid(later_held, "C", turn("C", 8), gestrichen=frozenset())
    assert later_five.pending == Offer(0, 5)


def test_no_duplicate_or_unknown_response_and_no_reusing_completed_deal():
    pending = opened()
    with pytest.raises(WattenBiddingError, match="unknown_bid_response"):
        respond(pending, "B", "accept", turn("A"))
    held = respond(pending, "B", "hold", turn("A"))
    with pytest.raises(WattenBiddingError, match="no_pending_bid"):
        respond(held, "B", "hold", turn("A"))
    done = respond(pending, "B", "go", turn("A"))
    for action in ("hold", "go", "counter"):
        with pytest.raises(WattenBiddingError, match="deal_finished"):
            respond(done, "B", action, turn("A"))
    with pytest.raises(WattenBiddingError, match="deal_finished"):
        bid(done, "B", turn("B"), gestrichen=frozenset())
    with pytest.raises(WattenBiddingError, match="deal_finished"):
        finish_deal_from_trusted_engine(done, 0, turn(None, 20, True))


def test_gestrichen_cannot_open_or_spontaneously_raise_but_can_hold_go_and_counter():
    initial = BidState("struck", roles())
    with pytest.raises(WattenBiddingError, match="gestrichen_cannot_open"):
        bid(initial, "A", turn("A"), gestrichen=frozenset({"A", "C"}))
    state = bid(initial, "B", turn("B"), gestrichen=frozenset({"A", "C"}))
    for action in ("hold", "go", "counter"):
        assert respond(state, "A", action, turn("B"))
    held = respond(state, "A", "hold", turn("B"))
    with pytest.raises(WattenBiddingError, match="gestrichen_cannot_open"):
        bid(held, "A", turn("A"), gestrichen=frozenset({"A", "C"}))


def test_confirmed_mixed_three_player_pair_uses_initiating_individuals_status():
    initial = BidState("mixed-9-4-vs-6", roles(3))
    # A has nine, C four, B six: C's own current opportunity may open three.
    assert bid(initial, "C", turn("C"), gestrichen=frozenset({"A"})).pending == Offer(0, 3)
    with pytest.raises(WattenBiddingError, match="gestrichen_cannot_open"):
        bid(initial, "A", turn("A"), gestrichen=frozenset({"A"}))
    pending = bid(initial, "B", turn("B"), gestrichen=frozenset({"A"}))
    assert respond(pending, "A", "counter", turn("B")).pending == Offer(0, 4)


def test_terminal_result_requires_authoritative_end_and_no_pending_response():
    initial = BidState("terminal", roles())
    with pytest.raises(WattenBiddingError, match="terminal_engine_event_required"):
        finish_deal_from_trusted_engine(initial, 0, turn("A", 19))
    with pytest.raises(WattenBiddingError, match="response_pending"):
        finish_deal_from_trusted_engine(opened(), 0, turn(None, 20, True))
    with pytest.raises(WattenBiddingError, match="unknown_party|invalid_result"):
        finish_deal_from_trusted_engine(initial, 2, turn(None, 20, True))
    held = respond(opened(), "B", "hold", turn("A"))
    done = finish_deal_from_trusted_engine(held, 1, turn(None, 16, True))
    assert (done.result.points, done.result.reason) == (3, "tricks")


@pytest.mark.parametrize("count", (2, 3, 4))
@pytest.mark.parametrize("winner", (0, 1))
def test_each_mode_awards_the_correct_individual_or_team_accounts(count, winner):
    done = finished(count, winner)
    original = new_score_ledger(done.roles, target=11)
    scored = award_deal(original, done)
    assert all(account.points == 0 for account in original.accounts)
    for account in scored.accounts:
        expected = 2 if set(account.members) <= set(done.roles.parties[winner]) else 0
        assert account.points == expected
    assert scored.applied_results == (done.result,)
    assert len(scored.accounts) == (2 if count == 4 else count)


def test_three_player_pair_gets_raised_stake_individually_and_can_win_together():
    initial = opened(3, "B")
    counter = respond(initial, "A", "counter", turn("B"))
    done = respond(counter, "B", "go", turn("B"))
    scores = ScoreLedger(11, (ScoreAccount(("A",), 9), ScoreAccount(("B",), 6), ScoreAccount(("C",), 8)))
    scored = award_deal(scores, done)
    assert tuple(account.points for account in scored.accounts) == (12, 6, 11)
    assert scored.winners == (("A",), ("C",))


def test_rotating_three_player_solo_retains_individual_score_accounts():
    ledger = award_deal(new_score_ledger(roles(3), target=11), finished(3, 0))
    rotated = BidState("deal-2", roles(3, "B"))
    done = finish_deal_from_trusted_engine(rotated, rotated.roles.party_of("C"), turn(None, 15, True))
    scored = award_deal(ledger, done)
    assert tuple(account.points for account in scored.accounts) == (2, 0, 4)


def test_unique_deal_id_prevents_replay_even_from_a_new_round_state_or_conflicting_result():
    done = finished()
    ledger = award_deal(new_score_ledger(done.roles, target=11), done)
    for duplicate in (done, finished(winner=1)):
        with pytest.raises(WattenBiddingError, match="already_scored"):
            award_deal(ledger, duplicate)
    different = finished(deal_id="deal-2")
    assert award_deal(ledger, different).accounts[0].points == 4
    with pytest.raises(WattenBiddingError, match="not_finished"):
        award_deal(ledger, BidState("deal-3", roles()))


def test_completed_match_refuses_further_awards_and_foreign_rosters_or_teams_are_rejected():
    done = finished()
    won = ScoreLedger(11, (ScoreAccount(("A", "C"), 11), ScoreAccount(("B", "D"), 7)))
    with pytest.raises(WattenBiddingError, match="match_finished"):
        award_deal(won, done)
    foreign = ScoreLedger(11, (ScoreAccount(("X", "Y")), ScoreAccount(("B", "D"))))
    with pytest.raises(WattenBiddingError, match="roster_mismatch"):
        award_deal(foreign, done)
    wrong_teams = ScoreLedger(11, (ScoreAccount(("A", "B")), ScoreAccount(("C", "D"))))
    with pytest.raises(WattenBiddingError, match="teams_mismatch"):
        award_deal(wrong_teams, done)


def test_all_state_and_nested_score_data_are_immutable():
    state = opened()
    ledger = new_score_ledger(state.roles, target=11)
    with pytest.raises(FrozenInstanceError):
        state.accepted_stake = 10
    with pytest.raises(FrozenInstanceError):
        ledger.accounts[0].points = 10
    with pytest.raises(WattenBiddingError, match="invalid_parties"):
        DealParties(tuple("ABCD"), "A", (["A", "C"], ["B", "D"]))
    with pytest.raises(WattenBiddingError, match="invalid_bid_state"):
        replace(state, accepted_stake=4)


@pytest.mark.parametrize("make_invalid", (
    lambda: DealParties(("A", "A"), "A", (("A",), ("A",))),
    lambda: DealParties(tuple("ABCD"), "A", (("A", "B"), ("C", "D"))),
    lambda: DealParties(tuple("ABC"), "A", (("A",), ("B", "C"))),
    lambda: DealProgress("A", True, False),
    lambda: DealProgress("A", -1, False),
    lambda: Offer(True, 3),
    lambda: Offer(0, 2),
    lambda: BidState("", roles()),
    lambda: ScoreLedger(True, (ScoreAccount(("A",)), ScoreAccount(("B",)))),
    lambda: ScoreLedger(11, (ScoreAccount(("A",)), ScoreAccount(("A",)))),
    lambda: ScoreAccount(("A",), -1),
))
def test_malformed_states_fail_at_the_pure_boundary(make_invalid):
    with pytest.raises(WattenBiddingError):
        make_invalid()
