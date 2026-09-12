"""Public, bounded counts of account-initiated ZDWA game abandonments."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select

from .database import database_schema_ready, session_scope
from .game_types import DEFAULT_GAME_TYPE
from .models import AbandonedGame, User
from .security import as_utc, utcnow


def _ranked_entries(rows) -> list[dict[str, int | str]]:
    entries = []
    previous_count = None
    rank = 0
    for position, (user_id, username, count) in enumerate(rows, start=1):
        if count != previous_count:
            rank = position
        entries.append({"rank": rank, "user_id": user_id, "username": username, "count": count})
        previous_count = count
    return entries


def abandonment_leaderboard(*, now: datetime | None = None) -> dict[str, list[dict[str, int | str]]]:
    """Count the initiator once per manual game, without reading participants.

    Current account IDs and names are the only identity source. Deleted or
    inactive accounts, guests and automated timeouts cannot appear here.
    """
    if not database_schema_ready():
        return {"recent": [], "alltime": []}
    now_utc = as_utc(now if now is not None else utcnow())
    count = func.count(AbandonedGame.id)
    query = (
        select(User.id, User.username, count)
        .select_from(AbandonedGame)
        .join(User, User.id == AbandonedGame.aborted_by_user_id)
        .where(
            AbandonedGame.game_type == DEFAULT_GAME_TYPE,
            AbandonedGame.reason == "manual",
            AbandonedGame.abandoned_at <= now_utc,
            User.is_active.is_(True),
        )
        .group_by(User.id, User.username)
        .order_by(count.desc(), User.id.asc())
        .limit(3)
    )
    with session_scope() as db:
        return {
            "recent": _ranked_entries(db.execute(query.where(
                AbandonedGame.abandoned_at >= now_utc - timedelta(days=10),
            ))),
            "alltime": _ranked_entries(db.execute(query)),
        }
