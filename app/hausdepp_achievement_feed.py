"""Signed-in Hausdepp timeline of the newest achievement unlocks."""

from __future__ import annotations

from typing import Final

from sqlalchemy import func, select

from .achievement_feed import (
    ACHIEVEMENT_FEED_PAGE_SIZE,
    AchievementDifficulty,
    _feed_envelope,
    _normalize_feed_request,
)
from .database import database_schema_ready, session_scope
from .hausdepp_achievements import ACHIEVEMENTS
from .models import HausdeppAchievementUnlock, User
from .security import as_utc


def _hausdepp_difficulty(points: int) -> AchievementDifficulty:
    """Map the one-time XP awards (10, 25, 50, 100) to the shared three bands."""

    if points == 10:
        return "easy"
    if points == 25:
        return "medium"
    if points in (50, 100):
        return "hard"
    raise RuntimeError(f"Hausdepp achievement needs a feed difficulty: {points}")


HAUSDEPP_FEED_DEFINITIONS: Final[dict[str, dict]] = {item["id"]: item for item in ACHIEVEMENTS}
HAUSDEPP_ACHIEVEMENT_DIFFICULTIES: Final[dict[str, AchievementDifficulty]] = {
    item["id"]: _hausdepp_difficulty(item["points"]) for item in ACHIEVEMENTS
}


def list_hausdepp_achievement_feed(
    viewer_id: int,
    *,
    page: int = 1,
    difficulty: AchievementDifficulty | None = None,
) -> dict[str, object]:
    """Return active accounts' newest Hausdepp awards, 20 at a time.

    Like the Hausdepp standings, only current account names leave this service:
    no account IDs, avatars, source rounds, cards, co-players or XP totals.
    Computers never hold unlock rows, so they cannot appear.
    """

    if type(viewer_id) is not int or viewer_id < 1:
        raise ValueError("hausdepp_invalid_user")
    page, difficulty = _normalize_feed_request(page, difficulty)
    keys = tuple(key for key, value in HAUSDEPP_ACHIEVEMENT_DIFFICULTIES.items()
                 if difficulty is None or value == difficulty)
    if not database_schema_ready():
        return _feed_envelope(items=[], page=page, total=0, difficulty=difficulty)
    offset = (page - 1) * ACHIEVEMENT_FEED_PAGE_SIZE
    criteria = (User.is_active.is_(True), HausdeppAchievementUnlock.achievement_id.in_(keys))
    with session_scope() as db:
        total = int(db.scalar(
            select(func.count())
            .select_from(HausdeppAchievementUnlock)
            .join(User, User.id == HausdeppAchievementUnlock.user_id)
            .where(*criteria)
        ) or 0)
        if offset >= total:
            return _feed_envelope(items=[], page=page, total=total, difficulty=difficulty)
        rows = db.execute(
            select(
                HausdeppAchievementUnlock.achievement_id,
                HausdeppAchievementUnlock.unlocked_at,
                User.id.label("user_id"),
                User.username,
            )
            .join(User, User.id == HausdeppAchievementUnlock.user_id)
            .where(*criteria)
            .order_by(
                HausdeppAchievementUnlock.unlocked_at.desc(),
                HausdeppAchievementUnlock.user_id.desc(),
                HausdeppAchievementUnlock.achievement_id.desc(),
            )
            .offset(offset)
            .limit(ACHIEVEMENT_FEED_PAGE_SIZE)
        ).all()

    items: list[dict[str, object]] = []
    for row in rows:
        definition = HAUSDEPP_FEED_DEFINITIONS[row.achievement_id]
        items.append({
            "unlocked_at": as_utc(row.unlocked_at).isoformat(),
            "player": {"display_name": str(row.username), "is_self": int(row.user_id) == viewer_id},
            "achievement": {
                "id": definition["id"],
                "name": dict(definition["name"]),
                "description": dict(definition["description"]),
                "category": definition["category"],
                "points": int(definition["points"]),
                "difficulty": HAUSDEPP_ACHIEVEMENT_DIFFICULTIES[definition["id"]],
            },
        })
    return _feed_envelope(items=items, page=page, total=total, difficulty=difficulty)
