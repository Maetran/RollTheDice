"""Median of existing difficulty profiles, without raw-count outlier inflation."""

from dataclasses import fields
from itertools import permutations, product

import pytest

from app.watten_cpu_skill import CpuSkill, skill_for_completed_games, skill_for_table

TIERS = (0, 10, 30, 75)


@pytest.mark.parametrize("completed", [0, 1, 9, 10, 29, 30, 74, 75, 1_000_000])
def test_single_human_preserves_all_existing_tier_boundaries(completed):
    assert skill_for_table([completed]) == skill_for_completed_games(completed)


def test_empty_table_keeps_the_existing_beginner_profile():
    assert skill_for_table(()) == skill_for_completed_games(0)


def test_outlier_is_capped_before_the_two_middle_profiles_are_averaged():
    result = skill_for_table([0, 1000])
    assert result.samples == 40
    assert result.confidence == pytest.approx(0.84)
    assert result.near_best == pytest.approx(0.046)
    assert result.partnership == pytest.approx(0.0265)
    assert result.bid_minimum == pytest.approx(0.67)
    assert skill_for_table([0, 20, 1000]) == skill_for_completed_games(20)
    assert skill_for_table([0, 0, 1000]) == skill_for_completed_games(0)


@pytest.mark.parametrize("left, right", tuple(product(TIERS, repeat=2)))
def test_every_pair_stays_within_existing_bounds_with_integer_samples(left, right):
    result = skill_for_table([left, right])
    first, second = skill_for_completed_games(left), skill_for_completed_games(right)
    assert type(result.samples) is int and 1 <= result.samples <= 64
    # All present tiers have even sample budgets. A new incompatible tier must
    # make its rounding contract explicit instead of silently truncating here.
    assert (first.samples + second.samples) % 2 == 0
    for field in fields(CpuSkill):
        assert getattr(result, field.name) == pytest.approx(
            (getattr(first, field.name) + getattr(second, field.name)) / 2)


def test_profile_parameters_remain_monotonic_so_the_median_is_coherent():
    profiles = [skill_for_completed_games(tier) for tier in TIERS]
    for field in fields(CpuSkill):
        values = [getattr(profile, field.name) for profile in profiles]
        assert values == sorted(values, reverse=field.name in {"near_best", "bid_minimum"})
        assert len(set(values)) == len(values)


def test_player_order_never_changes_the_profile():
    expected = skill_for_table(TIERS)
    assert all(skill_for_table(order) == expected for order in permutations(TIERS))


def test_more_experience_never_reverses_any_difficulty_parameter():
    profiles = [skill_for_table([0, completed, 75]) for completed in range(101)]
    for field in fields(CpuSkill):
        values = [getattr(profile, field.name) for profile in profiles]
        assert values == sorted(values, reverse=field.name in {"near_best", "bid_minimum"})


@pytest.mark.parametrize("invalid", [-1, 0.5, True, "10"])
def test_invalid_experience_still_fails_closed(invalid):
    with pytest.raises(ValueError, match="watten_cpu_invalid_experience"):
        skill_for_table([0, invalid])
