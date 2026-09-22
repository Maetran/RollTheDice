"""Public, privacy-safe timelines of recently earned achievements."""

from __future__ import annotations

from typing import Final, Literal
from urllib.parse import quote

from sqlalchemy import and_, func, select

from .achievements import ACHIEVEMENTS, Achievement
from .database import session_scope
from .game_types import DEFAULT_GAME_TYPE
from .models import CompletedGame, GameParticipant, User, UserAchievement, ZilchAchievementUnlock
from .security import as_utc
from .zilch_achievements import ZILCH_ACHIEVEMENTS, ZilchAchievementDefinition

AchievementDifficulty = Literal["easy", "medium", "hard"]

ACHIEVEMENT_FEED_PAGE_SIZE: Final = 20
ACHIEVEMENT_DIFFICULTIES: Final[tuple[AchievementDifficulty, ...]] = ("easy", "medium", "hard")

_ZDWA_NON_EARNED_PREFIXES: Final = (
    "manual_solo_aborts_",
    "manual_multiplayer_aborts_",
)
_ZILCH_COMMUNITY_EASY_TARGETS: Final = frozenset({100, 500, 1_000})
_ZILCH_COMMUNITY_MEDIUM_TARGETS: Final = frozenset({5_000, 10_000, 25_000})
_ZILCH_COMMUNITY_HARD_TARGETS: Final = frozenset({50_000, 100_000})


def _points_difficulty(points: int) -> AchievementDifficulty:
    """Map the published one-to-ten scoring scale to three stable bands."""

    if 1 <= points <= 3:
        return "easy"
    if 4 <= points <= 6:
        return "medium"
    if 7 <= points <= 10:
        return "hard"
    raise ValueError(f"achievement points outside supported difficulty scale: {points}")


def _zdwa_definition_difficulty(definition: Achievement) -> AchievementDifficulty | None:
    # These zero-point rows are Fairplay reminders for abandoned games. They
    # are deliberately not presented as earned achievements or as a reward for
    # negative behaviour.
    if definition.key.startswith(_ZDWA_NON_EARNED_PREFIXES):
        if definition.points != 0:
            raise RuntimeError(f"ZDWA Fairplay reminder unexpectedly awards points: {definition.key}")
        return None
    try:
        return _points_difficulty(definition.points)
    except ValueError as exc:
        raise RuntimeError(f"ZDWA achievement needs a feed difficulty: {definition.key}") from exc


def _zilch_definition_difficulty(definition: ZilchAchievementDefinition) -> AchievementDifficulty:
    if definition.points:
        try:
            return _points_difficulty(definition.points)
        except ValueError as exc:
            raise RuntimeError(f"Zilch achievement needs a feed difficulty: {definition.key}") from exc
    if definition.criterion != "community_games" or definition.target is None:
        raise RuntimeError(f"Zero-point Zilch achievement needs an explicit feed difficulty: {definition.key}")
    if definition.target in _ZILCH_COMMUNITY_EASY_TARGETS:
        return "easy"
    if definition.target in _ZILCH_COMMUNITY_MEDIUM_TARGETS:
        return "medium"
    if definition.target in _ZILCH_COMMUNITY_HARD_TARGETS:
        return "hard"
    raise RuntimeError(f"Unknown Zilch community milestone difficulty: {definition.key}")


ZDWA_FEED_DEFINITIONS: Final[dict[str, Achievement]] = {
    definition.key: definition
    for definition in ACHIEVEMENTS
    if _zdwa_definition_difficulty(definition) is not None
}
ZDWA_ACHIEVEMENT_DIFFICULTIES: Final[dict[str, AchievementDifficulty]] = {
    key: difficulty
    for definition in ACHIEVEMENTS
    if (difficulty := _zdwa_definition_difficulty(definition)) is not None
    for key in (definition.key,)
}
ZILCH_FEED_DEFINITIONS: Final[dict[str, ZilchAchievementDefinition]] = {
    definition.key: definition for definition in ZILCH_ACHIEVEMENTS
}
ZILCH_ACHIEVEMENT_DIFFICULTIES: Final[dict[str, AchievementDifficulty]] = {
    definition.key: _zilch_definition_difficulty(definition) for definition in ZILCH_ACHIEVEMENTS
}


def _normalize_feed_request(
    page: int,
    difficulty: AchievementDifficulty | None,
) -> tuple[int, AchievementDifficulty | None]:
    if type(page) is not int or page < 1:
        raise ValueError("achievement_feed_invalid_page")
    if difficulty is not None and difficulty not in ACHIEVEMENT_DIFFICULTIES:
        raise ValueError("achievement_feed_invalid_difficulty")
    return page, difficulty


def _keys_for_difficulty(
    difficulties: dict[str, AchievementDifficulty],
    difficulty: AchievementDifficulty | None,
) -> tuple[str, ...]:
    return tuple(
        key for key, definition_difficulty in difficulties.items()
        if difficulty is None or definition_difficulty == difficulty
    )


def _feed_envelope(
    *,
    items: list[dict[str, object]],
    page: int,
    total: int,
    difficulty: AchievementDifficulty | None,
) -> dict[str, object]:
    pages = (total + ACHIEVEMENT_FEED_PAGE_SIZE - 1) // ACHIEVEMENT_FEED_PAGE_SIZE
    return {
        "items": items,
        "page": page,
        "page_size": ACHIEVEMENT_FEED_PAGE_SIZE,
        "total": total,
        "pages": pages,
        "has_previous": page > 1,
        "has_next": page < pages,
        "difficulty": difficulty,
    }


def _player_payload(user_id: int, username: str, *, game: str) -> dict[str, object]:
    return {
        "id": user_id,
        "username": username,
        "avatar_url": f"/api/avatars/{user_id}",
        "profile_url": f"/api/players/by-id/{user_id}/profile?game={game}",
    }


def list_zdwa_achievement_feed(
    *,
    page: int = 1,
    difficulty: AchievementDifficulty | None = None,
) -> dict[str, object]:
    """Return public ZDWA awards with only a still-proven result link."""

    page, difficulty = _normalize_feed_request(page, difficulty)
    keys = _keys_for_difficulty(ZDWA_ACHIEVEMENT_DIFFICULTIES, difficulty)
    offset = (page - 1) * ACHIEVEMENT_FEED_PAGE_SIZE
    criteria = (
        User.is_active.is_(True),
        UserAchievement.achievement_key.in_(keys),
    )
    # A stored source only becomes a public replay link while the exact user
    # still participates in that surviving, typed ZDWA result. This also keeps
    # stale or manually corrupted provenance from turning into a public link.
    source_participant_exists = (
        select(GameParticipant.id)
        .where(
            GameParticipant.game_id == CompletedGame.id,
            GameParticipant.user_id == UserAchievement.user_id,
        )
        .correlate(CompletedGame, UserAchievement)
        .exists()
    )
    with session_scope() as db:
        total = int(db.scalar(
            select(func.count(UserAchievement.id))
            .join(User, User.id == UserAchievement.user_id)
            .where(*criteria)
        ) or 0)
        if offset >= total:
            return _feed_envelope(items=[], page=page, total=total, difficulty=difficulty)
        rows = db.execute(
            select(
                UserAchievement.id,
                UserAchievement.achievement_key,
                UserAchievement.unlocked_at,
                User.id.label("user_id"),
                User.username,
                CompletedGame.game_id.label("public_game_id"),
            )
            .join(User, User.id == UserAchievement.user_id)
            .outerjoin(
                CompletedGame,
                and_(
                    CompletedGame.id == UserAchievement.source_completed_game_id,
                    CompletedGame.game_type == DEFAULT_GAME_TYPE,
                    source_participant_exists,
                ),
            )
            .where(*criteria)
            .order_by(UserAchievement.unlocked_at.desc(), UserAchievement.id.desc())
            .offset(offset)
            .limit(ACHIEVEMENT_FEED_PAGE_SIZE)
        ).all()

    items: list[dict[str, object]] = []
    for row in rows:
        definition = ZDWA_FEED_DEFINITIONS[row.achievement_key]
        item: dict[str, object] = {
            "id": int(row.id),
            "unlocked_at": as_utc(row.unlocked_at).isoformat(),
            "player": _player_payload(int(row.user_id), str(row.username), game="zdwa"),
            "achievement": {
                "key": definition.key,
                "title": definition.name,
                "description": definition.description,
                "icon_key": definition.icon_key,
                "points": int(definition.points),
                "difficulty": ZDWA_ACHIEVEMENT_DIFFICULTIES[definition.key],
            },
        }
        if row.public_game_id:
            item["game_url"] = f"/ergebnis/{quote(str(row.public_game_id), safe='')}"
        items.append(item)
    return _feed_envelope(
        items=items,
        page=page,
        total=total,
        difficulty=difficulty,
    )


def list_zilch_achievement_feed(
    *,
    page: int = 1,
    difficulty: AchievementDifficulty | None = None,
) -> dict[str, object]:
    """Return public Zilch awards without any private result provenance."""

    page, difficulty = _normalize_feed_request(page, difficulty)
    keys = _keys_for_difficulty(ZILCH_ACHIEVEMENT_DIFFICULTIES, difficulty)
    offset = (page - 1) * ACHIEVEMENT_FEED_PAGE_SIZE
    criteria = (
        User.is_active.is_(True),
        ZilchAchievementUnlock.achievement_key.in_(keys),
    )
    with session_scope() as db:
        total = int(db.scalar(
            select(func.count(ZilchAchievementUnlock.id))
            .join(User, User.id == ZilchAchievementUnlock.user_id)
            .where(*criteria)
        ) or 0)
        if offset >= total:
            return _feed_envelope(items=[], page=page, total=total, difficulty=difficulty)
        rows = db.execute(
            select(
                ZilchAchievementUnlock.id,
                ZilchAchievementUnlock.achievement_key,
                ZilchAchievementUnlock.unlocked_at,
                User.id.label("user_id"),
                User.username,
            )
            .join(User, User.id == ZilchAchievementUnlock.user_id)
            .where(*criteria)
            .order_by(ZilchAchievementUnlock.unlocked_at.desc(), ZilchAchievementUnlock.id.desc())
            .offset(offset)
            .limit(ACHIEVEMENT_FEED_PAGE_SIZE)
        ).all()

    items: list[dict[str, object]] = []
    for row in rows:
        definition = ZILCH_FEED_DEFINITIONS[row.achievement_key]
        items.append({
            "id": int(row.id),
            "unlocked_at": as_utc(row.unlocked_at).isoformat(),
            "player": _player_payload(int(row.user_id), str(row.username), game="zilch"),
            "achievement": {
                "key": definition.key,
                "title": definition.title_de,
                "description": definition.description_de,
                "title_key": definition.title_key,
                "description_key": definition.description_key,
                "icon_key": definition.icon_key,
                "points": int(definition.points),
                "difficulty": ZILCH_ACHIEVEMENT_DIFFICULTIES[definition.key],
            },
        })
    return _feed_envelope(
        items=items,
        page=page,
        total=total,
        difficulty=difficulty,
    )
