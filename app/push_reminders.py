"""Opted-in daily reminders, claimed durably before any external delivery."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import delete, or_, select, update

from .database import session_scope
from .game_access import can_account_access_zilch
from .game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE
from .models import User, WebPushSubscription
from .product_hosts import site_origin, zilch_url
from .security import as_utc, utcnow
from .web_push import (
    DAILY_REMINDER_TIMEZONE,
    StoredSubscription,
    _send_web_push,
    daily_reminder_hour,
    web_push_available,
)

logger = logging.getLogger(__name__)
REMINDER_POLL_SECONDS = 60
REMINDER_BATCH_SIZE = 50
REMINDER_TTL_SECONDS = 60 * 60

# Each row is one DE/EN pair; the daily rotation is deterministic so retries
# and multiple devices never choose a different message for the same account.
REMINDER_COPY = {
    ZILCH_GAME_TYPE: (
        ("Heute schon gezilcht? Die Würfel haben keine Lust auf einen Ruhetag.",
         "Played Zilch today? The dice aren't in the mood for a day off."),
        ("Dein Würfelarm hatte genug Pause. Eine Runde Zilch?",
         "Your dice-rolling arm has had enough rest. Fancy a round of Zilch?"),
        ("Neue Runde, neue Chancen: Schnapp dir Mitspieler und jag ein paar Zilch-Achievements!",
         "New round, new chances: grab some friends and chase a few Zilch achievements!"),
        ("Die 10’000 rufen. Zeit für eine Runde Zilch!",
         "10,000 points are calling. Time for a round of Zilch!"),
        ("Weniger scrollen, mehr rollen. Wer sitzt heute mit dir am Zilch-Tisch?",
         "Less scrolling, more rolling. Who's joining you at the Zilch table today?"),
        ("Ein Zilch kommt selten allein. Deine Mitspieler hoffentlich auch nicht!",
         "One Zilch often brings another. Let's hope it brings some friends, too!"),
    ),
    DEFAULT_GAME_TYPE: (
        ("Heute schon die Wand angezockt? Dein Punkteblock wird langsam ungeduldig.",
         "Played ZDWA today? Your score sheet is getting impatient."),
        ("Die Wand steht noch. Zeit, sie mit einer guten Runde zu beeindrucken!",
         "The wall is still standing. Time to impress it with a great round!"),
        ("Ein paar Würfel, nette Leute, neue Achievements. Klingt nach einem ZDWA-Abend.",
         "A few dice, good company, new achievements. Sounds like a ZDWA evening."),
        ("Dein Highscore hat es sich bequem gemacht. Bring ihn bei ZDWA ins Schwitzen!",
         "Your high score is getting comfortable. Give it a workout in ZDWA!"),
        ("Ansagen kann jeder. Heute wird gewürfelt! Wer zockt mit dir die Wand an?",
         "Talk is cheap. Today we roll! Who's joining you for ZDWA?"),
        ("Die Würfel sind bereit. Deine nächste ZDWA-Runde und neue Achievements warten.",
         "The dice are ready. Your next ZDWA round and new achievements await."),
    ),
}


@dataclass(frozen=True)
class DailyReminder:
    user_id: int
    day: date
    game_type: str
    language: str
    variant: int
    subscriptions: tuple[StoredSubscription, ...]


def reminder_day(now: datetime) -> date | None:
    """Allow this hour only; never catch up old reminders late at night."""
    local = as_utc(now).astimezone(ZoneInfo(DAILY_REMINDER_TIMEZONE))
    return local.date() if local.hour == daily_reminder_hour() else None


def claim_daily_reminder(user_id: int, day: date) -> DailyReminder | None:
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
                or_(User.daily_reminder_push_last_sent_on.is_(None), User.daily_reminder_push_last_sent_on < day),
            )
            .values(daily_reminder_push_last_sent_on=day)
            .returning(User.id)
        ).scalar_one_or_none()
        if claimed is None:
            return None
        # When both PWAs are installed, alternate games instead of sending
        # two reminders. All subscribed devices of the selected game receive
        # the same reminder; other game subscriptions are left alone today.
        context = contexts[(day.toordinal() + user_id) % len(contexts)]
        return DailyReminder(
            user_id=user_id,
            day=day,
            game_type=context,
            language="en" if user.preferred_language == "en" else "de",
            variant=(day.toordinal() // len(contexts) + user_id) % len(REMINDER_COPY[context]),
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
    day = reminder_day(now or utcnow())
    if day is None or not web_push_available():
        return 0
    with session_scope() as db:
        user_ids = list(db.scalars(
            select(User.id)
            .join(WebPushSubscription, WebPushSubscription.user_id == User.id)
            .where(
                User.is_active.is_(True), User.daily_reminder_push_enabled.is_(True),
                or_(User.daily_reminder_push_last_sent_on.is_(None), User.daily_reminder_push_last_sent_on < day),
            )
            .distinct().order_by(User.id)
        ))
    dispatched = 0
    accepted = 0
    for user_id in user_ids:
        if dispatched >= REMINDER_BATCH_SIZE:
            break
        if now is None and reminder_day(utcnow()) != day:
            break
        reminder = claim_daily_reminder(user_id, day)
        if reminder is None:
            continue
        payload = reminder_payload(reminder)
        for subscription in reminder.subscriptions:
            if now is None and reminder_day(utcnow()) != day:
                break
            # Check again after preceding deliveries: a global opt-out while
            # a batch is running must remove any not-yet-dispatched endpoints.
            with session_scope() as db:
                still_eligible = db.scalar(select(WebPushSubscription.id).join(User).where(
                    WebPushSubscription.id == subscription.id,
                    WebPushSubscription.user_id == user_id,
                    User.is_active.is_(True), User.daily_reminder_push_enabled.is_(True),
                ))
            if still_eligible is None:
                continue
            sent, expired = await asyncio.to_thread(_send_web_push, subscription, payload, ttl=REMINDER_TTL_SECONDS)
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
