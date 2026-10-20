"""Bounded product presentation for one shared suite account system."""

from urllib.parse import parse_qs, quote, urlencode, urlsplit

from fastapi import HTTPException

from .product_hosts import (
    DEFAULT_SITE_ORIGIN,
    HAUSDEPP_ORIGIN,
    WATTEN_ORIGIN,
    is_hausdepp_host,
    is_watten_host,
    safe_hausdepp_path,
    safe_watten_account_path,
    site_origin,
)
from .watten_readiness import watten_account_preview_enabled, watten_public_beta_enabled


def account_app_context(request, requested: str = "zdwa") -> str:
    # Host identity wins over a stale tab's payload. A product choice changes
    # presentation only; it never changes token ownership or authentication.
    if is_watten_host(request) or requested == "watten":
        if not watten_account_preview_enabled(request):
            raise HTTPException(status_code=503, detail="watten_not_available")
        return "watten"
    return "hausdepp" if is_hausdepp_host(request) or requested == "hausdepp" else "zdwa"


def house_account_return_path(value: str | None) -> str:
    """Keep only a direct allowed House path from the legacy fixed handoff.

    This is account presentation, not a new authentication redirect contract:
    absolute origins, other apps, duplicate fields and nested handoffs fail shut.
    """
    candidate = value or "/hausdepp/konto"
    if not isinstance(candidate, str) or len(candidate) > 2048 or "\\" in candidate or "#" in candidate:
        return "/hausdepp"
    if any(ord(character) < 32 or ord(character) == 127 for character in candidate):
        return "/hausdepp"
    direct = safe_hausdepp_path(candidate)
    if direct == candidate:
        return direct
    if not candidate.startswith("/auth/continue?"):
        return "/hausdepp"
    try:
        outer = urlsplit(candidate)
        query = parse_qs(outer.query, keep_blank_values=True, max_num_fields=2)
    except ValueError:
        return "/hausdepp"
    if (outer.scheme or outer.netloc or outer.path != "/auth/continue" or outer.fragment
            or set(query) != {"app", "path"} or query["app"] != ["hausdepp"] or len(query["path"]) != 1):
        return "/hausdepp"
    inner = query["path"][0]
    if "\\" in inner or "#" in inner or any(ord(character) < 32 or ord(character) == 127 for character in inner):
        return "/hausdepp"
    direct = safe_hausdepp_path(inner)
    return direct if direct == inner else "/hausdepp"


def account_action_url(path: str, raw_token: str, language: str, *, app: str = "zdwa", return_to: str | None = None) -> str:
    origin = site_origin()
    parameters = {"lang": "en" if language == "en" else "de"}
    if app == "watten":
        if not watten_account_preview_enabled():
            raise RuntimeError("Watten account preview requires a local deployment")
        if watten_public_beta_enabled() and origin == DEFAULT_SITE_ORIGIN:
            origin = WATTEN_ORIGIN
        parameters["app"] = "watten"
        parameters["return_to"] = safe_watten_account_path(return_to)
    if app == "hausdepp":
        # Staging/local tokens stay in their configured environment. Only the
        # production suite uses its fixed Hausdepp origin, never request Host.
        if origin == DEFAULT_SITE_ORIGIN:
            origin = HAUSDEPP_ORIGIN
        parameters["app"] = "hausdepp"
        parameters["return_to"] = house_account_return_path(return_to)
    return f"{origin}{path}?{urlencode(parameters)}#token={quote(raw_token, safe='')}"
