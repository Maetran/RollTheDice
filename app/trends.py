from __future__ import annotations

from collections.abc import Iterable

TREND_WINDOW_SIZE = 3


def recent_points_trend(
    points: Iterable[int],
    *,
    games_played: int,
    points_total: int,
    window_size: int = TREND_WINDOW_SIZE,
) -> dict:
    """Compare the latest score window with the average for the same mode."""
    recent_points = [int(value) for value in points][:window_size]
    sample_size = len(recent_points)
    result = {
        "trend": None,
        "trend_games": sample_size,
        "recent_average_points": round(sum(recent_points) / sample_size, 1) if sample_size else None,
    }
    games_played = max(0, int(games_played or 0))
    if sample_size < window_size or games_played < window_size:
        return result

    # Cross multiplication avoids rounding differences between the two averages.
    recent_total = sum(recent_points)
    comparison = recent_total * games_played - int(points_total or 0) * sample_size
    result["trend"] = "up" if comparison > 0 else "down" if comparison < 0 else "same"
    return result
