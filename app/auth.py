from __future__ import annotations

import logging
import os
import secrets
from dataclasses import dataclass
from datetime import timedelta
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, Response, WebSocket, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from .database import session_scope
from .auth_protection import (
    clear_login_failures,
    enforce_login_rate_limit,
    record_login_failure,
)
from .models import Session as LoginSession
from .models import User
from .security import (
    as_utc,
    hash_password,
    hash_session_token,
    new_csrf_token,
    new_session_token,
    normalize_username,
    utcnow,
    validate_password,
    validate_username,
    verify_password,
)


logger = logging.getLogger(__name__)
SESSION_COOKIE = "rollthedice_session"
SESSION_DAYS = 30


@dataclass(frozen=True)
class AuthIdentity:
    user_id: int
    username: str
    role: str
    must_change_password: bool
    announce_selection_mode: str
    auto_write_announced: bool
    csrf_token: str
    session_id: int

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"


def auth_identity_payload(identity: AuthIdentity, *, include_csrf: bool = False) -> dict:
    """Serialize the account fields shared by HTTP and WebSocket auth responses."""
    payload = {
        "id": identity.user_id,
        "username": identity.username,
        "role": identity.role,
        "is_admin": identity.is_admin,
        "must_change_password": identity.must_change_password,
        "preferences": {
            "announce_selection_mode": identity.announce_selection_mode,
            "auto_write_announced": identity.auto_write_announced,
        },
    }
    if include_csrf:
        payload["csrf_token"] = identity.csrf_token
    return payload


def _cookie_secure() -> bool:
    return os.getenv("ROLLTHEDICE_COOKIE_SECURE", "0").strip().lower() in {"1", "true", "yes", "on"}


def set_session_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        raw_token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        SESSION_COOKIE,
        httponly=True,
        secure=_cookie_secure(),
        samesite="lax",
        path="/",
    )


def _origin_matches_host(origin: str, expected_host: str) -> bool:
    try:
        parsed_origin = urlsplit(origin)
        parsed_expected = urlsplit(f"//{expected_host}")
        same_hostname = (
            parsed_origin.scheme.casefold() in {"http", "https"}
            and bool(parsed_origin.hostname)
            and parsed_origin.hostname.casefold() == (parsed_expected.hostname or "").casefold()
        )
        same_explicit_port = (
            parsed_origin.port == parsed_expected.port
            if parsed_origin.port is not None and parsed_expected.port is not None
            else True
        )
        return same_hostname and same_explicit_port
    except ValueError:
        return False


def _validate_same_origin(request: Request) -> None:
    origin = request.headers.get("origin")
    if not origin:
        return
    expected_host = request.headers.get("host", "").split(",", 1)[0].strip()
    if not _origin_matches_host(origin, expected_host):
        logger.warning("Rejected request origin %s for host %s", origin, expected_host)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="origin_rejected")


def validate_request_origin(request: Request) -> None:
    _validate_same_origin(request)


def websocket_origin_allowed(websocket: WebSocket) -> bool:
    origin = websocket.headers.get("origin")
    if not origin:
        return True
    expected_host = websocket.headers.get("host", "").split(",", 1)[0].strip()
    return _origin_matches_host(origin, expected_host)


def username_is_registered(username: str) -> bool:
    normalized = normalize_username(username)
    if not normalized:
        return False
    with session_scope() as db:
        return db.scalar(select(User.id).where(User.username_normalized == normalized)) is not None


def login(request: Request, username: str, password: str) -> tuple[AuthIdentity, str]:
    _validate_same_origin(request)
    normalized = normalize_username(username)
    key = enforce_login_rate_limit(request, normalized)

    with session_scope() as db:
        user = db.scalar(select(User).where(User.username_normalized == normalized))
        if not user or not user.is_active or not verify_password(password, user.password_hash):
            record_login_failure(key)
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid_credentials")

        clear_login_failures(key)
        now = utcnow()
        raw_token = new_session_token()
        login_session = LoginSession(
            token_hash=hash_session_token(raw_token),
            csrf_token=new_csrf_token(),
            user_id=user.id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(days=SESSION_DAYS),
        )
        db.add(login_session)
        db.flush()
        identity = AuthIdentity(
            user_id=user.id,
            username=user.username,
            role=user.role,
            must_change_password=user.must_change_password,
            announce_selection_mode=user.announce_selection_mode,
            auto_write_announced=user.auto_write_announced,
            csrf_token=login_session.csrf_token,
            session_id=login_session.id,
        )
        return identity, raw_token


def resolve_session(connection: Request | WebSocket) -> AuthIdentity | None:
    raw_token = connection.cookies.get(SESSION_COOKIE)
    if not raw_token:
        return None
    now = utcnow()
    with session_scope() as db:
        login_session = db.scalar(
            select(LoginSession).where(LoginSession.token_hash == hash_session_token(raw_token))
        )
        if not login_session or as_utc(login_session.expires_at) <= now:
            if login_session:
                db.delete(login_session)
            return None
        user = db.get(User, login_session.user_id)
        if not user or not user.is_active:
            db.delete(login_session)
            return None
        if now - as_utc(login_session.last_seen_at) > timedelta(minutes=5):
            login_session.last_seen_at = now
        return AuthIdentity(
            user_id=user.id,
            username=user.username,
            role=user.role,
            must_change_password=user.must_change_password,
            announce_selection_mode=user.announce_selection_mode,
            auto_write_announced=user.auto_write_announced,
            csrf_token=login_session.csrf_token,
            session_id=login_session.id,
        )


def require_user(request: Request) -> AuthIdentity:
    identity = resolve_session(request)
    if not identity:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="authentication_required")
    return identity


def require_admin(request: Request) -> AuthIdentity:
    identity = require_user(request)
    if not identity.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin_required")
    return identity


def require_csrf(request: Request, identity: AuthIdentity) -> None:
    _validate_same_origin(request)
    provided = request.headers.get("x-csrf-token", "")
    if not provided or not secrets.compare_digest(provided, identity.csrf_token):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="csrf_rejected")


def logout(raw_token: str | None) -> None:
    if not raw_token:
        return
    with session_scope() as db:
        db.execute(delete(LoginSession).where(LoginSession.token_hash == hash_session_token(raw_token)))


def change_password(identity: AuthIdentity, current_password: str, new_password: str) -> None:
    validate_password(new_password)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if not user or not verify_password(current_password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="current_password_invalid")
        if verify_password(new_password, user.password_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="password_unchanged")
        user.password_hash = hash_password(new_password)
        user.must_change_password = False
        user.updated_at = utcnow()
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))


def create_user(username: str, password: str, *, role: str = "user", must_change_password: bool = True) -> User:
    clean_username = validate_username(username)
    normalized = normalize_username(clean_username)
    if role not in {"user", "admin"}:
        raise ValueError("Unbekannte Rolle")
    now = utcnow()
    try:
        with session_scope() as db:
            if db.scalar(select(User.id).where(User.username_normalized == normalized)):
                raise ValueError("Benutzername ist bereits vergeben")
            user = User(
                username=clean_username,
                username_normalized=normalized,
                password_hash=hash_password(password),
                role=role,
                is_active=True,
                must_change_password=must_change_password,
                created_at=now,
                updated_at=now,
            )
            db.add(user)
            db.flush()
            return user
    except IntegrityError as exc:
        raise ValueError("Benutzername ist bereits vergeben") from exc


def reset_password(user_id: int, temporary_password: str) -> None:
    validate_password(temporary_password)
    with session_scope() as db:
        user = db.get(User, user_id)
        if not user:
            raise LookupError("user_not_found")
        user.password_hash = hash_password(temporary_password)
        user.must_change_password = True
        user.updated_at = utcnow()
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))


def ensure_bootstrap_admin() -> bool:
    with session_scope() as db:
        if int(db.scalar(select(func.count()).select_from(User).where(User.role == "admin")) or 0) > 0:
            return False

    username = os.getenv("ROLLTHEDICE_ADMIN_USERNAME", "").strip()
    password = os.getenv("ROLLTHEDICE_ADMIN_PASSWORD", "")
    if not username and not password:
        logger.warning(
            "No administrator exists. Set ROLLTHEDICE_ADMIN_USERNAME and "
            "ROLLTHEDICE_ADMIN_PASSWORD once to bootstrap one."
        )
        return False
    if not username or not password:
        raise RuntimeError("Both ROLLTHEDICE_ADMIN_USERNAME and ROLLTHEDICE_ADMIN_PASSWORD are required")
    create_user(username, password, role="admin", must_change_password=True)
    logger.warning("Bootstrap administrator %s was created; remove the bootstrap password from the environment", username)
    return True
