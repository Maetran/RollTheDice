"""Minimal transactional account email delivery through Resend's HTTP API.

The feature deliberately has no inbound mailbox, operator copy, newsletter or
background queue.  It remains inert until the deployment explicitly enables
it and supplies a verified Resend sender address.
"""

from __future__ import annotations

import html
import json
import logging
import os
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request as UrlRequest
from urllib.request import urlopen

from .product_hosts import site_origin
from .security import validate_email_address

logger = logging.getLogger(__name__)

RESEND_EMAIL_URL = "https://api.resend.com/emails"


class EmailDeliveryUnavailable(RuntimeError):
    """Raised before durable account state is changed when delivery is off."""


class EmailDeliveryFailed(RuntimeError):
    """The provider could not accept a transactional message."""


@dataclass(frozen=True)
class AccountEmailConfig:
    enabled: bool
    api_key: str
    sender: str


def _enabled() -> bool:
    return os.getenv("ROLLTHEDICE_EMAIL_ENABLED", "0").strip().casefold() in {"1", "true", "yes", "on"}


def account_email_config() -> AccountEmailConfig:
    return AccountEmailConfig(
        enabled=_enabled(),
        api_key=os.getenv("ROLLTHEDICE_RESEND_API_KEY", "").strip(),
        sender=os.getenv("ROLLTHEDICE_EMAIL_FROM", "").strip(),
    )


def validate_account_email_config() -> None:
    """Fail startup only for an explicitly enabled, incomplete mail feature."""
    config = account_email_config()
    if not config.enabled:
        return
    if not config.api_key:
        raise RuntimeError("ROLLTHEDICE_RESEND_API_KEY is required when ROLLTHEDICE_EMAIL_ENABLED is enabled")
    if not config.sender:
        raise RuntimeError("ROLLTHEDICE_EMAIL_FROM is required when ROLLTHEDICE_EMAIL_ENABLED is enabled")
    try:
        validate_email_address(config.sender)
    except ValueError as exc:
        raise RuntimeError("ROLLTHEDICE_EMAIL_FROM must be a valid mailbox address") from exc
    origin = urlsplit(site_origin())
    if origin.scheme != "https" and origin.hostname not in {"localhost", "127.0.0.1", "::1"}:
        raise RuntimeError("Account email links require an HTTPS site origin")


def account_email_available() -> bool:
    config = account_email_config()
    return bool(config.enabled and config.api_key and config.sender)


def _copy(kind: str, language: str, action_url: str | None) -> tuple[str, str, str]:
    german = language != "en"
    if kind == "registration":
        subject = "Bestätige dein Konto für Zock die Wand an" if german else "Confirm your Zock die Wand an account"
        intro = "Bestätige deine E-Mail-Adresse und lege dein Passwort fest." if german else "Confirm your email address and set your password."
        label = "Konto bestätigen" if german else "Confirm account"
        expiry = "Der Link ist 24 Stunden gültig." if german else "The link is valid for 24 hours."
    elif kind == "email_verify":
        subject = "Bestätige deine neue E-Mail-Adresse" if german else "Confirm your new email address"
        intro = "Bestätige diese Adresse, um sie für dein Konto zu verwenden." if german else "Confirm this address to use it for your account."
        label = "E-Mail-Adresse bestätigen" if german else "Confirm email address"
        expiry = "Der Link ist 24 Stunden gültig." if german else "The link is valid for 24 hours."
    elif kind == "password_reset":
        subject = "Setze dein Passwort für Zock die Wand an zurück" if german else "Reset your Zock die Wand an password"
        intro = "Lege über diesen Link ein neues Passwort fest." if german else "Use this link to set a new password."
        label = "Passwort zurücksetzen" if german else "Reset password"
        expiry = "Der Link ist 30 Minuten gültig." if german else "The link is valid for 30 minutes."
    elif kind == "password_changed":
        subject = "Dein Passwort wurde geändert" if german else "Your password was changed"
        intro = "Dein Konto-Passwort wurde gerade geändert." if german else "Your account password was just changed."
        label = ""
        expiry = "Falls du das nicht warst, setze dein Passwort erneut zurück." if german else "If this was not you, reset your password again."
    else:
        raise ValueError("unknown_account_email_kind")

    if action_url:
        escaped_url = html.escape(action_url, quote=True)
        button = f'<p><a href="{escaped_url}">{html.escape(label)}</a></p>'
        plain_action = f"\n\n{label}: {action_url}"
    else:
        button = ""
        plain_action = ""
    text = f"{intro}{plain_action}\n\n{expiry}"
    body = f"<p>{html.escape(intro)}</p>{button}<p>{html.escape(expiry)}</p>"
    return subject, text, body


def send_account_email(
    *,
    recipient: str,
    kind: str,
    language: str,
    action_url: str | None = None,
    idempotency_key: str,
) -> None:
    """Send one bounded, idempotent account email without logging secrets."""
    config = account_email_config()
    if not config.enabled or not config.api_key or not config.sender:
        raise EmailDeliveryUnavailable("account_email_disabled")
    subject, text, body = _copy(kind, language, action_url)
    encoded = json.dumps(
        {"from": config.sender, "to": [recipient], "subject": subject, "text": text, "html": body},
        ensure_ascii=False,
    ).encode("utf-8")
    request = UrlRequest(
        RESEND_EMAIL_URL,
        data=encoded,
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotency_key[:256],
        },
        method="POST",
    )
    # Retrying once with the same idempotency key covers a dropped response
    # without letting one click create duplicate messages.
    for attempt in range(2):
        try:
            with urlopen(request, timeout=5) as response:
                if 200 <= response.status < 300:
                    return
                raise EmailDeliveryFailed("provider_rejected")
        except (HTTPError, URLError, TimeoutError, OSError, EmailDeliveryFailed) as exc:
            if attempt:
                logger.warning("Account email delivery failed after retry: %s", type(exc).__name__)
                raise EmailDeliveryFailed("provider_unavailable") from exc
    raise EmailDeliveryFailed("provider_unavailable")


def send_account_email_safely(**message) -> None:
    """Delivery after the HTTP response must not expose mailbox existence."""
    try:
        send_account_email(**message)
    except (EmailDeliveryFailed, EmailDeliveryUnavailable):
        logger.warning("Deferred account email delivery was unavailable")
