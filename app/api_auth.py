from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from .auth import (
    SESSION_COOKIE,
    auth_identity_payload,
    change_password,
    clear_session_cookie,
    create_user,
    login,
    logout,
    require_admin,
    require_csrf,
    require_user,
    reset_password,
    resolve_session,
    set_session_cookie,
    validate_request_origin,
)
from .auth_protection import (
    enforce_registration_rate_limit,
    registration_public_config,
    verify_registration_challenge,
)
from .database import session_scope
from .models import Session as LoginSession
from .models import User
from .security import utcnow


router = APIRouter(prefix="/api", tags=["authentication"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)
    turnstile_token: str | None = Field(default=None, max_length=4096)
    preferred_language: Literal["de", "en"] = "de"


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class UserPreferencesRequest(BaseModel):
    announce_selection_mode: Literal["table", "overlay"]
    auto_write_announced: bool
    preferred_language: Literal["de", "en"] = "de"


class LanguagePreferenceRequest(BaseModel):
    preferred_language: Literal["de", "en"]


class AdminUserCreateRequest(BaseModel):
    username: str
    temporary_password: str
    role: Literal["user", "admin"] = "user"


class AdminPasswordResetRequest(BaseModel):
    temporary_password: str


class AdminUserUpdateRequest(BaseModel):
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None


def _user_payload(user: User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }


@router.get("/auth/me")
def auth_me(request: Request):
    identity = resolve_session(request)
    return {
        "authenticated": bool(identity),
        "user": auth_identity_payload(identity, include_csrf=True) if identity else None,
    }


@router.get("/auth/registration-config")
def auth_registration_config():
    return registration_public_config()


@router.post("/auth/login")
def auth_login(payload: LoginRequest, request: Request, response: Response):
    identity, raw_token = login(request, payload.username, payload.password)
    set_session_cookie(response, raw_token)
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True, "user": auth_identity_payload(identity, include_csrf=True)}


@router.post("/auth/register", status_code=status.HTTP_201_CREATED)
def auth_register(payload: RegisterRequest, request: Request, response: Response):
    validate_request_origin(request)
    enforce_registration_rate_limit(request)
    verify_registration_challenge(request, payload.turnstile_token)
    try:
        create_user(
            payload.username,
            payload.password,
            role="user",
            must_change_password=False,
            preferred_language=payload.preferred_language,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    identity, raw_token = login(request, payload.username, payload.password)
    set_session_cookie(response, raw_token)
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True, "user": auth_identity_payload(identity, include_csrf=True)}


@router.post("/auth/logout")
def auth_logout(request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    logout(request.cookies.get(SESSION_COOKIE))
    clear_session_cookie(response)
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": False}


@router.post("/auth/change-password")
def auth_change_password(payload: PasswordChangeRequest, request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    change_password(identity, payload.current_password, payload.new_password)
    clear_session_cookie(response)
    return {"ok": True, "login_required": True}


@router.put("/auth/preferences")
def auth_update_preferences(payload: UserPreferencesRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        user.announce_selection_mode = payload.announce_selection_mode
        user.auto_write_announced = payload.auto_write_announced
        user.preferred_language = payload.preferred_language
        user.updated_at = utcnow()
        db.flush()
        return {
            "preferences": {
                "announce_selection_mode": user.announce_selection_mode,
                "auto_write_announced": user.auto_write_announced,
                "preferred_language": user.preferred_language,
            }
        }


@router.put("/auth/preferences/language")
def auth_update_language(payload: LanguagePreferenceRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        user.preferred_language = payload.preferred_language
        user.updated_at = utcnow()
        db.flush()
        return {"preferred_language": user.preferred_language}


@router.get("/admin/users")
def admin_list_users(request: Request, query: str = "", limit: int = 100, offset: int = 0):
    require_admin(request)
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    with session_scope() as db:
        stmt = select(User)
        if query.strip():
            stmt = stmt.where(User.username_normalized.contains(query.strip().casefold()))
        users = list(db.scalars(stmt.order_by(User.username_normalized).offset(offset).limit(limit)))
        return {"users": [_user_payload(user) for user in users], "limit": limit, "offset": offset}


@router.post("/admin/users", status_code=status.HTTP_201_CREATED)
def admin_create_user(payload: AdminUserCreateRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    try:
        user = create_user(
            payload.username,
            payload.temporary_password,
            role=payload.role,
            must_change_password=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"user": _user_payload(user)}


@router.post("/admin/users/{user_id}/reset-password")
def admin_reset_password(user_id: int, payload: AdminPasswordResetRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    try:
        reset_password(user_id, payload.temporary_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found") from exc
    return {"ok": True}


@router.patch("/admin/users/{user_id}")
def admin_update_user(user_id: int, payload: AdminUserUpdateRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    if payload.role is None and payload.is_active is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no_changes")

    with session_scope() as db:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        removes_admin = user.role == "admin" and (
            payload.role == "user" or payload.is_active is False
        )
        if removes_admin:
            active_admins = int(
                db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.is_active.is_(True)))
                or 0
            )
            if active_admins <= 1:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="last_admin_required")
        if payload.role is not None:
            user.role = payload.role
        if payload.is_active is not None:
            user.is_active = payload.is_active
        user.updated_at = utcnow()
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        db.flush()
        return {"user": _user_payload(user)}
