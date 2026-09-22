"""Durable, account-scoped help requests with independent admin push delivery."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from datetime import datetime, timedelta
from urllib.parse import urlencode

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from .database import database_schema_ready, session_scope
from .game_state import games
from .game_types import game_type_from_state
from .models import AdminHelpRecipient, AdminHelpRequest, User, WebPushSubscription
from .product_hosts import site_origin, zilch_origin
from .security import as_utc, utcnow
from .web_push import StoredSubscription, _send_web_push, web_push_available

logger = logging.getLogger(__name__)
ADMIN_HELP_PUSH_TTL_SECONDS = 5 * 60
ADMIN_HELP_BATCH_SIZE = 30
ADMIN_HELP_ASSIGNMENT_TTL = timedelta(hours=1)


def _error(code: str, status: int = 409) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code})


def game_is_active(game: dict | None) -> bool:
    return bool(game and not game.get("_finished") and not game.get("_aborted") and not game.get("_completion_persisted"))


def is_game_player(game: dict | None, user_id: int) -> bool:
    if not game:
        return False
    return any(
        isinstance(player, dict) and type(player.get("user_id")) is int and player["user_id"] == user_id
        and player.get("type", "human") != "cpu"
        for player in [*game.get("_players", []), *game.get("_participants", [])]
    )


def _user_projection(db, user_id: int | None) -> dict | None:
    user = db.get(User, user_id) if user_id else None
    return {"id": user.id, "username": user.username} if user else None


def help_request_projection(db, request: AdminHelpRequest) -> dict:
    from .admin_help_navigation import game_url

    origin = games.get(request.origin_game_id)
    return {
        "id": request.id,
        "requester_user_id": request.requester_user_id,
        "requester": _user_projection(db, request.requester_user_id),
        "game_id": request.game_id, "game_type": request.game_type, "game_name": request.game_name,
        "created_at": as_utc(request.created_at).isoformat(),
        "status": "resolved" if request.resolved_at else "claimed" if request.claimed_by_user_id else "open",
        "claimed_by_user_id": request.claimed_by_user_id,
        "claimed_by": _user_projection(db, request.claimed_by_user_id),
        "claimed_at": as_utc(request.claimed_at).isoformat() if request.claimed_at else None,
        "origin_game_id": request.origin_game_id,
        "help_url": f"{game_url(request.game_id, request.game_type, spectator=True)}?{urlencode({'help_request': request.id})}",
        "return_url": game_url(request.origin_game_id, game_type_from_state(origin)) if origin else None,
        "resolved_at": as_utc(request.resolved_at).isoformat() if request.resolved_at else None,
        "outcome": request.outcome,
    }


def _current_admin(db, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None or not user.is_active or user.role != "admin":
        raise _error("admin_required", 403)
    return user


def _subscription_identity(subscription: WebPushSubscription) -> str:
    identity = [subscription.endpoint, subscription.user_id, subscription.product_context,
                as_utc(subscription.created_at).isoformat(), as_utc(subscription.updated_at).isoformat()]
    return hashlib.sha256(json.dumps(identity).encode("utf-8")).hexdigest()


def _freeze_recipients(db, request: AdminHelpRequest) -> None:
    admins = db.scalars(select(User).where(
        User.role == "admin", User.is_active.is_(True), User.id != request.requester_user_id,
    )).all()
    for admin in admins:
        subscriptions = list(db.scalars(select(WebPushSubscription).where(
            WebPushSubscription.user_id == admin.id,
        ).order_by(WebPushSubscription.updated_at.desc(), WebPushSubscription.id.desc()))) if admin.admin_help_push_enabled else []
        # One product's devices per account avoids receiving the same call
        # from both installed games. All devices of that product remain useful.
        context = subscriptions[0].product_context if subscriptions else None
        db.add(AdminHelpRecipient(
            request_id=request.id, user_id=admin.id,
            subscription_snapshot_json=json.dumps([
                {"id": sub.id, "identity": _subscription_identity(sub)}
                for sub in subscriptions if sub.product_context == context
            ]),
        ))


def create_help_request(game_id: str, requester_user_id: int) -> tuple[dict, bool]:
    from .moderation import admin_help_blocked

    game = games.get(game_id)
    if not game_is_active(game):
        raise _error("admin_help_game_unavailable", 404)
    if not is_game_player(game, requester_user_id):
        raise _error("admin_help_not_player", 403)
    with session_scope() as db:
        # Serialize account requests before reading the open row. The partial
        # unique index is also the durable cross-process/restart flood barrier.
        user_id = db.execute(update(User).where(
            User.id == requester_user_id, User.is_active.is_(True),
        ).values(updated_at=User.updated_at).returning(User.id)).scalar_one_or_none()
        if user_id is None:
            raise _error("authentication_required", 401)
        if admin_help_blocked(requester_user_id):
            raise _error("admin_help_blocked", 403)
        existing = db.scalar(select(AdminHelpRequest).where(
            AdminHelpRequest.requester_user_id == requester_user_id, AdminHelpRequest.resolved_at.is_(None),
        ))
        if existing:
            if existing.game_id != game_id:
                raise _error("admin_help_already_open")
            return help_request_projection(db, existing), False
        request = AdminHelpRequest(
            id=uuid.uuid4().hex, requester_user_id=requester_user_id,
            game_id=game_id, game_type=game_type_from_state(game), game_name=str(game.get("_name") or "")[:160],
            created_at=utcnow(),
        )
        db.add(request)
        db.flush()
        _freeze_recipients(db, request)
        return help_request_projection(db, request), True


def get_help_request(request_id: str, admin_user_id: int) -> dict:
    with session_scope() as db:
        _current_admin(db, admin_user_id)
        request = db.get(AdminHelpRequest, request_id)
        if request is None:
            raise _error("admin_help_not_found", 404)
        return help_request_projection(db, request)


def list_help_requests(admin_user_id: int) -> list[dict]:
    with session_scope() as db:
        _current_admin(db, admin_user_id)
        return [help_request_projection(db, request) for request in db.scalars(select(AdminHelpRequest).where(
            AdminHelpRequest.resolved_at.is_(None),
        ).order_by(AdminHelpRequest.created_at, AdminHelpRequest.id)).all()]


def help_status(user_id: int | None, game_id: str = "") -> dict:
    from .moderation import admin_help_blocked

    empty = {"authenticated": False, "is_admin": False, "admin_help_enabled": False,
             "blocked": False, "can_request": False, "request": None, "requests": [], "active_claim": None,
             "return_to_game": None}
    if not user_id:
        return empty
    with session_scope() as db:
        user = db.get(User, user_id)
        if user is None or not user.is_active:
            return empty
        own = db.scalar(select(AdminHelpRequest).where(
            AdminHelpRequest.requester_user_id == user_id, AdminHelpRequest.resolved_at.is_(None),
        ))
        if own is None and game_id:
            own = db.scalar(select(AdminHelpRequest).where(
                AdminHelpRequest.requester_user_id == user_id, AdminHelpRequest.game_id == game_id,
            ).order_by(AdminHelpRequest.created_at.desc(), AdminHelpRequest.id.desc()).limit(1))
        admin = user.role == "admin"
        queue = list(db.scalars(select(AdminHelpRequest).where(
            AdminHelpRequest.resolved_at.is_(None),
        ).order_by(AdminHelpRequest.created_at, AdminHelpRequest.id))) if admin else []
        projections = [help_request_projection(db, item) for item in queue]
        previous = db.scalar(select(AdminHelpRequest).where(
            AdminHelpRequest.claimed_by_user_id == user_id, AdminHelpRequest.origin_game_id.is_not(None),
        ).order_by(AdminHelpRequest.claimed_at.desc()).limit(1)) if admin else None
        blocked = admin_help_blocked(user_id)
        return {
            "authenticated": True, "viewer_id": user_id, "is_admin": admin,
            "admin_help_enabled": bool(admin and user.admin_help_push_enabled), "blocked": blocked,
            "can_request": bool(not blocked and not (own and own.resolved_at is None)
                                and game_is_active(games.get(game_id)) and is_game_player(games.get(game_id), user_id)),
            "request": help_request_projection(db, own) if own else None, "requests": projections,
            "active_claim": next((item for item in projections if item["claimed_by_user_id"] == user_id), None),
            "return_to_game": {"request_id": previous.id, "game_id": previous.origin_game_id,
                               "url": help_request_projection(db, previous)["return_url"]} if previous else None,
        }


def claim_help_request(request_id: str, admin_user_id: int, origin_game_id: str | None = None) -> dict:
    from .moderation import user_play_banned

    if user_play_banned(admin_user_id):
        raise _error("play_banned", 403)
    try:
        with session_scope() as db:
            _current_admin(db, admin_user_id)
            request = db.get(AdminHelpRequest, request_id)
            if request is None:
                raise _error("admin_help_not_found", 404)
            if request.resolved_at:
                raise _error("admin_help_resolved")
            if request.requester_user_id == admin_user_id:
                raise _error("admin_help_own_request")
            if not game_is_active(games.get(request.game_id)):
                raise _error("admin_help_game_unavailable", 404)
            if origin_game_id and (
                origin_game_id == request.game_id or not game_is_active(games.get(origin_game_id))
                or not is_game_player(games.get(origin_game_id), admin_user_id)
            ):
                raise _error("admin_help_invalid_origin", 403)
            if request.claimed_by_user_id == admin_user_id:
                claimed = db.execute(update(AdminHelpRequest).where(
                    AdminHelpRequest.id == request_id, AdminHelpRequest.resolved_at.is_(None),
                    AdminHelpRequest.claimed_by_user_id == admin_user_id,
                    AdminHelpRequest.claimed_at > utcnow() - ADMIN_HELP_ASSIGNMENT_TTL,
                ).values(origin_game_id=origin_game_id or AdminHelpRequest.origin_game_id)
                    .execution_options(synchronize_session=False)
                    .returning(AdminHelpRequest.id)).scalar_one_or_none()
                if claimed is None:
                    raise _error("admin_help_resolved")
                db.refresh(request)
                return help_request_projection(db, request)
            claimed = db.execute(update(AdminHelpRequest).where(
                AdminHelpRequest.id == request_id, AdminHelpRequest.resolved_at.is_(None),
                AdminHelpRequest.claimed_by_user_id.is_(None),
            ).values(claimed_by_user_id=admin_user_id, claimed_at=utcnow(), origin_game_id=origin_game_id)
                .returning(AdminHelpRequest.id)).scalar_one_or_none()
            if claimed is None:
                raise _error("admin_help_already_claimed")
            db.refresh(request)
            return help_request_projection(db, request)
    except IntegrityError as exc:
        raise _error("admin_help_admin_busy") from exc


def has_active_help_claim(user_id: int, game_id: str, *, request_id: str | None = None) -> bool:
    from .moderation import user_play_banned

    if not database_schema_ready() or user_play_banned(user_id) or not game_is_active(games.get(game_id)):
        return False
    with session_scope() as db:
        query = select(AdminHelpRequest.id).join(User, User.id == AdminHelpRequest.claimed_by_user_id).where(
            AdminHelpRequest.game_id == game_id, AdminHelpRequest.claimed_by_user_id == user_id,
            AdminHelpRequest.resolved_at.is_(None), AdminHelpRequest.claimed_at > utcnow() - ADMIN_HELP_ASSIGNMENT_TTL,
            User.is_active.is_(True), User.role == "admin",
        )
        if request_id is not None:
            query = query.where(AdminHelpRequest.id == request_id)
        return bool(db.scalar(query.limit(1)))


def resolve_help_request(request_id: str, admin_user_id: int, outcome: str) -> dict:
    from .moderation import apply_help_misuse_ban

    if outcome not in {"resolved", "accidental", "misuse"}:
        raise _error("admin_help_invalid_outcome", 422)
    with session_scope() as db:
        _current_admin(db, admin_user_id)
        request = db.get(AdminHelpRequest, request_id)
        if request is None:
            raise _error("admin_help_not_found", 404)
        if request.claimed_by_user_id != admin_user_id:
            raise _error("admin_help_not_assigned", 403)
        if request.resolved_at:
            return help_request_projection(db, request)
        claimed = db.execute(update(AdminHelpRequest).where(
            AdminHelpRequest.id == request_id, AdminHelpRequest.claimed_by_user_id == admin_user_id,
            AdminHelpRequest.resolved_at.is_(None),
        ).values(resolved_at=utcnow(), resolved_by_user_id=admin_user_id, outcome=outcome)
            .returning(AdminHelpRequest.id)).scalar_one_or_none()
        if claimed is not None and outcome == "misuse":
            apply_help_misuse_ban(db, request.requester_user_id, admin_user_id, request_id)
        db.refresh(request)
        return help_request_projection(db, request)


async def close_stale_help_requests() -> None:
    """Release dead games and revoked admins without stranding an away player."""
    from .admin_help_navigation import end_help_assignment

    ended = []
    with session_scope() as db:
        for request in db.scalars(select(AdminHelpRequest).where(AdminHelpRequest.resolved_at.is_(None))).all():
            if not game_is_active(games.get(request.game_id)) or (
                request.claimed_at and as_utc(request.claimed_at) <= utcnow() - ADMIN_HELP_ASSIGNMENT_TTL
            ):
                db.execute(update(AdminHelpRequest).where(
                    AdminHelpRequest.id == request.id, AdminHelpRequest.resolved_at.is_(None),
                ).values(resolved_at=utcnow(), outcome="resolved"))
                ended.append(request.id)
            elif request.claimed_by_user_id:
                admin = db.get(User, request.claimed_by_user_id)
                if admin is None or not admin.is_active or admin.role != "admin":
                    db.execute(update(AdminHelpRequest).where(
                        AdminHelpRequest.id == request.id, AdminHelpRequest.resolved_at.is_(None),
                        AdminHelpRequest.claimed_by_user_id == request.claimed_by_user_id,
                    ).values(claimed_by_user_id=None, claimed_at=None, origin_game_id=None))
                    ended.append(request.id)
    for request_id in ended:
        await end_help_assignment(request_id)


def clear_help_origin(request_id: str, admin_user_id: int) -> None:
    with session_scope() as db:
        _current_admin(db, admin_user_id)
        changed = db.execute(update(AdminHelpRequest).where(
            AdminHelpRequest.id == request_id, AdminHelpRequest.claimed_by_user_id == admin_user_id,
        ).values(origin_game_id=None)).rowcount
        if not changed:
            raise _error("admin_help_not_assigned", 403)


def release_failed_help_claim(request_id: str, admin_user_id: int) -> None:
    """Undo an assignment if its guarded navigation could not be prepared."""
    with session_scope() as db:
        db.execute(update(AdminHelpRequest).where(
            AdminHelpRequest.id == request_id, AdminHelpRequest.claimed_by_user_id == admin_user_id,
            AdminHelpRequest.resolved_at.is_(None),
        ).values(claimed_by_user_id=None, claimed_at=None, origin_game_id=None))


def help_notification_payload(request: AdminHelpRequest, subscription: StoredSubscription, requester_name: str) -> dict:
    english = subscription.preferred_language == "en"
    product = "Zilch" if request.game_type == "zilch" else "ZDWA"
    icon = "/static/icons/zilch-icon-192.png" if subscription.product_context == "zilch" else "/static/icons/icon-192.png"
    origin = zilch_origin() if subscription.product_context == "zilch" else site_origin()
    return {
        "title": f"{product}: {'Help requested' if english else 'Admin gerufen'}",
        "body": f"{requester_name} {'needs help in' if english else 'braucht Hilfe in'} {request.game_name or product}.",
        # The lobby opens the admin queue. A push link grants no room access;
        # claiming the request is the authenticated, atomic next action.
        "url": f"{origin}/?{urlencode({'admin_help': request.id})}",
        "tag": f"admin-help-{request.id}", "icon": icon, "badge": icon,
    }


async def dispatch_admin_help_notifications(*, request_id: str | None = None, now: datetime | None = None) -> int:
    await close_stale_help_requests()
    if not web_push_available():
        return 0
    with session_scope() as db:
        statement = select(AdminHelpRecipient.request_id, AdminHelpRecipient.user_id).join(AdminHelpRequest).where(
            AdminHelpRecipient.push_claimed_at.is_(None),
        ).order_by(AdminHelpRequest.created_at, AdminHelpRecipient.user_id).limit(ADMIN_HELP_BATCH_SIZE)
        if request_id:
            statement = statement.where(AdminHelpRecipient.request_id == request_id)
        pending = db.execute(statement).all()
    claimed_count = 0
    for pending_id, user_id in pending:
        current = now or utcnow()
        with session_scope() as db:
            claimed = db.execute(update(AdminHelpRecipient).where(
                AdminHelpRecipient.request_id == pending_id, AdminHelpRecipient.user_id == user_id,
                AdminHelpRecipient.push_claimed_at.is_(None),
            ).values(push_claimed_at=current).returning(AdminHelpRecipient.request_id)).scalar_one_or_none()
            if claimed is None:
                continue
            claimed_count += 1
            recipient = db.get(AdminHelpRecipient, (pending_id, user_id))
            devices = json.loads(recipient.subscription_snapshot_json)
        for device in devices:
            with session_scope() as db:
                request = db.get(AdminHelpRequest, pending_id)
                user = db.get(User, user_id)
                sub = db.get(WebPushSubscription, device["id"])
                if (request is None or request.resolved_at or request.claimed_by_user_id
                    or not game_is_active(games.get(request.game_id))
                    or user is None or not user.is_active or user.role != "admin" or not user.admin_help_push_enabled
                    or sub is None or sub.user_id != user_id or _subscription_identity(sub) != device["identity"]):
                    continue
                ttl = min(ADMIN_HELP_PUSH_TTL_SECONDS, int((as_utc(request.created_at)
                    + timedelta(seconds=ADMIN_HELP_PUSH_TTL_SECONDS) - as_utc(now or utcnow())).total_seconds()))
                if ttl <= 0:
                    break
                stored = StoredSubscription(
                    id=sub.id, user_id=user_id, endpoint=sub.endpoint, p256dh=sub.p256dh, auth=sub.auth,
                    product_context=sub.product_context, preferred_language=user.preferred_language,
                )
                requester = db.get(User, request.requester_user_id)
                payload = help_notification_payload(request, stored, requester.username if requester else "Player")
            _accepted, expired = await asyncio.to_thread(_send_web_push, stored, payload, ttl=ttl)
            if expired:
                with session_scope() as db:
                    current_sub = db.get(WebPushSubscription, device["id"])
                    if current_sub and current_sub.user_id == user_id and _subscription_identity(current_sub) == device["identity"]:
                        db.execute(delete(WebPushSubscription).where(WebPushSubscription.id == current_sub.id))
    return claimed_count


async def run_admin_help_scheduler(stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            await dispatch_admin_help_notifications()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Admin help notification batch failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=10)
        except TimeoutError:
            continue
