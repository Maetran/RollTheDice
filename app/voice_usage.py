"""Best-effort WebRTC payload observations, never provider billing evidence."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import Engine, case, create_engine, delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from .database import get_engine
from .models import VoiceUsageBucket
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)
RETENTION_DAYS = 400
SOURCE = "browser_transport_payload"
MAX_COUNTER = 2 ** 53 - 1
MAX_BYTES_PER_SECOND = 1024 * 1024
BURST_BYTES = 128 * 1024
MIN_REPORT_SECONDS = 1


@dataclass
class UsageCounter:
    """Ephemeral deduplication tied to the authenticated voice membership."""

    started_at: float = field(default_factory=time.monotonic)
    reported_at: float | None = None
    attempted_at: float | None = None
    sequence: int = 0
    received_bytes: int = 0
    sent_bytes: int = 0


def accept_usage(counter: UsageCounter, usage: object, *, now: float | None = None) -> tuple[int, int] | None:
    """Ignore malformed, replayed or implausible observations without affecting voice."""
    if not isinstance(usage, dict) or set(usage) != {"received_bytes", "sent_bytes", "sequence"}:
        return None
    received, sent, sequence = usage["received_bytes"], usage["sent_bytes"], usage["sequence"]
    if any(type(value) is not int or not 0 <= value <= MAX_COUNTER for value in (received, sent, sequence)):
        return None
    if sequence <= counter.sequence or received < counter.received_bytes or sent < counter.sent_bytes:
        return None
    now = time.monotonic() if now is None else now
    if counter.attempted_at is not None and now - counter.attempted_at < MIN_REPORT_SECONDS:
        return None
    elapsed = max(0, now - (counter.reported_at if counter.reported_at is not None else counter.started_at))
    delta = received - counter.received_bytes, sent - counter.sent_bytes
    if max(delta) > BURST_BYTES + elapsed * MAX_BYTES_PER_SECOND:
        return None
    counter.attempted_at = now
    return delta


def prune_usage(db: Session, now: datetime) -> None:
    first_day = (as_utc(now) - timedelta(days=RETENTION_DAYS - 1)).date().isoformat()
    db.execute(delete(VoiceUsageBucket).where(VoiceUsageBucket.day < first_day))


def _writer_engine() -> Engine:
    """Observe through a short-lived connection, never the gameplay DB pool."""
    configured = get_engine()
    url = configured.url
    if configured.dialect.name == "sqlite":
        if not url.database or ":memory:" in url.database or url.query.get("mode", "").lower() == "memory":
            raise RuntimeError("Voice usage needs a persistent database")
        connect_args = {"check_same_thread": False, "timeout": 0.25}
    elif configured.dialect.name == "postgresql" and configured.dialect.driver in {"psycopg", "psycopg2"}:
        connect_args = {"connect_timeout": 1, "options": "-c statement_timeout=250"}
    else:
        raise RuntimeError("Voice usage database does not support bounded writes")
    return create_engine(url, poolclass=NullPool, connect_args=connect_args)


def record_usage(received_bytes: int, sent_bytes: int, *, now: datetime | None = None) -> bool:
    """Add one validated report with no account, room or transport identifiers."""
    if any(type(value) is not int or not 0 <= value <= MAX_COUNTER for value in (received_bytes, sent_bytes)):
        return False
    now = as_utc(now or utcnow())
    row = {"day": now.date().isoformat(), "received_bytes": received_bytes, "sent_bytes": sent_bytes,
           "reports": 1, "first_reported_at": now, "last_reported_at": now}
    bucket = VoiceUsageBucket
    committed = False
    engine = None
    try:
        engine = _writer_engine()
        with engine.connect() as connection, Session(bind=connection) as db:
            try:
                prune_usage(db, now)
                dialect = db.get_bind().dialect.name
                if dialect in {"sqlite", "postgresql"}:
                    statement = (sqlite_insert if dialect == "sqlite" else postgres_insert)(bucket).values(**row)
                    db.execute(statement.on_conflict_do_update(index_elements=["day"], set_={
                        "received_bytes": bucket.received_bytes + statement.excluded.received_bytes,
                        "sent_bytes": bucket.sent_bytes + statement.excluded.sent_bytes,
                        "reports": bucket.reports + 1,
                        "first_reported_at": case((statement.excluded.first_reported_at < bucket.first_reported_at,
                                                   statement.excluded.first_reported_at), else_=bucket.first_reported_at),
                        "last_reported_at": case((statement.excluded.last_reported_at > bucket.last_reported_at,
                                                  statement.excluded.last_reported_at), else_=bucket.last_reported_at),
                    }))
                else:
                    changed = db.execute(update(bucket).where(bucket.day == row["day"]).values(
                        received_bytes=bucket.received_bytes + received_bytes, sent_bytes=bucket.sent_bytes + sent_bytes,
                        reports=bucket.reports + 1,
                        first_reported_at=case((bucket.first_reported_at > now, now), else_=bucket.first_reported_at),
                        last_reported_at=case((bucket.last_reported_at < now, now), else_=bucket.last_reported_at),
                    ))
                    if not changed.rowcount:
                        db.execute(insert(bucket).values(**row))
                db.commit()
                committed = True
            finally:
                db.rollback()
    except (SQLAlchemyError, RuntimeError):
        logger.warning("Voice usage observation unavailable; voice continues", exc_info=False)
    finally:
        if engine is not None:
            engine.dispose()
    return committed


def usage_stats(db: Session, start: datetime, now: datetime) -> dict:
    """Read retained UTC totals; missing reports remain an explicit evidence gap."""
    start, now = as_utc(start), as_utc(now)
    today = now.date().isoformat()
    retained_start = (now - timedelta(days=RETENTION_DAYS - 1)).date().isoformat()
    start = max(start, now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=RETENTION_DAYS - 1))
    bucket = VoiceUsageBucket
    first, last = db.execute(select(func.min(bucket.first_reported_at), func.max(bucket.last_reported_at))
                             .where(bucket.day >= retained_start, bucket.day <= today)).one()

    def totals(from_day: str) -> dict:
        received, sent, reports = db.execute(select(func.sum(bucket.received_bytes), func.sum(bucket.sent_bytes),
                                                  func.sum(bucket.reports))
                                            .where(bucket.day >= from_day, bucket.day <= today)).one()
        return {"received_bytes": int(received or 0), "sent_bytes": int(sent or 0), "reports": int(reports or 0)}

    rows = db.scalars(select(bucket).where(bucket.day >= start.date().isoformat(), bucket.day <= today)
                      .order_by(bucket.day)).all()
    by_day = {row.day: {"day": row.day, "received_bytes": row.received_bytes, "sent_bytes": row.sent_bytes,
                        "reports": row.reports} for row in rows}
    daily = []
    if rows:
        for offset in range((now.date() - start.date()).days + 1):
            day = (start + timedelta(days=offset)).date().isoformat()
            daily.append(by_day.get(day, {"day": day, "received_bytes": 0, "sent_bytes": 0, "reports": 0}))
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return {"source": SOURCE, "first_reported_at": as_utc(first).isoformat() if first else None,
            "last_reported_at": as_utc(last).isoformat() if last else None, "retention_days": RETENTION_DAYS,
            "period": totals(start.date().isoformat()),
            "month": {"from": month_start.isoformat(), "to": now.isoformat(), **totals(month_start.date().isoformat())},
            "daily": daily}
