"""Phase/identity boundaries, one-time accounting and private-storage restart."""

import copy
import json
from dataclasses import FrozenInstanceError, replace

import pytest

from app.watten_bidding import WattenBiddingError
from app.watten_cards import DealtCards, deal_cards, make_deck
from app.watten_engine import (
    EngineActor,
    EngineCommand,
    EngineRecipe,
    SeatBinding,
    WattenEngineError,
    apply_command,
    gestrichen_players,
    next_deal,
    restore_storage,
    start_match,
    storage_payload,
)
from app.watten_play import PlayProfile, WattenPlayError, legal_cards
from app.watten_rules import round_roles


def recipe(count=4, determination="normal", blind=False, critical=False, **options):
    bindings = tuple(SeatBinding(player, index + 1) for index, player in enumerate("ABCD"[:count]))
    return EngineRecipe(PlayProfile(count, determination, blind, critical), bindings,
                        (("A", "C"), ("B", "D")) if count == 4 else None, **options)


def dealt(count=4, *, bottoms=None):
    deck = list(make_deck())
    if bottoms is None:
        return deal_cards(deck, player_count=count, recipient_order=tuple(seat for seat in range(count) for _ in range(5)))
    hands = [[] for _ in range(count)]
    for bottom in bottoms:
        deck.remove(bottom)
    for seat in range(count):
        hands[seat] = [*deck[:4], bottoms[seat]]
        del deck[:4]
    return DealtCards(tuple(tuple(hand) for hand in hands), tuple(deck), tuple(bottoms))


def actor(state, player):
    binding = next(binding for binding in state.recipe.bindings if binding.player_id == player)
    return EngineActor(player, binding.account_id)


def command(state, player, kind, value=None, command_id=None):
    private = next((item.sequence for item in state.feedback if item.sender == player), 0) if kind == "partner_feedback" else None
    return EngineCommand(command_id or f"{state.deal_id}-{state.opportunity}-{kind}-{private}", state.deal_id,
                         state.opportunity, state.phase, kind, value, private)


def step(state, player, kind, value=None, command_id=None):
    return apply_command(state, actor(state, player), command(state, player, kind, value, command_id)).state


def ready(state):
    roles = round_roles(len(state.recipe.seats), state.dealer_seat, determination=state.recipe.profile.determination)
    if state.recipe.profile.determination == "normal":
        state = step(state, state.recipe.seats[roles.strike_announcer], "announce_strike", "7")
        return step(state, state.recipe.seats[roles.suit_announcer], "announce_colour", "bells")
    for seat in sorted(state.inspectors):
        state = step(state, state.recipe.seats[seat], "show_ready")
    for seat in sorted(state.inspectors):
        state = step(state, state.recipe.seats[seat], "inspection_ack")
    return state


def finish(state):
    while state.phase == "play":
        player = state.play.current_player_id
        card = legal_cards(state.play, state.bid_state, player)[0]
        state = step(state, player, "play_card", card)
    return state


@pytest.mark.parametrize("count", (2, 3, 4))
@pytest.mark.parametrize("dealer", ("A", "B"))
def test_normal_roles_first_card_and_announcements_are_bound_to_actual_announcers(count, dealer):
    state = start_match(recipe(count), "first", dealt(count), first_dealer=dealer)
    roles = round_roles(count, state.dealer_seat, determination="normal")
    strike, colour = state.recipe.seats[roles.strike_announcer], state.recipe.seats[roles.suit_announcer]
    for player in state.recipe.seats:
        if player != strike:
            with pytest.raises(WattenEngineError, match="announcer_required"):
                step(state, player, "announce_strike", "7")
    initial = state
    first = apply_command(state, actor(state, strike), command(state, strike, "announce_strike", "7"))
    assert first.public_events == (("strike_announced", roles.strike_announcer, "7"),)
    state = first.state
    assert state.phase == "colour" and initial.phase == "strike"
    if colour != strike:
        with pytest.raises(WattenEngineError, match="announcer_required"):
            step(state, strike, "announce_colour", "bells")
    state = step(state, colour, "announce_colour", "bells")
    assert state.phase == "play" and state.play.current_seat == roles.first_player
    assert len(state.play.plays) == 0 and state.ledger.applied_results == ()


@pytest.mark.parametrize("count,blind", ((2, False), (4, False), (4, True)))
def test_ladinisch_requires_two_actual_shows_then_both_individual_inspection_acks(count, blind):
    bottoms = ("bells-K", "hearts-K", "leaves-8", "acorns-8")[:count]
    state = start_match(recipe(count, "ladinisch", blind), "inspection", dealt(count, bottoms=bottoms), first_dealer="A")
    assert state.thanks == () and state.call is None
    with pytest.raises(WattenEngineError, match="action_unavailable"):
        step(state, "B", "play_card", state.deal.hands[1][0])
    state = step(state, "A", "show_ready")
    assert state.phase == "show_ready" and state.call is None and state.thanks == ()
    with pytest.raises(WattenEngineError, match="show_unavailable"):
        step(state, "A", "show_ready")
    state = step(state, "B", "show_ready")
    assert state.phase == "inspection" and state.play is None
    assert state.call.strike_rank == "K" and state.call.trump_suit == "bells"
    assert state.thanks == ((0,) if blind else ())
    restored = restore_storage(json.loads(json.dumps(storage_payload(state))))
    assert restored == state
    state = step(state, "A", "inspection_ack")
    assert state.phase == "inspection" and state.play is None
    with pytest.raises(WattenEngineError, match="inspection_unavailable"):
        step(state, "A", "inspection_ack")
    state = step(state, "B", "inspection_ack")
    assert state.phase == "play" and state.play.current_player_id == "B"
    with pytest.raises(WattenEngineError, match="action_unavailable"):
        step(state, "A", "inspection_ack")


def test_thanks_uses_actual_shown_rechter_not_a_hidden_card_or_critical_collision():
    # King/bells: Rechter bells-K is in the stock, not an original shown card.
    state = start_match(recipe(4, "ladinisch", True), "hidden", dealt(4, bottoms=("bells-8", "hearts-K", "leaves-8", "acorns-8")), first_dealer="A")
    state = step(step(state, "A", "show_ready"), "B", "show_ready")
    assert state.thanks == ()
    critical = start_match(recipe(4, "ladinisch", True, True), "critical", dealt(4, bottoms=("hearts-K", "bells-K", "leaves-8", "acorns-8")), first_dealer="A")
    critical = step(step(critical, "A", "show_ready"), "B", "show_ready")
    assert critical.thanks == ()


@pytest.mark.parametrize("count,blind", ((2, False), (4, False), (4, True)))
def test_open_ladinisch_delivers_public_call_once_after_final_ack_but_blind_never_does(count, blind):
    state = start_match(recipe(count, "ladinisch", blind), "open-call", dealt(count), first_dealer="A")
    state = step(step(state, "A", "show_ready"), "B", "show_ready")
    first = apply_command(state, actor(state, "A"), command(state, "A", "inspection_ack"))
    assert first.public_events == ()
    state = first.state
    request = command(state, "B", "inspection_ack", command_id="final-window-close")
    final = apply_command(state, actor(state, "B"), request)
    expected = () if blind else (("strike_announced", 1, final.state.call.strike_rank),
                                ("colour_announced", 0, final.state.call.trump_suit))
    assert final.public_events == expected
    assert apply_command(final.state, actor(state, "B"), request).public_events == ()
    restored = restore_storage(json.loads(json.dumps(storage_payload(final.state))))
    assert apply_command(restored, actor(restored, "B"), request).public_events == ()


def test_bound_identity_and_stale_envelope_cannot_change_or_consume_opportunity():
    state = start_match(recipe(), "identity", dealt(), first_dealer="A")
    request = command(state, "B", "announce_strike", "7")
    before = storage_payload(state)
    for wrong in (EngineActor("B", 1), EngineActor("B", None), EngineActor("unknown", 2), EngineActor("A", True)):
        with pytest.raises(WattenEngineError, match="actor_not_bound"):
            apply_command(state, wrong, request)
    for wrong in (replace(request, deal_id="old"), replace(request, opportunity=1), replace(request, phase="play")):
        with pytest.raises(WattenEngineError, match="stale_opportunity"):
            apply_command(state, actor(state, "B"), wrong)
    assert storage_payload(state) == before
    with pytest.raises(FrozenInstanceError):
        state.opportunity = 9
    assert apply_command(state, actor(state, "B"), request).state.opportunity == 1


def test_duplicate_only_returns_safe_ack_and_never_reemits_normal_call_or_old_inspection_payload():
    state = start_match(recipe(), "ack", dealt(), first_dealer="A")
    request = command(state, "B", "announce_strike", "7", "same")
    accepted = apply_command(state, actor(state, "B"), request)
    state = step(accepted.state, "A", "announce_colour", "bells")
    replay = apply_command(state, actor(state, "B"), request)
    assert replay.state is state and replay.ack == accepted.ack and replay.replayed
    assert replay.public_events == ()
    for cached in storage_payload(state)["ack_cache"]:
        assert set(cached) == {"player_id", "account_id", "digest", "ack"}
        assert set(cached["ack"]) == {"command_id", "deal_id", "opportunity"}
    with pytest.raises(WattenEngineError, match="command_conflict"):
        apply_command(state, actor(state, "B"), replace(request, value="8"))


def test_evicted_private_feedback_cannot_be_changed_or_applied_twice():
    state = start_match(recipe(), "private-replay", dealt(), first_dealer="A")
    public_request = command(state, "B", "announce_strike", "7", "old-public")
    state = apply_command(state, actor(state, "B"), public_request).state
    state = step(state, "A", "announce_colour", "bells")
    state = step(state, "B", "bid")
    original = command(state, "A", "partner_feedback", "good", "old-feedback")
    public_opportunity = state.opportunity
    accepted = apply_command(state, actor(state, "A"), original)
    state = accepted.state
    replay = apply_command(state, actor(state, "A"), original)
    assert replay.replayed and replay.ack == accepted.ack and state.opportunity == public_opportunity
    assert len(state.feedback) == 1 and state.feedback[0].sequence == 1
    with pytest.raises(WattenEngineError, match="feedback_unavailable"):
        step(state, "A", "partner_feedback", "unsure", "fresh-second-choice")
    # Simulate pruning this actor's old receipts: durable feedback still
    # prevents another choice, independently of the bounded ACK cache.
    state = replace(state, ack_cache=tuple(item for item in state.ack_cache if item.player_id != "A"))
    with pytest.raises(WattenEngineError, match="feedback_unavailable"):
        apply_command(state, actor(state, "A"), original)
    assert apply_command(state, actor(state, "B"), public_request).replayed
    restored = restore_storage(json.loads(json.dumps(storage_payload(state))))
    with pytest.raises(WattenEngineError, match="feedback_unavailable"):
        apply_command(restored, actor(restored, "A"), original)


def test_pending_bid_freezes_cards_but_not_private_partner_feedback_and_go_scores_once():
    state = ready(start_match(recipe(), "bidding", dealt(), first_dealer="A"))
    state = step(state, "B", "play_card", legal_cards(state.play, state.bid_state, "B")[0])
    state = step(state, "C", "bid")
    assert state.phase == "bid_response"
    pending = state
    state = step(state, "D", "partner_feedback", "bad")
    assert state.opportunity == pending.opportunity and state.bid_state == pending.bid_state
    with pytest.raises(WattenEngineError, match="action_unavailable"):
        step(state, "C", "play_card", state.play.hands[2][0])
    with pytest.raises(WattenBiddingError, match="designated_decider"):
        step(state, "D", "respond", "hold")
    state = step(state, "B", "respond", "counter")
    assert state.bid_state.accepted_stake == 3 and state.bid_state.pending.points == 4
    request = command(state, "A", "respond", "go", "fold-once")
    terminal = apply_command(state, actor(state, "A"), request)
    assert terminal.state.phase == "deal_complete"
    assert terminal.state.bid_state.result.points == 3 and terminal.state.bid_state.result.winning_party == 1
    assert tuple(account.points for account in terminal.state.ledger.accounts) == (0, 3)
    assert apply_command(terminal.state, actor(state, "A"), request).state is terminal.state
    assert len(terminal.state.ledger.applied_results) == 1


@pytest.mark.parametrize("count", (2, 3, 4))
def test_third_party_trick_ends_and_awards_once_with_no_later_bid(count):
    state = finish(ready(start_match(recipe(count), "third-trick", dealt(count), first_dealer="A")))
    assert state.phase == "deal_complete" and state.play.ended
    assert max(state.play.party_tricks) == 3
    assert len(state.ledger.applied_results) == 1
    winners = state.parties.parties[state.bid_state.result.winning_party]
    for account in state.ledger.accounts:
        assert account.points == (2 if set(account.members) <= set(winners) else 0)
    for player in state.recipe.seats:
        with pytest.raises(WattenEngineError, match="action_unavailable"):
            step(state, player, "bid")


@pytest.mark.parametrize("count,rounds", ((3, 3), (4, 4)))
def test_next_deals_rotate_roles_and_three_solo_but_preserve_four_manual_parties(count, rounds):
    state = start_match(recipe(count), "rotate-0", dealt(count), first_dealer="A")
    original_parties = state.parties.parties
    dealers, solos = [], []
    for index in range(rounds):
        dealers.append(state.parties.dealer_id)
        if count == 3:
            solos.append(state.parties.parties[1][0])
        else:
            assert state.parties.parties == original_parties
        state = finish(ready(state))
        state = restore_storage(json.loads(json.dumps(storage_payload(state))))
        if index < rounds - 1:
            with pytest.raises(WattenEngineError, match="deal_id_reused"):
                next_deal(state, "rotate-0", dealt(count))
            state = next_deal(state, f"rotate-{index + 1}", dealt(count))
            assert not state.feedback and not state.shown and not state.acknowledged
    assert dealers == list("ABCD"[:count])
    if count == 3:
        assert solos == list("BCA")
        assert tuple(account.members for account in state.ledger.accounts) == (("A",), ("B",), ("C",))


def test_complete_match_stops_dealing_and_gestrichen_uses_source_target_minus_two():
    state = finish(ready(start_match(recipe(2, target_points=3), "match", dealt(2), first_dealer="A")))
    assert gestrichen_players(state) == frozenset(state.parties.parties[state.bid_state.result.winning_party])
    while state.phase != "match_complete":
        state = finish(ready(next_deal(state, f"match-{len(state.ledger.applied_results)}", dealt(2))))
    with pytest.raises(WattenEngineError, match="next_deal_unavailable"):
        next_deal(state, "after-match", dealt(2))
    assert recipe(2, target_points=15).gestrichen_from == 13


def test_storage_roundtrips_each_inspection_and_pending_response_boundary_and_rejects_tampering():
    state = start_match(recipe(4, "ladinisch", True), "restart", dealt(), first_dealer="A")
    stages = [state]
    for player, kind, value in (("A", "show_ready", None), ("B", "show_ready", None),
                                ("A", "inspection_ack", None), ("B", "inspection_ack", None)):
        state = step(state, player, kind, value)
        stages.append(state)
    state = step(state, "B", "play_card", legal_cards(state.play, state.bid_state, "B")[0])
    state = step(state, "A", "bid")
    stages.append(step(state, "D", "partner_feedback", "good"))
    for stage in stages:
        raw = json.loads(json.dumps(storage_payload(stage)))
        assert restore_storage(raw) == stage
        assert raw == storage_payload(restore_storage(raw))
    raw = storage_payload(stages[0])
    for corrupt in ({**raw, "unexpected": "secret"}, {**raw, "phase": "play"}, {**raw, "acknowledged": [0]},
                    {**raw, "shown": [0, 0]}, {**raw, "schema": True},
                    {**raw, "discarded_bid_increases": True}, {**raw, "discarded_bid_increases": 99}):
        with pytest.raises(ValueError):
            restore_storage(corrupt)
    score_corrupt = copy.deepcopy(storage_payload(stages[-1]))
    score_corrupt["ledger"]["accounts"][0]["points"] = 9
    with pytest.raises(WattenEngineError, match="score_mismatch"):
        restore_storage(score_corrupt)
    precard_bid = storage_payload(stages[4])
    precard_bid["phase"] = "bid_response"
    precard_bid["bid"]["last_offering_party"] = 0
    precard_bid["bid"]["pending"] = {"party": 0, "points": 3}
    restored_precard = restore_storage(precard_bid)
    assert restored_precard.phase == "bid_response" and restored_precard.play.plays == ()
    assert restored_precard.bid_state.pending.points == 3


@pytest.mark.parametrize("dealer", tuple("ABCD"))
@pytest.mark.parametrize("response", ("hold", "go", "counter"))
def test_blind_decider_bids_on_partner_turn_and_only_blind_partner_advises_response(dealer, response):
    state = ready(start_match(recipe(4, "ladinisch", True), "blind-deciders", dealt(), first_dealer=dealer))
    current = state.play.current_player_id
    state = step(state, current, "play_card", legal_cards(state.play, state.bid_state, current)[0])
    blind_bidder = state.play.current_player_id
    party = state.parties.party_of(blind_bidder)
    bidder = state.parties.decider(party)
    assert blind_bidder != bidder
    with pytest.raises(WattenBiddingError, match="designated_decider"):
        step(state, blind_bidder, "bid")
    state = step(state, bidder, "bid")
    responding_party = 1 - party
    decider = state.parties.decider(responding_party)
    partner = next(player for player in state.parties.parties[responding_party] if player != decider)
    with pytest.raises(WattenEngineError, match="feedback_unavailable"):
        step(state, decider, "partner_feedback", "good")
    with pytest.raises(WattenBiddingError, match="designated_decider"):
        step(state, partner, "respond", response)
    before = state.opportunity
    state = step(state, partner, "partner_feedback", "good")
    assert state.opportunity == before
    assert state.feedback[0].recipient == decider and state.feedback[0].sender == partner
    assert restore_storage(storage_payload(state)) == state
    state = step(state, decider, "respond", response)
    assert not state.feedback
    assert state.bid_state.accepted_stake == (2 if response == "go" else 3)
    if response == "counter":
        assert state.bid_state.pending.party == responding_party and state.bid_state.pending.points == 4


def test_restoring_legacy_blind_feedback_discards_knower_to_blind_partner_message():
    state = ready(start_match(recipe(4, "ladinisch", True), "legacy-signal", dealt(), first_dealer="A"))
    state = step(state, "B", "bid")
    state = step(state, "C", "partner_feedback", "good")
    raw = storage_payload(state)
    raw["feedback"].append({"sender": "A", "recipient": "C", "value": "bad", "sequence": 1})
    restored = restore_storage(raw)
    assert restored == state
    with pytest.raises(WattenEngineError, match="feedback_unavailable"):
        step(restored, "A", "partner_feedback", "good")


@pytest.mark.parametrize("count,determination,blind", ((2, "normal", False), (2, "ladinisch", False),
                                                     (3, "normal", False), (4, "normal", False), (4, "ladinisch", True)))
def test_opening_player_can_bid_before_any_card_after_call_and_fold_scores_without_a_trick(count, determination, blind):
    state = start_match(recipe(count, determination, blind), "opening-offer", dealt(count), first_dealer="A")
    with pytest.raises(WattenEngineError, match="action_unavailable"):
        step(state, "B", "bid")
    state = ready(state)
    player = state.play.current_player_id
    state = step(state, player, "bid")
    assert state.phase == "bid_response" and not state.play.plays
    decider = state.parties.decider(1 - state.bid_state.pending.party)
    state = step(state, decider, "respond", "go")
    assert state.phase == "deal_complete" and state.bid_state.result.reason == "go"
    assert not state.play.tricks and not state.play.plays
    assert sum(account.points > 0 for account in state.ledger.accounts) >= 1
    assert restore_storage(storage_payload(state)) == state


def test_secret_representations_are_redacted_and_unsupported_profiles_or_wrong_actions_fail_closed():
    state = ready(start_match(recipe(4, "ladinisch", True), "repr", dealt(), first_dealer="A"))
    assert "hearts" not in repr(state) and "bells" not in repr(state)
    assert "hands" not in repr(state) and "stock" not in repr(state) and "strike_rank" not in repr(state)
    assert "hearts" not in repr(command(state, "B", "play_card", "hearts-A"))
    with pytest.raises(WattenPlayError):
        recipe(3, "ladinisch")
    with pytest.raises(WattenEngineError, match="partner_hand_requires_open"):
        recipe(4, "ladinisch", True, open_partner_hand=True)
    critical = start_match(recipe(2, critical=True), "critical", dealt(2), first_dealer="A")
    with pytest.raises(WattenEngineError, match="free_weli"):
        step(critical, "B", "announce_strike", "weli")
