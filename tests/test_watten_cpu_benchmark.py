"""Regressions for the standalone CPU measurement harness, not strength claims."""

from types import SimpleNamespace

import pytest

from app.watten_cpu import CpuBudget, CpuTurn, CpuWait
from app.watten_cpu_skill import skill_for_completed_games
from app.watten_engine import EngineActor, EngineCommand, apply_command, start_match
from app.watten_play import PlayProfile
from app.watten_rules import ComparisonRules, WattenCall
from app.watten_views import cpu_view
from tests import watten_cpu_benchmark as harness
from tests.watten_cpu_benchmark import Measurements, baseline, card_schedule, recipe_for, run_deal


def test_measurement_passes_selected_experience_to_policy(monkeypatch):
    skill = skill_for_completed_games(75)
    observed = {}

    def decide(view, memory, *, seed, budget, skill):
        observed.update(seed=seed, budget=budget, skill=skill)
        return CpuTurn(memory, CpuWait("deal", 1, "playing", "waiting"))

    monkeypatch.setattr(harness, "decide", decide)
    budget = CpuBudget(skill.samples)
    Measurements().policy({}, None, 42, budget, skill)
    assert observed == {"seed": 42, "budget": budget, "skill": skill}


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


def test_measurement_counts_partner_overtake_only_when_a_lower_legal_card_exists(monkeypatch):
    parties = SimpleNamespace(seats=("A", "B", "C", "D"), parties=(("A", "C"), ("B", "D")),
                              party_of=lambda player: 0 if player in ("A", "C") else 1)
    play = SimpleNamespace(trick_cards=("hearts-7", "bells-8"), trick_leader=0,
                           profile=PlayProfile(4, "normal", False, False), parties=parties,
                           rules=ComparisonRules(WattenCall("9", "acorns"), critical=False))
    state = SimpleNamespace(play=play, bid_state=None)
    measured = Measurements()
    monkeypatch.setattr(harness, "legal_cards", lambda *_: ("hearts-8", "leaves-8"))
    harness._record_tactics(state, "C", SimpleNamespace(kind="play_card", value="hearts-8"), measured, {"A", "C"})
    assert measured.tactics == {"partner_winning_choices": 1, "partner_overtakes": 1,
                                "partner_overtakes_with_alternative": 1}
    harness._record_tactics(state, "C", SimpleNamespace(kind="play_card", value="leaves-8"), measured, {"A", "C"})
    assert measured.tactics["partner_winning_choices"] == 2
    assert measured.tactics["partner_overtakes"] == 1


def test_measurement_records_blind_partner_restricted_by_policy_trump_lead(monkeypatch):
    parties = SimpleNamespace(seats=("A", "B", "C", "D"), parties=(("A", "C"), ("B", "D")),
                              party_of=lambda player: 0 if player in ("A", "C") else 1)
    play = SimpleNamespace(trick_cards=("acorns-8", "leaves-8"), trick_leader=0, current_seat=2,
                           knower_seats={1, 2}, hands=((), (), ("acorns-7", "hearts-7"), ()),
                           profile=PlayProfile(4, "ladinisch", True, False), parties=parties,
                           rules=ComparisonRules(WattenCall("9", "acorns"), critical=False))
    state = SimpleNamespace(play=play, bid_state=None)
    monkeypatch.setattr(harness, "legal_cards", lambda *_: ("acorns-7",))
    measured = Measurements()
    harness._record_tactics(state, "C", SimpleNamespace(kind="play_card", value="acorns-7"), measured, {"A", "C"})
    assert measured.tactics["blind_policy_trump_lead_restricted_partner"] == 1
