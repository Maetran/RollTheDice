"""Both uninformed seats choose independently before any card or bid can start."""

import copy
import json

import pytest

from app.watten_cpu import CpuProposal, decide, own_legal_cards
from app.watten_cpu_memory import WattenCpuMemoryError, new_memory, read_personal_view
from app.watten_engine import WattenEngineError, apply_command, next_deal, restore_storage, start_match, storage_payload
from app.watten_play import legal_cards
from app.watten_views import cpu_view, spectator_view
from tests.test_watten_cpu_memory import cpu_recipe
from tests.test_watten_engine import actor, command, dealt, finish, ready, recipe, step
from tests.test_watten_views import blind_deal, personal


def restored(state):
    return restore_storage(json.loads(json.dumps(storage_payload(state))))


def consent(state):
    return spectator_view(state)["preplay"]["bloedeln_consent"]


@pytest.mark.parametrize("dealer", tuple("ABCD"))
@pytest.mark.parametrize("choices", ((True, True), (True, False), (False, True), (False, False)))
def test_both_explicit_choices_are_required_even_after_no_and_inspectors_progress_in_parallel(dealer, choices):
    state = start_match(recipe(4, "ladinisch", True), "both-choose", dealt(), first_dealer=dealer)
    seats = [seat for seat in range(4) if seat not in state.inspectors]
    assert consent(state) == {"pending": True, "decisions": [{"seat": seat, "accepted": None} for seat in seats]}
    for seat in range(4):
        actions = personal(state, state.recipe.seats[seat])["actions"]
        assert ("bloedeln_accept" in actions) is (seat in seats)
        assert ("show_ready" in actions) is (seat in state.inspectors)
    first = state.recipe.seats[seats[0]]
    state = step(state, first, "bloedeln_accept" if choices[0] else "bloedeln_decline")
    assert restored(state) == state and consent(state)["pending"]
    assert consent(state)["decisions"][0]["accepted"] is choices[0]
    assert "bloedeln_accept" not in personal(state, first)["actions"]
    # Both announcers may show and close their private windows while the other
    # uninformed player is still deciding. Only card play/bidding stay blocked.
    state = ready(state, bloedeln=None)
    assert state.phase == "play" and consent(state)["pending"]
    assert spectator_view(state)["card_turn"] is None
    for player in state.recipe.seats:
        assert not {"play_card", "bid"} & set(personal(state, player)["actions"])
    leader = state.play.current_player_id
    for kind, value in (("play_card", legal_cards(state.play, state.bid_state, leader)[0]), ("bid", None)):
        with pytest.raises(WattenEngineError, match="bloedeln_decision_pending"):
            step(state, leader, kind, value)
    second = state.recipe.seats[seats[1]]
    state = step(state, second, "bloedeln_accept" if choices[1] else "bloedeln_decline")
    assert not consent(state)["pending"] and state.bloedeln is all(choices)
    assert restored(state) == state and "play_card" in personal(state, leader)["actions"]
    cards = spectator_view(state)["preplay"]["bloedeln_cards"]
    assert cards == ([{"seat": seat, "card": state.deal.bottom_cards[seat]} for seat in seats] if all(choices) else [])


def test_choice_replays_are_idempotent_and_stale_or_changed_choices_never_replace_a_vote():
    state = start_match(recipe(4, "ladinisch", True), "race", dealt(), first_dealer="A")
    first, second = command(state, "C", "bloedeln_decline", command_id="first"), command(state, "D", "bloedeln_accept", command_id="second")
    state = apply_command(state, actor(state, "C"), first).state
    with pytest.raises(WattenEngineError, match="stale_opportunity"):
        apply_command(state, actor(state, "D"), second)
    assert apply_command(state, actor(state, "C"), first).replayed
    with pytest.raises(WattenEngineError, match="choice_unavailable"):
        step(state, "C", "bloedeln_accept")
    with pytest.raises(WattenEngineError, match="choice_unavailable"):
        step(state, "A", "bloedeln_accept")
    state = step(state, "D", "bloedeln_accept")
    assert dict(state.bloedeln_decisions) == {2: False, 3: True} and not state.bloedeln
    assert apply_command(state, actor(state, "C"), first).state == state


def test_public_choices_do_not_disclose_a_hidden_call_before_both_yes_votes():
    views = []
    for variant in ("base", "secret"):
        state = start_match(recipe(4, "ladinisch", True), "privacy-consent", blind_deal(variant), first_dealer="A")
        state = step(state, "C", "bloedeln_accept")
        views.append([spectator_view(state), personal(state, "C"), personal(state, "D")])
    assert views[0] == views[1]
    assert views[0][0]["preplay"]["bloedeln_cards"] == []


def test_next_round_rotates_eligible_seats_and_drops_both_previous_decisions():
    state = finish(ready(start_match(recipe(4, "ladinisch", True, target_points=15), "old", dealt(), first_dealer="A")))
    state = next_deal(state, "next", dealt())
    assert state.bloedeln_decisions == () and consent(state)["pending"]
    assert [item["seat"] for item in consent(state)["decisions"]] == [0, 3]
    assert restored(state) == state


def test_legacy_early_round_requires_choices_but_played_cards_and_existing_consents_are_preserved():
    early = ready(start_match(recipe(4, "ladinisch", True), "legacy", dealt(), first_dealer="A"), bloedeln=None)
    raw = storage_payload(early)
    del raw["preplay"]["bloedeln_decisions"]
    assert consent(restore_storage(raw))["pending"]
    accepted = ready(start_match(recipe(4, "ladinisch", True), "accepted", dealt(), first_dealer="A"), bloedeln=True)
    raw = storage_payload(accepted)
    del raw["preplay"]["bloedeln_decisions"]
    assert restore_storage(raw).bloedeln_decisions == ((2, True), (3, True))
    started = step(step(early, "C", "bloedeln_decline"), "D", "bloedeln_decline")
    started = step(started, "B", "play_card", legal_cards(started.play, started.bid_state, "B")[0])
    raw = storage_payload(started)
    del raw["preplay"]["bloedeln_decisions"]
    saved = restore_storage(raw)
    assert saved.play == started.play and saved.opportunity == started.opportunity
    assert consent(saved) == {"pending": False, "decisions": []}


def test_legacy_pending_request_keeps_requesters_explicit_yes_and_accepts_old_response_alias():
    state = start_match(recipe(4, "ladinisch", True), "legacy-pending", dealt(), first_dealer="A")
    raw = storage_payload(state)
    del raw["preplay"]["bloedeln_decisions"]
    raw["preplay"]["pending"] = {"kind": "bloedeln", "requester": 3, "responder": 2}
    state = restore_storage(raw)
    assert state.preplay_request is None and state.bloedeln_decisions == ((3, True),)
    state = step(state, "C", "preplay_decline")
    assert not state.bloedeln and not consent(state)["pending"]


@pytest.mark.parametrize("bad", (None, [{"seat": 0, "accepted": True}], [{"seat": 2, "accepted": 1}],
                                  [{"seat": 2, "accepted": True}, {"seat": 2, "accepted": False}]))
def test_explicit_new_storage_cannot_forge_missing_or_foreign_choices(bad):
    raw = storage_payload(start_match(recipe(4, "ladinisch", True), "invalid", dealt(), first_dealer="A"))
    raw["preplay"]["bloedeln_decisions"] = bad
    with pytest.raises(WattenEngineError, match="bloedeln_consent"):
        restore_storage(raw)


def test_cpu_decides_from_hidden_own_view_and_cannot_obtain_legal_cards_before_other_human_vote():
    state = start_match(cpu_recipe(4, "ladinisch", True), "cpu-consent", dealt(), first_dealer="A")
    view = cpu_view(state, player_id="C")
    decision = decide(view, new_memory("C"), seed=1).decision
    assert isinstance(decision, CpuProposal) and decision.kind == "bloedeln_decline"
    state = step(state, "C", decision.kind)
    state = ready(state, bloedeln=None)
    view = cpu_view(state, player_id="B")
    assert own_legal_cards(view, new_memory("B")) == ()
    invalid = copy.deepcopy(view)
    invalid["actions"] = ["play_card", "bid"]
    with pytest.raises(WattenCpuMemoryError):
        read_personal_view(invalid, player_id="B")


def test_schoeneres_preserves_choices_for_unchanged_nonannouncer_hands():
    from tests.test_watten_preplay import deterministic_redraw

    state = start_match(recipe(4, "ladinisch", True, schoeneres_enabled=True), "parallel", dealt(), first_dealer="A")
    state = step(state, "A", "request_schoeneres")
    state = step(state, "C", "bloedeln_decline")
    state = apply_command(state, actor(state, "B"), command(state, "B", "preplay_accept"),
                          replacement_deal=deterministic_redraw(state)).state
    assert state.bloedeln_decisions == ((2, False),) and consent(state)["pending"]
    assert restored(state) == state
