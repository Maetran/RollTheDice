"""Shared, rollout-safe activity facts for achievements spanning both games."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE
from .models import CompletedGame, GameParticipant, User
from .security import as_utc, utcnow

ZURICH = ZoneInfo("Europe/Zurich")
_GAME_TYPES = (DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE)


@dataclass(frozen=True)
class CrossGameActivity:
    """Verified paired play days for one account.

    A paired day contains at least one non-imported, completed ZDWA game and
    one non-imported, completed Zilch game in the Europe/Zurich calendar.  The
    migration-owned user marker deliberately keeps new awards forward-only:
    imported or pre-rollout history cannot surprise players with a bulk of
    unlocks when this catalog grows.
    """

    paired_days: int
    longest_streak: int
    latest_paired_game_id: str | None
    latest_zilch_game_id: str | None


def cross_game_activity_for_user(
    db,
    user: User,
    *,
    excluded_completed_game_id: int | None = None,
) -> CrossGameActivity:
    """Return the current same-day ZDWA/Zilch progress for ``user``.

    The optional exclusion lets a result finalizer prove that its just-written
    game really completed an achievement.  It mirrors the source-proof model
    of the established ZDWA achievement synchronizer.
    """

    started_at = as_utc(user.achievement_cross_game_started_at or utcnow())
    statement = (
        select(CompletedGame)
        .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
        .where(
            GameParticipant.user_id == user.id,
            CompletedGame.game_type.in_(_GAME_TYPES),
            CompletedGame.imported_from_legacy.is_(False),
            CompletedGame.finished_at >= started_at,
        )
        .order_by(CompletedGame.finished_at, CompletedGame.id)
    )
    if excluded_completed_game_id is not None:
        statement = statement.where(CompletedGame.id != int(excluded_completed_game_id))

    games_by_day: dict[date, dict[str, CompletedGame]] = {}
    for game in db.scalars(statement):
        local_day = as_utc(game.finished_at).astimezone(ZURICH).date()
        games_for_day = games_by_day.setdefault(local_day, {})
        previous = games_for_day.get(str(game.game_type))
        if previous is None or (as_utc(game.finished_at), int(game.id)) > (
            as_utc(previous.finished_at),
            int(previous.id),
        ):
            games_for_day[str(game.game_type)] = game

    paired: list[tuple[date, CompletedGame]] = []
    for local_day, games_for_day in games_by_day.items():
        if not all(game_type in games_for_day for game_type in _GAME_TYPES):
            continue
        trigger = max(
            games_for_day.values(),
            key=lambda game: (as_utc(game.finished_at), int(game.id)),
        )
        paired.append((local_day, trigger))
    paired.sort(key=lambda item: item[0])

    longest = current = 0
    previous_day: date | None = None
    for local_day, _game in paired:
        current = current + 1 if previous_day and local_day == previous_day + timedelta(days=1) else 1
        longest = max(longest, current)
        previous_day = local_day

    return CrossGameActivity(
        paired_days=len(paired),
        longest_streak=longest,
        latest_paired_game_id=str(paired[-1][1].game_id) if paired else None,
        latest_zilch_game_id=(
            str(games_by_day[paired[-1][0]][ZILCH_GAME_TYPE].game_id)
            if paired
            else None
        ),
    )
