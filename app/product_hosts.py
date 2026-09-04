"""Fixed product origins and safe cross-origin navigation helpers."""

from __future__ import annotations

import os
from urllib.parse import unquote, urlsplit

DEFAULT_SITE_ORIGIN = "https://zockdiewandan.online"
DEFAULT_ZILCH_ORIGIN = "https://zilch.zockdiewandan.online"

_ZILCH_EXACT_PATHS = frozenset(
    {
        "/",
        "/anmelden",
        "/historie",
        "/statistiken",
        "/bestenlisten",
        "/erfolge",
        "/konto",
        "/regeln",
    }
)
_ZILCH_PATH_PREFIXES = ("/spiel/", "/ergebnis/", "/spieler/")


def _decoded_path_segment_is_safe(segment: str) -> bool:
    """Reject separators and dot segments, including nested percent encoding."""
    decoded = segment
    try:
        while True:
            next_value = unquote(decoded, errors="strict")
            if next_value == decoded:
                break
            decoded = next_value
    except UnicodeDecodeError:
        return False
    return bool(
        decoded
        and decoded not in {".", ".."}
        and "/" not in decoded
        and "\\" not in decoded
        and not any(ord(character) < 32 or ord(character) == 127 for character in decoded)
    )


def _is_known_zilch_path(path: str) -> bool:
    if path in _ZILCH_EXACT_PATHS:
        return True
    for prefix in _ZILCH_PATH_PREFIXES:
        if not path.startswith(prefix):
            continue
        segment = path[len(prefix) :]
        if segment.endswith("/"):
            segment = segment[:-1]
        return _decoded_path_segment_is_safe(segment)
    return False


def _configured_origin(environment_name: str, default: str) -> str:
    value = os.getenv(environment_name, default).strip().rstrip("/")
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError as exc:
        raise RuntimeError(f"{environment_name} must be a valid absolute HTTP(S) origin") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError(f"{environment_name} must be an absolute HTTP(S) origin")
    return value


def site_origin() -> str:
    return _configured_origin("ROLLTHEDICE_SITE_ORIGIN", DEFAULT_SITE_ORIGIN)


def zilch_origin() -> str:
    return _configured_origin("ROLLTHEDICE_ZILCH_ORIGIN", DEFAULT_ZILCH_ORIGIN)


def validate_product_host_config() -> None:
    """Fail closed when cross-host login settings do not describe one trusted site."""
    configured_site = urlsplit(site_origin())
    configured_zilch = urlsplit(zilch_origin())
    if (configured_site.hostname or "").casefold() == (configured_zilch.hostname or "").casefold():
        raise RuntimeError("ROLLTHEDICE_SITE_ORIGIN and ROLLTHEDICE_ZILCH_ORIGIN must use different hostnames")

    cookie_domain = os.getenv("ROLLTHEDICE_COOKIE_DOMAIN", "").strip().lower().lstrip(".")
    if not cookie_domain:
        return
    if configured_site.scheme != "https" or configured_zilch.scheme != "https":
        raise RuntimeError("Shared product cookies require HTTPS product origins")
    for hostname in (configured_site.hostname or "", configured_zilch.hostname or ""):
        if hostname != cookie_domain and not hostname.endswith(f".{cookie_domain}"):
            raise RuntimeError("Product origins must belong to ROLLTHEDICE_COOKIE_DOMAIN")


def _origin_hostname(origin: str) -> str:
    return (urlsplit(origin).hostname or "").casefold()


def request_hostname(connection) -> str:
    host = connection.headers.get("host", "").split(",", 1)[0].strip()
    try:
        return (urlsplit(f"//{host}").hostname or "").casefold()
    except ValueError:
        return ""


def is_zilch_host(connection) -> bool:
    return request_hostname(connection) == _origin_hostname(zilch_origin())


def is_site_host(connection) -> bool:
    return request_hostname(connection) == _origin_hostname(site_origin())


def safe_zilch_path(value: str | None) -> str:
    """Accept only known relative Zilch destinations for the auth handoff."""
    candidate = str(value or "/").strip()
    if len(candidate) > 2048 or any(ord(character) < 32 for character in candidate):
        return "/"
    try:
        parsed = urlsplit(candidate)
    except ValueError:
        return "/"
    if parsed.scheme or parsed.netloc or parsed.fragment or not parsed.path.startswith("/"):
        return "/"
    if parsed.path.startswith("//"):
        return "/"
    if not _is_known_zilch_path(parsed.path):
        return "/"
    return parsed.path + (f"?{parsed.query}" if parsed.query else "")


def zilch_url(path: str | None = "/") -> str:
    return f"{zilch_origin()}{safe_zilch_path(path)}"
