"""Admin-only moderation endpoints; users retain access to their account."""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from .auth import require_admin, require_csrf
from .database import session_scope
from .moderation import apply_ban, ban_payload, disconnect_banned_user, revoke_bans

router = APIRouter(prefix="/api/admin/users", tags=["moderation"])


class BanRequest(BaseModel):
    scope: Literal["play", "help"]
    days: Literal[3, 5, 7, 14, 30, 60] | None = None
    reason: str = Field(min_length=1, max_length=500)


@router.post("/{user_id}/bans")
async def create_ban(user_id: int, payload: BanRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    with session_scope() as db:
        ban = apply_ban(db, user_id, identity.user_id, scope=payload.scope,
                        days=payload.days, reason=payload.reason)
        result = {"ban": ban_payload(ban)}
    if payload.scope == "play":
        await disconnect_banned_user(user_id)
    return result


@router.delete("/{user_id}/bans/{scope}")
def remove_ban(user_id: int, scope: Literal["play", "help"], request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    with session_scope() as db:
        revoke_bans(db, user_id, scope, identity.user_id)
    return {"ok": True}
