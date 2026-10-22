"""Consensual pre-play options preserve seats, secrecy and durable boundaries."""

import json
from dataclasses import replace

import pytest

from app.watten_bidding import DealResult, Retourschneider, ScoreAccount, ScoreLedger, retourschneider_candidate
from app.watten_cards import DealtCards
from app.watten_engine import (
    WattenEngineError,
    announcement_roles,
    apply_command,
    gestrichen_players,
    next_deal,
    restore_storage,
    start_match,
    storage_payload,
)
from app.watten_play import WattenPlayError, legal_cards
from app.watten_runtime import _redraw_callers
from app.watten_views import spectator_view
from tests.test_watten_engine import actor, command, dealt, finish, ready, recipe, step
from tests.test_watten_views import blind_deal, personal


def restored(state):
    return restore_storage(json.loads(json.dumps(storage_payload(state))))


def deterministic_redraw(state):
    callers = state.inspectors
    pool = [*state.deal.stock, *(card for seat in sorted(callers) for card in state.deal.hands[seat])]
    hands = list(state.deal.hands)
    for seat in sorted(callers):
        hands[seat] = tuple(pool[:5])
        del pool[:5]
    return DealtCards(tuple(hands), tuple(pool), tuple(hand[-1] for hand in hands))


@pytest.mark.parametrize("after_inspection", (False, True))
def test_schoeneres_requires_both_callers_and_resets_only_their_hands_and_call(after_inspection):
    state = start_match(recipe(4, "ladinisch", True, schoeneres_enabled=True), "redeal", blind_deal(), first_dealer="A")
    if after_inspection:
        state = ready(state)
    before = state
    state = step(state, "A", "request_schoeneres")
    assert personal(state, "B")["actions"] == ["preplay_accept", "preplay_decline"]
    assert personal(state, "A")["actions"] == []
    assert personal(state, "C")["actions"] == []
    assert spectator_view(state)["preplay"]["bloedeln_cards"] == []
    for player, kind in (("A", "preplay_accept"), ("C", "preplay_accept"), ("B", "inspection_ack")):
        with pytest.raises(WattenEngineError, match="preplay_response_required"):
            step(state, player, kind)
    replacement = deterministic_redraw(state)
    request = command(state, "B", "preplay_accept")
    transition = apply_command(state, actor(state, "B"), request, replacement_deal=replacement)
    state = transition.state
    assert state.deal_revision == 1 and state.phase == "show_ready"
    assert state.deal.hands[2:] == before.deal.hands[2:]
    assert state.deal == replacement and state.ledger == before.ledger and state.parties == before.parties
    assert state.call is None and not state.shown and not state.acknowledged and state.play is None
    assert all(personal(state, player)["inspection"] is None for player in "ABCD")
    assert restored(state) == state
    assert apply_command(state, actor(state, "B"), request).replayed
    # A fresh, separately accepted request is possible, without rotating dealer or scoring.
    state = step(state, "B", "request_schoeneres")
    state = apply_command(state, actor(state, "A"), command(state, "A", "preplay_accept"),
                          replacement_deal=deterministic_redraw(state)).state
    assert state.deal_revision == 2 and state.dealer_seat == before.dealer_seat and state.ledger == before.ledger


def test_schoeneres_rejects_replacing_other_hands_and_disabled_or_late_requests():
    disabled = ready(start_match(recipe(4, "ladinisch", True), "disabled", blind_deal(), first_dealer="A"))
    with pytest.raises(WattenEngineError, match="preplay_unavailable"):
        step(disabled, "A", "request_schoeneres")
    state = replace(disabled, recipe=replace(disabled.recipe, schoeneres_enabled=True))
    pending = step(state, "A", "request_schoeneres")
    with pytest.raises(WattenEngineError, match="replacement_deal_required"):
        apply_command(pending, actor(pending, "B"), command(pending, "B", "preplay_accept"), replacement_deal=dealt())
    declined = step(pending, "B", "preplay_decline")
    assert declined.deal == state.deal and declined.call == state.call and declined.deal_revision == 0
    player = declined.play.current_player_id
    state = step(declined, player, "play_card", legal_cards(declined.play, declined.bid_state, player)[0])
    with pytest.raises(WattenEngineError, match="preplay_unavailable"):
        step(state, "A", "request_schoeneres")


def test_schoeneres_after_an_opening_held_bid_resets_stake_and_retains_the_discarded_increment():
    state = ready(start_match(recipe(2, schoeneres_enabled=True), "held-redeal", dealt(2), first_dealer="A"))
    state = step(state, "B", "bid")
    with pytest.raises(WattenEngineError, match="preplay_unavailable"):
        step(state, "A", "request_schoeneres")
    state = step(state, "A", "respond", "hold")
    assert not state.play.plays and state.bid_state.accepted_stake == 3
    state = step(state, "B", "request_schoeneres")
    envelope = command(state, "A", "preplay_accept")
    transition = apply_command(state, actor(state, "A"), envelope, replacement_deal=deterministic_redraw(state))
    state = transition.state
    assert state.phase == "strike" and state.bid_state.accepted_stake == 2
    assert state.discarded_bid_increases == 1 and state.bid_state.pending is None
    assert restored(state) == state
    assert apply_command(state, actor(state, "A"), envelope).state.discarded_bid_increases == 1
    state = finish(ready(state))
    state = next_deal(state, "held-redeal-next", dealt(2))
    assert state.discarded_bid_increases == 1 and restored(state) == state


def test_server_redraw_keeps_non_callers_and_the_complete_unique_deck():
    state = ready(start_match(recipe(4, "ladinisch", True, schoeneres_enabled=True), "partial", blind_deal(), first_dealer="A"))
    for _ in range(3):
        replacement = _redraw_callers(state)
        assert replacement.hands[2:] == state.deal.hands[2:]
        assert len(set(card for hand in replacement.hands for card in hand) | set(replacement.stock)) == 33
        state = replace(state, deal=replacement, call=None, play=None, shown=frozenset(), acknowledged=frozenset(), phase="show_ready")


@pytest.mark.parametrize("count", (2, 4))
def test_schlagwechsel_changes_callers_after_consent_but_preserves_original_lead(count):
    state = start_match(recipe(count), "swap", dealt(count), first_dealer="A")
    before = state
    state = step(state, "B", "request_schlagwechsel")
    assert restored(state) == state
    state = step(state, "A", "preplay_accept")
    roles = announcement_roles(state)
    assert (roles.strike_announcer, roles.suit_announcer, roles.first_player) == (0, 1, 1)
    assert state.deal_revision == 1 and state.deal == before.deal and state.phase == "strike"
    with pytest.raises(WattenEngineError, match="announcer_required"):
        step(state, "B", "announce_strike", "9")
    state = step(state, "A", "announce_strike", "9")
    state = step(state, "B", "announce_colour", "hearts")
    assert state.play.current_player_id == "B" and state.call.strike_rank == "9"
    assert spectator_view(state)["announcement_roles"] == {"strike": 0, "colour": 1, "first_player": 1}
    assert restored(state) == state


def test_schlagwechsel_cannot_undo_an_already_made_announcement():
    state = start_match(recipe(4), "swap-too-late", dealt(), first_dealer="A")
    state = step(state, "B", "announce_strike", "9")
    with pytest.raises(WattenEngineError, match="preplay_unavailable"):
        step(state, "A", "request_schlagwechsel")


@pytest.mark.parametrize("count,determination,blind", ((3, "normal", False), (4, "ladinisch", False), (4, "ladinisch", True)))
def test_schlagwechsel_is_unavailable_for_solo_ladinisch_and_blind(count, determination, blind):
    state = start_match(recipe(count, determination, blind), "no-swap", dealt(count), first_dealer="A")
    with pytest.raises(WattenEngineError, match="preplay_unavailable"):
        step(state, "A", "request_schlagwechsel")


def test_bloedeln_needs_both_blind_partners_and_forces_their_private_bottoms_in_first_trick():
    state = ready(start_match(recipe(4, "ladinisch", True), "bloedeln", blind_deal(), first_dealer="A"), bloedeln=None)
    assert spectator_view(state)["preplay"]["bloedeln_cards"] == []
    with pytest.raises(WattenEngineError, match="preplay_unavailable"):
        step(state, "A", "request_bloedeln")
    state = step(state, "C", "request_bloedeln")
    assert personal(state, "D")["actions"] == ["preplay_accept", "preplay_decline"]
    assert spectator_view(state)["preplay"]["bloedeln_cards"] == []
    state = step(state, "D", "preplay_accept")
    assert spectator_view(state)["preplay"]["bloedeln_cards"] == []
    for seat, player in enumerate(state.recipe.seats):
        assert personal(state, player)["preplay"]["bloedeln_cards"] == (
            [{"seat": seat, "card": state.deal.bottom_cards[seat]}] if seat in (2, 3) else [])
    assert "round_summary" not in spectator_view(state)
    assert restored(state) == state
    first_card = legal_cards(state.play, state.bid_state, "B")[0]
    first_command = command(state, "B", "play_card", first_card)
    transition = apply_command(state, actor(state, "B"), first_command)
    assert transition.ack.opportunity == state.opportunity + 1
    state = transition.state
    assert state.play.plays == (first_card, state.deal.bottom_cards[2], state.deal.bottom_cards[3])
    assert state.play.current_player_id == "A"
    assert apply_command(restored(state), actor(state, "B"), first_command).replayed
    for player in ("C", "D"):
        view = personal(state, player)
        assert "play_card" not in view["actions"] and view["preplay"]["bloedeln_cards"] == []
        assert len(view["hand"]) == 4
    # Even a legacy intermediate turn never permits another selected card.
    legacy = replace(state, play=replace(state.play, plays=(first_card,)))
    assert legal_cards(legacy.play, legacy.bid_state, "C") == (state.deal.bottom_cards[2],)
    wrong = next(card for card in legacy.play.hands[2] if card != state.deal.bottom_cards[2])
    with pytest.raises(WattenPlayError):
        step(legacy, "C", "play_card", wrong)
    state = step(state, "A", "play_card", legal_cards(state.play, state.bid_state, "A")[0])
    assert len(state.play.tricks) == 1 and restored(state) == state
    # The persisted replay rejects replacing an obligated opening with another held card.
    raw = storage_payload(state)
    raw["plays"][1] = next(card for card in state.deal.hands[2] if card != state.deal.bottom_cards[2])
    with pytest.raises(WattenPlayError):
        restore_storage(raw)


def test_bloedeln_never_publishes_the_consented_bottoms_or_hidden_call_before_play():
    views = []
    for variant in ("base", "secret"):
        state = ready(start_match(recipe(4, "ladinisch", True), "bloedeln-privacy", blind_deal(variant), first_dealer="A"), bloedeln=None)
        state = step(state, "C", "request_bloedeln")
        state = step(state, "D", "preplay_accept")
        views.append((spectator_view(state), personal(state, "C"), personal(state, "D")))
    assert views[0] == views[1]


def retour_choice():
    state = finish(ready(start_match(recipe(4), "retour-choice", dealt(), first_dealer="A")))
    last = state.bid_state.result
    other = 1 - last.winning_party
    results = (DealResult("prior-two", state.parties, other, 2, "tricks"),
               DealResult("prior-seven", state.parties, last.winning_party, 7, "tricks"), last)
    accounts = tuple(ScoreAccount(account.members, 9 if index == last.winning_party else 2)
                     for index, account in enumerate(state.ledger.accounts))
    return replace(state, ledger=ScoreLedger(11, accounts, results))


@pytest.mark.parametrize("second_vote", ("accept", "decline"))
def test_retourschneider_needs_both_separate_votes_and_one_decline_is_final(second_vote):
    state = retour_choice()
    candidates = retourschneider_candidate(state.ledger)
    assert candidates is not None and len(candidates) == 2
    first, second = candidates
    assert all("retourschneider" in personal(state, player)["actions"] for player in candidates)
    state = step(state, first, "retourschneider", "accept")
    view = personal(state, first)["retourschneider"]
    assert view["status"] == "available" and view["accepted_by"] == [first]
    assert next(account.points for account in state.ledger.accounts if account.members == candidates) == 2
    assert "retourschneider" not in personal(state, first)["actions"] and restored(state) == state
    with pytest.raises(WattenEngineError, match="decision_pending"):
        next_deal(state, "too-early", dealt())
    state = step(state, second, "retourschneider", second_vote)
    view = personal(state, first)["retourschneider"]
    assert view["status"] == ("active" if second_vote == "accept" else "declined")
    assert next(account.points for account in state.ledger.accounts if account.members == candidates) == (
        0 if second_vote == "accept" else 2)
    assert restored(state) == state
    with pytest.raises(WattenEngineError, match="retourschneider_unavailable"):
        step(state, first, "retourschneider", "accept")


def test_active_retourschneider_challengers_can_bid_even_after_reaching_nine():
    state = finish(ready(start_match(recipe(4), "retour-at-nine", dealt(), first_dealer="A")))
    party = state.bid_state.result.winning_party
    challenger = state.parties.parties[party]
    other = 1 - party
    result = replace(state.bid_state.result, points=9)
    history = (DealResult("earlier-two", state.parties, party, 2, "tricks"),
               DealResult("earlier-seven", state.parties, other, 7, "tricks"),
               DealResult("opponents-gestrichen", state.parties, other, 2, "tricks"), result)
    ledger = ScoreLedger(11, tuple(ScoreAccount(account.members, 9) for account in state.ledger.accounts), history,
                         Retourschneider(challenger, "opponents-gestrichen", 2, True))
    state = replace(state, ledger=ledger, bid_state=replace(state.bid_state, accepted_stake=9,
                                                         last_offering_party=party, result=result))
    state = ready(next_deal(state, "retour-next-nine", dealt()))
    assert gestrichen_players(state) == frozenset(state.parties.parties[other])
    # Find the first eligible challenger turn after the opening card.
    while not state.play.plays or state.play.current_player_id not in challenger:
        player = state.play.current_player_id
        assert player in challenger or "bid" not in personal(state, player)["actions"]
        state = step(state, player, "play_card", legal_cards(state.play, state.bid_state, player)[0])
    player = state.play.current_player_id
    assert "bid" in personal(state, player)["actions"]
    state = step(state, player, "bid")
    assert state.phase == "bid_response" and state.bid_state.pending.party == party
