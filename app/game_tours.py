"""Durable, private tour choices and an atomic one-time offer claim.

Reading missing preferences returns defaults without creating a row. A claimed
offer is already ``dismissed`` until the player deliberately starts the tour:
closing or reloading its tab must never open the offer again on another device.
Tour choices never authorize or perform any gameplay action.
"""

from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import update
from sqlalchemy.orm import Session

from .models import GameTourPreferences

GameType = Literal["zdwa", "zilch", "hausdepp", "watten"]
TourState = Literal["dismissed", "started", "completed"]
GAME_TYPES: tuple[GameType, ...] = ("zdwa", "zilch", "hausdepp")


class TourPreferencesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = Field(default=None, strict=True)
    game_type: GameType | None = None
    state: TourState | None = None

    @model_validator(mode="after")
    def require_complete_selection(self) -> Self:
        if (self.game_type is None) != (self.state is None):
            raise ValueError("game_type and state must be supplied together")
        if any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("Tour preferences cannot be null")
        return self


class TourOfferRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    game_type: GameType


def tour_preferences(db: Session, user_id: int, *, include_watten: bool = False) -> dict:
    stored = db.get(GameTourPreferences, user_id)
    return {
        "enabled": stored.enabled if stored is not None else True,
        "games": {
            game: getattr(stored, f"{game}_state") if stored is not None else "unseen"
            for game in ((*GAME_TYPES, "watten") if include_watten else GAME_TYPES)
        },
    }


def _ensure_preferences(db: Session, user_id: int) -> None:
    # Supported production databases both offer a conflict-safe insert. This
    # avoids a check-then-create race between tabs, devices and different games.
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    db.execute(insert(GameTourPreferences).values(user_id=user_id).on_conflict_do_nothing(index_elements=["user_id"]))


def update_tour_preferences(db: Session, user_id: int, payload: TourPreferencesRequest, *, include_watten: bool = False) -> dict:
    if payload.game_type == "watten" and not include_watten:
        raise ValueError("watten_tour_unavailable")
    _ensure_preferences(db, user_id)
    changes = {}
    if payload.enabled is not None:
        changes["enabled"] = payload.enabled
    if payload.game_type is not None:
        changes[f"{payload.game_type}_state"] = payload.state
    if changes:
        db.execute(update(GameTourPreferences).where(GameTourPreferences.user_id == user_id).values(**changes))
    return tour_preferences(db, user_id, include_watten=include_watten)


def claim_tour_offer(db: Session, user_id: int, game_type: GameType, *, include_watten: bool = False) -> dict:
    if game_type == "watten" and not include_watten:
        raise ValueError("watten_tour_unavailable")
    _ensure_preferences(db, user_id)
    state_column = getattr(GameTourPreferences, f"{game_type}_state")
    result = db.execute(
        update(GameTourPreferences)
        .where(
            GameTourPreferences.user_id == user_id,
            GameTourPreferences.enabled.is_(True),
            state_column == "unseen",
        )
        .values({state_column: "dismissed"})
    )
    return {"show": result.rowcount == 1, **tour_preferences(db, user_id, include_watten=include_watten)}
