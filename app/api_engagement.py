from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse

from .auth import require_csrf, require_user
from .engagement import (
    record_account_tab_engagement,
    record_engagement_safely,
    record_request_engagement,
)

router = APIRouter(tags=["engagement"])

_GITHUB_DESTINATIONS = {
    "issues": "https://github.com/Maetran/RollTheDice/issues",
    "changelog": "https://github.com/Maetran/RollTheDice/blob/master/CHANGELOG.md",
}


@router.post("/api/account/engagement/account-tab/{tab}")
def account_tab_engagement(
    tab: Literal["statistics", "achievements", "settings"],
    request: Request,
):
    """Track the exact visible account tab; no free-form award input exists."""
    identity = require_user(request)
    require_csrf(request, identity)
    return record_account_tab_engagement(identity.user_id, tab)


@router.post("/api/account/engagement/theme")
def theme_engagement(request: Request):
    """Track the one local appearance toggle after its UI action completed."""
    identity = require_user(request)
    require_csrf(request, identity)
    return record_engagement_safely(identity.user_id, "theme_changed")


@router.post("/api/account/engagement/push-settings")
def push_settings_engagement(request: Request):
    """Track an actual interaction inside the dedicated push-settings card."""
    identity = require_user(request)
    require_csrf(request, identity)
    return record_engagement_safely(identity.user_id, "push_settings_viewed")


@router.get("/go/github/{destination}", include_in_schema=False)
def github_redirect(
    destination: Literal["issues", "changelog"],
    request: Request,
) -> RedirectResponse:
    """Record an app-owned GitHub handoff before leaving the product."""
    record_request_engagement(request, "github_clicked")
    response = RedirectResponse(_GITHUB_DESTINATIONS[destination], status_code=307)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response
