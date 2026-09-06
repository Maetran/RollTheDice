"""Minimal account play-day evidence, shared by both games, never spectators."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import TYPE_CHECKING
from zoneinfo import ZoneInfo

from sqlalchemy import and_, or_, select, update

from .database import session_scope
from .models import CompletedGame, GameParticipant, User
from .security import as_utc, utcnow

if TYPE_CHECKING:
    from .game_ws_session import GameSocketSession

PLAY_DAY_TIMEZONE = "Europe/Zurich"


def play_day(now: datetime) -> date:
    return as_utc(now).astimezone(ZoneInfo(PLAY_DAY_TIMEZONE)).date()


def not_played_on(day: date):
    """SQL eligibility, including results completed before activity tracking shipped."""
    zone = ZoneInfo(PLAY_DAY_TIMEZONE)
    start = datetime.combine(day, time.min, zone).astimezone(timezone.utc)
    end = datetime.combine(day + timedelta(days=1), time.min, zone).astimezone(timezone.utc)
    completed_today = select(GameParticipant.id).join(CompletedGame).where(
        GameParticipant.user_id == User.id,
        CompletedGame.finished_at >= start,
        CompletedGame.finished_at < end,
    ).exists()
    return and_(or_(User.last_played_on.is_(None), User.last_played_on < day), ~completed_today)


def record_gameplay(session: GameSocketSession) -> None:
    """Call only after an accepted human roll/score action, before broadcasting.

    Joining, watching, chatting, CPU turns and rejected commands never count.
    One date per account is enough; no extra history of individual actions.
    """
    identity = session.auth_identity
    if identity is None or session.is_spectator or not session.player_id:
        return
    if not any(
        player.get("id") == session.player_id and player.get("user_id") == identity.user_id
        for player in session.game.get("_players", [])
    ):
        return
    day = play_day(utcnow())
    with session_scope() as db:
        db.execute(update(User).where(
            User.id == identity.user_id,
            or_(User.last_played_on.is_(None), User.last_played_on < day),
        ).values(last_played_on=day))
