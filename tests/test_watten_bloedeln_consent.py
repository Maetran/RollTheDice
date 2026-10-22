"""Optional Blödeln requests, explicit answers, private bottoms and CPU coins."""

import copy
import json
from dataclasses import replace

import pytest

from app.watten_cpu import CpuProposal, CpuWait, _bloedeln_coin, decide, own_legal_cards
from app.watten_cpu_memory import WattenCpuMemoryError, new_memory, read_personal_view
from app.watten_engine import WattenEngineError, apply_command, next_deal, restore_storage, start_match, storage_payload
from app.watten_play import legal_cards
from app.watten_views import cpu_view, spectator_view
from tests.test_watten_cpu_memory import cpu_recipe
from tests.test_watten_engine import actor, command, dealt, finish, ready, recipe, step
from tests.test_watten_views import blind_deal, personal


def restored(state):
    return restore_storage(json.loads(json.dumps(storage_payload(state))))


def status(state):
    return spectator_view(state)["preplay"]["bloedeln_status"]


@pytest.mark.parametrize("dealer", tuple("ABCD"))
def test_no_request_needs_no_answer_and_never_blocks_the_first_card_or_bid(dealer):
    state = start_match(recipe(4, "ladinisch", True), "optional", dealt(), first_dealer=dealer)
    assert status(state) == "available" and state.preplay_request is None
    for seat, player in enumerate(state.recipe.seats):
        assert ("request_bloedeln" in personal(state, player)["actions"]) is (seat not in state.inspectors)
    state = ready(state)
    leader = state.play.current_player_id
    assert {"play_card", "bid"} <= set(personal(state, leader)["actions"])
    assert step(state, leader, "bid").phase == "bid_response"
    played = step(state, leader, "play_card", legal_cards(state.play, state.bid_state, leader)[0])
    assert status(played) is None and played.bloedeln_decisions == ()
    assert restored(played) == played


@pytest.mark.parametrize("dealer", tuple("ABCD"))
@pytest.mark.parametrize("accepted", (False, True))
def test_request_waits_for_only_the_other_noncaller_while_inspectors_progress(dealer, accepted):
    state = start_match(recipe(4, "ladinisch", True), "request", dealt(), first_dealer=dealer)
    seats = [seat for seat in range(4) if seat not in state.inspectors]
    first, second = (state.recipe.seats[seat] for seat in seats)
    state = step(state, first, "request_bloedeln")
    assert status(state) == "pending" and restored(state) == state
    assert spectator_view(state)["preplay"]["pending"] == {"kind": "bloedeln", "requester": seats[0], "responder": seats[1]}
    assert personal(state, second)["actions"] == ["preplay_accept", "preplay_decline"]
    state = ready(state, bloedeln=None)
    assert state.phase == "play" and status(state) == "pending"
    assert spectator_view(state)["card_turn"] is None
    for player in state.recipe.seats:
        assert not {"play_card", "bid"} & set(personal(state, player)["actions"])
    leader = state.play.current_player_id
    for kind, value in (("play_card", legal_cards(state.play, state.bid_state, leader)[0]), ("bid", None)):
        with pytest.raises(WattenEngineError, match="bloedeln_decision_pending"):
            step(state, leader, kind, value)
    state = step(state, second, "preplay_accept" if accepted else "preplay_decline")
    assert status(state) == ("accepted" if accepted else "declined") and state.bloedeln is accepted
    assert restored(state) == state and "play_card" in personal(state, leader)["actions"]
    assert spectator_view(state)["preplay"]["bloedeln_cards"] == []
    for seat, player in enumerate(state.recipe.seats):
        assert personal(state, player)["preplay"]["bloedeln_cards"] == (
            [{"seat": seat, "card": state.deal.bottom_cards[seat]}] if accepted and seat in seats else [])
    for player in (first, second):
        with pytest.raises(WattenEngineError, match="preplay_unavailable"):
            step(state, player, "request_bloedeln")


def test_request_and_answer_replay_and_racing_request_cannot_change_a_decline():
    state = start_match(recipe(4, "ladinisch", True), "race", dealt(), first_dealer="A")
    request = command(state, "C", "request_bloedeln", command_id="request")
    race = command(state, "D", "request_bloedeln", command_id="race")
    state = apply_command(state, actor(state, "C"), request).state
    assert apply_command(state, actor(state, "C"), request).replayed
    with pytest.raises(WattenEngineError, match="stale_opportunity"):
        apply_command(state, actor(state, "D"), race)
    for player in "ABC":
        with pytest.raises(WattenEngineError, match="preplay_response_required"):
            step(state, player, "preplay_accept")
    answer = command(state, "D", "preplay_decline", command_id="decline")
    state = apply_command(state, actor(state, "D"), answer).state
    assert apply_command(restored(state), actor(state, "D"), answer).replayed
    with pytest.raises(WattenEngineError, match="action_unavailable"):
        step(state, "D", "preplay_accept")
    assert status(state) == "declined" and not state.bloedeln


@pytest.mark.parametrize("alias,accepted", (("bloedeln_accept", True), ("bloedeln_decline", False)))
def test_legacy_answer_alias_needs_real_pending_request_and_real_responder(alias, accepted):
    state = start_match(recipe(4, "ladinisch", True), "alias", dealt(), first_dealer="A")
    with pytest.raises(WattenEngineError, match="bloedeln_choice_unavailable"):
        step(state, "C", alias)
    state = step(state, "C", "request_bloedeln")
    with pytest.raises(WattenEngineError, match="preplay_response_required"):
        step(state, "C", alias)
    assert step(state, "D", alias).bloedeln is accepted


def test_accepting_before_inspection_exposes_no_bottom_to_any_view():
    state = start_match(recipe(4, "ladinisch", True), "private", blind_deal(), first_dealer="A")
    state = step(step(state, "C", "request_bloedeln"), "D", "preplay_accept")
    for view in (spectator_view(state), *(personal(state, player) for player in "ABCD")):
        assert view["preplay"]["bloedeln_cards"] == []
    state = ready(state)
    assert spectator_view(state)["preplay"]["bloedeln_cards"] == []
    for player in "AB":
        assert personal(state, player)["preplay"]["bloedeln_cards"] == []


@pytest.mark.parametrize("dealer", tuple("ABCD"))
def test_consented_packet_bottoms_play_automatically_in_clockwise_order_for_every_dealer(dealer):
    state = ready(start_match(recipe(4, "ladinisch", True), "automatic", dealt(), first_dealer=dealer),
                  bloedeln=True)
    leader = state.play.current_player_id
    first_card = legal_cards(state.play, state.bid_state, leader)[0]
    seat = state.play.current_seat
    state = step(state, leader, "play_card", first_card)
    expected_seats = ((seat + 1) % 4, (seat + 2) % 4)
    assert state.play.plays == (first_card, *(state.deal.bottom_cards[owner] for owner in expected_seats))
    assert state.play.current_seat == state.dealer_seat
    assert restored(state) == state
    assert spectator_view(state)["preplay"]["bloedeln_cards"] == []
    for owner in expected_seats:
        assert state.deal.bottom_cards[owner] not in state.play.hands[owner]
        assert personal(state, state.recipe.seats[owner])["preplay"]["bloedeln_cards"] == []


def test_legacy_obligated_turn_stays_frozen_during_a_bid_and_auto_plays_after_hold():
    state = ready(start_match(recipe(4, "ladinisch", True), "bid-frozen", dealt(), first_dealer="A"),
                  bloedeln=True)
    first_card = legal_cards(state.play, state.bid_state, "B")[0]
    state = step(state, "B", "play_card", first_card)
    legacy = replace(state, play=replace(state.play, plays=(first_card,)))
    pending = step(legacy, "C", "bid")
    assert pending.phase == "bid_response" and pending.play.plays == (first_card,)
    assert restored(pending).play.plays == (first_card,)
    decider = pending.parties.decider(1 - pending.bid_state.pending.party)
    continued = step(pending, decider, "respond", "hold")
    assert continued.play.plays == (first_card, continued.deal.bottom_cards[2], continued.deal.bottom_cards[3])
    assert continued.play.current_player_id == "A"
    ended = step(pending, decider, "respond", "go")
    assert ended.phase == "deal_complete" and ended.play.plays == (first_card,)


def test_next_round_rotates_optional_requesters_and_drops_previous_decline():
    state = ready(start_match(recipe(4, "ladinisch", True, target_points=15), "old", dealt(), first_dealer="A"))
    state = step(step(state, "C", "request_bloedeln"), "D", "preplay_decline")
    state = next_deal(finish(state), "next", dealt())
    assert state.bloedeln_decisions == () and status(state) == "available"
    assert {seat for seat, player in enumerate(state.recipe.seats) if "request_bloedeln" in personal(state, player)["actions"]} == {0, 3}


def test_legacy_early_and_started_rounds_keep_cards_and_consents_without_mandatory_votes():
    early = ready(start_match(recipe(4, "ladinisch", True), "legacy", dealt(), first_dealer="A"))
    raw = storage_payload(early)
    del raw["preplay"]["bloedeln_decisions"]
    saved = restore_storage(raw)
    assert status(saved) == "available" and "play_card" in personal(saved, "B")["actions"]
    accepted = ready(start_match(recipe(4, "ladinisch", True), "accepted", dealt(), first_dealer="A"), bloedeln=True)
    raw = storage_payload(accepted)
    del raw["preplay"]["bloedeln_decisions"]
    assert restore_storage(raw).bloedeln_decisions == ((2, True), (3, True))
    played = step(early, "B", "play_card", legal_cards(early.play, early.bid_state, "B")[0])
    raw = storage_payload(played)
    del raw["preplay"]["bloedeln_decisions"]
    assert restore_storage(raw).play == played.play


def test_legacy_request_and_intermediate_partial_vote_preserve_the_real_decision():
    state = step(start_match(recipe(4, "ladinisch", True), "old-request", dealt(), first_dealer="A"), "D", "request_bloedeln")
    raw = storage_payload(state)
    del raw["preplay"]["bloedeln_decisions"]
    assert restore_storage(raw) == state
    raw = storage_payload(state)
    raw["preplay"]["pending"] = None
    assert restore_storage(raw) == state
    raw["preplay"]["bloedeln_decisions"] = [{"seat": 3, "accepted": False}]
    assert status(restore_storage(raw)) == "declined"


@pytest.mark.parametrize("bad", (None, [{"seat": 0, "accepted": True}], [{"seat": 2, "accepted": 1}],
                                  [{"seat": 2, "accepted": True}, {"seat": 2, "accepted": False}]))
def test_explicit_storage_cannot_forge_missing_or_foreign_choices(bad):
    raw = storage_payload(start_match(recipe(4, "ladinisch", True), "invalid", dealt(), first_dealer="A"))
    raw["preplay"]["bloedeln_decisions"] = bad
    with pytest.raises(WattenEngineError):
        restore_storage(raw)


def test_cpu_coin_is_stable_per_deal_and_never_reads_hand_strength_or_secret_call():
    for purpose in ("request", "answer"):
        coins = []
        for index in range(128):
            variants = []
            for variant in ("base", "secret"):
                state = start_match(cpu_recipe(4, "ladinisch", True), f"coin-{index}", blind_deal(variant), first_dealer="A")
                snapshot = read_personal_view(cpu_view(state, player_id="C"), player_id="C")
                variants.append(_bloedeln_coin(snapshot, purpose))
            assert variants[0] == variants[1]
            coins.append(variants[0])
        assert 40 < sum(coins) < 88


def test_cpu_may_request_or_answer_from_hidden_hand_but_never_bypasses_pending_guard(monkeypatch):
    import app.watten_cpu as policy

    state = start_match(cpu_recipe(4, "ladinisch", True), "cpu", dealt(), first_dealer="A")
    monkeypatch.setattr(policy, "_bloedeln_coin", lambda *_args: False)
    assert isinstance(decide(cpu_view(state, player_id="C"), new_memory("C"), seed=1).decision, CpuWait)
    monkeypatch.setattr(policy, "_bloedeln_coin", lambda *_args: True)
    decision = decide(cpu_view(state, player_id="C"), new_memory("C"), seed=1).decision
    assert isinstance(decision, CpuProposal) and decision.kind == "request_bloedeln"
    state = step(state, "C", decision.kind)
    response = decide(cpu_view(state, player_id="D"), new_memory("D"), seed=1).decision
    assert response.kind == "preplay_accept"
    state = ready(state, bloedeln=None)
    view = cpu_view(state, player_id="B")
    assert own_legal_cards(view, new_memory("B")) == ()
    forged = copy.deepcopy(view)
    forged["actions"] = ["play_card", "bid"]
    with pytest.raises(WattenCpuMemoryError):
        read_personal_view(forged, player_id="B")
