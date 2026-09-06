"""Durable release outbox, populated only after a successful production deploy."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.sqlite import insert

from .database import configure_database, session_scope
from .game_access import can_account_access_zilch
from .models import PushRelease, PushReleaseRecipient, User, WebPushSubscription
from .product_hosts import site_origin, zilch_url
from .release_manifest import ReleaseNotice
from .security import as_utc, utcnow
from .web_push import StoredSubscription, _send_web_push, web_push_available

logger = logging.getLogger(__name__)
RELEASE_TTL_SECONDS = 24 * 60 * 60
RELEASE_BATCH_SIZE = 50


def _subscription_identity(subscription: WebPushSubscription) -> str:
    # SQLite can reuse deleted integer IDs. Freeze the registration identity
    # as well, without duplicating sensitive endpoint URLs in the release log.
    identity = [subscription.endpoint, subscription.user_id, subscription.product_context,
                as_utc(subscription.created_at).isoformat(), as_utc(subscription.updated_at).isoformat()]
    return hashlib.sha256(json.dumps(identity).encode("utf-8")).hexdigest()


def publish_release_notice(notice: ReleaseNotice, *, now: datetime | None = None) -> int:
    """Freeze consenting accounts/devices once. Repeating a revision is a no-op."""
    now = now or utcnow()
    with session_scope() as db:
        inserted = db.execute(insert(PushRelease).values(
            revision=notice.revision, kind=notice.kind, summary_de=notice.summary_de, summary_en=notice.summary_en,
            game_types_json=json.dumps(list(notice.games)), published_at=now,
        ).on_conflict_do_nothing(index_elements=["revision"]).returning(PushRelease.revision)).scalar_one_or_none()
        if inserted is None:
            return 0
        rows = db.execute(select(User, WebPushSubscription).join(
            WebPushSubscription, WebPushSubscription.user_id == User.id,
        ).where(
            User.is_active.is_(True), User.release_push_enabled.is_(True),
            WebPushSubscription.product_context.in_(notice.games),
        ).order_by(WebPushSubscription.updated_at.desc(), WebPushSubscription.id.desc())).all()
        audience: dict[int, list[WebPushSubscription]] = {}
        for user, subscription in rows:
            if subscription.product_context == "zilch" and not can_account_access_zilch(username=user.username, role=user.role):
                continue
            audience.setdefault(user.id, []).append(subscription)
        for user_id, subscriptions in audience.items():
            # A shared release is one account notification, not one per game.
            # Prefer the most recently registered eligible product's devices.
            context = subscriptions[0].product_context
            db.add(PushReleaseRecipient(
                revision=notice.revision, user_id=user_id, product_context=context,
                subscription_snapshot_json=json.dumps([
                    {"id": sub.id, "identity": _subscription_identity(sub)} for sub in subscriptions if sub.product_context == context
                ]),
            ))
    return len(audience)


def release_notification_payload(release: PushRelease, context: str, language: str) -> dict:
    game = "Zilch" if context == "zilch" else "ZDWA"
    icon = "/static/icons/zilch-icon-192.png" if context == "zilch" else "/static/icons/icon-192.png"
    return {
        "title": f"{game}: {'Update available' if language == 'en' else 'Neue Version verfügbar'}",
        "body": release.summary_en if language == "en" else release.summary_de,
        "url": zilch_url("/") if context == "zilch" else f"{site_origin()}/",
        "tag": f"app-release-{release.revision}", "icon": icon, "badge": icon,
    }


async def dispatch_release_notifications(*, now: datetime | None = None) -> int:
    if not web_push_available():
        return 0
    with session_scope() as db:
        pending = db.execute(select(PushReleaseRecipient.revision, PushReleaseRecipient.user_id).join(PushRelease).where(
            PushReleaseRecipient.claimed_at.is_(None),
        ).order_by(PushRelease.published_at, PushReleaseRecipient.user_id).limit(RELEASE_BATCH_SIZE)).all()
    claimed_count = 0
    for revision, user_id in pending:
        current = now or utcnow()
        with session_scope() as db:
            claimed = db.execute(update(PushReleaseRecipient).where(
                PushReleaseRecipient.revision == revision, PushReleaseRecipient.user_id == user_id,
                PushReleaseRecipient.claimed_at.is_(None),
            ).values(claimed_at=current).returning(PushReleaseRecipient.revision)).scalar_one_or_none()
            if claimed is None:
                continue
            claimed_count += 1
            recipient = db.get(PushReleaseRecipient, (revision, user_id))
            release = db.get(PushRelease, revision)
            context = recipient.product_context
            subscription_snapshot = json.loads(recipient.subscription_snapshot_json)
        # Claim before any external effect; failures and restarts never retry
        # this account/revision. Newly registered devices are not backfilled.
        for device in subscription_snapshot:
            subscription_id = device["id"]
            current = now or utcnow()
            expires = as_utc(release.published_at) + timedelta(seconds=RELEASE_TTL_SECONDS)
            ttl = min(RELEASE_TTL_SECONDS, int((expires - as_utc(current)).total_seconds()))
            if ttl <= 0:
                break
            with session_scope() as db:
                row = db.execute(select(WebPushSubscription, User).join(User).where(
                    WebPushSubscription.id == subscription_id, WebPushSubscription.user_id == user_id,
                    WebPushSubscription.product_context == context,
                    User.is_active.is_(True), User.release_push_enabled.is_(True),
                )).first()
                if row is None:
                    continue
                sub, user = row
                if _subscription_identity(sub) != device["identity"]:
                    continue
                if context == "zilch" and not can_account_access_zilch(username=user.username, role=user.role):
                    continue
                stored = StoredSubscription(
                    id=sub.id, user_id=user_id, endpoint=sub.endpoint, p256dh=sub.p256dh, auth=sub.auth,
                    product_context=context, preferred_language=user.preferred_language,
                )
                payload = release_notification_payload(release, context, user.preferred_language)
            _accepted, expired = await asyncio.to_thread(_send_web_push, stored, payload, ttl=ttl)
            if expired:
                with session_scope() as db:
                    db.execute(delete(WebPushSubscription).where(WebPushSubscription.id == subscription_id, WebPushSubscription.user_id == user_id))
    if claimed_count:
        logger.info("Release notifications: %s account dispatches claimed", claimed_count)
    return claimed_count


async def run_release_push_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await dispatch_release_notifications()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Release push batch failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=30)
        except asyncio.TimeoutError:
            continue


def main() -> None:
    """Operator-only deploy hook: read reviewed metadata from stdin, no HTTP API."""
    payload = json.load(sys.stdin)
    if isinstance(payload, dict) and payload.get("skip"):
        print("No application changes: release notification skipped.")
        return
    notice = ReleaseNotice.from_payload(payload)
    configure_database(Path(os.getenv("ROLLTHEDICE_DATA_DIR", "/app/data")))
    audience = publish_release_notice(notice)
    print(f"Release {notice.revision[:12]} registered for {audience} opted-in accounts.")


if __name__ == "__main__":
    main()
