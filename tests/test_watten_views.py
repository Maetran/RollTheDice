"""Privacy comparisons condition on the actual allowed public/private transcript."""

import json
from dataclasses import replace

import pytest

from app.watten_cards import DealtCards, make_deck
from app.watten_engine import (
    ACK_LIMIT,
    SeatBinding,
    WattenEngineError,
    apply_command,
    next_deal,
    restore_storage,
    start_match,
    storage_payload,
)
from app.watten_play import legal_cards
from app.watten_rules import round_roles
from app.watten_views import cpu_view, member_view, spectator_view
from tests.test_watten_engine import actor, command, dealt, finish, ready, recipe, step


def personal(state, player):
    return member_view(state, account_id=ord(player) - ord("A") + 1, player_id=player)


def blind_deal(variant="base"):
    hands = [["leaves-8", "bells-9", "hearts-7", "hearts-8", "bells-8"],
             ["acorns-K", "hearts-O", "hearts-A", "bells-7", "hearts-9"]]
    if variant == "secret":
        hands[0][0], hands[0][-1] = hands[0][-1], hands[0][0]
        hands[1][0], hands[1][-1] = hands[1][-1], hands[1][0]
    elif variant == "thanks":
        hands[0][1], hands[0][-1] = hands[0][-1], hands[0][1]
    used = set(hands[0] + hands[1])
    remaining = [card for card in make_deck() if card not in used]
    hands.extend((remaining[:5], remaining[5:10]))
    return DealtCards(tuple(tuple(hand) for hand in hands), tuple(remaining[10:]), tuple(hand[-1] for hand in hands))


@pytest.mark.parametrize("count", (2, 3, 4))
@pytest.mark.parametrize("dealer", ("A", "B"))
def test_normal_precall_hands_only_actual_announcers_then_all_own_hands(count, dealer):
    state = start_match(recipe(count), "normal-view", dealt(count), first_dealer=dealer)
    roles = round_roles(count, state.dealer_seat, determination="normal")
    for seat, player in enumerate(state.recipe.seats):
        view = personal(state, player)
        expected = [{"card": card} for card in state.deal.hands[seat]] if seat in {
            roles.strike_announcer, roles.suit_announcer} else [{"back": True}] * 5
        assert view["hand"] == expected
        assert view["inspection"] is None and view["partner_hand"] is None
        assert [item["tricks_won"] for item in view["seats"]] == [0] * count
    state = ready(state)
    for seat, player in enumerate(state.recipe.seats):
        assert personal(state, player)["hand"] == [{"card": card} for card in state.play.hands[seat]]
    spectator = spectator_view(state)
    assert "hand" not in spectator and "viewer" not in spectator and "actions" not in spectator


def test_public_trick_counts_retain_earlier_winners_without_enabling_live_history():
    state = ready(start_match(recipe(4, trick_history=False), "public-piles", dealt(4), first_dealer="A"))
    for player, card in (("B", "hearts-O"), ("C", "bells-9"), ("D", "bells-A"), ("A", "hearts-7"),
                         ("A", "hearts-8"), ("B", "hearts-K"), ("C", "bells-10"), ("D", "leaves-7")):
        state = step(state, player, "play_card", card)
    assert state.play.tricks[0].winner == 0 and state.play.tricks[1].winner == 3
    for view in [spectator_view(state), *(personal(state, player) for player in "ABCD")]:
        assert [item["tricks_won"] for item in view["seats"]] == [1, 0, 0, 1]
        assert view["trick_history"] is None
        assert sum(item["tricks_won"] for item in view["seats"]) == sum(view["party_tricks"])
    state = finish(state)
    state = next_deal(state, "public-piles-next", dealt(4))
    assert [item["tricks_won"] for item in spectator_view(state)["seats"]] == [0, 0, 0, 0]


@pytest.mark.parametrize("blind", (False, True))
def test_inspection_rejoin_returns_same_original_cards_only_to_own_unacknowledged_window(blind):
    state = start_match(recipe(4, "ladinisch", blind), "window", blind_deal(), first_dealer="A")
    for player in state.recipe.seats:
        assert personal(state, player)["hand"] == [{"back": True}] * 5
    state = step(state, "A", "show_ready")
    assert personal(state, "A")["inspection"] is None
    state = step(state, "B", "show_ready")
    shown = [{"role": "strike", "card": "hearts-9"}, {"role": "colour", "card": "bells-8"}]
    assert personal(state, "A")["inspection"]["cards"] == shown
    assert personal(state, "B")["inspection"]["cards"] == shown
    assert personal(state, "C")["inspection"] is None and personal(state, "D")["inspection"] is None
    restored = restore_storage(json.loads(json.dumps(storage_payload(state))))
    assert personal(restored, "A")["inspection"]["cards"] == shown
    request = command(state, "A", "inspection_ack", command_id="close-A")
    state = apply_command(state, actor(state, "A"), request).state
    assert personal(state, "A")["inspection"] is None
    assert personal(state, "B")["inspection"]["cards"] == shown
    restored = restore_storage(json.loads(json.dumps(storage_payload(state))))
    assert personal(restored, "A")["inspection"] is None
    replayed = apply_command(restored, actor(restored, "A"), request)
    assert replayed.replayed and not replayed.public_events
    assert personal(replayed.state, "A")["inspection"] is None
    state = step(state, "B", "inspection_ack")
    for player in state.recipe.seats:
        assert personal(state, player)["inspection"] is None
        assert all("card" in card for card in personal(state, player)["hand"])
    assert "hearts-9" not in json.dumps(personal(state, "A"))
    assert "bells-8" not in json.dumps(personal(state, "B"))


@pytest.mark.parametrize("show_rechter", (False, True))
@pytest.mark.parametrize("critical", (False, True))
def test_matching_reference_only_with_option_and_official_knowledge_never_other_original_bottom(show_rechter, critical):
    state = ready(start_match(recipe(4, "ladinisch", True, critical, show_rechter=show_rechter),
                              "reference", blind_deal(), first_dealer="A"))
    for player in state.recipe.seats:
        view = personal(state, player)
        encoded = json.dumps(view)
        assert "strike_rank" not in encoded and "trump_suit" not in encoded and "normal_strike" not in encoded
        assert "announced_strike" not in view and "inspection" in view and view["inspection"] is None
        if show_rechter:
            assert view["reference_card"] == ({"face": "card", "card": "bells-9"} if player in "AB" else {"face": "back"})
        else:
            assert "reference_card" not in view
    assert spectator_view(state).get("reference_card") == ({"face": "back"} if show_rechter else None)
    assert "hearts-9" not in json.dumps(personal(state, "A"))
    assert "bells-8" not in json.dumps(personal(state, "B"))


@pytest.mark.parametrize("critical", (False, True))
def test_weli_reference_is_the_sole_matching_card_even_when_critical(critical):
    state = ready(start_match(recipe(4, "ladinisch", True, critical, show_rechter=True), "weli-reference",
                              dealt(4, bottoms=("hearts-8", "bells-6", "leaves-8", "acorns-8")), first_dealer="A"))
    assert personal(state, "A")["reference_card"] == {"face": "card", "card": "bells-6"}
    assert personal(state, "B")["reference_card"] == {"face": "card", "card": "bells-6"}
    assert personal(state, "C")["reference_card"] == {"face": "back"}


@pytest.mark.parametrize("critical", (False, True))
@pytest.mark.parametrize("show_rechter", (False, True))
def test_hidden_call_changes_leave_blind_cpu_spectator_and_personal_views_identical_given_same_allowed_transcript(critical, show_rechter):
    states = []
    for variant in ("base", "secret"):
        state = ready(start_match(recipe(4, "ladinisch", True, critical, show_rechter=show_rechter),
                                  "privacy", blind_deal(variant), first_dealer="A"))
        state = step(state, "B", "bid")
        state = step(state, "C", "partner_feedback", "good")
        states.append(state)
    left, right = states
    assert left.call != right.call and left.thanks == right.thanks == ()
    assert spectator_view(left) == spectator_view(right)
    for player in "CD":
        assert personal(left, player) == personal(right, player)
        assert bool(personal(left, player)["feedback"]) is (player == "C")
    assert legal_cards(left.play, left.bid_state, "C") == legal_cards(right.play, right.bid_state, "C") == ()
    # A CPU assigned to C receives exactly the same personal allowlist. A
    # derived guess about the call cannot elevate it to an official knower.
    cpu_states = []
    for state in states:
        bindings = tuple(SeatBinding(item.player_id, None if item.player_id == "C" else item.account_id)
                         for item in state.recipe.bindings)
        cpu_states.append(replace(state, recipe=replace(state.recipe, bindings=bindings)))
    assert cpu_view(cpu_states[0], player_id="C") == personal(left, "C")
    assert cpu_view(cpu_states[0], player_id="C") == cpu_view(cpu_states[1], player_id="C")
    assert "legal_cards" not in json.dumps(personal(left, "C"))


@pytest.mark.parametrize("dealer", tuple("ABCD"))
def test_blind_actions_keep_bid_and_response_with_knower_and_feedback_with_its_partner(dealer):
    state = ready(start_match(recipe(4, "ladinisch", True), "blind-actions", dealt(), first_dealer=dealer))
    first = state.play.current_player_id
    state = step(state, first, "play_card", legal_cards(state.play, state.bid_state, first)[0])
    card_player = state.play.current_player_id
    party = state.parties.party_of(card_player)
    bidder = state.parties.decider(party)
    assert personal(state, card_player)["actions"] == ["play_card"]
    assert personal(state, bidder)["actions"] == ["bid"]
    assert all("bid" not in personal(state, player)["actions"]
               for player in state.recipe.seats if player != bidder)
    state = step(state, bidder, "bid")
    decider = state.parties.decider(1 - party)
    partner = next(player for player in state.parties.parties[1 - party] if player != decider)
    assert personal(state, decider)["actions"] == ["respond_hold", "respond_go", "respond_counter"]
    assert personal(state, partner)["actions"] == ["partner_feedback"]
    assert all(not personal(state, player)["actions"] for player in state.parties.parties[party])


def test_public_thanks_is_the_only_permitted_difference_when_a_shown_rechter_changes():
    base = ready(start_match(recipe(4, "ladinisch", True), "thanks-privacy", blind_deal(), first_dealer="A"))
    thanked = ready(start_match(recipe(4, "ladinisch", True), "thanks-privacy", blind_deal("thanks"), first_dealer="A"))
    assert base.thanks == () and thanked.thanks == (0,)
    for projection in (spectator_view, lambda state: personal(state, "C"), lambda state: personal(state, "D")):
        left, right = projection(base), projection(thanked)
        assert left.pop("transcript") == []
        assert right.pop("transcript") == [{"kind": "watten_thanks", "seat": 0}]
        assert left == right


@pytest.mark.parametrize("count", (3, 4))
def test_private_feedback_changes_no_opponent_or_public_snapshot_even_during_bid(count):
    state = ready(start_match(recipe(count), "feedback", dealt(count), first_dealer="A"))
    state = step(state, "B", "bid")
    public = spectator_view(state)
    opponent = personal(state, "B")
    changed = step(state, "A", "partner_feedback", "good")
    assert changed.opportunity == state.opportunity
    assert spectator_view(changed) == public and personal(changed, "B") == opponent
    assert personal(changed, "C")["feedback"] == [{"sender": "A", "recipient": "C", "value": "good", "sequence": 1}]
    assert personal(changed, "A")["feedback_opportunity"] == 1
    assert personal(changed, "C")["feedback_opportunity"] == 0
    if count == 4:
        assert personal(changed, "D") == personal(state, "D")
    for illegal in ("hearts-A", "strike=7", "great", ""):
        with pytest.raises(ValueError):
            step(changed, "A", "partner_feedback", illegal)
    if count == 3:
        with pytest.raises(WattenEngineError, match="feedback_unavailable"):
            step(changed, "B", "partner_feedback", "good")


def test_other_actors_private_feedback_cannot_be_probed_through_public_ack_eviction():
    initial = start_match(recipe(), "ack-privacy", dealt(), first_dealer="A")
    public_request = command(initial, "B", "announce_strike", "7", "public-probe")
    state = apply_command(initial, actor(initial, "B"), public_request).state
    state = step(state, "A", "announce_colour", "bells")
    state = step(state, "B", "bid")
    before = apply_command(state, actor(state, "B"), public_request)
    state = step(state, "A", "partner_feedback", "good", "private-first")
    for index in range(ACK_LIMIT + 1):
        with pytest.raises(WattenEngineError, match="feedback_unavailable"):
            step(state, "A", "partner_feedback", "good", f"private-{index}")
    after = apply_command(state, actor(state, "B"), public_request)
    assert before.ack == after.ack and before.replayed == after.replayed
    assert before.public_events == after.public_events == ()
    assert spectator_view(before.state) == spectator_view(after.state)
    assert personal(before.state, "B") == personal(after.state, "B")


@pytest.mark.parametrize("count", (3, 4))
def test_open_partner_hand_is_opt_in_only_after_call_and_only_the_actual_partner(count):
    state = start_match(recipe(count, open_partner_hand=True), "partner", dealt(count), first_dealer="A")
    assert all(personal(state, player)["partner_hand"] is None for player in state.recipe.seats)
    state = ready(state)
    expected = {"A": "C", "C": "A", "B": "D", "D": "B"} if count == 4 else {"A": "C", "C": "A"} if count == 3 else {}
    for player in state.recipe.seats:
        view = personal(state, player)
        if player in expected:
            partner = expected[player]
            assert view["partner_hand"] == {"player_id": partner, "cards": list(state.play.hands[state.recipe.seats.index(partner)])}
        else:
            assert view["partner_hand"] is None
    assert "partner_hand" not in spectator_view(state)
    default = ready(start_match(recipe(count), "partner-default", dealt(count), first_dealer="A"))
    assert all(personal(default, player)["partner_hand"] is None for player in default.recipe.seats)


def test_two_player_partner_hand_option_is_rejected_and_solo_has_no_feedback_or_partner():
    with pytest.raises(WattenEngineError, match="partner_hand_requires_partners"):
        recipe(2, open_partner_hand=True)
    state = ready(start_match(recipe(2), "no-partner", dealt(2), first_dealer="A"))
    for player in state.recipe.seats:
        assert personal(state, player)["partner_hand"] is None
        assert "partner_feedback" not in personal(state, player)["actions"]


@pytest.mark.parametrize("history", (False, True))
def test_trick_history_contains_only_already_public_current_deal_cards(history):
    state = ready(start_match(recipe(4, trick_history=history), "history", dealt(), first_dealer="A"))
    for _ in range(4):
        player = state.play.current_player_id
        state = step(state, player, "play_card", legal_cards(state.play, state.bid_state, player)[0])
    view = spectator_view(state)
    assert view["current_trick"] == {"cards": []}
    assert len(view["last_trick"]["cards"]) == 4
    assert view["trick_history"] == ([view["last_trick"]] if history else None)
    public_cards = {card["card"] for card in view["last_trick"]["cards"]}
    encoded = json.dumps(view)
    assert all(card not in encoded for card in state.deal.stock)
    assert all(card in state.play.plays for card in public_cards)
    assert "account_id" not in encoded and "ack_cache" not in encoded and "bottom_cards" not in encoded


@pytest.mark.parametrize("history", (False, True))
@pytest.mark.parametrize("determination,blind", (("normal", False), ("ladinisch", True)))
def test_completed_round_publicly_explains_call_and_all_completed_tricks_then_drops_review(history, determination, blind):
    state = ready(start_match(recipe(4, determination, blind, trick_history=history), "round-review",
                              blind_deal(), first_dealer="A"))
    assert "round_summary" not in spectator_view(state)
    assert all("round_summary" not in personal(state, player) for player in state.recipe.seats)
    state = finish(state)
    public = spectator_view(state)
    assert state.phase == "deal_complete"
    assert public["round_summary"] == {"strike_rank": state.call.strike_rank, "trump_suit": state.call.trump_suit,
                                       "rechter": f"{state.call.trump_suit}-{state.call.strike_rank}"}
    assert len(public["trick_history"]) == len(state.play.tricks) <= 5
    assert public["trick_history"][-1] == public["last_trick"]
    for player in state.recipe.seats:
        assert personal(state, player)["round_summary"] == public["round_summary"]
        assert personal(state, player)["trick_history"] == public["trick_history"]
    encoded = json.dumps(public)
    permitted = {card["card"] for trick in public["trick_history"] for card in trick["cards"]}
    permitted.add(public["round_summary"]["rechter"])
    assert all(card in permitted or card not in encoded for hand in state.play.hands for card in hand)
    assert all(card in permitted or card not in encoded for card in state.deal.stock)
    assert "bottom_cards" not in encoded and "hand" not in public
    state = next_deal(state, "round-after-review", dealt())
    assert "round_summary" not in spectator_view(state)
    assert spectator_view(state)["trick_history"] is None


@pytest.mark.parametrize("critical,bottoms,rechter", (
    (False, ("hearts-8", "bells-6", "leaves-8", "acorns-8"), "bells-6"),
    (True, ("hearts-8", "bells-6", "leaves-8", "acorns-8"), None),
    (True, ("hearts-8", "bells-K", "leaves-8", "acorns-8"), None),
    (True, ("acorns-8", "hearts-7", "leaves-8", "bells-8"), None),
))
def test_completed_blind_round_has_no_invented_rechter_when_matching_card_is_critical(critical, bottoms, rechter):
    state = ready(start_match(recipe(4, "ladinisch", True, critical), "critical-review",
                              dealt(4, bottoms=bottoms), first_dealer="A"))
    state = finish(state)
    assert spectator_view(state)["round_summary"] == {
        "strike_rank": state.call.strike_rank, "trump_suit": state.call.trump_suit, "rechter": rechter}


def test_folded_round_review_keeps_partial_trick_separate_and_match_end_is_reviewable():
    state = ready(start_match(recipe(2, target_points=3), "fold-review", dealt(2), first_dealer="A"))
    state = step(state, "B", "play_card", legal_cards(state.play, state.bid_state, "B")[0])
    state = step(state, "A", "bid")
    state = step(state, "B", "respond", "counter")
    state = step(state, "A", "respond", "go")
    public = spectator_view(state)
    assert state.phase == "match_complete"
    assert public["round_summary"] == {"strike_rank": "7", "trump_suit": "bells", "rechter": "bells-7"}
    assert public["trick_history"] == [] and public["last_trick"] is None
    assert len(public["current_trick"]["cards"]) == 1


def test_role_requests_fail_closed_and_returned_views_cannot_mutate_internal_state():
    state = ready(start_match(recipe(), "role-check", dealt(), first_dealer="A"))
    for account, player in ((1, "B"), (1, "unknown"), (None, "A"), (True, "A")):
        with pytest.raises(WattenEngineError, match="actor_not_bound"):
            member_view(state, account_id=account, player_id=player)
    with pytest.raises(WattenEngineError, match="actor_not_bound"):
        cpu_view(state, player_id="A")
    before = storage_payload(state)
    view = personal(state, "A")
    view["hand"].clear()
    view["scores"][0]["members"].append("foreign")
    view["seats"][0]["player_id"] = "foreign"
    assert storage_payload(state) == before
