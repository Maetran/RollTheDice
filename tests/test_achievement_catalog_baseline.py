"""The 4.5 public currencies and absolute ranks survive append-only goals."""

import json
from pathlib import Path

import pytest

from app.achievements import ACHIEVEMENT_POINTS_POSSIBLE, ACHIEVEMENT_RANKS, ACHIEVEMENTS, achievement_rank_for_points
from app.zilch_achievements import (
    ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
    ZILCH_ACHIEVEMENT_RANKS,
    ZILCH_ACHIEVEMENTS,
    zilch_achievement_rank_for_points,
)

BASELINE = json.loads((Path(__file__).parent / "fixtures" / "achievement-4.5-baseline.json").read_text())


@pytest.mark.parametrize("game,catalog,ranks,points,rank_for,new", (
    ("zdwa", ACHIEVEMENTS, ACHIEVEMENT_RANKS, ACHIEVEMENT_POINTS_POSSIBLE, achievement_rank_for_points,
     {"lower_clean_sheet": 7, "top_equal_with_bonuses": 9}),
    ("zilch", ZILCH_ACHIEVEMENTS, ZILCH_ACHIEVEMENT_RANKS, ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
     zilch_achievement_rank_for_points, {"zilch.no_small_change": 6, "zilch.double_hot_dice_turn": 5}),
))
def test_append_only_catalog_retains_every_old_price_key_and_rank_boundary(game, catalog, ranks, points, rank_for, new):
    prices = {goal.key: goal.points for goal in catalog}
    old = BASELINE[game]
    assert {key: value for key, value in prices.items() if key not in new} == old["old_definition_prices"]
    assert {key: prices[key] for key in new} == new
    assert points == old["catalog_points"] + sum(new.values())
    thresholds = [(rank.key, rank.reference_minimum_points) for rank in ranks]
    assert thresholds == [tuple(item) for item in old["rank_thresholds"]]
    for index, (key, minimum) in enumerate(thresholds):
        assert rank_for(minimum)["key"] == key
        assert rank_for(minimum + 1)["key"] == key
        assert rank_for(minimum - 1)["key"] == thresholds[max(0, index - 1)][0]
    if game == "zilch":
        assert all(goal.definition_version == 1 for goal in catalog)
