from __future__ import annotations

import hashlib
import json
import os
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, func, select

from .database import session_scope
from .models import AuthRateEvent
from .security import utcnow


def _positive_int_env(name: str, default: int) -> int:
    raw_value = os.getenv(name, str(default)).strip()
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be a positive integer") from exc
    if value < 1:
        raise RuntimeError(f"{name} must be a positive integer")
    return value


TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_MAX_FAILURES = 5
REGISTER_BURST_WINDOW = timedelta(minutes=1)
REGISTER_BURST_MAX = 1
REGISTER_IP_WINDOW = timedelta(hours=1)
REGISTER_IP_MAX = 3
REGISTER_GLOBAL_WINDOW = timedelta(hours=1)
REGISTER_GLOBAL_MAX = 20
GAME_CREATE_BURST_WINDOW = timedelta(minutes=1)
GAME_CREATE_BURST_MAX = _positive_int_env("ROLLTHEDICE_GAME_CREATE_BURST_MAX", 5)
GAME_CREATE_IP_WINDOW = timedelta(hours=1)
GAME_CREATE_IP_MAX = _positive_int_env("ROLLTHEDICE_GAME_CREATE_IP_MAX", 30)
GAME_CREATE_GLOBAL_WINDOW = timedelta(hours=1)
GAME_CREATE_GLOBAL_MAX = _positive_int_env("ROLLTHEDICE_GAME_CREATE_GLOBAL_MAX", 300)
EVENT_RETENTION = timedelta(days=1)


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def turnstile_config() -> tuple[str, str]:
    return _env("ROLLTHEDICE_TURNSTILE_SITE_KEY"), _env("ROLLTHEDICE_TURNSTILE_SECRET")


def validate_auth_protection_config() -> None:
    site_key, secret = turnstile_config()
    if bool(site_key) != bool(secret):
        raise RuntimeError(
            "ROLLTHEDICE_TURNSTILE_SITE_KEY and ROLLTHEDICE_TURNSTILE_SECRET "
            "must either both be set or both be empty"
        )


def registration_public_config() -> dict:
    site_key, secret = turnstile_config()
    return {"turnstile_enabled": bool(site_key and secret), "turnstile_site_key": site_key}


def _client_address(request: Request) -> str:
    # Uvicorn only applies forwarded headers from its configured trusted proxies.
    # Using request.client avoids trusting a spoofable header here directly.
    return request.client.host if request.client else "unknown"


def _key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _client_key(request: Request) -> str:
    return _key(_client_address(request))


def _login_key(request: Request, normalized_username: str) -> str:
    return _key(f"{_client_address(request)}\0{normalized_username}")


def _event_count(kind: str, since, *, client_key: str | None = None) -> int:
    with session_scope() as db:
        stmt = select(func.count()).select_from(AuthRateEvent).where(
            AuthRateEvent.kind == kind,
            AuthRateEvent.occurred_at >= since,
        )
        if client_key is not None:
            stmt = stmt.where(AuthRateEvent.client_key == client_key)
        return int(db.scalar(stmt) or 0)


def _record_event(kind: str, client_key: str) -> None:
    now = utcnow()
    with session_scope() as db:
        db.add(AuthRateEvent(kind=kind, client_key=client_key, occurred_at=now))
        # Each accepted request opportunistically removes obsolete rows.
        db.execute(delete(AuthRateEvent).where(AuthRateEvent.occurred_at < now - EVENT_RETENTION))


def enforce_registration_rate_limit(request: Request) -> None:
    now = utcnow()
    client_key = _client_key(request)
    burst_limited = (
        _event_count("register", now - REGISTER_BURST_WINDOW, client_key=client_key) >= REGISTER_BURST_MAX
    )
    hourly_limited = (
        _event_count("register", now - REGISTER_IP_WINDOW, client_key=client_key) >= REGISTER_IP_MAX
        or _event_count("register", now - REGISTER_GLOBAL_WINDOW) >= REGISTER_GLOBAL_MAX
    )
    if burst_limited or hourly_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="registration_temporarily_blocked",
            headers={"Retry-After": "3600" if hourly_limited else "60"},
        )
    # Record before CAPTCHA and password hashing so rejected bot traffic cannot
    # repeatedly consume either external verification or CPU resources.
    _record_event("register", client_key)


def enforce_game_creation_rate_limit(request: Request) -> None:
    """Limit anonymous game creation per client and across the instance."""
    now = utcnow()
    client_key = _client_key(request)
    burst_limited = (
        _event_count("game_create", now - GAME_CREATE_BURST_WINDOW, client_key=client_key)
        >= GAME_CREATE_BURST_MAX
    )
    hourly_limited = (
        _event_count("game_create", now - GAME_CREATE_IP_WINDOW, client_key=client_key)
        >= GAME_CREATE_IP_MAX
        or _event_count("game_create", now - GAME_CREATE_GLOBAL_WINDOW)
        >= GAME_CREATE_GLOBAL_MAX
    )
    if burst_limited or hourly_limited:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="game_creation_temporarily_blocked",
            headers={"Retry-After": "3600" if hourly_limited else "60"},
        )
    _record_event("game_create", client_key)


def enforce_login_rate_limit(request: Request, normalized_username: str) -> str:
    key = _login_key(request, normalized_username)
    if _event_count("login_failure", utcnow() - LOGIN_WINDOW, client_key=key) >= LOGIN_MAX_FAILURES:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="login_temporarily_blocked",
            headers={"Retry-After": str(int(LOGIN_WINDOW.total_seconds()))},
        )
    return key


def record_login_failure(key: str) -> None:
    _record_event("login_failure", key)


def clear_login_failures(key: str) -> None:
    with session_scope() as db:
        db.execute(delete(AuthRateEvent).where(
            AuthRateEvent.kind == "login_failure",
            AuthRateEvent.client_key == key,
        ))


def verify_registration_challenge(request: Request, token: str | None) -> None:
    site_key, secret = turnstile_config()
    if not site_key or not secret:
        return
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="captcha_required")

    body = urlencode({
        "secret": secret,
        "response": token,
        "remoteip": _client_address(request),
    }).encode("ascii")
    verification_request = UrlRequest(
        TURNSTILE_VERIFY_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(verification_request, timeout=5) as response:
            result = json.load(response)
    except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="captcha_unavailable",
        ) from exc

    if not result.get("success") or result.get("action") != "register":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="captcha_invalid")
