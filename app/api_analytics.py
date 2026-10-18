"""Authenticated dashboard and bounded anonymous first-party event collection."""
from __future__ import annotations

import json

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import update

from .analytics import MAX_BODY_BYTES, dashboard_stats, enqueue_batch, normalize_batch
from .auth import require_admin, require_csrf, require_user
from .database import session_scope
from .models import User
from .ownership import ownership_flags, require_owner
from .proxy_headers import trusted_cloudflare_peer
from .security import utcnow
from .watten_access import can_access_watten

router = APIRouter(prefix="/api")

_COUNTRY_CODES = frozenset("""
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO
FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT
JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM
MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR
PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ
TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW ZZ
""".split())


def trusted_country(request: Request) -> str:
    if trusted_cloudflare_peer(request.scope) is not None:
        value = request.headers.get("cf-ipcountry", "ZZ").upper()
        if value in _COUNTRY_CODES:
            return value
    return "ZZ"


def require_analytics(request: Request):
    """Read fresh capability every time; staff roles grant no dashboard access."""
    identity = require_user(request)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if user is None or not user.is_active or not (
            user.analytics_access or ownership_flags(db, user.id)["is_founder"]
        ):
            raise HTTPException(status_code=403, detail="analytics_access_required")
    return identity


@router.post("/analytics/events", status_code=202)
async def analytics_events(request: Request):
    if request.headers.get("dnt") == "1" or request.headers.get("sec-gpc") == "1":
        return Response(status_code=204)
    # This anonymous write has no account side effects. Enforce same-origin
    # collection rather than requiring a login/CSRF token on public pages.
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") != str(request.base_url).rstrip("/"):
        raise HTTPException(status_code=403, detail="analytics_origin_rejected")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(status_code=403, detail="analytics_origin_rejected")
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    if content_type not in {"application/json", "text/plain"}:
        raise HTTPException(status_code=415, detail="analytics_content_type")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="analytics_payload_too_large")
    try:
        batch = normalize_batch(json.loads(raw), country=trusted_country(request))
    except (ValueError, UnicodeError, TypeError, RecursionError) as exc:
        raise HTTPException(status_code=400, detail="analytics_invalid_payload") from exc
    if not enqueue_batch(batch):
        raise HTTPException(status_code=429, detail="analytics_busy", headers={"Retry-After": "60"})
    return {"accepted": len(batch["events"])}


@router.get("/admin/analytics")
def analytics_dashboard(request: Request, response: Response, days: int = Query(default=7),
                        game: str = Query(default="all", max_length=16)):
    identity = require_analytics(request)
    # Bind a mounted dashboard to the account actually serving this request.
    # The optional assertion grants no capability and precedes any aggregation.
    expected = request.headers.getlist("X-Analytics-Expected-Account-Id")
    if expected:
        if (len(expected) != 1 or not expected[0].isascii() or not expected[0].isdecimal()
                or expected[0].startswith("0")):
            raise HTTPException(status_code=400, detail="analytics_invalid_expected_account_id",
                                headers={"Cache-Control": "no-store"})
        if expected[0] != str(identity.user_id):
            raise HTTPException(status_code=409, detail="analytics_account_changed", headers={"Cache-Control": "no-store"})
    # Public game access never grants the private Mission Control dataset.
    include_hausdepp = bool(identity.is_founder)
    # The closed native product is an independent, request-scoped capability.
    # A delegated dashboard grant (or an old identity flag) cannot enable it.
    with session_scope() as db:
        include_watten = bool(can_access_watten(identity, request)
                              and ownership_flags(db, identity.user_id)["is_founder"])
    if game not in {"all", "zdwa", "zilch", "hausdepp", "watten"}:
        raise HTTPException(status_code=422, detail="analytics_invalid_filter")
    if game == "hausdepp" and not include_hausdepp or game == "watten" and not include_watten:
        raise HTTPException(status_code=403, detail="analytics_game_unavailable")
    if days not in {1, 7, 30, 90}:
        raise HTTPException(status_code=422, detail="analytics_invalid_filter")
    response.headers["Cache-Control"] = "no-store"
    return dashboard_stats(days, game, include_hausdepp=include_hausdepp, include_watten=include_watten)


class AnalyticsAccessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool


@router.put("/admin/users/{user_id}/analytics-access")
def update_analytics_access(user_id: int, payload: AnalyticsAccessRequest, request: Request, response: Response):
    identity = require_admin(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    with session_scope() as db:
        require_owner(db, identity.user_id, founder=True)
        # Serialize the target check with concurrent account administration.
        db.execute(update(User).where(User.id == user_id).values(updated_at=User.updated_at))
        user = db.get(User, user_id)
        if user is None:
            raise HTTPException(status_code=404, detail="user_not_found")
        db.refresh(user)
        if ownership_flags(db, user.id)["is_founder"]:
            raise HTTPException(status_code=409, detail="founder_protected")
        user.analytics_access = payload.enabled
        user.updated_at = utcnow()
        return {"user": {"id": user.id, "analytics_access": user.analytics_access,
                         "can_view_analytics": bool(user.is_active and user.analytics_access)}}
