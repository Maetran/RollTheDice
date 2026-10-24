"""Narrow adaptive CPU decisions and failure-safe account experience."""

from __future__ import annotations

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy.exc import SQLAlchemyError

from app.zilch_cpu_strategy import (
    ZILCH_CPU_BASELINE_POLICY,
    ZILCH_CPU_CONTINUATION_POLICY,
    CpuQuickHoldOption,
    CpuStrategyContext,
    choose_zilch_cpu_decision,
)
from app.zilch_engine import new_zilch_turn, options_for_turn, roll_zilch_turn, select_zilch_option
from app.zilch_statistics import zilch_cpu_completed_experience


def witness_context(*, strategy="normal", gap=0, remaining=(1, 5, 2, 3)):
    values = iter((1, 1, 2, 3, 4, 6, *remaining))

    def rng(_low, _high):
        return next(values)

    turn, _evaluation = roll_zilch_turn(new_zilch_turn("cpu", turn_id=1, round_number=1), randint_fn=rng)
    two = next(option for option in options_for_turn(turn) if option.points == 200)
    turn = select_zilch_option(turn, two.option_id).turn
    turn, _evaluation = roll_zilch_turn(turn, randint_fn=rng)
    options = tuple(CpuQuickHoldOption(
        option_id=option.option_id, combination_type=option.combination_type, points=option.points,
        dice_indices=option.dice_indices, all_available_dice=option.all_available_dice,
        hot_dice=option.hot_dice, free_roll=option.free_roll,
        requires_confirmation=option.requires_confirmation, dice_values=option.dice_values,
    ) for option in options_for_turn(turn))
    return CpuStrategyContext(
        strategy=strategy, own_total=2_000, opponent_total=2_000 + gap, target_score=10_000,
        round_points=turn.round_points, available_dice_count=4, confirmation_required=False,
        hot_dice=False, final_round=False, needed_to_beat=None, quick_holds=options,
        can_roll=False, can_bank=False, policy=ZILCH_CPU_CONTINUATION_POLICY,
        rolls_used=turn.rolls_used, available_dice=tuple((index, turn.dice[index]) for index in turn.available_indices),
    )


def points(context):
    return choose_zilch_cpu_decision(context).reason_params["points"]


def test_only_the_six_dominant_cells_choose_one_instead_of_one_plus_five():
    expected = {"conservative": (100, 100, 100), "normal": (100, 100, 150), "aggressive": (100, 150, 150)}
    for strategy, choices in expected.items():
        for gap, choice in zip((-1_200, 0, 1_200), choices, strict=True):
            context = witness_context(strategy=strategy, gap=gap)
            assert points(context) == choice
            assert points(replace(context, policy=ZILCH_CPU_BASELINE_POLICY)) == 150
            assert points(replace(context, policy="future-unknown-policy")) == 150


def test_exact_gap_and_target_boundaries_are_preserved():
    assert points(witness_context(strategy="normal", gap=1_199)) == 100
    assert points(witness_context(strategy="normal", gap=1_200)) == 150
    assert points(witness_context(strategy="aggressive", gap=-1_200)) == 100
    assert points(witness_context(strategy="aggressive", gap=-1_199)) == 150
    context = witness_context()
    assert points(replace(context, own_total=8_200, opponent_total=8_200)) == 100
    assert points(replace(context, own_total=8_201, opponent_total=8_201)) == 150


def test_unsupported_state_facts_are_exactly_the_baseline():
    context = witness_context()
    cases = (
        {"rolls_used": 1}, {"rolls_used": 3}, {"rolls_used": True}, {"round_points": 150},
        {"available_dice_count": 5}, {"confirmation_required": True}, {"hot_dice": True},
        {"final_round": True}, {"needed_to_beat": 10_000}, {"can_roll": True}, {"can_bank": True},
        {"available_dice": ()}, {"available_dice": list(context.available_dice)},
        {"available_dice": ((0, 1), (0, 5), (2, 2), (3, 3))},
        {"available_dice": ((0, 1), (1, 1), (2, 2), (3, 3))},
        {"available_dice": ((0, 1), (1, 5), (2, True), (3, 3))},
    )
    for overrides in cases:
        candidate = replace(context, **overrides)
        assert choose_zilch_cpu_decision(candidate) == choose_zilch_cpu_decision(
            replace(candidate, policy=ZILCH_CPU_BASELINE_POLICY))


def test_mismatched_options_cannot_enter_the_tactic():
    context = witness_context()
    for overrides in ({"requires_confirmation": True}, {"dice_values": (6,)}, {"dice_values": (True,)},
                      {"dice_values": (1.0,)},
                      {"combination_type": "unsupported"}, {"dice_indices": [2]}):
        options = tuple(replace(option, **overrides) if option.points == 100 else option
                        for option in context.quick_holds)
        candidate = replace(context, quick_holds=options)
        assert choose_zilch_cpu_decision(candidate) == choose_zilch_cpu_decision(
            replace(candidate, policy=ZILCH_CPU_BASELINE_POLICY))
    for options in (context.quick_holds[:2], (*context.quick_holds, context.quick_holds[0]),
                    tuple(replace(option, option_id="duplicate") for option in context.quick_holds)):
        candidate = replace(context, quick_holds=options)
        assert choose_zilch_cpu_decision(candidate) == choose_zilch_cpu_decision(
            replace(candidate, policy=ZILCH_CPU_BASELINE_POLICY))


def test_every_permutation_and_nonscoring_pair_keeps_the_actual_one():
    for first in (2, 3, 4, 6):
        for second in (2, 3, 4, 6):
            for remaining in ((1, 5, first, second), (second, 1, first, 5), (5, second, 1, first)):
                context = witness_context(remaining=remaining)
                decision = choose_zilch_cpu_decision(context)
                selected = next(option for option in context.quick_holds if option.option_id == decision.option_id)
                assert (selected.points, selected.dice_values, len(selected.dice_indices)) == (100, (1,), 1)


def test_policy_never_consumes_randomness():
    context = witness_context()
    with patch("app.zilch_engine.secrets.randbelow", side_effect=AssertionError("No policy RNG")):
        assert choose_zilch_cpu_decision(context) == choose_zilch_cpu_decision(context)


def test_experience_is_distinct_completed_only_capped_and_closes_early():
    closed = []

    def records(**_kwargs):
        try:
            for game_id, status, active in [("abandoned", "abandoned", True), ("inactive", "completed", False),
                                            ("same", "completed", True), ("same", "completed", True)]:
                yield SimpleNamespace(game_id=game_id, payload={"outcome": {"status": status}}, user_is_active=active)
            for index in range(9):
                yield SimpleNamespace(game_id=str(index), payload={"outcome": {"status": "completed"}}, user_is_active=True)
            raise AssertionError("Must stop at ten valid completions")
        finally:
            closed.append(True)

    with patch("app.zilch_statistics.database_schema_ready", return_value=True), \
            patch("app.zilch_statistics._iter_player_results", side_effect=records):
        assert zilch_cpu_completed_experience(7) == 10
    assert closed == [True]


def test_guest_and_failed_experience_reads_do_not_claim_success(caplog):
    with patch("app.zilch_statistics._iter_player_results", side_effect=SQLAlchemyError("offline")) as source, \
            patch("app.zilch_statistics.database_schema_ready", return_value=True):
        for guest in (None, 0, False, "7"):
            assert zilch_cpu_completed_experience(guest) == 0
        source.assert_not_called()
        assert zilch_cpu_completed_experience(7) == 0
    assert "experience lookup failed; using baseline" in caplog.text


def test_partial_or_unavailable_experience_is_not_reported_as_a_success(caplog):
    closed = []

    def records(**_kwargs):
        try:
            yield SimpleNamespace(game_id="valid", payload={"outcome": {"status": "completed"}}, user_is_active=True)
            raise SQLAlchemyError("Read failed after a partial page")
        finally:
            closed.append(True)

    with patch("app.zilch_statistics.database_schema_ready", return_value=True), \
            patch("app.zilch_statistics._iter_player_results", side_effect=records):
        assert zilch_cpu_completed_experience(7) == 0
    assert closed == [True]
    assert "experience lookup failed; using baseline" in caplog.text
    with patch("app.zilch_statistics.database_schema_ready", return_value=False), \
            patch("app.zilch_statistics._iter_player_results", side_effect=AssertionError("No schema")):
        assert zilch_cpu_completed_experience(7) == 0
    assert "experience history unavailable; using baseline" in caplog.text
