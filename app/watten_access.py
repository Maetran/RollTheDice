"""A separate, strictly local game-development gate; never a production grant."""

import ipaddress
import os
from urllib.parse import urlsplit

from fastapi import HTTPException

from .product_hosts import is_watten_host, site_origin


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


def can_access_watten(identity, connection) -> bool:
    return bool(identity is not None and watten_game_preview_enabled(connection))


def require_watten_access(connection, identity):
    if not watten_game_preview_enabled(connection):
        raise HTTPException(status_code=404, detail="game_not_found")
    if identity is None:
        raise HTTPException(status_code=401, detail="authentication_required")
    return identity
