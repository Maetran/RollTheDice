"""Private feature administration and account-bound player capabilities."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt

from .auth import lock_current_account_session, require_admin, require_csrf, resolve_session
from .database import session_scope
from .feature_flags import (
    PRIVATE_HEADERS,
    admin_feature_catalog,
    feature_catalog,
    set_feature_settings,
    set_game_beta,
)

router = APIRouter(prefix="/api", tags=["game features"])


class FeatureChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["off", "internal", "public"]
    beta: StrictBool
    version: StrictInt = Field(ge=0)


class GameBetaChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    beta: StrictBool
    version: StrictInt = Field(ge=0)


def _check_viewer(request: Request, user_id: int | None) -> None:
    for name in ("x-watten-expected-account-id", "x-account-expected-id"):
        values = request.headers.getlist(name)
        if values and (len(values) != 1 or user_id is None or values[0] != str(user_id)):
            raise HTTPException(status_code=409, detail="account_changed", headers=PRIVATE_HEADERS)


@router.get("/features")
def player_features(request: Request, response: Response):
    response.headers.update(PRIVATE_HEADERS)
    identity = resolve_session(request)
    _check_viewer(request, identity.user_id if identity else None)
    with session_scope() as db:
        return feature_catalog(db, identity)


@router.get("/admin/features")
def admin_features(request: Request, response: Response):
    response.headers.update(PRIVATE_HEADERS)
    identity = require_admin(request)
    _check_viewer(request, identity.user_id)
    with session_scope() as db:
        return admin_feature_catalog(db, identity.user_id)


@router.put("/admin/features/{key}")
def change_feature(key: str, payload: FeatureChange, request: Request, response: Response):
    response.headers.update(PRIVATE_HEADERS)
    identity = require_admin(request)
    _check_viewer(request, identity.user_id)
    require_csrf(request, identity)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        return set_feature_settings(db, actor_user_id=identity.user_id, key=key,
                                    status=payload.status, beta=payload.beta, version=payload.version)


@router.put("/admin/features/games/{game}/beta")
def change_game_beta(game: str, payload: GameBetaChange, request: Request, response: Response):
    response.headers.update(PRIVATE_HEADERS)
    identity = require_admin(request)
    _check_viewer(request, identity.user_id)
    require_csrf(request, identity)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        return set_game_beta(db, actor_user_id=identity.user_id, game=game, beta=payload.beta, version=payload.version)
