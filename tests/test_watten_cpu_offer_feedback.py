"""A CPU decider answers an offer to its team only after its partner's signal.

The partner here acts through plain engine commands, exactly like a human at
the table; only the deciding seat runs the CPU policy on its own DTO.
"""

import pytest

import app.watten_cpu as cpu_policy
from app import watten_cpu_runtime as runner
from app.watten_cpu import CpuBudget, CpuWait, decide
from app.watten_engine import start_match
from tests.test_watten_cpu import shuffled_deal
from tests.test_watten_cpu_memory import Table, cpu_recipe
from tests.test_watten_engine import dealt

FAST = CpuBudget(6)
WAITING = "watten_cpu_partner_feedback_waiting"


def decision(table, player, budget=FAST):
    result = decide(table.view(player), table.memories[player], seed=3, budget=budget)
    table.memories[player] = result.memory
    return result.decision


def offered_team(blind, deal_id="offer"):
    """The first card player offers; returns the table, our decider and our partner."""
    recipe = cpu_recipe(4, "ladinisch", True) if blind else cpu_recipe(4, target_points=15)
    table = Table(start_match(recipe, deal_id, shuffled_deal(4, 9) if blind else dealt(4), first_dealer="A"))
    table.ready("7", "bells")
    table.act(table.state.play.current_player_id, "bid")
    party = 1 - table.state.bid_state.pending.party
    decider = table.state.parties.decider(party)
    partner = next(player for player in table.state.parties.parties[party] if player != decider)
    return table, decider, partner


def own_advice_first(table, decider):
    """In open play the decider may first advise its partner; that is never blocked."""
    if "partner_feedback" in table.view(decider)["actions"]:
        advice = decision(table, decider)
        assert advice.kind == "partner_feedback"
        table.propose(decider, advice)


def scheduler_waits(table, player):
    return runner._partner_feedback_pending(table.view(player), player)


@pytest.mark.parametrize("blind", (False, True))
def test_decider_waits_for_its_partners_signal_and_then_uses_it(blind):
    table, decider, partner = offered_team(blind)
    assert ("partner_feedback" in table.view(decider)["actions"]) == (not blind)
    own_advice_first(table, decider)
    waiting = decision(table, decider)
    assert isinstance(waiting, CpuWait) and waiting.reason == WAITING
    assert scheduler_waits(table, decider)
    # The partner's dialog remains available, including its private opportunity.
    assert "partner_feedback" in table.view(partner)["actions"]
    opportunity = table.state.opportunity
    table.act(partner, "partner_feedback", "unsure")
    assert table.state.opportunity == opportunity  # private: no public opportunity
    assert table.memories[decider].opportunity == opportunity
    assert not scheduler_waits(table, decider)
    response = decision(table, decider)
    assert response.kind == "respond" and response.value in {"hold", "go", "counter"}
    table.propose(decider, response)


def test_a_returning_counteroffer_asks_the_partner_again():
    table, decider, partner = offered_team(False, "counter")
    own_advice_first(table, decider)
    table.act(partner, "partner_feedback", "good")
    table.act(decider, "respond", "counter")
    opponent = table.state.parties.decider(1 - table.state.bid_state.pending.party)
    assert opponent not in {decider, partner}
    table.act(opponent, "respond", "counter")
    # The offer is back with our team: the old signal is cleared, a new one is due.
    assert table.view(decider)["feedback"] == []
    assert "partner_feedback" in table.view(partner)["actions"]
    own_advice_first(table, decider)
    assert decision(table, decider).reason == WAITING
    table.act(partner, "partner_feedback", "bad")
    assert decision(table, decider).kind == "respond"


@pytest.mark.parametrize("count", (2, 3))
def test_seats_without_a_partner_never_wait(count):
    table = Table(start_match(cpu_recipe(count), "solo", dealt(count), first_dealer="A"))
    table.ready("7", "bells")
    if count == 3:
        table.play(table.state.play.current_player_id)  # the solo leads; a pair member offers
    table.act(table.state.play.current_player_id, "bid")
    decider = table.state.parties.decider(1 - table.state.bid_state.pending.party)
    assert len(table.state.parties.parties[table.state.parties.party_of(decider)]) == 1
    assert not scheduler_waits(table, decider)
    assert decision(table, decider).kind == "respond"


# Each row is a fixed own estimate where exactly the partner's signal decides.
BORDERS = (
    (0.10, {"good": "hold", "unsure": "go", "bad": "go"}),
    (0.20, {"good": "hold", "unsure": "hold", "bad": "go"}),
    (0.86, {"good": "counter", "unsure": "hold", "bad": "hold"}),
    (0.96, {"good": "counter", "unsure": "counter", "bad": "hold"}),
)


@pytest.mark.parametrize(("chance", "expected"), BORDERS)
def test_partner_signal_changes_the_answer_at_the_border(monkeypatch, chance, expected):
    monkeypatch.setattr(cpu_policy, "_win_chance", lambda *_args: (chance, 24))
    answers = {}
    for feeling in ("good", "unsure", "bad"):
        table, decider, partner = offered_team(False, f"border-{feeling}")
        own_advice_first(table, decider)
        table.act(partner, "partner_feedback", feeling)
        answer = decision(table, decider, CpuBudget(24))
        assert answer.kind == "respond"
        answers[feeling] = answer.value
    assert answers == expected
