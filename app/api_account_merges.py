"""Private owner merge preview/apply and independently scoped player receipts."""
from __future__ import annotations

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .account_merge import (
    acknowledge_merge_in_session,
    apply_merge_in_session,
    preview_merge_in_session,
    public_operation,
)
from .account_progress import ProgressIdentityError
from .auth import require_admin, require_csrf, require_user
from .auth_proofs import AccountConfirmation
from .database import session_scope
from .models import AccountMergeOperation

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["account merge"])
_PRIVATE = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


class MergePreviewRequest(BaseModel):
    source_user_id: int = Field(gt=0)
    target_user_id: int = Field(gt=0)


class MergeApplyRequest(AccountConfirmation, MergePreviewRequest):
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    idempotency_key: str = Field(min_length=16, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    confirmed: Literal[True]


def _failure(exc):
    if isinstance(exc, ProgressIdentityError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail="merge_game_validation_failed")
    # Do not serialize SQL parameters, authenticator state or private evidence.
    logger.error("Account merge database operation could not be completed")
    return HTTPException(status_code=503, detail="merge_temporarily_unavailable")


def _require_mounted_account(request: Request, user_id: int, *, required: bool):
    """Reject a receipt from a page mounted for a different signed-in account."""
    values = request.headers.getlist("x-account-expected-id")
    if not values and not required:
        return
    if len(values) != 1 or values[0] != str(user_id):
        raise HTTPException(status_code=409, detail="account_changed", headers=_PRIVATE)


@router.post("/admin/account-merges/preview")
def preview(payload: MergePreviewRequest, request: Request, response: Response):
    response.headers.update(_PRIVATE)
    identity = require_admin(request)
    _require_mounted_account(request, identity.user_id, required=True)
    require_csrf(request, identity)
    try:
        with session_scope() as db:
            return preview_merge_in_session(db, actor_id=identity.user_id, source_id=payload.source_user_id,
                                            target_id=payload.target_user_id)
    except (ProgressIdentityError, ValueError, SQLAlchemyError) as exc:
        raise _failure(exc) from exc


@router.post("/admin/account-merges/apply")
async def apply(payload: MergeApplyRequest, request: Request, response: Response):
    response.headers.update(_PRIVATE)
    identity = require_admin(request)
    _require_mounted_account(request, identity.user_id, required=True)
    require_csrf(request, identity)
    try:
        # History evaluation can take time. Keep the event loop available for
        # game/voice traffic while this one atomic database transaction runs.
        result = await asyncio.to_thread(_apply_request, payload, identity, request)
    except (ProgressIdentityError, ValueError, SQLAlchemyError) as exc:
        raise _failure(exc) from exc
    from .hausdepp_voice import reap_voice

    try:
        await reap_voice()
    except Exception:
        # The existing voice watchdog rechecks exact sessions every 3seconds.
        # Transport failure cannot undo an already committed account merge.
        logger.error("Post-merge voice cleanup will be retried by the watchdog")
    return result


def _apply_request(payload, identity, request):
    # A retry returns the recorded receipt without applying a second merge.
    with session_scope() as db:
        return apply_merge_in_session(
            db, identity=identity, request=request, source_id=payload.source_user_id,
            target_id=payload.target_user_id, fingerprint=payload.fingerprint,
            idempotency_key=payload.idempotency_key,
            current_password=payload.current_password, passkey=payload.passkey,
        )


@router.get("/account/merges/pending")
def pending(request: Request, response: Response):
    response.headers.update(_PRIVATE)
    identity = require_user(request)
    _require_mounted_account(request, identity.user_id, required=False)
    with session_scope() as db:
        rows = db.scalars(select(AccountMergeOperation).where(
            AccountMergeOperation.target_user_id == identity.user_id,
            AccountMergeOperation.acknowledged_at.is_(None),
        ).order_by(AccountMergeOperation.created_at, AccountMergeOperation.id).limit(20))
        return {"viewer_id": identity.user_id, "operations": [public_operation(row) for row in rows]}


@router.post("/account/merges/{operation_id}/acknowledge")
def acknowledge(operation_id: str, request: Request, response: Response):
    response.headers.update(_PRIVATE)
    identity = require_user(request)
    _require_mounted_account(request, identity.user_id, required=True)
    require_csrf(request, identity)
    with session_scope() as db:
        return acknowledge_merge_in_session(db, identity=identity, operation_id=operation_id)
