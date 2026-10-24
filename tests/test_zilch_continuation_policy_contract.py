"""Exact baseline evidence must continue to justify every runtime override.

Die neun exakten Zellen tragen die Freigabe der sechs Runtime-Zellen. Ändert
sich die Baseline, muss dieser Vertrag die Entscheidung erneut absichern.
No match-strength claim or random simulation is part of this contract.
"""

from app.zilch_cpu_strategy import _CONTINUATION_CELLS, choose_zilch_cpu_decision
from app.zilch_engine import apply_zilch_streak
from scripts.zilch_continuation_probe import GAPS, PROFILES, VALIDATION_CONTRACT, exact_values
from tests.test_zilch_cpu_adaptation import witness_context


def test_all_nine_exact_cells_match_the_runtime_continuation_policy():
    # Net value is affine in actual loss. These real engine endpoints therefore
    # cover every clamped loss between zero and the third-Zilch penalty.
    losses = [2_000 - apply_zilch_streak(2_000, streak)[0] for streak in (0, 2)]
    assert losses == VALIDATION_CONTRACT["net_gain_must_clear_threshold_at_penalty_endpoints"]
    eligible, selected, evidence = set(), set(), {}
    for strategy in PROFILES:
        for position, gap in GAPS.items():
            cell = strategy, position
            alternative, baseline = exact_values(strategy, gap, lambda: None)
            gains = tuple(alternative.net(2_000, streak) - baseline.net(2_000, streak) for streak in (0, 2))
            bust_delta = alternative.bust_probability - baseline.bust_probability
            evidence[cell] = {"net_gains": gains, "whole_turn_bust_delta": bust_delta}
            if min(gains) >= VALIDATION_CONTRACT["minimum_exact_net_gain_points"] and bust_delta < 0:
                eligible.add(cell)

            # This context comes from actual legal engine rolls and options,
            # with the versioned runtime policy enabled and no hand-built holds.
            context = witness_context(strategy=strategy, gap=gap)
            decision = choose_zilch_cpu_decision(context)
            assert decision.action == "select_hold"
            option = next(option for option in context.quick_holds if option.option_id == decision.option_id)
            assert (option.points, option.dice_values) in {(100, (1,)), (150, (1, 5))}
            if option.points == 100:
                selected.add(cell)

    assert eligible == _CONTINUATION_CELLS, evidence
    assert selected == eligible, evidence
