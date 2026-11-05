"""Owner-managed controls and private, bounded game observation export."""

import json
import re
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt
from sqlalchemy import select

from .auth import lock_current_account_session, require_admin, require_csrf
from .database import session_scope
from .models import ObservationEvent, ObservationRecording, User
from .observation import PRIVATE_HEADERS, RETENTION_DAYS, change_policy, delete_recordings, policy_snapshot
from .ownership import require_owner
from .security import as_utc, utcnow

router = APIRouter(prefix="/api/admin/observation", tags=["private game observation"])


class PolicyChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: StrictBool
    mode: Literal["all", "selected"]
    selected_user_ids: list[StrictInt] = Field(max_length=1000)
    version: StrictInt = Field(ge=0)


class DeleteChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: StrictInt = Field(ge=0)


def _identity(request, response, write=False):
    response.headers.update(PRIVATE_HEADERS)
    identity = require_admin(request)
    values = request.headers.getlist("x-account-expected-id")
    if values and (len(values) != 1 or values[0] != str(identity.user_id)):
        raise HTTPException(status_code=409, detail="account_changed", headers=PRIVATE_HEADERS)
    if write:
        require_csrf(request, identity)
    return identity


@router.get("")
def get_policy(request: Request, response: Response):
    identity = _identity(request, response)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        return policy_snapshot(db, identity.user_id)


@router.put("")
def put_policy(payload: PolicyChange, request: Request, response: Response):
    identity = _identity(request, response, True)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        return change_policy(db, actor_user_id=identity.user_id, enabled=payload.enabled, mode=payload.mode,
                             selected_user_ids=payload.selected_user_ids, version=payload.version)


@router.delete("/recordings")
def delete_all(payload: DeleteChange, request: Request, response: Response):
    identity = _identity(request, response, True)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        return delete_recordings(db, actor_user_id=identity.user_id, version=payload.version)


@router.get("/players")
def find_players(request: Request, response: Response, query: str = Query(min_length=1, max_length=32)):
    identity = _identity(request, response)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        require_owner(db, identity.user_id)
        rows = db.execute(select(User.id, User.username).where(User.is_active.is_(True),
                          User.username_normalized.contains(query.strip().casefold(), autoescape=True))
                          .order_by(User.username_normalized).limit(30)).all() if query.strip() else []
        return {"players": [{"id": row.id, "username": row.username} for row in rows]}


@router.get("/recordings")
def list_recordings(request: Request, response: Response, limit: int = Query(50, ge=1, le=100),
                    before: str | None = Query(None, pattern=r"^[0-9a-f]{32}$")):
    identity = _identity(request, response)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        require_owner(db, identity.user_id)
        query = select(ObservationRecording).where(ObservationRecording.started_at > utcnow() - timedelta(days=RETENTION_DAYS))
        if before:
            query = query.where(ObservationRecording.id < before)
        rows = db.scalars(query.order_by(ObservationRecording.id.desc()).limit(limit + 1)).all()
        items = rows[:limit]
        return {"items": [{"id": row.id, "game_type": row.game_type, "status": row.status,
                           "started_at": as_utc(row.started_at).isoformat(),
                           "finished_at": as_utc(row.finished_at).isoformat() if row.finished_at else None,
                           "outcome": json.loads(row.outcome_json) if row.outcome_json else None} for row in items],
                "next_cursor": items[-1].id if len(rows) > limit else None}


@router.get("/recordings/{recording_id}/events")
def list_events(recording_id: str, request: Request, response: Response, limit: int = Query(100, ge=1, le=200),
                after: int = Query(-1, ge=-1, le=100000)):
    identity = _identity(request, response)
    if not re.fullmatch(r"[0-9a-f]{32}", recording_id):
        raise HTTPException(status_code=404, detail="observation_not_found", headers=PRIVATE_HEADERS)
    with session_scope() as db:
        lock_current_account_session(db, identity)
        require_owner(db, identity.user_id)
        recording = db.get(ObservationRecording, recording_id)
        if not recording or as_utc(recording.started_at) <= utcnow() - timedelta(days=RETENTION_DAYS):
            raise HTTPException(status_code=404, detail="observation_not_found", headers=PRIVATE_HEADERS)
        rows = db.scalars(select(ObservationEvent).where(ObservationEvent.recording_id == recording_id,
                          ObservationEvent.sequence > after).order_by(ObservationEvent.sequence).limit(limit + 1)).all()
        items = rows[:limit]
        return {"items": [{"sequence": row.sequence, "actor_seat": row.actor_seat, "actor_kind": row.actor_kind,
                           "action": json.loads(row.action_json), "context": json.loads(row.context_json),
                           "created_at": as_utc(row.created_at).isoformat()} for row in items],
                "next_after": items[-1].sequence if len(rows) > limit else None}
