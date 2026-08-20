from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timezone

from pwdlib import PasswordHash


PASSWORD_MIN_LENGTH = 8
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 32
_password_hash = PasswordHash.recommended()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def normalize_username(username: str) -> str:
    return str(username or "").strip().casefold()


def validate_username(username: str) -> str:
    value = str(username or "").strip()
    if not USERNAME_MIN_LENGTH <= len(value) <= USERNAME_MAX_LENGTH:
        raise ValueError(f"Benutzername muss {USERNAME_MIN_LENGTH} bis {USERNAME_MAX_LENGTH} Zeichen lang sein")
    if not re.fullmatch(r"[\w.-]+", value, flags=re.UNICODE) or value.startswith((".", "-")):
        raise ValueError("Benutzername darf nur Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten")
    return value


def validate_password(password: str) -> str:
    value = str(password or "")
    if len(value) < PASSWORD_MIN_LENGTH:
        raise ValueError(f"Passwort muss mindestens {PASSWORD_MIN_LENGTH} Zeichen lang sein")
    if len(value) > 256:
        raise ValueError("Passwort ist zu lang")
    return value


def hash_password(password: str) -> str:
    return _password_hash.hash(validate_password(password))


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hash.verify(str(password or ""), password_hash)
    except Exception:
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def new_csrf_token() -> str:
    return secrets.token_urlsafe(24)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(str(token or "").encode("utf-8")).hexdigest()
