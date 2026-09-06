"""Player-friendly successful releases; no push endpoints or recipient data."""

from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert

from .auth import require_csrf, require_user, resolve_session
from .database import session_scope
from .game_access import can_access_zilch_preview
from .models import PushRelease, ReleaseAcknowledgement
from .security import as_utc, utcnow

router = APIRouter(prefix="/api/releases", tags=["release notes"])
HISTORY_LIMIT = 10


class AcknowledgeReleaseRequest(BaseModel):
    # Guards against an account switch while an old dialog is still open.
    # Authorization always uses the current authenticated identity.
    viewer_id: int


def _require_product(identity, game_type: str) -> None:
    if game_type == "zilch" and not can_access_zilch_preview(identity):
        raise HTTPException(status_code=403, detail="game_access_denied")


@router.get("")
def release_history(request: Request, response: Response, game_type: Literal["zdwa", "zilch"] = "zdwa", language: Literal["de", "en"] = "de"):
    identity = resolve_session(request)
    _require_product(identity, game_type)
    response.headers["Cache-Control"] = "no-store"
    user_id = identity.user_id if identity else None
    with session_scope() as db:
        releases = list(db.scalars(select(PushRelease).where(
            PushRelease.game_types_json.contains(f'"{game_type}"'),
        ).order_by(PushRelease.published_at.desc(), PushRelease.revision.desc()).limit(HISTORY_LIMIT)))
        acknowledged = set(db.scalars(select(ReleaseAcknowledgement.revision).where(
            ReleaseAcknowledgement.user_id == user_id,
            ReleaseAcknowledgement.revision.in_([release.revision for release in releases]),
        ))) if user_id is not None else set()
        items = []
        for release in releases:
            notes = json.loads(release.player_notes_json)[language] if release.player_notes_json else {
                "title": "Neue Version" if language == "de" else "App update",
                "changes": [release.summary_de if language == "de" else release.summary_en],
            }
            items.append({
                "revision": release.revision, "published_at": as_utc(release.published_at).isoformat(),
                "title": notes["title"], "changes": notes["changes"],
                "acknowledged": release.revision in acknowledged,
                # Historic push-only releases stay readable, but are never
                # retroactively turned into popup announcements.
                "can_announce": bool(release.player_notes_json),
            })
    return {"viewer_id": user_id, "releases": items, "can_prompt": not (identity and identity.must_change_password)}


@router.post("/{revision}/acknowledge")
def acknowledge_release(revision: str, payload: AcknowledgeReleaseRequest, request: Request, response: Response,
                        game_type: Literal["zdwa", "zilch"] = "zdwa"):
    identity = require_user(request)
    require_csrf(request, identity)
    _require_product(identity, game_type)
    if payload.viewer_id != identity.user_id:
        raise HTTPException(status_code=409, detail="release_viewer_changed")
    response.headers["Cache-Control"] = "no-store"
    with session_scope() as db:
        release = db.get(PushRelease, revision)
        if release is None or game_type not in json.loads(release.game_types_json):
            raise HTTPException(status_code=404, detail="release_not_found")
        db.execute(insert(ReleaseAcknowledgement).values(
            revision=revision, user_id=identity.user_id, acknowledged_at=utcnow(),
        ).on_conflict_do_nothing(index_elements=["revision", "user_id"]))
    return {"ok": True, "revision": revision}
