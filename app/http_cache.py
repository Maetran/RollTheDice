"""HTTP cache policy for dynamic responses and versioned static assets."""

from __future__ import annotations

import re
from pathlib import Path

from starlette.requests import Request
from starlette.responses import Response

REVALIDATE = "no-cache, must-revalidate"
NO_STORE = "no-store"
IMMUTABLE = "public, max-age=31536000, immutable"
_CACHE_VERSION_RE = re.compile(r"const CACHE_VERSION = 'assets-([A-Za-z0-9._-]+)';")
_IMMUTABLE_STATUSES = {200, 206, 304}


def read_static_asset_version(static_dir: Path) -> str | None:
    """Read the synchronized bundle version from the service worker.

    Failure is deliberately safe: without a trustworthy version, static
    responses are revalidated instead of being cached forever.
    """
    try:
        match = _CACHE_VERSION_RE.search((static_dir / "sw.js").read_text(encoding="utf-8"))
    except OSError:
        return None
    return match.group(1) if match else None


def apply_cache_policy(request: Request, response: Response, *, asset_version: str | None) -> None:
    """Apply one explicit cache contract to every HTTP response."""
    path = request.url.path

    if path.startswith("/api/"):
        response.headers["Cache-Control"] = NO_STORE
        return

    if path.startswith("/static/"):
        if response.status_code >= 400:
            response.headers["Cache-Control"] = NO_STORE
        elif path.endswith(".html"):
            response.headers["Cache-Control"] = REVALIDATE
        elif (
            asset_version
            and request.query_params.get("v") == asset_version
            and response.status_code in _IMMUTABLE_STATUSES
        ):
            response.headers["Cache-Control"] = IMMUTABLE
        else:
            response.headers["Cache-Control"] = REVALIDATE
        return

    if path in {"/manifest.webmanifest", "/manifest-en.webmanifest"}:
        response.headers["Cache-Control"] = REVALIDATE
        return

    # Avoid heuristic caching for unknown/error responses and make the policy
    # explicit for small root-level resources such as robots.txt and favicon.ico.
    if response.status_code >= 400:
        response.headers["Cache-Control"] = NO_STORE
    else:
        response.headers.setdefault("Cache-Control", REVALIDATE)
