"""Bounded, idempotent persistence for started games that were abandoned.

Completed results remain the sole input for scores, leaderboards and result
pages. Only non-scoring Fairplay reminders use the counters here. This module stores the minimum account-safe data
needed for later aggregate abandonment statistics.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from .database import database_schema_ready, session_scope
from .game_types import ZILCH_GAME_TYPE, GameType, game_type_from_state
from .models import AbandonedGame, AbandonedGameParticipant, User
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)

AbortReason = Literal["manual", "inactivity_timeout"]
AbandonedGameWriteStatus = Literal["stored", "already_stored", "skipped", "failed"]
_VALID_ABORT_REASONS = frozenset({"manual", "inactivity_timeout"})


@dataclass(frozen=True)
class AbandonedGameWriteResult:
    """Outcome of one idempotent abandoned-game write."""

    status: AbandonedGameWriteStatus
    game_id: str
    game_type: GameType | None
    abandoned_game_id: int | None = None
    reason: str | None = None

    @property
    def succeeded(self) -> bool:
        """Whether the durable record exists after this call."""
        return self.status in {"stored", "already_stored"}


@dataclass(frozen=True)
class _AccountSeat:
    """A runtime player seat that can safely be associated with an account."""

    player_id: str
    user_id: int


def _positive_user_id(value: object) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _timestamp(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return as_utc(value)
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
    except (TypeError, ValueError, OverflowError):
        return None
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _started_at(game: dict[str, Any]) -> datetime | None:
    """Require a durable start timestamp so lobby cancellations are excluded."""
    return _timestamp(game.get("_started_at"))


def _abandoned_at(game: dict[str, Any], explicit: datetime | None) -> datetime:
    """Choose an authoritative terminal time, with a server-clock fallback."""
    if explicit is not None:
        return as_utc(explicit)
    for field in ("_finished_at", "_updated_at", "_last_activity"):
        parsed = _timestamp(game.get(field))
        if parsed is not None:
            return parsed
    return utcnow()


def _is_human_zilch_seat(player: dict[str, Any]) -> bool:
    """Accept only explicit human durable Zilch participants."""
    return str(player.get("type") or "").strip().lower() == "human"


def _raw_runtime_seats(game: dict[str, Any], game_type: GameType) -> Iterable[dict[str, Any]]:
    if game_type == ZILCH_GAME_TYPE:
        participants = game.get("_participants")
        if isinstance(participants, list):
            for participant in participants:
                if isinstance(participant, dict) and _is_human_zilch_seat(participant):
                    yield participant
            return
    players = game.get("_players")
    if isinstance(players, list):
        for player in players:
            if isinstance(player, dict):
                yield player


def _account_seats(game: dict[str, Any], game_type: GameType) -> list[_AccountSeat]:
    """Extract distinct account seats; guests and CPUs never enter persistence."""
    seats: list[_AccountSeat] = []
    seen_user_ids: set[int] = set()
    for player in _raw_runtime_seats(game, game_type):
        user_id = _positive_user_id(player.get("user_id"))
        if user_id is None or user_id in seen_user_ids:
            continue
        player_id = str(player.get("id") or "").strip()
        if not player_id:
            continue
        seen_user_ids.add(user_id)
        seats.append(_AccountSeat(player_id=player_id, user_id=user_id))
    return seats


def _existing_result(game_id: str, game_type: GameType) -> AbandonedGameWriteResult | None:
    """Read a concurrent or prior write without exposing any game payload."""
    try:
        with session_scope() as db:
            existing = db.scalar(select(AbandonedGame).where(AbandonedGame.game_id == game_id))
            if existing is None:
                return None
            if existing.game_type != game_type:
                return AbandonedGameWriteResult(
                    "failed",
                    game_id,
                    game_type,
                    abandoned_game_id=existing.id,
                    reason="game_id_type_conflict",
                )
            return AbandonedGameWriteResult(
                "already_stored",
                game_id,
                game_type,
                abandoned_game_id=existing.id,
            )
    except SQLAlchemyError:
        logger.exception("Could not inspect abandoned game %s", game_id)
        return AbandonedGameWriteResult("failed", game_id, game_type, reason="database_error")


def persist_abandoned_game(
    game: dict[str, Any],
    *,
    reason: AbortReason | str | None = None,
    aborted_by_player_id: object | None = None,
    abandoned_at: datetime | None = None,
) -> AbandonedGameWriteResult:
    """Store one started, terminally aborted game exactly once.

    Callers pass the authoritative live state after marking it ``_aborted``.
    A game without a start timestamp is deliberately skipped: a cancelled
    lobby is not an abandoned played game.  Only existing account IDs become
    participant rows; guest and CPU seats are never retained.
    """
    game_id = str(game.get("_id") or "").strip()
    if not game_id or len(game_id) > 64:
        return AbandonedGameWriteResult("failed", game_id, None, reason="invalid_game_id")
    try:
        game_type = game_type_from_state(game)
    except ValueError:
        return AbandonedGameWriteResult("failed", game_id, None, reason="invalid_game_type")
    # Configured Zilch Solo uses a typed private terminal result rather than
    # the generic room-abort flag. Only the explicit action writes this marker;
    # older result snapshots must never be guessed into the new public count.
    explicit_solo_abort = (
        game_type == ZILCH_GAME_TYPE
        and game.get("_manual_solo_abandonment") is True
        and game.get("_finished") is True
        and isinstance(game.get("_zilch_outcome"), dict)
        and game["_zilch_outcome"].get("status") == "abandoned"
    )
    if not game.get("_aborted") and not explicit_solo_abort:
        return AbandonedGameWriteResult("skipped", game_id, game_type, reason="game_not_aborted")

    abort_reason = str(reason if reason is not None else game.get("_abort_reason") or "").strip()
    if abort_reason not in _VALID_ABORT_REASONS:
        return AbandonedGameWriteResult("failed", game_id, game_type, reason="invalid_abort_reason")
    if abort_reason != "manual":
        return AbandonedGameWriteResult("skipped", game_id, game_type, reason="not_active_abort")

    started_at = _started_at(game)
    if started_at is None:
        return AbandonedGameWriteResult("skipped", game_id, game_type, reason="game_not_started")
    recorded_at = _abandoned_at(game, abandoned_at)
    if recorded_at < started_at:
        return AbandonedGameWriteResult("failed", game_id, game_type, reason="invalid_abandoned_at")

    seats = _account_seats(game, game_type)
    if not seats:
        return AbandonedGameWriteResult("skipped", game_id, game_type, reason="no_account_participants")
    if not database_schema_ready():
        return AbandonedGameWriteResult("failed", game_id, game_type, reason="database_not_ready")

    actor_player_id = str(aborted_by_player_id or game.get("_aborted_by_player_id") or "").strip()
    actor_user_id = next((seat.user_id for seat in seats if seat.player_id == actor_player_id), None)
    if actor_user_id is None:
        return AbandonedGameWriteResult("skipped", game_id, game_type, reason="no_account_initiator")

    try:
        with session_scope() as db:
            existing = db.scalar(select(AbandonedGame).where(AbandonedGame.game_id == game_id))
            if existing is not None:
                if existing.game_type == game_type:
                    return AbandonedGameWriteResult(
                        "already_stored",
                        game_id,
                        game_type,
                        abandoned_game_id=existing.id,
                    )
                return AbandonedGameWriteResult(
                    "failed",
                    game_id,
                    game_type,
                    abandoned_game_id=existing.id,
                    reason="game_id_type_conflict",
                )

            # A numeric ID from a live JSON state must still resolve to a real
            # account in this database.  This prevents stale/imported state
            # from accidentally attributing a guest seat to a reused ID.
            known_user_ids = {
                int(user_id)
                for user_id in db.scalars(select(User.id).where(User.id.in_({seat.user_id for seat in seats})))
            }
            persisted_seats = [seat for seat in seats if seat.user_id in known_user_ids]
            if not persisted_seats:
                return AbandonedGameWriteResult("skipped", game_id, game_type, reason="no_account_participants")
            if actor_user_id not in known_user_ids:
                return AbandonedGameWriteResult("skipped", game_id, game_type, reason="no_account_initiator")

            row = AbandonedGame(
                game_id=game_id,
                game_type=game_type,
                game_name=str(game.get("_name") or "")[:160],
                mode=str(game.get("_mode") or "")[:16],
                hardcore=bool(game.get("_hardcore")),
                started_at=started_at,
                abandoned_at=recorded_at,
                reason=abort_reason,
                aborted_by_user_id=actor_user_id,
                created_at=utcnow(),
            )
            db.add(row)
            db.flush()
            for seat in persisted_seats:
                db.add(
                    AbandonedGameParticipant(
                        abandoned_game_id=row.id,
                        user_id=seat.user_id,
                        was_abort_initiator=seat.user_id == actor_user_id,
                    )
                )
        return AbandonedGameWriteResult("stored", game_id, game_type, abandoned_game_id=row.id)
    except IntegrityError:
        # Concurrent terminal delivery may race; a matching durable row is a
        # successful idempotent outcome, never a duplicate statistic.
        result = _existing_result(game_id, game_type)
        if result is not None:
            return result
        logger.exception("Could not persist abandoned game %s after an integrity conflict", game_id)
        return AbandonedGameWriteResult("failed", game_id, game_type, reason="integrity_error")
    except (SQLAlchemyError, TypeError, ValueError):
        logger.exception("Could not persist abandoned game %s", game_id)
        return AbandonedGameWriteResult("failed", game_id, game_type, reason="database_error")
