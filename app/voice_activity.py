"""Private best-effort listening membership observations, never speaking time.

Only the authorized voice backend calls the observer. No client minutes,
transport counters, content, microphone state or session tokens enter this store.
The existing bounded analytics queue owns persistence outside game/voice locks.
"""

from __future__ import annotations

import logging
import math
import re
import threading
import time
import weakref
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import case, delete, func, select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .models import User, VoiceActivityBucket
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)
RETENTION_DAYS = 400
MAX_UNCONFIRMED_SECONDS = 30  # The voice backend's HEARTBEAT_SECONDS.
MAX_ACCOUNTS = 128  # The voice backend's simultaneous member limit.
GAMES = ("zdwa", "hausdepp", "watten")
_GAME_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
_lock = threading.RLock()
_owners: weakref.WeakValueDictionary = weakref.WeakValueDictionary()
_dropped = 0


@dataclass(eq=False)
class ActivityCounter:
    """Ephemeral state owned by one authorized VoiceMember, not a browser."""

    user_id: int | None = None
    game_type: str | None = None
    game_id: str | None = None
    last_at: float | None = None
    last_wall: datetime | None = None
    connected: bool = False
    ended: bool = False


def note_dropped(count: int) -> None:
    global _dropped
    with _lock:
        _dropped += max(0, count)


def _row(counter: ActivityCounter, first: datetime, last: datetime, ms: int = 0, activation: int = 0) -> dict:
    return {"day": first.date().isoformat(), "game_type": counter.game_type, "game_id": counter.game_id,
            "user_id": counter.user_id, "connected_ms": ms, "activations": activation,
            "first_observed_at": first, "last_observed_at": last}


def _interval(counter: ActivityCounter, now: float) -> list[dict]:
    if not counter.connected or counter.last_at is None:
        return []
    # A late cleanup cannot turn a stale or disconnected socket into minutes.
    elapsed_ms = max(0, min(int((now - counter.last_at) * 1000), MAX_UNCONFIRMED_SECONDS * 1000))
    start = counter.last_wall
    end = start + timedelta(milliseconds=elapsed_ms)
    rows = []
    while start < end:
        midnight = start.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
        last = min(end, midnight)
        rows.append(_row(counter, start, last, ms=round((last - start).total_seconds() * 1000)))
        start = last
    return rows


def observe_activity(counter: ActivityCounter, *, user_id: int, game_type: str, game_id: str,
                     connected: bool = True, ended: bool = False, now: float | None = None,
                     wall_time: datetime | None = None) -> bool:
    """Observe a successful authorized membership; queue failure never blocks it.

    First join counts once. Heartbeats/resumes keep the counter. Disconnect
    pauses immediately; cross-game handoff opens a zero-time row without another
    activation or attributing the uncertain handoff gap to either game.
    """
    try:
        if (not isinstance(counter, ActivityCounter) or type(user_id) is not int or user_id <= 0
                or game_type not in GAMES or not isinstance(game_id, str) or not _GAME_ID.fullmatch(game_id)
                or type(connected) is not bool or type(ended) is not bool):
            return False
        stamp = time.monotonic() if now is None else now
        if type(stamp) not in {int, float} or not math.isfinite(stamp):
            return False
        wall = as_utc(wall_time or utcnow())
        with _lock:
            if counter.ended or counter.user_id not in {None, user_id}:
                return False
            if counter.last_at is not None and stamp < counter.last_at:
                return False
            rows = []
            fresh = counter.user_id is None
            if fresh:
                if not connected or ended:
                    return False
                owner = _owners.get(user_id)
                if owner is not None and owner is not counter and not owner.ended:
                    # Simultaneous devices cannot add overlapping account time.
                    if owner.last_at is not None and stamp < owner.last_at:
                        return False
                    rows.extend(_interval(owner, stamp))
                    owner.ended = True
                elif len(_owners) >= MAX_ACCOUNTS:
                    note_dropped(1)
                    return False
                counter.user_id, counter.game_type, counter.game_id = user_id, game_type, game_id
                _owners[user_id] = counter
                rows.append(_row(counter, wall, wall, activation=1))
            elif _owners.get(user_id) is not counter:
                return False
            elif (counter.game_type, counter.game_id) != (game_type, game_id):
                # Last heartbeat was already accounted for. The handoff gap is
                # unobserved; preserve membership, not a guessed game timeline.
                counter.game_type, counter.game_id = game_type, game_id
                rows.append(_row(counter, wall, wall))
            else:
                rows.extend(_interval(counter, stamp))
            counter.last_at, counter.last_wall = stamp, wall
            counter.connected, counter.ended = connected and not ended, ended
            if ended:
                _owners.pop(user_id, None)
            if not rows:
                return True
            from .analytics import enqueue_voice_activity

            if enqueue_voice_activity(rows):
                return True
            note_dropped(len(rows))
    except Exception:
        note_dropped(1)
        logger.warning("Voice activity observation unavailable; voice continues", exc_info=False)
    return False


def prune_activity(db: Session, now: datetime) -> None:
    first_day = (as_utc(now) - timedelta(days=RETENTION_DAYS - 1)).date().isoformat()
    db.execute(delete(VoiceActivityBucket).where(VoiceActivityBucket.day < first_day))


def persist_activity(db: Session, rows: list[dict]) -> None:
    """Called only by the bounded writer, never while a voice lock is held."""
    if not rows:
        return
    users = set(db.scalars(select(User.id).where(User.id.in_({row["user_id"] for row in rows}))))
    combined = {}
    for row in rows:
        if row["user_id"] not in users:  # A queued observation cannot recreate a deleted account.
            continue
        key = tuple(row[field] for field in ("day", "game_type", "game_id", "user_id"))
        existing = combined.get(key)
        if existing:
            existing["activations"] += row["activations"]
            existing["connected_ms"] += row["connected_ms"]
            existing["first_observed_at"] = min(existing["first_observed_at"], row["first_observed_at"])
            existing["last_observed_at"] = max(existing["last_observed_at"], row["last_observed_at"])
        else:
            combined[key] = dict(row)
    bucket = VoiceActivityBucket
    dialect = db.get_bind().dialect.name
    for row in combined.values():
        statement = (sqlite_insert if dialect == "sqlite" else postgres_insert)(bucket).values(**row)
        db.execute(statement.on_conflict_do_update(
            index_elements=["day", "game_type", "game_id", "user_id"],
            set_={"activations": bucket.activations + statement.excluded.activations,
                  "connected_ms": bucket.connected_ms + statement.excluded.connected_ms,
                  "first_observed_at": case((statement.excluded.first_observed_at < bucket.first_observed_at,
                                             statement.excluded.first_observed_at), else_=bucket.first_observed_at),
                  "last_observed_at": case((statement.excluded.last_observed_at > bucket.last_observed_at,
                                            statement.excluded.last_observed_at), else_=bucket.last_observed_at)},
        ))


def activity_stats(db: Session, start: datetime, now: datetime, games: tuple[str, ...]) -> dict:
    """Private dashboard aggregate, with product capabilities already applied."""
    start, now = as_utc(start), as_utc(now)
    first_day = (now - timedelta(days=RETENTION_DAYS - 1)).date().isoformat()
    bucket = VoiceActivityBucket
    retained = [bucket.game_type.in_(games), bucket.day >= first_day, bucket.day <= now.date().isoformat()]
    first, last = db.execute(select(func.min(bucket.first_observed_at), func.max(bucket.last_observed_at))
                             .where(*retained)).one()
    filters = [*retained, bucket.day >= start.date().isoformat()]

    def totals(extra=(), *, retained_total=False) -> dict:
        conditions = [*(retained if retained_total else filters), *extra]
        activations, ms, users = db.execute(select(func.sum(bucket.activations), func.sum(bucket.connected_ms),
                                                  func.count(func.distinct(bucket.user_id))).where(*conditions)).one()
        parties = db.scalar(select(func.count()).select_from(select(bucket.game_type, bucket.game_id)
                                                            .where(*conditions).distinct().subquery()))
        return {"activations": int(activations or 0), "connected_minutes": round((ms or 0) / 60000, 2),
                "games": int(parties or 0), "users": int(users or 0)}

    leaders = db.execute(select(User.username, func.sum(bucket.connected_ms).label("ms")).join(
        User, User.id == bucket.user_id).where(*filters).group_by(User.id, User.username)
        .order_by(func.sum(bucket.connected_ms).desc(), User.id).limit(10)).all()
    return {"source": "server_authorized_listening_membership", "retention_days": RETENTION_DAYS,
            "first_observed_at": as_utc(first).isoformat() if first else None,
            "last_observed_at": as_utc(last).isoformat() if last else None,
            "max_unconfirmed_seconds": MAX_UNCONFIRMED_SECONDS, "observed_only": True,
            "dropped_observations_since_restart": _dropped,
            "period": totals(), "by_game": [{"game_type": game, **totals((bucket.game_type == game,))}
                                              for game in games],
            "retained": {"from": first_day, "to": now.isoformat(), **totals(retained_total=True)},
            "top_users": [{"username": name, "connected_minutes": round(ms / 60000, 2)} for name, ms in leaders]}
