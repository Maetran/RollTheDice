"""Optional passkey login and password-confirmed credential management."""

from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from .auth import (
    auth_identity_payload,
    issue_session_for_user,
    lock_verified_password,
    require_csrf,
    require_user,
    set_session_cookie,
    validate_request_origin,
)
from .auth_protection import clear_login_failures, enforce_login_rate_limit, record_login_failure
from .database import session_scope
from .models import AuthRateEvent, User
from .passkeys import (
    CEREMONY_COOKIE_NAME,
    CEREMONY_COOKIE_PATH,
    PasskeyError,
    begin_authentication_ceremony,
    begin_registration_ceremony,
    ceremony_cookie_settings,
    complete_authentication_ceremony,
    complete_registration_ceremony,
    list_passkey_credentials,
    passkey_config,
    remove_passkey_credential,
)
from .security import utcnow, verify_password

router = APIRouter(prefix="/api/auth/passkeys", tags=["authentication"])
PASSKEY_RATE_WINDOW = timedelta(minutes=15)
PASSKEY_RATE_IP_MAX = 60
PASSKEY_RATE_GLOBAL_MAX = 1000


class ReauthenticationRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)


class CredentialRequest(BaseModel):
    credential: dict[str, Any]


class RegistrationCredentialRequest(CredentialRequest):
    label: str = Field(default="", max_length=64)


def _origin(request: Request) -> str:
    config = passkey_config()
    if not config.enabled:
        raise HTTPException(status_code=503, detail="passkeys_unavailable")
    validate_request_origin(request)
    # Require the browser's actual Origin, never infer it from attacker input or
    # allow a no-Origin fallback on these authentication state transitions.
    origin = request.headers.get("origin", "")
    if origin not in config.expected_origins:
        raise HTTPException(status_code=403, detail="origin_rejected")
    return origin


def _enforce_rate_limit(request: Request) -> None:
    now = utcnow()
    client = request.client.host if request.client else "unknown"
    key = hashlib.sha256(client.encode("utf-8")).hexdigest()
    with session_scope() as db:
        # Take SQLite's writer lock before counting so concurrent requests cannot
        # all observe the same remaining allowance. Rejected events are removed.
        db.execute(delete(AuthRateEvent).where(AuthRateEvent.occurred_at < now - timedelta(days=1)))
        event = AuthRateEvent(kind="passkey_request", client_key=key, occurred_at=now)
        db.add(event)
        db.flush()
        window = select(func.count()).select_from(AuthRateEvent).where(
            AuthRateEvent.kind == "passkey_request", AuthRateEvent.occurred_at >= now - PASSKEY_RATE_WINDOW
        )
        blocked = (
            int(db.scalar(window.where(AuthRateEvent.client_key == key)) or 0) > PASSKEY_RATE_IP_MAX
            or int(db.scalar(window) or 0) > PASSKEY_RATE_GLOBAL_MAX
        )
        if blocked:
            db.delete(event)
    if blocked:
        raise HTTPException(status_code=429, detail="passkey_temporarily_blocked", headers={"Retry-After": "900"})


def _prepare(request: Request, response: Response) -> str:
    response.headers["Cache-Control"] = "no-store"
    origin = _origin(request)
    _enforce_rate_limit(request)
    return origin


def _error(exc: PasskeyError) -> HTTPException:
    return HTTPException(status_code=503 if exc.code == "passkeys_unavailable" else 400, detail=exc.code)


def _set_ceremony_cookie(response: Response, start) -> None:
    response.set_cookie(value=start.state_token, **ceremony_cookie_settings())


def _clear_ceremony_cookie(response: Response) -> None:
    settings = ceremony_cookie_settings()
    response.delete_cookie(
        key=CEREMONY_COOKIE_NAME,
        path=CEREMONY_COOKIE_PATH,
        secure=bool(settings["secure"]),
        httponly=True,
        samesite="strict",
    )


def _payload(record) -> dict:
    return {"id": record.id, "label": record.label, "created_at": record.created_at, "last_used_at": record.last_used_at}


def _reauthenticated_user(db, identity, password: str) -> User:
    user = db.get(User, identity.user_id)
    if (
        user is None or not user.is_active or not verify_password(password, user.password_hash)
        or not lock_verified_password(db, user)
    ):
        raise HTTPException(status_code=400, detail="current_password_invalid")
    if user.must_change_password:
        raise HTTPException(status_code=403, detail="password_change_required")
    return user


@router.post("/authentication/options")
def authentication_options(request: Request, response: Response):
    _prepare(request, response)
    try:
        with session_scope() as db:
            start = begin_authentication_ceremony(db)
    except PasskeyError as exc:
        raise _error(exc) from exc
    _set_ceremony_cookie(response, start)
    return {"options": start.options}


@router.post("/authentication/verify")
def authentication_verify(payload: CredentialRequest, request: Request, response: Response):
    origin = _prepare(request, response)
    try:
        with session_scope() as db:
            result = complete_authentication_ceremony(
                db,
                raw_state=request.cookies.get(CEREMONY_COOKIE_NAME, ""),
                credential=payload.credential,
                request_origin=origin,
            )
            identity, token = issue_session_for_user(db, result.user)
    except PasskeyError as exc:
        raise _error(exc) from exc
    _clear_ceremony_cookie(response)
    set_session_cookie(response, token)
    return {"authenticated": True, "user": auth_identity_payload(identity, include_csrf=True)}


@router.get("")
def credentials_list(request: Request, response: Response):
    identity = require_user(request)
    response.headers["Cache-Control"] = "no-store"
    config = passkey_config()
    with session_scope() as db:
        records = list_passkey_credentials(db, user_id=identity.user_id)
        return {"enabled": config.enabled, "credentials": [_payload(record) for record in records]}


@router.post("/registration/options")
def registration_options(payload: ReauthenticationRequest, request: Request, response: Response):
    _prepare(request, response)
    identity = require_user(request)
    require_csrf(request, identity)
    key = enforce_login_rate_limit(request, f"passkey-management:{identity.user_id}")
    try:
        with session_scope() as db:
            user = _reauthenticated_user(db, identity, payload.current_password)
            start = begin_registration_ceremony(db, user=user, session_id=identity.session_id)
    except HTTPException as exc:
        if exc.detail == "current_password_invalid":
            record_login_failure(key)
        raise
    except PasskeyError as exc:
        raise _error(exc) from exc
    clear_login_failures(key)
    _set_ceremony_cookie(response, start)
    return {"options": start.options}


@router.post("/registration/verify")
def registration_verify(payload: RegistrationCredentialRequest, request: Request, response: Response):
    origin = _prepare(request, response)
    identity = require_user(request)
    require_csrf(request, identity)
    try:
        with session_scope() as db:
            user = db.get(User, identity.user_id)
            if user is None or not user.is_active or user.must_change_password:
                raise HTTPException(status_code=403, detail="password_change_required")
            record = complete_registration_ceremony(
                db,
                raw_state=request.cookies.get(CEREMONY_COOKIE_NAME, ""),
                user=user,
                session_id=identity.session_id,
                credential=payload.credential,
                label=payload.label,
                request_origin=origin,
            )
            result = _payload(record)
    except PasskeyError as exc:
        raise _error(exc) from exc
    except IntegrityError as exc:
        # A duplicate registered concurrently is still a normal rejected attempt.
        raise HTTPException(status_code=400, detail="passkey_already_registered") from exc
    _clear_ceremony_cookie(response)
    return {"ok": True, "credential": result}


@router.delete("/{credential_id}")
def credentials_delete(credential_id: int, payload: ReauthenticationRequest, request: Request, response: Response):
    _prepare(request, response)
    identity = require_user(request)
    require_csrf(request, identity)
    key = enforce_login_rate_limit(request, f"passkey-management:{identity.user_id}")
    try:
        with session_scope() as db:
            _reauthenticated_user(db, identity, payload.current_password)
            removed = remove_passkey_credential(db, user_id=identity.user_id, credential_id=credential_id)
    except HTTPException as exc:
        if exc.detail == "current_password_invalid":
            record_login_failure(key)
        raise
    clear_login_failures(key)
    if not removed:
        raise HTTPException(status_code=404, detail="passkey_not_found")
    return {"ok": True}
