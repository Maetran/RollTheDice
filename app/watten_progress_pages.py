"""Authenticated draft progress pages and their native account API."""

from pathlib import Path
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi import Path as ApiPath
from fastapi.responses import JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .auth import require_csrf, resolve_session
from .database import session_scope
from .models import WattenMatchCredit
from .watten_access import require_watten_access, watten_game_preview_enabled, watten_request_enabled
from .watten_progress_presentations import apply_match_receipts, match_presentation
from .watten_progression_receipts import acknowledge_match_presentation
from .watten_progression_store import acknowledge_draft_progress
from .watten_pwa import account_pwa_head
from .watten_readiness import watten_account_preview_enabled

router = APIRouter()
_STATIC = Path(__file__).resolve().parent / "static"
_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def _gate(request: Request):
    if (not watten_request_enabled(request)
            or watten_game_preview_enabled(request) and not watten_account_preview_enabled(request)):
        raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)


def _identity(request: Request):
    _gate(request)
    try:
        identity = require_watten_access(request, resolve_session(request))
        expected = request.headers.getlist("X-Watten-Expected-Account-Id")
        if expected and (len(expected) != 1 or not expected[0].isascii() or not expected[0].isdecimal()
                        or expected[0] != str(identity.user_id)):
            raise HTTPException(status_code=409, detail="watten_account_changed", headers=_HEADERS)
        return identity
    except HTTPException as exc:
        exc.headers = {**(exc.headers or {}), **_HEADERS}
        raise


def _response(data):
    return JSONResponse(data, headers=_HEADERS)


def _csrf(request, identity):
    try:
        require_csrf(request, identity)
    except HTTPException as exc:
        exc.headers = {**(exc.headers or {}), **_HEADERS}
        raise


def _read_error(exc):
    code = str(exc)
    if code in {"watten_account_invalid_cursor", "watten_account_invalid_limit", "watten_leaderboard_xp_filter_unsupported",
                "watten_leaderboard_invalid_metric", "watten_leaderboard_invalid_opponents"}:
        return HTTPException(status_code=400, detail=code, headers=_HEADERS)
    return HTTPException(status_code=503, detail="watten_progress_unavailable", headers=_HEADERS)


@router.get("/api/watten/account")
def account(request: Request, before: str | None = Query(default=None, max_length=512),
            limit: int = Query(default=12, ge=1, le=30), identity=Depends(_identity)):
    from .watten_account import build_watten_account

    try:
        result = build_watten_account(identity.user_id, before=before, limit=limit)
        return _response(apply_match_receipts(result, user_id=identity.user_id))
    except (ValueError, SQLAlchemyError) as exc:
        raise _read_error(exc) from exc


@router.get("/api/watten/leaderboard")
def leaderboard(request: Request, metric: str = Query(default="xp", pattern=r"^(xp|wins|win_rate)$"),
                players: int | None = Query(default=None, ge=2, le=4),
                opponents: str = Query(default="all", pattern=r"^(all|human|cpu)$"),
                limit: int = Query(default=50, ge=1, le=50), identity=Depends(_identity)):
    from .watten_leaderboard import build_watten_leaderboard

    try:
        return _response(build_watten_leaderboard(identity.user_id, metric=metric, players=players,
                                                  opponents=opponents, limit=limit))
    except (ValueError, SQLAlchemyError) as exc:
        raise _read_error(exc) from exc


@router.get("/api/watten/achievements/feed")
def achievement_feed(request: Request, page: int = Query(default=1, ge=1),
                     limit: int = Query(default=12, ge=1, le=30), identity=Depends(_identity)):
    from .watten_achievement_feed import build_watten_achievement_feed

    try:
        return _response(build_watten_achievement_feed(identity.user_id, page=page, limit=limit))
    except (ValueError, SQLAlchemyError) as exc:
        raise _read_error(exc) from exc


class ProgressAcknowledgement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    generation: StrictInt = Field(ge=1)
    through_sequence: StrictInt = Field(ge=0)


@router.get("/api/watten/account/matches/{game_id}/presentation")
def present_match(request: Request, game_id: str = ApiPath(pattern=r"^[0-9a-f]{16}$"), identity=Depends(_identity)):
    from .watten_account import build_watten_account

    try:
        account_data = build_watten_account(identity.user_id)
        return _response(match_presentation(account_data, user_id=identity.user_id, game_id=game_id))
    except (ValueError, SQLAlchemyError) as exc:
        if str(exc) == "watten_presentation_not_found":
            raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS) from exc
        raise _read_error(exc) from exc


@router.post("/api/watten/account/matches/{game_id}/presentation/acknowledge")
def acknowledge_match(payload: ProgressAcknowledgement, request: Request,
                      game_id: str = ApiPath(pattern=r"^[0-9a-f]{16}$"), identity=Depends(_identity)):
    _csrf(request, identity)
    try:
        with session_scope() as db:
            if db.scalar(select(WattenMatchCredit.game_id).where(
                    WattenMatchCredit.user_id == identity.user_id, WattenMatchCredit.game_id == game_id).limit(1)) is None:
                raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)
            result = acknowledge_match_presentation(db, user_id=identity.user_id, generation=payload.generation,
                                                    game_id=game_id, through_sequence=payload.through_sequence)
            response = {"ok": True, "generation": result.generation, "game_id": result.game_id,
                        "through_sequence": result.through_sequence}
        return _response(response)
    except ValueError as exc:
        if str(exc) in {"watten_presentation_match_not_owned", "watten_presentation_not_found"}:
            raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS) from exc
        raise HTTPException(status_code=409, detail="watten_progress_stale_ack", headers=_HEADERS) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="watten_progress_unavailable", headers=_HEADERS) from exc


@router.post("/api/watten/account/acknowledge")
def acknowledge(payload: ProgressAcknowledgement, request: Request, identity=Depends(_identity)):
    _csrf(request, identity)
    try:
        with session_scope() as db:
            result = acknowledge_draft_progress(db, user_id=identity.user_id, generation=payload.generation,
                                                through_sequence=payload.through_sequence)
            response = {"ok": True, "generation": result.generation,
                        "acknowledged_sequence": result.acknowledged_sequence}
        return _response(response)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail="watten_progress_stale_ack", headers=_HEADERS) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="watten_progress_unavailable", headers=_HEADERS) from exc


def _page(request: Request, page: str):
    _gate(request)
    if resolve_session(request) is None:
        return RedirectResponse("/watten/anmelden?" + urlencode({"return_to": request.url.path}),
                                status_code=303, headers=_HEADERS)
    _identity(request)
    template = _STATIC / "watten-progress.html"
    if not template.is_file():
        raise HTTPException(status_code=503, detail="watten_preview_not_ready", headers=_HEADERS)
    content = template.read_text(encoding="utf-8").replace("{watten_progress_page}", page)
    return Response(account_pwa_head(content) if watten_account_preview_enabled(request) else content,
                    media_type="text/html", headers=_HEADERS)


@router.get("/watten/konto/fortschritt", include_in_schema=False)
def progress_page(request: Request):
    return _page(request, "progress")


@router.get("/watten/konto/verlauf", include_in_schema=False)
def history_page(request: Request):
    return _page(request, "history")


@router.get("/watten/rangliste", include_in_schema=False)
def leaderboard_page(request: Request):
    return _page(request, "leaderboard")
