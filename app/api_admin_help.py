"""HTTP entry points for player help requests and authenticated admin claims."""

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from .admin_help import (
    claim_help_request,
    clear_help_origin,
    close_stale_help_requests,
    create_help_request,
    dispatch_admin_help_notifications,
    get_help_request,
    help_status,
    list_help_requests,
    release_failed_help_claim,
    resolve_help_request,
)
from .admin_help_navigation import end_help_assignment, enter_help_game, return_from_help
from .auth import require_admin, require_csrf, require_user, resolve_session
from .game_access import can_access_game
from .game_state import games

router = APIRouter(prefix="/api/admin-help", tags=["admin help"])


class CreateHelpPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    game_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9-]+$")


class ClaimHelpPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_game_id: str | None = Field(default=None, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9-]+$")


class ResolveHelpPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: Literal["resolved", "accidental", "misuse"]


@router.get("/status")
async def admin_help_status(request: Request, response: Response, game_id: str = "") -> dict:
    identity = resolve_session(request)
    response.headers["Cache-Control"] = "no-store"
    await close_stale_help_requests()
    return help_status(identity.user_id if identity else None, game_id)


@router.get("/requests")
async def admin_help_requests(request: Request, response: Response) -> dict:
    identity = require_admin(request)
    response.headers["Cache-Control"] = "no-store"
    await close_stale_help_requests()
    return {"requests": list_help_requests(identity.user_id)}


@router.post("")
async def admin_help_create(payload: CreateHelpPayload, request: Request, response: Response,
                            background_tasks: BackgroundTasks) -> dict:
    from fastapi import HTTPException

    identity = require_user(request)
    require_csrf(request, identity)
    if not can_access_game(identity, games.get(payload.game_id, {})):
        raise HTTPException(status_code=404, detail={"code": "admin_help_game_unavailable"})
    response.headers["Cache-Control"] = "no-store"
    await close_stale_help_requests()
    help_request, created = create_help_request(payload.game_id, identity.user_id)
    if created:
        background_tasks.add_task(dispatch_admin_help_notifications, request_id=help_request["id"])
    return {"request": help_request, "created": created}


@router.post("/{request_id}/claim")
async def admin_help_claim(request_id: str, payload: ClaimHelpPayload, request: Request, response: Response) -> dict:
    identity = require_admin(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    await close_stale_help_requests()
    previous = get_help_request(request_id, identity.user_id)
    help_request = claim_help_request(request_id, identity.user_id, payload.current_game_id)
    try:
        if previous["origin_game_id"] != help_request["origin_game_id"]:
            await end_help_assignment(request_id)
        navigation = await enter_help_game(identity, help_request)
    except Exception:
        if previous["claimed_by_user_id"] != identity.user_id:
            await end_help_assignment(request_id)
            release_failed_help_claim(request_id, identity.user_id)
        raise
    return {"request": help_request, **navigation}


@router.post("/{request_id}/resolve")
async def admin_help_resolve(request_id: str, payload: ResolveHelpPayload, request: Request, response: Response) -> dict:
    identity = require_admin(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    help_request = resolve_help_request(request_id, identity.user_id, payload.outcome)
    await end_help_assignment(request_id)
    return {"request": help_request}


@router.post("/{request_id}/return")
async def admin_help_return(request_id: str, request: Request, response: Response) -> dict:
    identity = require_admin(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    help_request = get_help_request(request_id, identity.user_id)
    navigation = await return_from_help(identity, help_request)
    clear_help_origin(request_id, identity.user_id)
    return {"request": get_help_request(request_id, identity.user_id), **navigation}
