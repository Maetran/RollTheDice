"""Email-confirmed registration, account-address verification and recovery."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Callable
from urllib.parse import quote

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from .auth import (
    AuthIdentity,
    create_user_in_session,
    issue_session_for_user,
    lock_verified_password,
    revoke_account_recovery_state,
)
from .database import session_scope
from .email_delivery import (
    EmailDeliveryFailed,
    EmailDeliveryUnavailable,
    account_email_available,
    send_account_email,
)
from .models import AccountEmailToken, PendingEmailRegistration, User
from .models import Session as LoginSession
from .product_hosts import site_origin
from .security import (
    as_utc,
    hash_password,
    hash_session_token,
    new_session_token,
    normalize_email_address,
    normalize_username,
    utcnow,
    validate_email_address,
    validate_password,
    validate_username,
    verify_password,
)

logger = logging.getLogger(__name__)

REGISTRATION_TTL = timedelta(hours=24)
EMAIL_VERIFICATION_TTL = timedelta(hours=24)
PASSWORD_RESET_TTL = timedelta(minutes=30)


def _action_url(path: str, raw_token: str, language: str) -> str:
    # A fragment never travels in HTTP requests, reverse-proxy logs or caches.
    return f"{site_origin()}{path}?lang={'en' if language == 'en' else 'de'}#token={quote(raw_token, safe='')}"


def _active_token(token, *, now) -> bool:
    return token is not None and token.consumed_at is None and as_utc(token.expires_at) > now


def _consume_token(db, *, raw_token: str, purpose: str, now, error: str) -> AccountEmailToken:
    """Claim the token with a conditional write, including concurrent callers."""
    token_hash = hash_session_token(raw_token)
    claimed = db.execute(
        update(AccountEmailToken).where(
            AccountEmailToken.token_hash == token_hash,
            AccountEmailToken.purpose == purpose,
            AccountEmailToken.consumed_at.is_(None),
            AccountEmailToken.expires_at > now,
        ).values(consumed_at=now)
    )
    if claimed.rowcount != 1:
        raise ValueError(error)
    return db.scalar(select(AccountEmailToken).where(AccountEmailToken.token_hash == token_hash))


def _masked_email(value: str | None) -> str | None:
    if not value or "@" not in value:
        return None
    local, domain = value.rsplit("@", 1)
    return f"{local[:1]}***@{domain}"


def _purge_expired(db, now) -> None:
    db.execute(delete(PendingEmailRegistration).where(PendingEmailRegistration.expires_at <= now))
    db.execute(delete(AccountEmailToken).where(AccountEmailToken.expires_at <= now))


def _ensure_delivery_available() -> None:
    if not account_email_available():
        raise EmailDeliveryUnavailable("account_email_disabled")


def begin_registration(
    *, username: str, email: str, preferred_language: str,
    delivery: Callable[..., None] | None = None,
) -> dict:
    """Store a non-loginable registration request and mail its confirmation."""
    _ensure_delivery_available()
    clean_username = validate_username(username)
    username_normalized = normalize_username(clean_username)
    clean_email = validate_email_address(email)
    email_normalized = normalize_email_address(clean_email)
    if preferred_language not in {"de", "en"}:
        raise ValueError("preferred_language_invalid")
    raw_token = new_session_token()
    token_hash = hash_session_token(raw_token)
    now = utcnow()
    try:
        with session_scope() as db:
            _purge_expired(db, now)
            if db.scalar(select(User.id).where(User.username_normalized == username_normalized)):
                raise ValueError("username_taken")
            if db.scalar(select(User.id).where(User.email_normalized == email_normalized)):
                return {"accepted": True}
            # Unverified requests must not reserve somebody else's name or
            # address, nor invalidate a link already in their inbox. Account
            # uniqueness is enforced only when the mailbox owner confirms.
            db.add(
                PendingEmailRegistration(
                    username=clean_username,
                    username_normalized=username_normalized,
                    email=clean_email,
                    email_normalized=email_normalized,
                    preferred_language=preferred_language,
                    token_hash=token_hash,
                    requested_at=now,
                    expires_at=now + REGISTRATION_TTL,
                    completed_at=None,
                )
            )
    except IntegrityError as exc:
        raise ValueError("username_or_email_taken") from exc

    try:
        (delivery or send_account_email)(
            recipient=clean_email,
            kind="registration",
            language=preferred_language,
            action_url=_action_url("/registrierung/bestaetigen", raw_token, preferred_language),
            idempotency_key=f"registration-{token_hash}",
        )
    except EmailDeliveryFailed:
        # The request is safely retryable.  Avoid identifying the target in
        # logs or returning it to a client that may not own the mailbox.
        logger.warning("Registration confirmation delivery was unavailable")
        raise
    return {"accepted": True}


def inspect_registration(raw_token: str) -> dict:
    _ensure_delivery_available()
    now = utcnow()
    with session_scope() as db:
        registration = db.scalar(
            select(PendingEmailRegistration).where(PendingEmailRegistration.token_hash == hash_session_token(raw_token))
        )
        valid = bool(registration and registration.completed_at is None and as_utc(registration.expires_at) > now)
        return {"valid": valid}


def complete_registration(*, raw_token: str, password: str) -> tuple[AuthIdentity, str]:
    """Consume the confirmation and create the account plus first session."""
    _ensure_delivery_available()
    validate_password(password)
    now = utcnow()
    try:
        with session_scope() as db:
            claimed = db.execute(
                update(PendingEmailRegistration).where(
                    PendingEmailRegistration.token_hash == hash_session_token(raw_token),
                    PendingEmailRegistration.completed_at.is_(None),
                    PendingEmailRegistration.expires_at > now,
                ).values(completed_at=now)
            )
            if claimed.rowcount != 1:
                raise ValueError("registration_token_invalid")
            registration = db.scalar(
                select(PendingEmailRegistration).where(PendingEmailRegistration.token_hash == hash_session_token(raw_token))
            )
            user = create_user_in_session(
                db,
                registration.username,
                password,
                must_change_password=False,
                preferred_language=registration.preferred_language,
                email=registration.email,
                email_confirmed=True,
            )
            db.execute(
                delete(PendingEmailRegistration).where(
                    PendingEmailRegistration.id != registration.id,
                    (PendingEmailRegistration.email_normalized == registration.email_normalized)
                    | (PendingEmailRegistration.username_normalized == registration.username_normalized),
                )
            )
            return issue_session_for_user(db, user)
    except IntegrityError as exc:
        raise ValueError("username_or_email_taken") from exc


def account_email_status(user_id: int) -> dict:
    now = utcnow()
    with session_scope() as db:
        user = db.get(User, user_id)
        if not user:
            raise LookupError("user_not_found")
        pending = db.scalar(
            select(AccountEmailToken)
            .where(
                AccountEmailToken.user_id == user_id,
                AccountEmailToken.purpose == "email_verify",
                AccountEmailToken.consumed_at.is_(None),
                AccountEmailToken.expires_at > now,
            )
            .order_by(AccountEmailToken.requested_at.desc())
        )
        return {
            "delivery_available": account_email_available(),
            "email": _masked_email(user.email) if user.email_confirmed_at else None,
            "email_confirmed": bool(user.email_confirmed_at),
            "pending_email": _masked_email(pending.email) if pending else None,
        }


def begin_email_verification(*, identity: AuthIdentity, email: str, current_password: str) -> dict:
    _ensure_delivery_available()
    clean_email = validate_email_address(email)
    email_normalized = normalize_email_address(clean_email)
    raw_token = new_session_token()
    token_hash = hash_session_token(raw_token)
    now = utcnow()
    language = "de"
    try:
        with session_scope() as db:
            user = db.get(User, identity.user_id)
            if (
                not user or not user.is_active or not verify_password(current_password, user.password_hash)
                or not lock_verified_password(db, user)
            ):
                raise ValueError("current_password_invalid")
            language = user.preferred_language
            if user.email_normalized == email_normalized and user.email_confirmed_at:
                return {"accepted": True, "already_confirmed": True}
            if db.scalar(select(User.id).where(User.email_normalized == email_normalized, User.id != user.id)):
                raise ValueError("email_taken")
            db.execute(
                delete(AccountEmailToken).where(
                    AccountEmailToken.user_id == user.id,
                    AccountEmailToken.purpose == "email_verify",
                )
            )
            db.add(
                AccountEmailToken(
                    user_id=user.id,
                    purpose="email_verify",
                    email=clean_email,
                    email_normalized=email_normalized,
                    token_hash=token_hash,
                    requested_at=now,
                    expires_at=now + EMAIL_VERIFICATION_TTL,
                    consumed_at=None,
                )
            )
    except IntegrityError as exc:
        raise ValueError("email_taken") from exc

    try:
        send_account_email(
            recipient=clean_email,
            kind="email_verify",
            language=language,
            action_url=_action_url("/email-bestaetigen", raw_token, language),
            idempotency_key=f"email-verify-{token_hash}",
        )
    except (EmailDeliveryFailed, EmailDeliveryUnavailable):
        logger.warning("Account email verification delivery was unavailable")
        raise
    return {"accepted": True, "already_confirmed": False}


def inspect_account_email_token(*, raw_token: str, purpose: str) -> dict:
    _ensure_delivery_available()
    if purpose not in {"email_verify", "password_reset"}:
        raise ValueError("token_purpose_invalid")
    now = utcnow()
    with session_scope() as db:
        token = db.scalar(
            select(AccountEmailToken).where(
                AccountEmailToken.token_hash == hash_session_token(raw_token),
                AccountEmailToken.purpose == purpose,
            )
        )
        user = db.get(User, token.user_id) if token else None
        valid = bool(
            _active_token(token, now=now) and user and user.is_active
            and (purpose != "password_reset" or (user.email_confirmed_at and user.email_normalized == token.email_normalized))
        )
        return {"valid": valid}


def confirm_email(*, raw_token: str) -> None:
    _ensure_delivery_available()
    now = utcnow()
    try:
        with session_scope() as db:
            token = _consume_token(
                db, raw_token=raw_token, purpose="email_verify", now=now,
                error="email_verification_token_invalid",
            )
            user = db.get(User, token.user_id)
            if not user or not user.is_active:
                raise ValueError("email_verification_token_invalid")
            if db.scalar(select(User.id).where(User.email_normalized == token.email_normalized, User.id != user.id)):
                raise ValueError("email_taken")
            user.email = token.email
            user.email_normalized = token.email_normalized
            user.email_confirmed_at = now
            user.updated_at = now
            db.execute(
                delete(AccountEmailToken).where(
                    AccountEmailToken.user_id == user.id,
                    AccountEmailToken.id != token.id,
                )
            )
    except IntegrityError as exc:
        raise ValueError("email_taken") from exc


def begin_password_reset(*, email: str, preferred_language: str) -> dict:
    """Request recovery without revealing whether a mailbox owns an account."""
    _ensure_delivery_available()
    try:
        clean_email = validate_email_address(email)
        email_normalized = normalize_email_address(clean_email)
    except ValueError:
        return {"accepted": True}
    language = preferred_language if preferred_language in {"de", "en"} else "de"
    raw_token = new_session_token()
    token_hash = hash_session_token(raw_token)
    now = utcnow()
    with session_scope() as db:
        user = db.scalar(
            select(User).where(
                User.email_normalized == email_normalized,
                User.email_confirmed_at.is_not(None),
                User.is_active.is_(True),
            )
        )
        if not user:
            return {"accepted": True}
        language = user.preferred_language
        _purge_expired(db, now)
        db.add(
            AccountEmailToken(
                user_id=user.id,
                purpose="password_reset",
                email=user.email,
                email_normalized=user.email_normalized,
                token_hash=token_hash,
                requested_at=now,
                expires_at=now + PASSWORD_RESET_TTL,
                consumed_at=None,
            )
        )
    try:
        send_account_email(
            recipient=clean_email,
            kind="password_reset",
            language=language,
            action_url=_action_url("/passwort-zuruecksetzen", raw_token, language),
            idempotency_key=f"password-reset-{token_hash}",
        )
    except (EmailDeliveryFailed, EmailDeliveryUnavailable):
        # Keep the public response generic. A later repeat makes a fresh,
        # bounded link and the client never learns whether the mailbox exists.
        logger.warning("Password reset delivery was unavailable")
    return {"accepted": True}


def complete_password_reset(*, raw_token: str, password: str) -> None:
    _ensure_delivery_available()
    validate_password(password)
    now = utcnow()
    recipient: str | None = None
    language = "de"
    with session_scope() as db:
        token = _consume_token(
            db, raw_token=raw_token, purpose="password_reset", now=now,
            error="password_reset_token_invalid",
        )
        user = db.get(User, token.user_id)
        if (
            not user or not user.is_active or not user.email_confirmed_at
            or user.email_normalized != token.email_normalized
        ):
            raise ValueError("password_reset_token_invalid")
        user.password_hash = hash_password(password)
        user.must_change_password = False
        user.updated_at = now
        recipient = user.email if user.email_confirmed_at else None
        language = user.preferred_language
        db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        revoke_account_recovery_state(db, user.id, remove_passkeys=True)
    if recipient:
        try:
            send_account_email(
                recipient=recipient,
                kind="password_changed",
                language=language,
                idempotency_key=f"password-changed-{hash_session_token(raw_token)}",
            )
        except (EmailDeliveryFailed, EmailDeliveryUnavailable):
            logger.warning("Password-change confirmation delivery was unavailable")
