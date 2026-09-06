"""Opted-in daily reminders, claimed durably before any external delivery."""

from __future__ import annotations

import asyncio
import hashlib
import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, or_, select, update

from .database import session_scope
from .game_access import can_account_access_zilch
from .game_activity import not_played_on
from .game_types import ZILCH_GAME_TYPE
from .models import User, WebPushSubscription
from .product_hosts import site_origin, zilch_url
from .push_reminder_copy import REMINDER_COPY
from .security import as_utc, utcnow
from .web_push import (
    DAILY_REMINDER_END_HOUR,
    DAILY_REMINDER_START_HOUR,
    DAILY_REMINDER_TIMEZONE,
    StoredSubscription,
    _send_web_push,
    web_push_available,
)

logger = logging.getLogger(__name__)
REMINDER_POLL_SECONDS = 60
REMINDER_BATCH_SIZE = 50
REMINDER_TTL_SECONDS = 60 * 60


@dataclass(frozen=True)
class DailyReminder:
    user_id: int
    day: date
    game_type: str
    language: str
    variant: int
    subscriptions: tuple[StoredSubscription, ...]


def reminder_day(now: datetime) -> date | None:
    """Only 17:00 <= Swiss time < 21:00; never catch up at night."""
    local = as_utc(now).astimezone(ZoneInfo(DAILY_REMINDER_TIMEZONE))
    return local.date() if DAILY_REMINDER_START_HOUR <= local.hour < DAILY_REMINDER_END_HOUR else None


def reminder_scheduled_at(user_id: int, day: date) -> datetime:
    """A new pseudorandom minute per account/day, stable across workers/restarts.

    This is scheduling, not a secret or authorization token. Using a stable
    hash avoids Python's per-process hash seed or re-randomizing every poll.
    """
    seed = hashlib.sha256(f"daily-reminder-v1:{user_id}:{day.isoformat()}".encode()).digest()
    minutes = int.from_bytes(seed[:8], "big") % ((DAILY_REMINDER_END_HOUR - DAILY_REMINDER_START_HOUR) * 60)
    return datetime.combine(day, time(DAILY_REMINDER_START_HOUR), ZoneInfo(DAILY_REMINDER_TIMEZONE)) + timedelta(minutes=minutes)


def reminder_expires_at(day: date) -> datetime:
    return datetime.combine(day, time(DAILY_REMINDER_END_HOUR), ZoneInfo(DAILY_REMINDER_TIMEZONE))


def claim_daily_reminder(user_id: int, now: datetime) -> DailyReminder | None:
    day = reminder_day(now)
    if day is None or as_utc(now) < reminder_scheduled_at(user_id, day):
        return None
    with session_scope() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active or not user.daily_reminder_push_enabled:
            return None
        subscriptions = db.scalars(
            select(WebPushSubscription).where(WebPushSubscription.user_id == user_id).order_by(WebPushSubscription.id)
        ).all()
        subscriptions = [subscription for subscription in subscriptions if (
            subscription.product_context != ZILCH_GAME_TYPE
            or can_account_access_zilch(username=user.username, role=user.role)
        )]
        contexts = sorted({subscription.product_context for subscription in subscriptions})
        if not contexts:
            return None
        claimed = db.execute(
            update(User)
            .where(
                User.id == user_id,
                User.is_active.is_(True),
                User.daily_reminder_push_enabled.is_(True),
                not_played_on(day),
                or_(User.daily_reminder_push_last_sent_on.is_(None), User.daily_reminder_push_last_sent_on < day),
            )
            .values(
                daily_reminder_push_last_sent_on=day,
                daily_reminder_push_sequence=User.daily_reminder_push_sequence + 1,
            )
            .returning(User.daily_reminder_push_sequence)
        ).scalar_one_or_none()
        if claimed is None:
            return None
        # When both PWAs are installed, alternate games instead of sending
        # two reminders. All subscribed devices of the selected game receive
        # the same reminder; other game subscriptions are left alone today.
        sequence = claimed - 1
        context = contexts[(sequence + user_id) % len(contexts)]
        return DailyReminder(
            user_id=user_id,
            day=day,
            game_type=context,
            language="en" if user.preferred_language == "en" else "de",
            variant=(sequence // len(contexts) + user_id) % len(REMINDER_COPY[context]),
            subscriptions=tuple(StoredSubscription(
                id=subscription.id, user_id=user.id, endpoint=subscription.endpoint,
                p256dh=subscription.p256dh, auth=subscription.auth, product_context=context,
                preferred_language=user.preferred_language,
            ) for subscription in subscriptions if subscription.product_context == context),
        )


def reminder_payload(reminder: DailyReminder) -> dict[str, object]:
    zilch = reminder.game_type == ZILCH_GAME_TYPE
    english = reminder.language == "en"
    title = ("Ready for Zilch?" if zilch else "Ready for ZDWA?") if english else (
        "Heute schon gezilcht?" if zilch else "Heute schon die Wand angezockt?"
    )
    icon = "/static/icons/zilch-icon-192.png" if zilch else "/static/icons/icon-192.png"
    return {
        "title": title,
        "body": REMINDER_COPY[reminder.game_type][reminder.variant][1 if english else 0],
        "url": zilch_url("/") if zilch else f"{site_origin()}/",
        "tag": f"daily-reminder-{reminder.day.isoformat()}",
        "icon": icon,
        "badge": icon,
    }


async def dispatch_daily_reminders(*, now: datetime | None = None) -> int:
    """Claim each account once per Swiss calendar day, including on failure."""
    current = now or utcnow()
    day = reminder_day(current)
    if day is None or not web_push_available():
        return 0
    with session_scope() as db:
        user_ids = list(db.scalars(
            select(User.id)
            .join(WebPushSubscription, WebPushSubscription.user_id == User.id)
            .where(
                User.is_active.is_(True), User.daily_reminder_push_enabled.is_(True),
                not_played_on(day),
                or_(User.daily_reminder_push_last_sent_on.is_(None), User.daily_reminder_push_last_sent_on < day),
            )
            .distinct().order_by(User.id)
        ))
    dispatched = 0
    accepted = 0
    for user_id in user_ids:
        if dispatched >= REMINDER_BATCH_SIZE:
            break
        current = now or utcnow()
        if reminder_day(current) != day:
            break
        reminder = claim_daily_reminder(user_id, current)
        if reminder is None:
            continue
        payload = reminder_payload(reminder)
        for subscription in reminder.subscriptions:
            current = now or utcnow()
            if reminder_day(current) != day:
                break
            # Check again after preceding deliveries: a global opt-out while
            # a batch is running must remove any not-yet-dispatched endpoints.
            with session_scope() as db:
                still_eligible = db.scalar(select(WebPushSubscription.id).join(User).where(
                    WebPushSubscription.id == subscription.id,
                    WebPushSubscription.user_id == user_id,
                    User.is_active.is_(True), User.daily_reminder_push_enabled.is_(True),
                    not_played_on(day),
                ))
            if still_eligible is None:
                continue
            ttl = min(REMINDER_TTL_SECONDS, max(0, int((reminder_expires_at(day) - as_utc(current)).total_seconds())))
            sent, expired = await asyncio.to_thread(_send_web_push, subscription, payload, ttl=ttl)
            accepted += int(sent)
            if expired:
                with session_scope() as db:
                    db.execute(delete(WebPushSubscription).where(WebPushSubscription.id == subscription.id))
        dispatched += 1
    if dispatched:
        logger.info("Daily reminders: %s accounts claimed, %s push deliveries accepted", dispatched, accepted)
    return dispatched


async def run_daily_reminder_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await dispatch_daily_reminders()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Daily push reminder batch failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=REMINDER_POLL_SECONDS)
        except asyncio.TimeoutError:
            continue
