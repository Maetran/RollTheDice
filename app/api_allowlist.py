"""Private invitation selection by account ID, independently of push consent."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.sqlite import insert

from .auth import require_csrf, require_user
from .database import session_scope
from .models import PushInviteAllowedSender, User
from .security import utcnow

router = APIRouter(prefix="/api/web-push/allowlist", tags=["invitation selection"])
ALLOWLIST_LIMIT = 100


class AllowlistViewer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    viewer_id: int


class AllowlistAudience(AllowlistViewer):
    audience: Literal["all", "allowlist"]


def _payload(db, user_id: int) -> dict:
    user = db.get(User, user_id)
    players = db.scalars(select(User).join(
        PushInviteAllowedSender, PushInviteAllowedSender.sender_user_id == User.id,
    ).where(PushInviteAllowedSender.recipient_user_id == user_id).order_by(User.username_normalized))
    return {
        "viewer_id": user_id, "audience": user.game_invite_push_audience,
        "limit": ALLOWLIST_LIMIT,
        "players": [{"id": player.id, "username": player.username, "active": player.is_active} for player in players],
    }


def _viewer(request: Request, response: Response, payload: AllowlistViewer | None = None) -> int:
    identity = require_user(request)
    response.headers["Cache-Control"] = "no-store"
    if payload is not None:
        require_csrf(request, identity)
        if payload.viewer_id != identity.user_id:
            raise HTTPException(status_code=409, detail="allowlist_viewer_changed")
    return identity.user_id


def _lock_recipient(db, user_id: int) -> None:
    # Acquire SQLite's write reservation before counting or reading members.
    # Concurrent additions cannot exceed the limit or overwrite each other.
    result = db.execute(update(User).where(User.id == user_id, User.is_active.is_(True)).values(updated_at=utcnow()))
    if not result.rowcount:
        raise HTTPException(status_code=401, detail="authentication_required")


@router.get("")
def own_allowlist(request: Request, response: Response):
    user_id = _viewer(request, response)
    with session_scope() as db:
        return _payload(db, user_id)


@router.put("")
def save_allowlist_audience(payload: AllowlistAudience, request: Request, response: Response):
    user_id = _viewer(request, response, payload)
    with session_scope() as db:
        _lock_recipient(db, user_id)
        db.get(User, user_id).game_invite_push_audience = payload.audience
        db.flush()
        return _payload(db, user_id)


@router.put("/{sender_user_id}")
def add_allowlist_player(sender_user_id: int, payload: AllowlistViewer, request: Request, response: Response):
    user_id = _viewer(request, response, payload)
    with session_scope() as db:
        _lock_recipient(db, user_id)
        sender = db.get(User, sender_user_id)
        if sender is None or not sender.is_active or sender.id == user_id:
            raise HTTPException(status_code=400, detail="push_allowlist_invalid")
        key = {"recipient_user_id": user_id, "sender_user_id": sender_user_id}
        if db.get(PushInviteAllowedSender, key) is None:
            count = db.scalar(select(func.count()).select_from(PushInviteAllowedSender).where(
                PushInviteAllowedSender.recipient_user_id == user_id,
            ))
            if count >= ALLOWLIST_LIMIT:
                raise HTTPException(status_code=409, detail="push_allowlist_limit")
            db.execute(insert(PushInviteAllowedSender).values(**key, created_at=utcnow()).on_conflict_do_nothing())
        return _payload(db, user_id)


@router.delete("/{sender_user_id}")
def remove_allowlist_player(sender_user_id: int, payload: AllowlistViewer, request: Request, response: Response):
    user_id = _viewer(request, response, payload)
    with session_scope() as db:
        _lock_recipient(db, user_id)
        db.execute(delete(PushInviteAllowedSender).where(
            PushInviteAllowedSender.recipient_user_id == user_id,
            PushInviteAllowedSender.sender_user_id == sender_user_id,
        ))
        return _payload(db, user_id)
