"""Regressions for the standalone CPU measurement harness, not strength claims."""

import pytest

from app.watten_cpu import CpuBudget
from app.watten_engine import EngineActor, EngineCommand, apply_command, start_match
from app.watten_play import PlayProfile
from app.watten_views import cpu_view
from tests.watten_cpu_benchmark import Measurements, baseline, card_schedule, recipe_for, run_deal


def test_benchmark_baseline_declines_real_optional_request():
    profile = PlayProfile(4, "ladinisch", True, False)
    recipe = recipe_for(profile)
    deal, _ = card_schedule(0, 4)
    state = start_match(recipe, "benchmark-consent", deal, first_dealer="A")
    request = EngineCommand("request", state.deal_id, state.opportunity, state.phase, "request_bloedeln")
    state = apply_command(state, EngineActor("C", None), request).state
    decision = baseline(cpu_view(state, player_id="D"), ())
    assert decision.kind == "preplay_decline"
    changed = apply_command(state, EngineActor("D", None), EngineCommand(**decision.command_fields())).state
    assert changed.preplay_request is None and not changed.bloedeln


@pytest.mark.parametrize(("critical", "seed", "dealer", "policy_party"), (
    (False, 0, 1, 0),
    (False, 1, 3, 1),
    (True, 1, 2, 0),
    (True, 1, 2, 1),
))
def test_benchmark_blind_deals_do_not_stall_on_baseline_consent(critical, seed, dealer, policy_party):
    profile = PlayProfile(4, "ladinisch", True, critical)
    deal, _ = card_schedule(seed, 4)
    measured = Measurements()
    outcome = run_deal(profile, seed, dealer, policy_party, deal, 240, CpuBudget(), measured)
    assert outcome["status"] == "complete"
    assert measured.accepted["baseline:preplay_decline"] == 1
