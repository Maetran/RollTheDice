"""Strict local development and independently authorized founder web preview."""

import ipaddress
import os
from urllib.parse import urlsplit

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .database import database_schema_ready, session_scope
from .models import AccountOwnership, User
from .product_hosts import (
    DEFAULT_SITE_ORIGIN,
    DEFAULT_ZILCH_ORIGIN,
    HAUSDEPP_ORIGIN,
    is_watten_host,
    site_origin,
)
from .watten_readiness import watten_public_beta_enabled

_PRIVATE_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def _local(hostname: str) -> bool:
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(hostname).is_loopback
    except ValueError:
        return False


def watten_game_preview_enabled(connection=None) -> bool:
    if os.getenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0") != "1":
        return False
    if not _local((urlsplit(site_origin()).hostname or "").casefold()):
        return False
    if connection is None or is_watten_host(connection):
        return False
    hosts = connection.headers.getlist("host")
    if len(hosts) != 1 or "," in hosts[0]:
        return False
    try:
        parsed = urlsplit(f"//{hosts[0].strip()}")
        parsed.port
        return bool(not parsed.username and not parsed.password and not parsed.path
                    and not parsed.query and not parsed.fragment and _local((parsed.hostname or "").casefold()))
    except ValueError:
        return False


def watten_founder_deployment_enabled() -> bool:
    """Server capability only; it never authorizes a visitor or a CPU room."""
    if os.getenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0") != "1":
        return False
    try:
        return site_origin() == DEFAULT_SITE_ORIGIN
    except RuntimeError:
        return False


def _founder_request_enabled(connection, *, discovery=False) -> bool:
    if connection is None or not watten_founder_deployment_enabled():
        return False
    hosts = connection.headers.getlist("host")
    if len(hosts) != 1:
        return False
    origins = (DEFAULT_SITE_ORIGIN, DEFAULT_ZILCH_ORIGIN, HAUSDEPP_ORIGIN) if discovery else (DEFAULT_SITE_ORIGIN,)
    allowed = {urlsplit(origin).hostname for origin in origins}
    # Positive authorization accepts only canonical raw suite hosts. Forwarded
    # headers, mixed Hosts, trailing dots and arbitrary configured domains do
    # not establish this private production audience. The fixed Watten host
    # intentionally remains in its holding state.
    return hosts[0].casefold() in {value for host in allowed for value in (host, f"{host}:443")}


def watten_request_enabled(connection=None) -> bool:
    """Pre-auth deployment/host filter, never an account access decision."""
    return watten_public_beta_enabled(connection) or watten_game_preview_enabled(connection) or _founder_request_enabled(connection)


def watten_founder_account_id(db, *, lock=False) -> int | None:
    """Fresh account-ID authority inside the caller's transaction, without writes.

    A locking caller acquires its source checkpoint first. PostgreSQL locks
    both joined rows; SQLite callers must already own their writer reservation.
    Database failures propagate so a committing caller can roll back safely.
    """
    query = select(User.id).join(AccountOwnership, AccountOwnership.user_id == User.id).where(
        User.is_active.is_(True), AccountOwnership.is_founder.is_(True))
    return db.execute(query.with_for_update() if lock else query).scalar_one_or_none()


def _current_founder(identity) -> bool:
    account = getattr(identity, "user_id", None)
    if type(account) is not int or account < 1 or not database_schema_ready():
        return False
    try:
        with session_scope() as db:
            return watten_founder_account_id(db) == account
    except SQLAlchemyError:
        return False


def can_access_watten(identity, connection) -> bool:
    return bool(identity is not None and (watten_public_beta_enabled(connection) or watten_game_preview_enabled(connection)
                or _founder_request_enabled(connection) and _current_founder(identity)))


def can_discover_watten(identity, connection) -> bool:
    """The three existing suite hosts may link the founder to the apex preview."""
    return bool(watten_public_beta_enabled(connection) or identity is not None and (watten_game_preview_enabled(connection)
                or _founder_request_enabled(connection, discovery=True) and _current_founder(identity)))


def require_watten_access(connection, identity):
    if not watten_request_enabled(connection):
        raise HTTPException(status_code=404, detail="game_not_found", headers=_PRIVATE_HEADERS)
    if identity is None:
        raise HTTPException(status_code=401, detail="authentication_required", headers=_PRIVATE_HEADERS)
    if not can_access_watten(identity, connection):
        raise HTTPException(status_code=404, detail="game_not_found", headers=_PRIVATE_HEADERS)
    return identity
