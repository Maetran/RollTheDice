"""Private, explicit follow-up invitations and account-scoped password consent.

No delivery, membership, seat, start, result or progress writer lives here.
The durable native source/target pair is authority; opaque invitation IDs are
lookup keys only. A pending deadline never slides, including on retries.
"""

from __future__ import annotations

import re
import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError, OperationalError, SQLAlchemyError

from .database import database_schema_ready, session_scope
from .models import ActiveGame, User, WattenPersonalInvitation
from .moderation import ensure_play_allowed
from .security import as_utc, utcnow
from .watten_access import watten_request_enabled
from .watten_http import _HEADERS, _response
from .watten_http import _identity as _http_identity
from .watten_recipe import loads_strict_json, require_fields

router = APIRouter()
_ID = re.compile(r"[0-9a-f]{16}")
_INVITATION_ID = re.compile(r"[0-9a-f]{32}")


class WattenInvitationError(ValueError):
    pass


class _LostCAS(Exception):
    pass


def _fail(code):
    raise WattenInvitationError(f"watten_invitation_{code}")


def _account(db, account):
    if type(account) is not int or account < 1:
        _fail("not_found")
    user = db.get(User, account)
    if user is None or not user.is_active:
        _fail("not_found")
    return user


def _pair(db, target_id, *, lock=False):
    from .watten_runtime import restore_watten_json

    if type(target_id) is not str or not _ID.fullmatch(target_id):
        _fail("not_found")
    query = select(ActiveGame.state_json).where(ActiveGame.game_id == target_id)
    raw = db.scalar(query.with_for_update() if lock else query)
    if raw is None:
        _fail("not_found")
    target = restore_watten_json(raw, refresh_titles=False)
    if target["_id"] != target_id:
        _fail("invalid_checkpoint")
    source_id = target["_watten"].room.rematch_of
    if source_id is None or source_id == target_id:
        _fail("not_follow_up")
    source_raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == source_id))
    if source_raw is None:
        _fail("invalid_checkpoint")
    source = restore_watten_json(source_raw, refresh_titles=False)
    if (source["_id"] != source_id or source["_watten"].room.rematch_room_id != target_id
            or source["_watten"].room.status not in {"finished", "closed"}
            or source["_watten"].engine is not None and not source["_completion_persisted"]):
        _fail("invalid_checkpoint")
    return raw, source, target


def _host(db, target, account):
    _account(db, account)
    room = target["_watten"].room
    if not any(member.participant_id == room.host_participant_id and member.account_id == account for member in room.members):
        _fail("host_required")


def _waiting(target, now):
    room = target["_watten"].room
    if room.status != "waiting" or now >= room.wait_expires_at:
        _fail("unavailable")


def _capacity(target, account, now):
    from .watten_room import admit

    room = target["_watten"].room
    # Pure validation only: the returned new membership is deliberately ignored.
    admit(room, revision=room.revision, account_id=account, now=now, protection_verified=True)


def _binding(row, source, target):
    if (type(row.id) is not str or not _INVITATION_ID.fullmatch(row.id)
            or type(row.recipient_user_id) is not int or row.recipient_user_id < 1
            or row.status not in {"pending", "accepted", "declined"}
            or row.created_at is None or row.expires_at is None
            or not as_utc(row.created_at) < as_utc(row.expires_at) <= as_utc(row.created_at) + timedelta(minutes=5)
            or (row.status == "pending") != (row.responded_at is None)
            or row.responded_at is not None and not as_utc(row.created_at) <= as_utc(row.responded_at) < as_utc(row.expires_at)
            or row.source_game_id != source["_id"] or row.target_game_id != target["_id"]
            or not any(member.account_id == row.recipient_user_id and member.participant_id == row.source_participant_id
                       and member.seat is not None for member in source["_watten"].room.members)):
        _fail("invalid_checkpoint")


def _available(target, now):
    room = target["_watten"].room
    return room.status in {"waiting", "started"} and (room.status != "waiting" or now < room.wait_expires_at)


def _payload(row, target, now):
    status = row.status
    if status == "pending" and (now >= as_utc(row.expires_at) or target["_watten"].room.status != "waiting"
                                or now >= target["_watten"].room.wait_expires_at):
        status = "expired"
    return {"id": row.id, "source_game_id": row.source_game_id, "game_id": row.target_game_id,
            "recipient_participant_id": row.source_participant_id, "status": status,
            "created_at": as_utc(row.created_at).isoformat(), "expires_at": as_utc(row.expires_at).isoformat(),
            "responded_at": as_utc(row.responded_at).isoformat() if row.responded_at else None,
            "access_granted": status == "accepted" and _available(target, now)}


def _claim_target(db, target_id, raw):
    # PostgreSQL already holds the target row lock. This exact JSON CAS also
    # serializes SQLite with normal target start/leave/checkpoint writers.
    changed = db.execute(update(ActiveGame).where(ActiveGame.game_id == target_id,
        ActiveGame.state_json == raw).values(state_json=raw))
    if changed.rowcount != 1:
        raise _LostCAS()


def host_invitations(target_id, account):
    with session_scope() as db:
        _raw, source, target = _pair(db, target_id)
        _host(db, target, account)
        now = utcnow()
        rows = db.scalars(select(WattenPersonalInvitation).where(WattenPersonalInvitation.target_game_id == target_id)
                          .order_by(WattenPersonalInvitation.created_at, WattenPersonalInvitation.id)).all()
        for row in rows:
            _binding(row, source, target)
        candidates = []
        admitted = {member.account_id for member in target["_watten"].room.members}
        for member in source["_watten"].room.members:
            user = db.get(User, member.account_id)
            if member.seat is None or member.account_id in admitted or user is None or not user.is_active:
                continue
            try:
                _waiting(target, now)
                _capacity(target, member.account_id, now)
            except ValueError:
                continue
            candidates.append({"participant_id": member.participant_id, "name": user.username})
        return {"schema_version": 1, "game_type": "watten", "source_game_id": source["_id"], "game_id": target_id,
                "candidates": candidates, "invitations": [_payload(row, target, now) for row in rows]}


def _create(target_id, account, participant):
    with session_scope() as db:
        raw, source, target = _pair(db, target_id, lock=True)
        _host(db, target, account)
        if type(participant) is not str:
            _fail("invalid_request")
        member = next((item for item in source["_watten"].room.members
                       if item.participant_id == participant and item.seat is not None), None)
        if member is None or member.account_id == account:
            _fail("recipient_unavailable")
        _account(db, member.account_id)
        row = db.scalar(select(WattenPersonalInvitation).where(WattenPersonalInvitation.target_game_id == target_id,
                                                               WattenPersonalInvitation.recipient_user_id == member.account_id))
        now = utcnow()
        if row is None:
            _waiting(target, now)
            _capacity(target, member.account_id, now)
            if any(item.account_id == member.account_id for item in target["_watten"].room.members):
                _fail("recipient_unavailable")
            _claim_target(db, target_id, raw)
            row = WattenPersonalInvitation(id=secrets.token_hex(16), source_game_id=source["_id"], target_game_id=target_id,
                recipient_user_id=member.account_id, sender_user_id=account, source_participant_id=member.participant_id,
                status="pending", created_at=now, expires_at=min(now + timedelta(minutes=5), target["_watten"].room.wait_expires_at))
            db.add(row)
            db.flush()
        _binding(row, source, target)
        return _payload(row, target, now)


def _respond(invitation_id, account, decision):
    with session_scope() as db:
        _account(db, account)
        row = db.scalar(select(WattenPersonalInvitation).where(WattenPersonalInvitation.id == invitation_id,
            WattenPersonalInvitation.recipient_user_id == account).with_for_update())
        if row is None:
            _fail("not_found")
        raw, source, target = _pair(db, row.target_game_id, lock=True)
        _binding(row, source, target)
        now = utcnow()
        if row.status != "pending":
            if row.status != decision:
                _fail("already_responded")
        else:
            _waiting(target, now)
            if now >= as_utc(row.expires_at):
                _fail("expired")
            if decision == "accepted":
                _capacity(target, account, now)
            _claim_target(db, row.target_game_id, raw)
            changed = db.execute(update(WattenPersonalInvitation).where(WattenPersonalInvitation.id == row.id,
                WattenPersonalInvitation.status == "pending").values(status=decision, responded_at=now))
            if changed.rowcount != 1:
                raise _LostCAS()
            db.refresh(row)
        return _payload(row, target, now)


def _retry(operation, *args):
    for attempt in range(2):
        try:
            return operation(*args)
        except _LostCAS:
            if attempt:
                _fail("retry")
        except OperationalError as exc:
            if getattr(exc.orig, "sqlite_errorcode", None) not in {5, 6, 517} or attempt:
                raise
        except IntegrityError:
            # SQLite's legacy SELECT transaction mode can observe no invitation
            # before a competing insert, even though our target JSON is equal.
            # The unique target/recipient key wins; reload it once after rollback.
            if attempt:
                raise
    _fail("retry")


def create_invitation(target_id, account, participant):
    return _retry(_create, target_id, account, participant)


def respond_to_invitation(invitation_id, account, decision):
    if (type(invitation_id) is not str or not _INVITATION_ID.fullmatch(invitation_id)
            or type(decision) is not str or decision not in {"accepted", "declined"}):
        _fail("invalid_request")
    return _retry(_respond, invitation_id, account, decision)


def own_invitations(account, invitation_id=None):
    with session_scope() as db:
        _account(db, account)
        query = select(WattenPersonalInvitation).where(WattenPersonalInvitation.recipient_user_id == account)
        if invitation_id is not None:
            query = query.where(WattenPersonalInvitation.id == invitation_id)
        rows = db.scalars(query.order_by(WattenPersonalInvitation.created_at.desc(), WattenPersonalInvitation.id).limit(50)).all()
        if invitation_id is not None and not rows:
            _fail("not_found")
        results = []
        now = utcnow()
        for row in rows:
            _raw, source, target = _pair(db, row.target_game_id)
            _binding(row, source, target)
            results.append(_payload(row, target, now))
        return {"schema_version": 1, "game_type": "watten", "invitations": results}


def accepted_invitation_access(game, account):
    """Fresh durable grant; a pending token, reservation or link grants nothing."""
    if type(account) is not int or account < 1 or not _available(game, utcnow()):
        return False
    if not database_schema_ready():
        _fail("storage_unavailable")
    with session_scope() as db:
        _account(db, account)
        row = db.scalar(select(WattenPersonalInvitation).where(WattenPersonalInvitation.target_game_id == game["_id"],
            WattenPersonalInvitation.recipient_user_id == account, WattenPersonalInvitation.status == "accepted"))
        if row is None:
            return False
        _raw, source, target = _pair(db, game["_id"])
        _binding(row, source, target)
        return _available(target, utcnow())


def _identity(request, *, mutate=False, expected=None):
    if not watten_request_enabled(request):
        raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)
    identity = _http_identity(request)
    if expected is not None and identity.user_id != expected:
        raise HTTPException(status_code=409, detail="watten_account_changed", headers=_HEADERS)
    if mutate:
        from .auth import require_csrf

        try:
            require_csrf(request, identity)
            ensure_play_allowed(identity)
        except HTTPException as exc:
            exc.headers = {**(exc.headers or {}), **_HEADERS}
            raise
    return identity


def _error(exc):
    code = str(exc)
    if code == "watten_invitation_not_found":
        return HTTPException(status_code=404, detail=code, headers=_HEADERS)
    if isinstance(exc, WattenInvitationError) and code not in {
            "watten_invitation_invalid_checkpoint", "watten_invitation_storage_unavailable"} or code.startswith("watten_room_"):
        return HTTPException(status_code=409, detail=code, headers=_HEADERS)
    return HTTPException(status_code=503, detail="watten_storage_unavailable", headers=_HEADERS)


async def _body(request, fields):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 1024:
            _fail("invalid_request")
        chunks.append(chunk)
    try:
        return require_fields(loads_strict_json(b"".join(chunks).decode("utf-8")), frozenset(fields),
                              WattenInvitationError, "watten_invitation")
    except (ValueError, UnicodeError) as exc:
        raise WattenInvitationError("watten_invitation_invalid_request") from exc


@router.get("/api/watten/games/{target_id}/invitations")
def list_host_invitations(target_id: str, request: Request):
    identity = _identity(request)
    try:
        return _response(host_invitations(target_id, identity.user_id))
    except (ValueError, SQLAlchemyError) as exc:
        raise _error(exc) from exc


@router.post("/api/watten/games/{target_id}/invitations")
async def invite(target_id: str, request: Request):
    identity = _identity(request, mutate=True)
    try:
        data = await _body(request, {"recipient_participant_id"})
        from .watten_runtime import game_lock

        async with game_lock({"_id": target_id}):
            _identity(request, mutate=True, expected=identity.user_id)
            result = create_invitation(target_id, identity.user_id, data["recipient_participant_id"])
        return _response({"schema_version": 1, "game_type": "watten", "invitation": result})
    except (ValueError, UnicodeError, SQLAlchemyError) as exc:
        raise _error(exc) from exc


@router.get("/api/watten/account/invitations")
def list_own_invitations(request: Request):
    identity = _identity(request)
    try:
        return _response(own_invitations(identity.user_id))
    except (ValueError, SQLAlchemyError) as exc:
        raise _error(exc) from exc


@router.get("/api/watten/invitations/{invitation_id}")
def read_own_invitation(invitation_id: str, request: Request):
    identity = _identity(request)
    try:
        return _response(own_invitations(identity.user_id, invitation_id))
    except (ValueError, SQLAlchemyError) as exc:
        raise _error(exc) from exc


@router.post("/api/watten/invitations/{invitation_id}/respond")
async def respond(invitation_id: str, request: Request):
    identity = _identity(request, mutate=True)
    try:
        data = await _body(request, {"decision"})
        _identity(request, mutate=True, expected=identity.user_id)
        result = respond_to_invitation(invitation_id, identity.user_id, data["decision"])
        return _response({"schema_version": 1, "game_type": "watten", "invitation": result})
    except (ValueError, UnicodeError, SQLAlchemyError) as exc:
        raise _error(exc) from exc
