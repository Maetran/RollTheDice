"""Opt-in Web Push subscriptions and waiting-room invitation delivery.

The browser gives this service an endpoint only after a deliberate settings
action.  Endpoints are treated as sensitive capabilities: they are validated
before storage, never returned to a client, and are removed after the push
service reports that they have expired.
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from ipaddress import ip_address
from urllib.parse import quote, urlsplit

from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select, update

from .database import session_scope
from .game_access import can_account_access_zilch
from .game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE, game_type_from_state
from .models import User, WebPushSubscription
from .product_hosts import site_origin, zilch_url
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)

WEB_PUSH_PUBLIC_KEY_ENV = "ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY"
WEB_PUSH_PRIVATE_KEY_ENV = "ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY"
WEB_PUSH_SUBJECT_ENV = "ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT"
GAME_INVITE_PUSH_COOLDOWN_SECONDS = 10 * 60
GAME_INVITE_PUSH_ACCOUNT_COOLDOWN_SECONDS = 60
GAME_INVITE_PUSH_SENT_AT_KEY = "_game_invite_push_sent_at"
_MAX_ENDPOINT_LENGTH = 2_048
_MAX_KEY_LENGTH = 256
_PUSH_ENDPOINT_SUFFIXES = (
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "push.apple.com",
    "notify.windows.com",
)


@dataclass(frozen=True)
class WebPushConfig:
    public_key: str
    private_key: str
    subject: str

    @property
    def enabled(self) -> bool:
        return bool(self.public_key and self.private_key and self.subject)


@dataclass(frozen=True)
class StoredSubscription:
    id: int
    user_id: int
    endpoint: str
    p256dh: str
    auth: str
    product_context: str
    preferred_language: str


@dataclass(frozen=True)
class GameInviteDispatch:
    attempted: int
    accepted: int
    expired: int


class WebPushSubscriptionKeys(BaseModel):
    p256dh: str = Field(min_length=1, max_length=_MAX_KEY_LENGTH)
    auth: str = Field(min_length=1, max_length=_MAX_KEY_LENGTH)


class WebPushSubscriptionRequest(BaseModel):
    endpoint: str = Field(min_length=1, max_length=_MAX_ENDPOINT_LENGTH)
    keys: WebPushSubscriptionKeys


def web_push_config() -> WebPushConfig:
    return WebPushConfig(
        public_key=os.getenv(WEB_PUSH_PUBLIC_KEY_ENV, "").strip(),
        private_key=os.getenv(WEB_PUSH_PRIVATE_KEY_ENV, "").strip(),
        subject=os.getenv(WEB_PUSH_SUBJECT_ENV, "").strip(),
    )


def _decode_base64url(value: str) -> bytes | None:
    try:
        if not value or any(character.isspace() for character in value):
            return None
        return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (ValueError, binascii.Error):
        return None


def _valid_vapid_public_key(value: str) -> bool:
    decoded = _decode_base64url(value)
    return bool(decoded and len(decoded) == 65 and decoded[0] == 4)


def validate_web_push_config() -> None:
    """Reject ambiguous production configuration before accepting traffic."""
    config = web_push_config()
    configured = (bool(config.public_key), bool(config.private_key), bool(config.subject))
    if any(configured) and not all(configured):
        raise RuntimeError(
            "Web Push requires ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY, "
            "ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY and "
            "ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT together"
        )
    if not config.enabled:
        return
    if not _valid_vapid_public_key(config.public_key):
        raise RuntimeError("ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY must be a VAPID public key")
    parsed = urlsplit(config.subject)
    valid_mailto = config.subject.startswith("mailto:") and len(config.subject) > len("mailto:")
    valid_url = parsed.scheme in {"https", "http"} and bool(parsed.hostname)
    if not (valid_mailto or valid_url):
        raise RuntimeError("ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT must be a mailto: address or HTTP(S) URL")


def web_push_available() -> bool:
    return web_push_config().enabled


def _supported_push_endpoint(endpoint: str) -> bool:
    try:
        parsed = urlsplit(endpoint)
        port = parsed.port
    except ValueError:
        return False
    hostname = (parsed.hostname or "").casefold()
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
        or not parsed.path
        or port not in {None, 443}
    ):
        return False
    try:
        ip_address(hostname)
    except ValueError:
        pass
    else:
        return False
    return any(hostname == suffix or hostname.endswith(f".{suffix}") for suffix in _PUSH_ENDPOINT_SUFFIXES)


def _valid_subscription_keys(p256dh: str, auth: str) -> bool:
    public_key = _decode_base64url(p256dh)
    auth_secret = _decode_base64url(auth)
    return bool(
        public_key
        and len(public_key) == 65
        and public_key[0] == 4
        and auth_secret
        and 16 <= len(auth_secret) <= 64
    )


def _validated_subscription(payload: WebPushSubscriptionRequest) -> tuple[str, str, str]:
    endpoint = payload.endpoint.strip()
    p256dh = payload.keys.p256dh.strip()
    auth = payload.keys.auth.strip()
    if not _supported_push_endpoint(endpoint) or not _valid_subscription_keys(p256dh, auth):
        raise ValueError("web_push_subscription_invalid")
    return endpoint, p256dh, auth


def web_push_subscription_status(user_id: int) -> dict[str, object]:
    config = web_push_config()
    with session_scope() as db:
        user = db.get(User, user_id)
        subscribed = bool(
            user
            and db.scalar(select(WebPushSubscription.id).where(WebPushSubscription.user_id == user_id).limit(1))
        )
        enabled = bool(user and user.game_invite_push_enabled and subscribed)
    return {
        "available": config.enabled,
        "public_key": config.public_key if config.enabled else None,
        "enabled": enabled,
        "subscribed": subscribed,
    }


def save_web_push_subscription(
    *,
    user_id: int,
    payload: WebPushSubscriptionRequest,
    product_context: str,
) -> dict[str, object]:
    if not web_push_available():
        raise RuntimeError("web_push_unavailable")
    endpoint, p256dh, auth = _validated_subscription(payload)
    context = ZILCH_GAME_TYPE if product_context == ZILCH_GAME_TYPE else DEFAULT_GAME_TYPE
    now = utcnow()
    with session_scope() as db:
        user = db.get(User, user_id)
        if user is None:
            raise LookupError("user_not_found")
        subscription = db.scalar(select(WebPushSubscription).where(WebPushSubscription.endpoint == endpoint))
        if subscription is None:
            db.add(
                WebPushSubscription(
                    user_id=user.id,
                    endpoint=endpoint,
                    p256dh=p256dh,
                    auth=auth,
                    product_context=context,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            # A device can legitimately be signed out and then used by a
            # different account. Its endpoint must belong to the currently
            # authenticated account, never to a previous browser session.
            subscription.user_id = user.id
            subscription.p256dh = p256dh
            subscription.auth = auth
            subscription.product_context = context
            subscription.updated_at = now
        user.game_invite_push_enabled = True
        user.updated_at = now
        db.flush()
    return {"available": True, "enabled": True, "subscribed": True}


def remove_web_push_subscriptions(user_id: int) -> dict[str, object]:
    with session_scope() as db:
        user = db.get(User, user_id)
        if user is None:
            raise LookupError("user_not_found")
        db.execute(delete(WebPushSubscription).where(WebPushSubscription.user_id == user.id))
        user.game_invite_push_enabled = False
        user.updated_at = utcnow()
    return {"available": web_push_available(), "enabled": False, "subscribed": False}


def game_invite_cooldown_remaining(game: dict) -> int:
    value = game.get(GAME_INVITE_PUSH_SENT_AT_KEY)
    if not isinstance(value, str) or not value.strip():
        return 0
    try:
        normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
        parsed = datetime.fromisoformat(normalized)
        sent_at = parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return 0
    remaining = GAME_INVITE_PUSH_COOLDOWN_SECONDS - int((utcnow() - sent_at).total_seconds())
    return max(0, remaining)


def claim_game_invite_push(user_id: int) -> int:
    """Atomically reserve one account-wide invitation per minute.

    Persist before any delivery attempt: parallel tabs, different games,
    reconnects and process restarts must not reset this flood barrier. Even a
    request with no currently reachable recipients consumes the account slot.
    Return zero on success, otherwise the remaining cooldown in seconds.
    """
    now = utcnow()
    cutoff = now - timedelta(seconds=GAME_INVITE_PUSH_ACCOUNT_COOLDOWN_SECONDS)
    with session_scope() as db:
        claimed = db.execute(
            update(User)
            .where(
                User.id == user_id,
                or_(User.game_invite_push_last_sent_at.is_(None), User.game_invite_push_last_sent_at <= cutoff),
            )
            .values(game_invite_push_last_sent_at=now)
            .returning(User.id)
        ).scalar_one_or_none()
        if claimed is not None:
            return 0
        sent_at = db.scalar(select(User.game_invite_push_last_sent_at).where(User.id == user_id))
        if sent_at is None:
            raise LookupError("user_not_found")
        return max(1, math.ceil(GAME_INVITE_PUSH_ACCOUNT_COOLDOWN_SECONDS - (now - as_utc(sent_at)).total_seconds()))


def mark_game_invite_push_sent(game: dict) -> None:
    game[GAME_INVITE_PUSH_SENT_AT_KEY] = utcnow().isoformat()


def open_seat_invitation_error(game: dict, *, user_id: int) -> str | None:
    """Return the stable API error for an unsafe or non-waiting room."""
    if game.get("_passphrase"):
        return "game_invite_private_room"
    if game.get("_started") or game.get("_finished") or game.get("_aborted") or game.get("_completion_persisted"):
        return "game_invite_not_waiting"
    players = [player for player in game.get("_players", []) if isinstance(player, dict)]
    if not any(player.get("user_id") == user_id for player in players):
        return "game_invite_not_player"
    try:
        game_type = game_type_from_state(game)
        expected = int(game.get("_expected", 0))
    except (TypeError, ValueError):
        return "game_invite_not_waiting"
    if game_type == ZILCH_GAME_TYPE and game.get("_play_mode", "multiplayer") != "multiplayer":
        return "game_invite_not_waiting"
    if expected < 2 or len(players) >= expected:
        return "game_invite_no_open_seat"
    return None


def _waiting_player_names(game: dict) -> list[str]:
    names: list[str] = []
    for index, player in enumerate(game.get("_players", []), start=1):
        if not isinstance(player, dict):
            continue
        name = str(player.get("name") or f"Spieler {index}").strip()
        if name:
            names.append(name[:32])
    return names


def _joined_names(names: list[str], *, language: str) -> str:
    if not names:
        return ""
    conjunction = "and" if language == "en" else "und"
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} {conjunction} {names[1]}"
    return f"{', '.join(names[:-1])} {conjunction} {names[-1]}"


def game_invite_notification_payload(
    *,
    game: dict,
    destination: str,
    language: str,
    product_context: str,
) -> dict[str, object]:
    game_type = game_type_from_state(game)
    waiting_names = _waiting_player_names(game)
    next_player = len(waiting_names) + 1
    names = _joined_names(waiting_names, language=language)
    product_name = "Zilch" if game_type == ZILCH_GAME_TYPE else "ZDWA"
    if language == "en":
        ordinal = {2: "second", 3: "third", 4: "fourth"}.get(next_player, "next")
        if len(waiting_names) == 1:
            body = f"{names} is waiting in {product_name} for a {ordinal} player. Join in!"
        else:
            body = f"{names} are waiting in {product_name} for a {ordinal} player. Join in!"
        title = f"{product_name} is looking for players"
    else:
        ordinal = {2: "zweiten", 3: "dritten", 4: "vierten"}.get(next_player, "nächsten")
        waits = "wartet" if len(waiting_names) == 1 else "warten"
        body = f"{names} {waits} in {product_name} auf einen {ordinal} Mitspieler. Sei dabei!"
        title = f"{product_name} sucht Mitspieler"
    icon = "/static/icons/zilch-icon-192.png" if product_context == ZILCH_GAME_TYPE else "/static/icons/icon-192.png"
    return {
        "title": title,
        "body": body,
        "url": destination,
        "tag": f"game-invite-{game_type}-{game.get('_id', '')}",
        "icon": icon,
        "badge": icon,
    }


def game_invite_destinations(game: dict, subscriptions: list[StoredSubscription]) -> list[tuple[StoredSubscription, str]]:
    game_type = game_type_from_state(game)
    game_id = quote(str(game.get("_id") or ""), safe="")
    if not game_id:
        return []
    destination = zilch_url(f"/spiel/{game_id}") if game_type == ZILCH_GAME_TYPE else f"{site_origin()}/spiel/{game_id}"
    return [(subscription, destination) for subscription in subscriptions]


def game_invite_push_recipients(game: dict) -> list[StoredSubscription]:
    """Load only opted-in accounts allowed to see this product and not seated."""
    game_type = game_type_from_state(game)
    seated_ids = {
        int(player["user_id"])
        for player in game.get("_players", [])
        if isinstance(player, dict) and type(player.get("user_id")) is int
    }
    with session_scope() as db:
        rows = db.execute(
            select(WebPushSubscription, User)
            .join(User, WebPushSubscription.user_id == User.id)
            .where(User.is_active.is_(True), User.game_invite_push_enabled.is_(True))
        ).all()
    recipients: list[StoredSubscription] = []
    for subscription, user in rows:
        if user.id in seated_ids:
            continue
        if game_type == ZILCH_GAME_TYPE and not can_account_access_zilch(username=user.username, role=user.role):
            continue
        recipients.append(
            StoredSubscription(
                id=subscription.id,
                user_id=user.id,
                endpoint=subscription.endpoint,
                p256dh=subscription.p256dh,
                auth=subscription.auth,
                product_context=subscription.product_context,
                preferred_language=user.preferred_language if user.preferred_language == "en" else "de",
            )
        )
    return recipients


def _push_failure_status(error: BaseException) -> int | None:
    response = getattr(error, "response", None)
    for candidate in (getattr(error, "status_code", None), getattr(response, "status_code", None)):
        if isinstance(candidate, int):
            return candidate
    return None


def _send_web_push(subscription: StoredSubscription, payload: dict[str, object]) -> tuple[bool, bool]:
    """Return (accepted_by_push_service, subscription_expired)."""
    config = web_push_config()
    try:
        from pywebpush import webpush

        webpush(
            subscription_info={
                "endpoint": subscription.endpoint,
                "keys": {"p256dh": subscription.p256dh, "auth": subscription.auth},
            },
            data=json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            vapid_private_key=config.private_key,
            vapid_claims={"sub": config.subject},
            ttl=300,
            timeout=8,
        )
        return True, False
    except Exception as exc:  # pywebpush wraps only some transport failures.
        status_code = _push_failure_status(exc)
        expired = status_code in {404, 410}
        logger.info(
            "Web Push dispatch failed for subscription %s%s",
            subscription.id,
            " (expired)" if expired else "",
        )
        return False, expired


async def dispatch_game_invite_push(game: dict, subscriptions: list[StoredSubscription]) -> GameInviteDispatch:
    """Dispatch one waiting-room invite without retaining endpoint details in logs."""
    if not subscriptions:
        return GameInviteDispatch(attempted=0, accepted=0, expired=0)
    deliveries = game_invite_destinations(game, subscriptions)
    results = await asyncio.gather(
        *(
            asyncio.to_thread(
                _send_web_push,
                subscription,
                game_invite_notification_payload(
                    game=game,
                    destination=destination,
                    language=subscription.preferred_language,
                    product_context=subscription.product_context,
                ),
            )
            for subscription, destination in deliveries
        )
    )
    expired_ids = [
        subscription.id
        for (subscription, _destination), (_accepted, expired) in zip(deliveries, results, strict=True)
        if expired
    ]
    if expired_ids:
        with session_scope() as db:
            db.execute(delete(WebPushSubscription).where(WebPushSubscription.id.in_(expired_ids)))
    return GameInviteDispatch(
        attempted=len(deliveries),
        accepted=sum(1 for accepted, _expired in results if accepted),
        expired=len(expired_ids),
    )
