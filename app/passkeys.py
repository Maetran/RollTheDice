"""Replay-safe WebAuthn ceremonies used by the passkey API."""

from __future__ import annotations

import base64
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Mapping
from urllib.parse import urlsplit

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session as DatabaseSession

from .models import PasskeyCredential, User, WebAuthnCeremony
from .models import Session as LoginSession
from .product_hosts import site_origin, zilch_origin
from .security import as_utc, hash_session_token, new_session_token, utcnow

PASSKEYS_ENABLED_ENV = "ROLLTHEDICE_PASSKEYS_ENABLED"
PASSKEY_RP_ID_ENV = "ROLLTHEDICE_WEBAUTHN_RP_ID"
PASSKEY_RP_NAME_ENV = "ROLLTHEDICE_WEBAUTHN_RP_NAME"
PASSKEY_RP_NAME_DEFAULT = "Zock die Wand an"
CEREMONY_TTL = timedelta(minutes=5)
CEREMONY_TIMEOUT_MS = int(CEREMONY_TTL.total_seconds() * 1000)
CEREMONY_COOKIE_NAME = "rollthedice_webauthn_ceremony"
CEREMONY_COOKIE_PATH = "/api/auth/passkeys"
CHALLENGE_BYTES = 32
USER_HANDLE_BYTES = 32
MAX_PASSKEY_LABEL_LENGTH = 64
MAX_CREDENTIAL_RESPONSE_BYTES = 64 * 1024
MAX_PASSKEYS_PER_USER = 20


class PasskeyError(ValueError):
    """A deliberately narrow failure for future public API handlers."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class PasskeyUnavailableError(PasskeyError):
    def __init__(self) -> None:
        super().__init__("passkeys_unavailable")


@dataclass(frozen=True)
class PasskeyConfig:
    enabled: bool
    rp_id: str
    rp_name: str
    expected_origins: tuple[str, ...]


@dataclass(frozen=True)
class CeremonyStart:
    """Options for the browser and an opaque value for an HttpOnly cookie."""

    state_token: str
    options: dict[str, Any]
    expires_at: datetime


@dataclass(frozen=True)
class AuthenticationResult:
    user: User
    credential: PasskeyCredential


def _enabled_from_environment() -> bool:
    value = os.getenv(PASSKEYS_ENABLED_ENV, "0").strip().lower()
    if value in {"", "0", "false", "no", "off"}:
        return False
    if value in {"1", "true", "yes", "on"}:
        return True
    raise RuntimeError(f"{PASSKEYS_ENABLED_ENV} must be a boolean value")


def _hostname(origin: str) -> str:
    hostname = (urlsplit(origin).hostname or "").casefold()
    if not hostname:
        raise RuntimeError("Configured WebAuthn origins need hostnames")
    return hostname


def _valid_dns_hostname(value: str) -> bool:
    if value == "localhost":
        return True
    labels = value.split(".")
    return bool(
        len(value) <= 253
        and len(labels) >= 2
        and all(
            label
            and len(label) <= 63
            and label[0].isalnum()
            and label[-1].isalnum()
            and all(character.isascii() and (character.isalnum() or character == "-") for character in label)
            for label in labels
        )
    )


def _validate_secure_origin(origin: str) -> None:
    parsed = urlsplit(origin)
    hostname = (parsed.hostname or "").casefold()
    if parsed.scheme == "https":
        return
    # Secure Contexts §3.1 treats localhost and its reserved subdomains as
    # potentially trustworthy. This permits the two-product local test setup.
    if parsed.scheme == "http" and (hostname == "localhost" or hostname.endswith(".localhost")):
        return
    raise RuntimeError("WebAuthn requires HTTPS origins (except localhost domains for local development)")


def _secure_cookie_enabled() -> bool:
    return os.getenv("ROLLTHEDICE_COOKIE_SECURE", "0").strip().lower() in {"1", "true", "yes", "on"}


def passkey_config() -> PasskeyConfig:
    """Return the fixed two-product RP policy without accepting arbitrary origins."""
    enabled = _enabled_from_environment()
    configured_site = site_origin()
    configured_zilch = zilch_origin()
    site_host = _hostname(configured_site)
    rp_id = os.getenv(PASSKEY_RP_ID_ENV, site_host).strip().casefold().rstrip(".")
    rp_name = os.getenv(PASSKEY_RP_NAME_ENV, PASSKEY_RP_NAME_DEFAULT).strip()

    if not enabled:
        return PasskeyConfig(False, rp_id or site_host, rp_name or PASSKEY_RP_NAME_DEFAULT, ())
    if not _valid_dns_hostname(rp_id):
        raise RuntimeError(f"{PASSKEY_RP_ID_ENV} must be a valid hostname")
    # The apex product host is the only supported RP ID. This permits the one
    # controlled Zilch subdomain while making a broader parent-domain setup an
    # explicit code change rather than an accidental environment setting.
    if rp_id != site_host:
        raise RuntimeError(f"{PASSKEY_RP_ID_ENV} must equal the hostname of ROLLTHEDICE_SITE_ORIGIN")
    if not rp_name or len(rp_name) > 128 or any(ord(character) < 32 for character in rp_name):
        raise RuntimeError(f"{PASSKEY_RP_NAME_ENV} must contain 1 to 128 printable characters")

    origins = tuple(dict.fromkeys((configured_site, configured_zilch)))
    for origin in origins:
        _validate_secure_origin(origin)
        host = _hostname(origin)
        if host != rp_id and not host.endswith(f".{rp_id}"):
            raise RuntimeError("Every WebAuthn origin must be the RP ID or its controlled subdomain")
    if any(urlsplit(origin).scheme == "https" for origin in origins) and not _secure_cookie_enabled():
        raise RuntimeError("ROLLTHEDICE_COOKIE_SECURE must be enabled when passkeys use HTTPS")
    return PasskeyConfig(True, rp_id, rp_name, origins)


def validate_passkey_config() -> None:
    """Fail startup only when an explicitly enabled passkey policy is invalid."""
    config = passkey_config()
    if config.enabled:
        _webauthn()


def passkey_public_config() -> dict[str, bool]:
    """Small non-sensitive capability payload suitable for ``/auth/me`` later."""
    return {"enabled": passkey_config().enabled}


def ceremony_cookie_settings() -> dict[str, object]:
    """Cookie attributes for future route handlers.

    The cookie remains host-only by omitting a domain. Registration state is
    consequently bound to the exact product origin that started the ceremony.
    """
    return {
        "key": CEREMONY_COOKIE_NAME,
        "max_age": int(CEREMONY_TTL.total_seconds()),
        "httponly": True,
        "secure": _secure_cookie_enabled(),
        "samesite": "strict",
        "path": CEREMONY_COOKIE_PATH,
    }


def _webauthn() -> dict[str, Any]:
    """Import optional dependencies lazily so a disabled rollout remains inert."""
    try:
        from webauthn import (
            base64url_to_bytes,
            generate_authentication_options,
            generate_registration_options,
            options_to_json,
            verify_authentication_response,
            verify_registration_response,
        )
        from webauthn.helpers.structs import (
            AttestationConveyancePreference,
            AuthenticatorSelectionCriteria,
            PublicKeyCredentialDescriptor,
            ResidentKeyRequirement,
            UserVerificationRequirement,
        )
    except ModuleNotFoundError as exc:
        raise RuntimeError("Passkey support requires the webauthn package") from exc
    return {
        "base64url_to_bytes": base64url_to_bytes,
        "generate_authentication_options": generate_authentication_options,
        "generate_registration_options": generate_registration_options,
        "options_to_json": options_to_json,
        "verify_authentication_response": verify_authentication_response,
        "verify_registration_response": verify_registration_response,
        "AttestationConveyancePreference": AttestationConveyancePreference,
        "AuthenticatorSelectionCriteria": AuthenticatorSelectionCriteria,
        "PublicKeyCredentialDescriptor": PublicKeyCredentialDescriptor,
        "ResidentKeyRequirement": ResidentKeyRequirement,
        "UserVerificationRequirement": UserVerificationRequirement,
    }


def _require_enabled() -> PasskeyConfig:
    config = passkey_config()
    if not config.enabled:
        raise PasskeyUnavailableError()
    return config


def _fresh_user_handle(db: DatabaseSession) -> bytes:
    # A collision is cryptographically implausible, but the database uniqueness
    # constraint is still the authority. Avoid leaking an IntegrityError to a
    # caller if an unlucky collision ever occurs.
    for _ in range(4):
        candidate = secrets.token_bytes(USER_HANDLE_BYTES)
        if db.scalar(select(User.id).where(User.webauthn_user_handle == candidate)) is None:
            return candidate
    raise RuntimeError("Could not create a unique WebAuthn user handle")


def ensure_webauthn_user_handle(db: DatabaseSession, user: User) -> bytes:
    if user.webauthn_user_handle:
        return bytes(user.webauthn_user_handle)
    user.webauthn_user_handle = _fresh_user_handle(db)
    db.flush()
    return bytes(user.webauthn_user_handle)


def purge_expired_ceremonies(db: DatabaseSession, *, now=None) -> int:
    current = as_utc(now or utcnow())
    result = db.execute(
        delete(WebAuthnCeremony).where(WebAuthnCeremony.expires_at <= current).execution_options(synchronize_session=False)
    )
    return int(result.rowcount or 0)


def _start_ceremony(
    db: DatabaseSession,
    *,
    purpose: str,
    challenge: bytes,
    user_id: int | None = None,
    session_id: int | None = None,
) -> tuple[WebAuthnCeremony, str]:
    now = utcnow()
    purge_expired_ceremonies(db, now=now)
    raw_state = new_session_token()
    ceremony = WebAuthnCeremony(
        state_token_hash=hash_session_token(raw_state),
        purpose=purpose,
        challenge=challenge,
        user_id=user_id,
        session_id=session_id,
        created_at=now,
        expires_at=now + CEREMONY_TTL,
    )
    db.add(ceremony)
    db.flush()
    return ceremony, raw_state


def _options_payload(options_to_json, options: object) -> dict[str, Any]:
    try:
        payload = json.loads(options_to_json(options))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("WebAuthn options could not be serialized") from exc
    if not isinstance(payload, dict):
        raise RuntimeError("WebAuthn options must serialize to an object")
    return payload


def _credential_payload(credential: Mapping[str, Any]) -> dict[str, Any]:
    """Bound browser input before passing it to a CBOR and crypto parser."""
    if not isinstance(credential, Mapping):
        raise PasskeyError("passkey_verification_failed")
    try:
        payload = dict(credential)
        serialized = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
    except (TypeError, ValueError) as exc:
        raise PasskeyError("passkey_verification_failed") from exc
    if len(serialized.encode("utf-8")) > MAX_CREDENTIAL_RESPONSE_BYTES:
        raise PasskeyError("passkey_verification_failed")
    # py_webauthn verifies origin and signatures but does not reject embedded
    # ceremonies itself. This app permits WebAuthn only in its own top-level UI.
    try:
        encoded = payload["response"]["clientDataJSON"]
        if not isinstance(encoded, str):
            raise ValueError("invalid client data")
        client_data = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if not isinstance(client_data, dict) or client_data.get("crossOrigin", False) is not False or "topOrigin" in client_data:
            raise ValueError("embedded ceremony")
    except (KeyError, TypeError, ValueError) as exc:
        raise PasskeyError("passkey_verification_failed") from exc
    return payload


def _expected_origin(config: PasskeyConfig, request_origin: str | None) -> str | list[str]:
    if request_origin is None:
        return list(config.expected_origins)
    if request_origin not in config.expected_origins:
        raise PasskeyError("origin_rejected")
    return request_origin


def _current_login_session(db: DatabaseSession, *, user_id: int, session_id: int) -> LoginSession:
    current = db.get(LoginSession, session_id)
    if (
        current is None
        or current.user_id != user_id
        or as_utc(current.expires_at) <= utcnow()
    ):
        raise PasskeyError("authentication_required")
    return current


def begin_registration_ceremony(
    db: DatabaseSession,
    *,
    user: User,
    session_id: int,
) -> CeremonyStart:
    """Create discoverable, user-verified passkey options for a signed-in user."""
    config = _require_enabled()
    library = _webauthn()
    if not user.id or not user.is_active:
        raise PasskeyError("authentication_required")
    _current_login_session(db, user_id=user.id, session_id=session_id)
    handle = ensure_webauthn_user_handle(db, user)
    credentials = list(
        db.scalars(select(PasskeyCredential).where(PasskeyCredential.user_id == user.id)).all()
    )
    if len(credentials) >= MAX_PASSKEYS_PER_USER:
        raise PasskeyError("passkey_limit_reached")
    challenge = secrets.token_bytes(CHALLENGE_BYTES)
    selection = library["AuthenticatorSelectionCriteria"](
        resident_key=library["ResidentKeyRequirement"].REQUIRED,
        user_verification=library["UserVerificationRequirement"].REQUIRED,
    )
    options = library["generate_registration_options"](
        rp_id=config.rp_id,
        rp_name=config.rp_name,
        user_id=handle,
        user_name=user.username,
        user_display_name=user.username,
        challenge=challenge,
        timeout=CEREMONY_TIMEOUT_MS,
        attestation=library["AttestationConveyancePreference"].NONE,
        authenticator_selection=selection,
        exclude_credentials=[
            library["PublicKeyCredentialDescriptor"](id=credential.credential_id) for credential in credentials
        ],
    )
    ceremony, raw_state = _start_ceremony(
        db,
        purpose="registration",
        challenge=challenge,
        user_id=user.id,
        session_id=session_id,
    )
    return CeremonyStart(raw_state, _options_payload(library["options_to_json"], options), ceremony.expires_at)


def begin_authentication_ceremony(db: DatabaseSession) -> CeremonyStart:
    """Create a usernameless passkey request using discoverable credentials."""
    config = _require_enabled()
    library = _webauthn()
    challenge = secrets.token_bytes(CHALLENGE_BYTES)
    options = library["generate_authentication_options"](
        rp_id=config.rp_id,
        challenge=challenge,
        timeout=CEREMONY_TIMEOUT_MS,
        user_verification=library["UserVerificationRequirement"].REQUIRED,
    )
    ceremony, raw_state = _start_ceremony(db, purpose="authentication", challenge=challenge)
    return CeremonyStart(raw_state, _options_payload(library["options_to_json"], options), ceremony.expires_at)


def _valid_ceremony(
    db: DatabaseSession,
    *,
    raw_state: str,
    purpose: str,
    user_id: int | None = None,
    session_id: int | None = None,
) -> WebAuthnCeremony:
    if not isinstance(raw_state, str) or not raw_state or len(raw_state) > 512:
        raise PasskeyError("passkey_ceremony_invalid")
    now = utcnow()
    ceremony = db.scalar(
        select(WebAuthnCeremony).where(
            WebAuthnCeremony.state_token_hash == hash_session_token(raw_state),
            WebAuthnCeremony.purpose == purpose,
        )
    )
    if (
        ceremony is None
        or ceremony.consumed_at is not None
        or as_utc(ceremony.expires_at) <= now
        or ceremony.user_id != user_id
        or ceremony.session_id != session_id
    ):
        raise PasskeyError("passkey_ceremony_invalid")
    return ceremony


def _claim_ceremony(db: DatabaseSession, ceremony: WebAuthnCeremony) -> None:
    now = utcnow()
    result = db.execute(
        update(WebAuthnCeremony)
        .where(
            WebAuthnCeremony.id == ceremony.id,
            # SQLite may reuse integer IDs after recovery deletes old rows.
            # Bind the claim to the original unpredictable ceremony as well.
            WebAuthnCeremony.state_token_hash == ceremony.state_token_hash,
            WebAuthnCeremony.consumed_at.is_(None),
            WebAuthnCeremony.expires_at > now,
        )
        .values(consumed_at=now)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:
        raise PasskeyError("passkey_ceremony_invalid")
    db.expire(ceremony, ["consumed_at"])


def _label(value: object) -> str | None:
    label = str(value or "").strip()
    if not label:
        return None
    if len(label) > MAX_PASSKEY_LABEL_LENGTH or any(ord(character) < 32 for character in label):
        raise PasskeyError("passkey_label_invalid")
    return label


def _verification_error(exc: Exception) -> PasskeyError:
    # WebAuthn failures must stay intentionally non-specific; exception text
    # can contain malformed client payloads and is not suitable for a client or log.
    return PasskeyError("passkey_verification_failed")


def complete_registration_ceremony(
    db: DatabaseSession,
    *,
    raw_state: str,
    user: User,
    session_id: int,
    credential: Mapping[str, Any],
    label: object = "",
    request_origin: str | None = None,
) -> PasskeyCredential:
    """Verify and persist a new passkey in the caller's transaction."""
    config = _require_enabled()
    library = _webauthn()
    if not user.id or not user.is_active:
        raise PasskeyError("authentication_required")
    _current_login_session(db, user_id=user.id, session_id=session_id)
    ceremony = _valid_ceremony(
        db,
        raw_state=raw_state,
        purpose="registration",
        user_id=user.id,
        session_id=session_id,
    )
    payload = _credential_payload(credential)
    try:
        verified = library["verify_registration_response"](
            credential=payload,
            expected_challenge=ceremony.challenge,
            expected_rp_id=config.rp_id,
            expected_origin=_expected_origin(config, request_origin),
            require_user_presence=True,
            require_user_verification=True,
        )
    except Exception as exc:  # The dependency owns detailed parsing/crypto errors.
        raise _verification_error(exc) from exc
    credential_id = bytes(verified.credential_id)
    # The claim obtains the write lock before counting, so simultaneous
    # enrollments cannot each claim the final available credential slot.
    _claim_ceremony(db, ceremony)
    if db.scalar(select(PasskeyCredential.id).where(PasskeyCredential.credential_id == credential_id)) is not None:
        raise PasskeyError("passkey_already_registered")
    credential_count = int(
        db.scalar(select(func.count()).select_from(PasskeyCredential).where(PasskeyCredential.user_id == user.id)) or 0
    )
    if credential_count >= MAX_PASSKEYS_PER_USER:
        raise PasskeyError("passkey_limit_reached")
    now = utcnow()
    record = PasskeyCredential(
        user_id=user.id,
        credential_id=credential_id,
        credential_public_key=bytes(verified.credential_public_key),
        sign_count=int(verified.sign_count),
        device_type=str(getattr(verified.credential_device_type, "value", verified.credential_device_type)),
        backed_up=bool(verified.credential_backed_up),
        label=_label(label),
        created_at=now,
    )
    db.add(record)
    db.flush()
    return record


def _credential_id_from_response(library: Mapping[str, Any], credential: Mapping[str, Any]) -> bytes:
    credential_id = credential.get("id")
    if not isinstance(credential_id, str) or not credential_id or len(credential_id) > 2048:
        raise PasskeyError("passkey_verification_failed")
    try:
        return bytes(library["base64url_to_bytes"](credential_id))
    except Exception as exc:
        raise PasskeyError("passkey_verification_failed") from exc


def _user_handle_matches(library: Mapping[str, Any], credential: Mapping[str, Any], user: User) -> bool:
    response = credential.get("response")
    supplied = response.get("userHandle") if isinstance(response, Mapping) else None
    if supplied in (None, ""):
        return False
    if not isinstance(supplied, str) or not user.webauthn_user_handle:
        return False
    try:
        return secrets.compare_digest(bytes(library["base64url_to_bytes"](supplied)), bytes(user.webauthn_user_handle))
    except Exception:
        return False


def complete_authentication_ceremony(
    db: DatabaseSession,
    *,
    raw_state: str,
    credential: Mapping[str, Any],
    request_origin: str | None = None,
) -> AuthenticationResult:
    """Verify a discoverable credential and return its active account.

    The API layer should call ``issue_session_for_user`` in this same database
    transaction before committing, then set the normal session cookie.
    """
    config = _require_enabled()
    library = _webauthn()
    ceremony = _valid_ceremony(db, raw_state=raw_state, purpose="authentication")
    payload = _credential_payload(credential)
    credential_id = _credential_id_from_response(library, payload)
    record = db.scalar(select(PasskeyCredential).where(PasskeyCredential.credential_id == credential_id))
    if record is None:
        raise PasskeyError("passkey_verification_failed")
    user = db.get(User, record.user_id)
    if user is None or not user.is_active or not _user_handle_matches(library, payload, user):
        raise PasskeyError("passkey_verification_failed")
    try:
        verified = library["verify_authentication_response"](
            credential=payload,
            expected_challenge=ceremony.challenge,
            expected_rp_id=config.rp_id,
            expected_origin=_expected_origin(config, request_origin),
            credential_public_key=record.credential_public_key,
            credential_current_sign_count=record.sign_count,
            require_user_verification=True,
        )
    except Exception as exc:  # Includes signature, origin, counter and UV failures.
        raise _verification_error(exc) from exc
    if not secrets.compare_digest(bytes(verified.credential_id), record.credential_id):
        raise PasskeyError("passkey_verification_failed")
    _claim_ceremony(db, ceremony)
    previous_sign_count = record.sign_count
    now = utcnow()
    counter_update = db.execute(
        update(PasskeyCredential)
        .where(
            PasskeyCredential.id == record.id,
            PasskeyCredential.credential_id == record.credential_id,
            PasskeyCredential.credential_public_key == record.credential_public_key,
            PasskeyCredential.user_id == record.user_id,
            PasskeyCredential.sign_count == previous_sign_count,
        )
        .values(
            sign_count=int(verified.new_sign_count),
            device_type=str(getattr(verified.credential_device_type, "value", verified.credential_device_type)),
            backed_up=bool(verified.credential_backed_up),
            last_used_at=now,
        )
    )
    if counter_update.rowcount != 1:
        raise PasskeyError("passkey_verification_failed")
    db.flush()
    db.refresh(record)
    return AuthenticationResult(user=user, credential=record)


def list_passkey_credentials(db: DatabaseSession, *, user_id: int) -> list[PasskeyCredential]:
    """Return only the caller's rows; serialization must omit public key bytes."""
    return list(
        db.scalars(
            select(PasskeyCredential)
            .where(PasskeyCredential.user_id == user_id)
            .order_by(PasskeyCredential.last_used_at.desc(), PasskeyCredential.id.desc())
        ).all()
    )


def remove_passkey_credential(db: DatabaseSession, *, user_id: int, credential_id: int) -> bool:
    """Delete one owned credential; caller performs password/passkey reauthentication."""
    result = db.execute(
        delete(PasskeyCredential).where(
            PasskeyCredential.id == credential_id,
            PasskeyCredential.user_id == user_id,
        )
    )
    return bool(result.rowcount)
