"""Account-bound settings for live friend activity, unrelated to push/chat."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, StrictBool, StrictInt
from sqlalchemy import update

from .auth import require_csrf, require_user
from .database import session_scope
from .models import User
from .security import utcnow

router = APIRouter(prefix="/api/friend-activity", tags=["friend activity"])


class FriendActivityPreference(BaseModel):
    model_config = ConfigDict(extra="forbid")
    viewer_id: StrictInt
    enabled: StrictBool


@router.get("/preferences")
def friend_activity_preferences(request: Request, response: Response) -> dict:
    identity = require_user(request)
    response.headers["Cache-Control"] = "no-store"
    with session_scope() as db:
        return {"viewer_id": identity.user_id, "enabled": db.get(User, identity.user_id).friend_activity_enabled}


@router.put("/preferences")
def save_friend_activity_preferences(payload: FriendActivityPreference, request: Request, response: Response) -> dict:
    identity = require_user(request)
    require_csrf(request, identity)
    if payload.viewer_id != identity.user_id:
        raise HTTPException(status_code=409, detail="friend_activity_viewer_changed")
    response.headers["Cache-Control"] = "no-store"
    with session_scope() as db:
        result = db.execute(update(User).where(User.id == identity.user_id, User.is_active.is_(True)).values(
            friend_activity_enabled=payload.enabled, updated_at=utcnow(),
        ))
        if not result.rowcount:
            raise HTTPException(status_code=401, detail="authentication_required")
    return {"viewer_id": identity.user_id, "enabled": payload.enabled}
