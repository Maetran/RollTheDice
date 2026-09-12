from __future__ import annotations

import hashlib
import re
import secrets
from datetime import datetime, timezone

from pwdlib import PasswordHash

PASSWORD_MIN_LENGTH = 8
USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 32
EMAIL_MAX_LENGTH = 254
_password_hash = PasswordHash.recommended()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def normalize_username(username: str) -> str:
    return str(username or "").strip().casefold()


def validate_email_address(email: str) -> str:
    """Accept a practical mailbox address without allowing header injection.

    The provider performs the final mailbox-level validation.  This deliberately
    keeps the account boundary small: we only need a stable, safe address for a
    unique login identifier and outbound transactional mail.
    """
    value = str(email or "").strip()
    if not 3 <= len(value) <= EMAIL_MAX_LENGTH or any(character.isspace() for character in value):
        raise ValueError("Bitte gib eine gültige E-Mail-Adresse ein")
    if value.count("@") != 1 or "\x00" in value or "\r" in value or "\n" in value:
        raise ValueError("Bitte gib eine gültige E-Mail-Adresse ein")
    local, domain = value.rsplit("@", 1)
    if (
        not local
        or len(local) > 64
        or not re.fullmatch(r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~.\-]+", local)
        or local.startswith(".")
        or local.endswith(".")
        or ".." in local
        or not domain
    ):
        raise ValueError("Bitte gib eine gültige E-Mail-Adresse ein")
    try:
        ascii_domain = domain.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("Bitte gib eine gültige E-Mail-Adresse ein") from exc
    labels = ascii_domain.split(".")
    if (
        len(f"{local}@{ascii_domain}") > EMAIL_MAX_LENGTH
        or len(labels) < 2
        or any(
            not label
            or len(label) > 63
            or not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label)
            for label in labels
        )
    ):
        raise ValueError("Bitte gib eine gültige E-Mail-Adresse ein")
    return f"{local}@{ascii_domain.casefold()}"


def normalize_email_address(email: str) -> str:
    return validate_email_address(email).casefold()


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
