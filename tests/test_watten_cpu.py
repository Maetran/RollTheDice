"""Tactical CPU decisions use only the seat's own DTO, memory and an explicit seed."""

import json
import random
from dataclasses import replace

import pytest

import app.watten_cpu as cpu_policy
from app.watten_cards import deal_cards, make_deck
from app.watten_cpu import (
    MAX_SAMPLES,
    WATTEN_CPU_NAMES,
    CpuBudget,
    CpuProposal,
    CpuWait,
    WattenCpuError,
    available_cpu_names,
    call_hypotheses,
    decide,
    own_legal_cards,
)
from app.watten_cpu_memory import WattenCpuMemoryError, memory_from_storage, memory_to_storage
from app.watten_engine import EngineCommand, apply_command, restore_storage, start_match, storage_payload
from app.watten_play import legal_cards
from app.watten_rules import CardKind, ComparisonRules, card_kind
from tests.test_watten_cpu_memory import Table, cpu_recipe, explicit_deal
from tests.test_watten_engine import actor, dealt
from tests.test_watten_views import blind_deal

FAST = CpuBudget(6)


def turn(table, player, seed=7, budget=FAST):
    result = decide(table.view(player), table.memories[player], seed=seed, budget=budget)
    table.memories[player] = result.memory
    return result.decision


def card_choice(table, player, budget=FAST):
    """The CPU may first bid on its own card turn; a held bid still leaves the same turn."""
    decision = turn(table, player, budget=budget)
    if decision.kind == "bid":
        table.propose(player, decision)
        decider = table.state.parties.decider(1 - table.state.bid_state.pending.party)
        table.act(decider, "respond", "hold")
        decision = turn(table, player, budget=budget)
    assert decision.kind == "play_card"
    return decision


def shuffled_deal(count, seed):
    deck = list(make_deck())
    random.Random(seed).shuffle(deck)
    return deal_cards(deck, player_count=count, recipient_order=tuple(seat for _ in range(5) for seat in range(count)))


def run_cpus(table, *, seed=3, budget=FAST, policy_seats=None, limit=240):
    """Every seat decides on each state; feedback first, then one acting proposal."""
    policy_seats = set(table.state.recipe.seats if policy_seats is None else policy_seats)
    proposals = []
    for _ in range(limit):
        if table.state.phase in {"deal_complete", "match_complete"}:
            return proposals
        decisions = {}
        for player in table.state.recipe.seats:
            if player in policy_seats:
                if table.state.phase == "play" and table.state.play.current_player_id == player:
                    view = table.view(player)
                    assert own_legal_cards(view, table.memories[player]) == legal_cards(
                        table.state.play, table.state.bid_state, player)
                decisions[player] = turn(table, player, seed, budget)
            else:
                decisions[player] = baseline(table, player)
        acting = [(player, item) for player, item in decisions.items() if isinstance(item, CpuProposal)]
        assert acting, decisions
        player, proposal = min(acting, key=lambda item: item[1].kind != "partner_feedback")
        table.propose(player, proposal)
        proposals.append((player, proposal))
    raise AssertionError("deal did not finish within the bounded step limit")


def baseline(table, player):
    """Deliberately simple legal baseline: first option, never bids, always holds."""
    view = table.view(player)
    state = table.state

    def make(kind, value=None):
        return CpuProposal(player, view["deal_id"], view["opportunity"], view["phase"], kind, value)

    actions = view["actions"]
    if "announce_strike" in actions:
        return make("announce_strike", "7")
    if "announce_colour" in actions:
        return make("announce_colour", "hearts")
    for kind in ("show_ready", "inspection_ack"):
        if kind in actions:
            return make(kind)
    if "respond_hold" in actions:
        return make("respond", "hold")
    if "play_card" in actions:
        return make("play_card", legal_cards(state.play, state.bid_state, player)[0])
    return CpuWait(view["deal_id"], view["opportunity"], view["phase"], "baseline_waiting")


@pytest.mark.parametrize(("count", "determination", "blind", "critical", "options"), (
    (2, "normal", False, False, {}),
    (2, "normal", False, True, {"show_rechter": True}),
    (2, "ladinisch", False, False, {"trick_history": True}),
    (2, "ladinisch", False, True, {"show_rechter": True}),
    (3, "normal", False, False, {"open_partner_hand": True}),
    (3, "normal", False, True, {}),
    (4, "normal", False, False, {"open_partner_hand": True, "trick_history": True}),
    (4, "normal", False, True, {}),
    (4, "ladinisch", False, False, {"open_partner_hand": True}),
    (4, "ladinisch", False, True, {"show_rechter": True}),
    (4, "ladinisch", True, False, {}),
    (4, "ladinisch", True, True, {"show_rechter": True}),
))
def test_cpus_finish_every_confirmed_profile_with_engine_accepted_commands(count, determination, blind, critical,
                                                                           options):
    for deal_seed in (1, 2):
        recipe = cpu_recipe(count, determination, blind, critical, **options)
        table = Table(start_match(recipe, f"profile-{deal_seed}", shuffled_deal(count, deal_seed), first_dealer="A"))
        proposals = run_cpus(table, seed=deal_seed)
        assert table.state.phase in {"deal_complete", "match_complete"}
        kinds = {proposal.kind for _, proposal in proposals}
        assert "play_card" in kinds and kinds <= {"announce_strike", "announce_colour", "show_ready",
                                                  "inspection_ack", "play_card", "bid", "respond", "partner_feedback"}
        for player, proposal in proposals:
            assert proposal.player_id == player
            # Command kinds, not view action names, reach the engine.
            assert not proposal.kind.startswith("respond_") and proposal.value != "respond_hold"


@pytest.mark.parametrize("count", (2, 3, 4))
def test_match_deciding_counterbids_stop_without_changing_engine_bidding_rules(count):
    table = Table(start_match(cpu_recipe(count), "decisive-bid", shuffled_deal(count, 1), first_dealer="A"))
    table.ready()
    table.play(table.state.play.current_player_id)
    table.act(table.state.play.current_player_id, "bid")
    while table.state.bid_state.pending.points <= table.state.ledger.target:
        decider = table.state.parties.decider(1 - table.state.bid_state.pending.party)
        table.act(decider, "respond", "counter")
    decider = table.state.parties.decider(1 - table.state.bid_state.pending.party)
    response = turn(table, decider)
    assert response.kind == "respond" and response.value in {"hold", "go"}
    table.propose(decider, response)
    assert table.state.bid_state.pending is None


def test_partner_already_winning_with_rechter_gets_a_cheap_card_not_a_trump():
    deal = explicit_deal(
        ("bells-A", "bells-K", "hearts-7", "leaves-8", "acorns-9"),
        ("hearts-8", "hearts-9", "hearts-10", "leaves-10", "acorns-10"),
        ("bells-7", "hearts-U", "hearts-O", "leaves-U", "acorns-U"),
        ("leaves-9", "leaves-O", "leaves-K", "acorns-O", "acorns-K"),
    )
    table = Table(start_match(cpu_recipe(4), "partner", deal, first_dealer="A"))
    table.ready("7", "bells")
    table.play("B", "hearts-8")
    table.play("C", "bells-7")
    table.play("D", "leaves-9")
    decision = card_choice(table, "A", budget=CpuBudget(24))
    rules = ComparisonRules(table.state.call)
    assert card_kind(decision.value, rules) == CardKind.NORMAL
    table.propose("A", decision)


@pytest.mark.parametrize("better_repeated", (None, "hearts-10", "acorns-8"))
def test_blind_opening_shows_new_rank_and_suit_only_between_close_simulated_choices(monkeypatch, better_repeated):
    deal = explicit_deal(
        ("bells-A", "bells-K", "hearts-7", "leaves-8", "acorns-9"),
        ("hearts-8", "hearts-9", "hearts-A", "bells-7", "leaves-10"),
        ("acorns-8", "bells-9", "hearts-10", "leaves-K", "acorns-A"),
        ("leaves-9", "leaves-O", "hearts-U", "acorns-O", "acorns-K"),
    )
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "opening-combinations", deal, first_dealer="A"))
    table.ready()
    table.play("B", "hearts-8")
    hypotheses = call_hypotheses(table.view("C"), table.memories["C"])
    # Isolate the uncertain rollout boundary: three equally promising choices,
    # or one clearly stronger move that repeats a public rank/suit.
    def rollout(_ctx, _world, card):
        if card == better_repeated:
            return 0.8
        return 0.5 if card in {"bells-9", "hearts-10", "acorns-8"} else 0.2

    monkeypatch.setattr(cpu_policy, "_rollout", rollout)
    decision = card_choice(table, "C")
    assert decision.value == (better_repeated or "bells-9")
    assert (table.memories["C"].strike, table.memories["C"].suit) == (None, None)
    assert call_hypotheses(table.view("C"), table.memories["C"]) == hypotheses
    table.propose("C", decision)


def test_informed_blind_announcer_also_offers_new_opening_combinations(monkeypatch):
    deal = explicit_deal(
        ("bells-A", "hearts-K", "leaves-7", "acorns-U", "bells-8"),
        ("hearts-8", "hearts-9", "hearts-10", "bells-7", "hearts-A"),
        ("acorns-9", "bells-9", "leaves-K", "acorns-A", "leaves-A"),
        ("leaves-10", "leaves-O", "hearts-U", "acorns-O", "acorns-K"),
    )
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "announcer-combinations", deal, first_dealer="A"))
    table.ready()
    for player, card in (("B", "hearts-8"), ("C", "acorns-9"), ("D", "leaves-10")):
        table.play(player, card)
    monkeypatch.setattr(cpu_policy, "_rollout", lambda _ctx, _world, _card: 0.5)
    assert card_choice(table, "A").value == "bells-A"


def test_rechter_lead_excludes_a_nonwinning_strike_in_cpu_and_engine_legality():
    deal = explicit_deal(
        ("hearts-7", "bells-A", "hearts-8", "leaves-9", "acorns-10"),
        ("bells-7", "bells-K", "leaves-A", "acorns-A", "hearts-A"),
    )
    table = Table(start_match(cpu_recipe(2), "conserve", deal, first_dealer="A"))
    table.ready("7", "bells")
    table.play("B", "bells-7")
    view = table.view("A")
    assert own_legal_cards(view, table.memories["A"]) == ("bells-A",) == legal_cards(
        table.state.play, table.state.bid_state, "A")
    assert card_choice(table, "A", budget=CpuBudget(24)).value == "bells-A"


@pytest.mark.parametrize(("lead", "critical"), (("bells-A", False), ("hearts-K", True)))
def test_rechter_and_critical_exemptions_leave_the_whole_hand_legal(lead, critical):
    deal = explicit_deal(
        ("bells-7", "hearts-8", "leaves-9", "acorns-10", "bells-9" if critical else "hearts-9"),
        (lead, "bells-K", "leaves-A", "acorns-A", "hearts-A" if critical else "hearts-K"),
    )
    table = Table(start_match(cpu_recipe(2, critical=critical), "exempt", deal, first_dealer="A"))
    table.ready("7", "bells")
    table.play("B", lead)
    view = table.view("A")
    hand = tuple(card["card"] for card in view["hand"])
    assert own_legal_cards(view, table.memories["A"]) == hand == legal_cards(
        table.state.play, table.state.bid_state, "A")
    decision = card_choice(table, "A")
    assert decision.value in tuple(card["card"] for card in table.view("A")["hand"])
    table.propose("A", decision)


def test_three_player_partner_after_critical_overtrick_still_follows_trump_but_keeps_its_strike():
    deal = explicit_deal(
        ("bells-9", "hearts-7", "leaves-8", "acorns-9", "hearts-8"),
        ("bells-10", "bells-A", "leaves-A", "hearts-A", "leaves-K"),
        ("hearts-K", "leaves-9", "acorns-8", "acorns-10", "leaves-10"),
    )
    table = Table(start_match(cpu_recipe(3, critical=True), "overtrick", deal, first_dealer="A"))
    table.ready("7", "bells")
    table.play("B", "bells-10")
    table.play("C", "hearts-K")
    assert own_legal_cards(table.view("A"), table.memories["A"]) == ("bells-9",) == legal_cards(
        table.state.play, table.state.bid_state, "A")
    decision = card_choice(table, "A", budget=CpuBudget(24))
    assert decision.value == "bells-9"
    table.propose("A", decision)


@pytest.mark.parametrize("critical", (False, True))
def test_a_winning_ordinary_strike_remains_legal_in_cpu_rollouts_and_real_engine(critical):
    deal = explicit_deal(
        ("hearts-9", "bells-A", "hearts-8", "leaves-9", "acorns-10"),
        ("bells-7", "bells-K", "leaves-A", "acorns-A", "hearts-A"),
    )
    table = Table(start_match(cpu_recipe(2, critical=critical), "winning-strike", deal, first_dealer="A"))
    table.ready("9", "bells")
    table.play("B", "bells-7")
    assert own_legal_cards(table.view("A"), table.memories["A"]) == ("hearts-9", "bells-A", "leaves-9") == legal_cards(
        table.state.play, table.state.bid_state, "A")
    decision = card_choice(table, "A", budget=CpuBudget(24))
    assert decision.value in {"hearts-9", "bells-A", "leaves-9"}
    table.propose("A", decision)


def test_cpu_keeps_voluntary_losing_rechter_and_critical_but_not_a_losing_plain_strike():
    deal = explicit_deal(
        ("bells-9", "bells-A", "acorns-7", "leaves-9", "leaves-7"),
        ("bells-7", "acorns-8", "acorns-10", "acorns-U", "acorns-O"),
        ("hearts-K", "hearts-8", "hearts-10", "hearts-U", "leaves-A"),
    )
    table = Table(start_match(cpu_recipe(3, critical=True), "protected-overtrick", deal, first_dealer="A"))
    table.ready("9", "bells")
    table.play("B", "bells-7")
    table.play("C", "hearts-K")
    assert own_legal_cards(table.view("A"), table.memories["A"]) == ("bells-9", "bells-A", "acorns-7") == legal_cards(
        table.state.play, table.state.bid_state, "A")
    decision = card_choice(table, "A", budget=CpuBudget(24))
    assert decision.value in {"bells-9", "bells-A", "acorns-7"}
    table.propose("A", decision)
    assert table.state.play.tricks[0].winner == 2


def test_blind_non_inspector_keeps_call_uncertain_is_never_bound_and_infers_from_public_winners():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "blind", blind_deal(), first_dealer="A"))
    table.ready()
    true_call = (table.state.call.strike_rank, table.state.call.trump_suit)
    before = call_hypotheses(table.view("C"), table.memories["C"])
    assert true_call in before and len(before) > 1
    assert call_hypotheses(table.view("A"), table.memories["A"]) == (true_call,)
    for _ in range(4):
        player = table.state.play.current_player_id
        if player == "C":
            view = table.view("C")
            assert own_legal_cards(view, table.memories["C"]) == tuple(card["card"] for card in view["hand"])
        table.play(player)
    after = call_hypotheses(table.view("C"), table.memories["C"])
    assert true_call in after and set(after) < set(before)


def _blind_decision(variant, seed=11):
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "privacy", blind_deal(variant), first_dealer="A"))
    table.ready()
    table.act("A", "partner_feedback", "good")
    table.play("B", "hearts-A")
    view = table.view("C")
    return table, view, decide(view, table.memories["C"], seed=seed, budget=CpuBudget(12))


def test_hidden_state_independence_for_secret_call_opponent_hands_and_stock():
    base, base_view, base_turn = _blind_decision("base")
    secret, secret_view, secret_turn = _blind_decision("secret")
    assert base.state.call != secret.state.call and base_view == secret_view
    assert base_turn.decision == secret_turn.decision and base_turn.memory == secret_turn.memory
    # Same permitted inputs, different opponent hand/stock split: identical output.
    deal = blind_deal()
    hands = [list(hand) for hand in deal.hands]
    stock = list(deal.stock)
    hands[3][0], stock[0] = stock[0], hands[3][0]
    swapped = replace(deal, hands=tuple(map(tuple, hands)), stock=tuple(stock))
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "privacy", swapped, first_dealer="A"))
    table.ready()
    table.act("A", "partner_feedback", "good")
    table.play("B", "hearts-A")
    assert table.view("C") == base_view
    other = decide(table.view("C"), table.memories["C"], seed=11, budget=CpuBudget(12))
    assert other.decision == base_turn.decision and other.memory == base_turn.memory


def test_same_inputs_and_seed_replay_identically_and_command_dedup_fails_closed():
    table = Table(start_match(cpu_recipe(2), "replay", shuffled_deal(2, 5), first_dealer="A"))
    table.ready()
    first = turn(table, "B")
    stored = memory_from_storage(json.loads(json.dumps(memory_to_storage(table.memories["B"]))))
    again = decide(table.view("B"), stored, seed=7, budget=FAST)
    assert again.decision == first and again.decision.command_id == first.command_id
    old_view, old_memory = table.view("B"), table.memories["B"]
    request = EngineCommand(**first.command_fields())
    applied = apply_command(table.state, actor(table.state, "B"), request)
    assert not applied.replayed
    assert apply_command(applied.state, actor(applied.state, "B"), request).replayed
    table.state = applied.state
    table.observe(())
    with pytest.raises(WattenCpuMemoryError, match="stale_observation"):
        decide(old_view, table.memories["B"], seed=7)
    assert decide(old_view, old_memory, seed=7, budget=FAST).decision == first


def test_invalid_seed_budget_and_non_dto_inputs_fail_closed():
    table = Table(start_match(cpu_recipe(2), "inputs", dealt(2), first_dealer="A"))
    table.ready()
    memory = table.memories["B"]
    for seed in (True, "7", 1.5, None):
        with pytest.raises(WattenCpuError, match="invalid_seed"):
            decide(table.view("B"), memory, seed=seed)
    for samples in (0, MAX_SAMPLES + 1, True):
        with pytest.raises(WattenCpuError, match="invalid_budget"):
            CpuBudget(samples)
    with pytest.raises(WattenCpuMemoryError, match="view_required"):
        decide(table.state, memory, seed=1)
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        decide({**table.view("B"), "stock": list(table.state.deal.stock)}, memory, seed=1)
    with pytest.raises(WattenCpuError, match="invalid_memory"):
        decide(table.view("B"), memory_to_storage(memory), seed=1)


def _three_player_bid(deal_id, deal, dealer, call, lead):
    table = Table(start_match(cpu_recipe(3), deal_id, deal, first_dealer="A"))
    if dealer != "A":
        table.ready()
        table.finish()
        table.next_deal(deal_id + "-next", deal)
    table.ready(*call)
    solo = table.state.play.current_player_id
    table.play(solo, lead)
    while table.state.play.current_player_id != solo:
        table.play(table.state.play.current_player_id)
    table.act(solo, "bid")
    return table, solo


def test_three_player_roles_rotate_and_only_the_actual_partner_advises_its_decider():
    deal = explicit_deal(
        ("hearts-7", "hearts-8", "leaves-7", "leaves-8", "bells-10"),
        ("acorns-9", "acorns-U", "acorns-O", "acorns-K", "acorns-A"),
        ("hearts-9", "hearts-10", "leaves-9", "leaves-10", "bells-9"),
    )
    table, solo = _three_player_bid("rotate", deal, "A", ("9", "acorns"), "acorns-9")
    assert solo == "B" and table.state.bid_state.pending is not None
    assert table.view("C")["bid"]["pending"]["decider"] == "A"
    advice = turn(table, "C")
    assert advice.kind == "partner_feedback" and advice.value in {"good", "bad", "unsure"}
    assert advice.private_opportunity == 0
    table.propose("C", advice)
    assert isinstance(turn(table, "C"), CpuWait)
    assert isinstance(turn(table, "B"), CpuWait)
    response = turn(table, "A")
    assert response.kind == "respond" and response.value in {"hold", "go", "counter"}
    table.propose("A", response)
    # Next deal: dealer B, solo C, partners B+A; C has no partner to advise.
    rotated = explicit_deal(
        ("hearts-7", "hearts-8", "acorns-7", "acorns-8", "bells-10"),
        ("hearts-9", "hearts-10", "acorns-9", "acorns-10", "bells-9"),
        ("leaves-8", "leaves-U", "leaves-O", "leaves-K", "leaves-A"),
    )
    table, solo = _three_player_bid("rotate-2", rotated, "B", ("8", "leaves"), "leaves-8")
    assert solo == "C" and table.view("A")["bid"]["pending"]["decider"] == "B"
    assert "partner_feedback" not in table.view("C")["actions"]
    assert isinstance(turn(table, "C"), CpuWait)
    advice = turn(table, "A")
    assert advice.kind == "partner_feedback"
    table.propose("A", advice)
    assert turn(table, "B").kind == "respond"


def _with_points(state, winner, points):
    """Real two-player engine state whose ledger already holds earlier scored deals."""
    payload = storage_payload(state)
    roles = {"seats": ["A", "B"], "dealer_id": "A", "parties": [["A"], ["B"]]}
    payload["ledger"]["applied_results"] = [
        {"deal_id": f"old-{index}", "roles": roles, "winning_party": "AB".index(winner), "points": stake,
         "reason": "tricks"} for index, stake in enumerate(points)]
    for account in payload["ledger"]["accounts"]:
        account["points"] = sum(points) if account["members"] == [winner] else 0
    return restore_storage(payload)


@pytest.mark.parametrize("opponent_points", ((), (2, 3, 3)))
def test_score_aware_response_goes_when_hopeless_but_never_concedes_the_match_by_going(opponent_points):
    # A cannot beat the led hearts-9, so every sampled world loses: the win chance is exactly zero.
    deal = explicit_deal(
        ("hearts-7", "bells-7", "acorns-9", "acorns-8", "bells-8"),
        ("hearts-U", "bells-U", "hearts-9", "leaves-A", "leaves-U"),
    )
    table = Table(_with_points(start_match(cpu_recipe(2), "stake", deal, first_dealer="A"), "B", opponent_points))
    table.ready("U", "leaves")
    for lead, answer in (("hearts-U", "hearts-7"), ("bells-U", "bells-7")):
        table.play("B", lead)
        table.play("A", answer)
    table.play("B", "hearts-9")
    table.act("A", "bid")
    table.act("B", "respond", "counter")
    view = table.view("A")
    assert view["bid"]["accepted_stake"] == 3 and view["bid"]["pending"]["decider"] == "A"
    decision = turn(table, "A", budget=CpuBudget(24))
    assert decision.kind == "respond"
    assert (decision.value == "go") == (not opponent_points)
    table.propose("A", decision)


def test_gestrichen_cpu_never_opens_but_may_still_answer_a_bid():
    deal = explicit_deal(
        ("hearts-7", "bells-7", "hearts-10", "acorns-8", "bells-8"),
        ("hearts-U", "bells-U", "hearts-9", "leaves-A", "leaves-U"),
    )
    table = Table(_with_points(start_match(cpu_recipe(2), "struck", deal, first_dealer="A"), "A", (3, 3, 3)))
    table.ready("U", "leaves")
    table.play("B", "hearts-9")
    table.play("A", "hearts-10")
    view = table.view("A")
    assert "bid" not in view["actions"] and "play_card" in view["actions"]
    assert turn(table, "A").kind == "play_card"
    table = Table(_with_points(start_match(cpu_recipe(2), "struck-2", deal, first_dealer="A"), "A", (3, 3, 3)))
    table.ready("U", "leaves")
    table.play("B", "hearts-U")
    table.play("A", "hearts-7")
    table.act("B", "bid")
    decision = turn(table, "A")
    assert decision.kind == "respond"
    table.propose("A", decision)


def test_cpu_names_are_stable_unique_and_skip_human_identities():
    assert len(WATTEN_CPU_NAMES) == len({name.casefold() for name in WATTEN_CPU_NAMES}) >= 8
    assert available_cpu_names() == WATTEN_CPU_NAMES
    remaining = available_cpu_names([" seppl", "TONI", 42])
    assert "Seppl" not in remaining and "Toni" not in remaining and len(remaining) == len(WATTEN_CPU_NAMES) - 2


def test_proposals_encode_engine_commands_not_view_action_names():
    with pytest.raises(WattenCpuError):
        CpuProposal("A", "deal", 1, "bid_response", "respond_hold")
    with pytest.raises(WattenCpuError):
        CpuProposal("A", "deal", 1, "bid_response", "respond", "respond_hold")
    with pytest.raises(WattenCpuError):
        CpuProposal("A", "deal", 1, "play", "partner_feedback", "good")
    proposal = CpuProposal("A", "deal", 1, "play", "partner_feedback", "good", 0)
    assert EngineCommand(**proposal.command_fields()).kind == "partner_feedback"
    assert "good" not in repr(proposal)


@pytest.mark.parametrize("count", (2, 4))
def test_small_paired_seeded_comparison_against_simple_legal_baseline(count):
    """Tiny fixed sample: same deals, swapped seats. Not evidence of general strength."""
    totals = {"policy": 0, "baseline": 0}
    for deal_seed in range(4):
        for policy_party in (0, 1):
            recipe = cpu_recipe(count)
            state = start_match(recipe, f"paired-{deal_seed}-{policy_party}", shuffled_deal(count, 100 + deal_seed),
                                first_dealer="A")
            seats = {player for player in recipe.seats if state.parties.party_of(player) == policy_party}
            table = Table(state)
            run_cpus(table, seed=deal_seed, budget=CpuBudget(8), policy_seats=seats)
            result = table.state.bid_state.result
            totals["policy" if result.winning_party == policy_party else "baseline"] += result.points
    # Recorded with ``-s`` for review; eight paired deals cannot establish general strength.
    print(f"paired {count}p points: {totals}")
    assert sum(totals.values()) >= 2 * 8


@pytest.mark.parametrize("blind", (False, True))
def test_partner_cover_preference_conserves_a_strike_when_safe_and_covers_sampled_later_threats(blind):
    deal = explicit_deal(
        ("hearts-10", "hearts-U", "hearts-K", "leaves-A", "bells-8"),
        ("bells-K", "hearts-7", "leaves-U", "acorns-A", "hearts-9"),
        ("hearts-8", "leaves-8", "acorns-8", "leaves-K", "acorns-10"),
        ("acorns-9", "leaves-7", "leaves-10", "acorns-O", "hearts-O"),
    )
    table = Table(start_match(cpu_recipe(4, "ladinisch" if blind else "normal", blind),
                              "partner-cover", deal, first_dealer="A"))
    table.ready("9", "bells")
    table.play("B", "bells-K")
    table.play("C", "hearts-8")
    view, memory = table.view("D"), table.memories["D"]
    ctx = cpu_policy._prepare(view, memory, ())
    model = ctx.model("9", "bells")
    # These are explicit hypothetical worlds for the narrow tie preference,
    # supplied without reading any opponent engine hand in the policy.
    safe = (("hearts-10", "hearts-U", "hearts-K", "leaves-A", "bells-8"), (), (), ctx.hand)
    threatened = (("bells-A", *safe[0][1:]), (), (), ctx.hand)
    preference = cpu_policy._partner_cover_preference
    weak, strong = "leaves-7", "acorns-9"
    assert preference(ctx, weak, [(model, safe)], CpuSkill()) > preference(ctx, strong, [(model, safe)], CpuSkill())
    assert preference(ctx, strong, [(model, threatened)], CpuSkill()) > preference(ctx, weak, [(model, threatened)], CpuSkill())
    assert (ctx.memory.strike, ctx.memory.suit) == ((None, None) if blind else ("9", "bells"))

