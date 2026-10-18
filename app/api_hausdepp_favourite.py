"""One private account preset; password protection is a choice, never a secret."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .auth import require_csrf, require_user
from .database import session_scope
from .game_access import can_access_hausdepp
from .models import HausdeppPreferences

router = APIRouter(prefix="/api/hausdepp", tags=["hausdepp"])


class HausdeppFavouriteRequest(BaseModel):
    model_config = {"extra": "forbid"}

    waiting_mode: Literal["fixed", "open"] = "fixed"
    players: int = Field(strict=True, ge=2, le=6)
    cpu_count: int = Field(default=0, strict=True, ge=0, le=5)
    tournament: bool = Field(default=False, strict=True)
    password_required: bool = Field(default=False, strict=True)

    @model_validator(mode="after")
    def validate_seats(self):
        if self.waiting_mode == "open":
            self.players = 6
        if self.cpu_count >= self.players:
            raise ValueError("hausdepp_invalid_cpu_count")
        return self


def _account(request: Request):
    identity = require_user(request)
    if not can_access_hausdepp(identity):
        raise HTTPException(status_code=403, detail="hausdepp_preview_required")
    return identity


@router.get("/favourite")
def get_hausdepp_favourite(request: Request, response: Response):
    identity = _account(request)
    response.headers["Cache-Control"] = "no-store"
    with session_scope() as db:
        stored = db.get(HausdeppPreferences, identity.user_id)
        raw = stored.favourite_preset_json if stored else None
    try:
        favourite = HausdeppFavouriteRequest.model_validate_json(raw).model_dump() if raw else None
    except ValidationError:
        # A malformed historical row cannot disclose unvalidated fields.
        favourite = None
    return {"favourite": favourite}


@router.put("/favourite")
def put_hausdepp_favourite(payload: HausdeppFavouriteRequest, request: Request, response: Response):
    identity = _account(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    raw = payload.model_dump_json()
    with session_scope() as db:
        insert = sqlite_insert if db.bind.dialect.name == "sqlite" else pg_insert
        statement = insert(HausdeppPreferences).values(user_id=identity.user_id, favourite_preset_json=raw)
        db.execute(statement.on_conflict_do_update(
            index_elements=[HausdeppPreferences.user_id], set_={"favourite_preset_json": raw},
        ))
    return {"favourite": payload.model_dump()}


@router.delete("/favourite")
def delete_hausdepp_favourite(request: Request, response: Response):
    identity = _account(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    with session_scope() as db:
        db.execute(update(HausdeppPreferences).where(HausdeppPreferences.user_id == identity.user_id)
                   .values(favourite_preset_json=None))
    return {"favourite": None}
