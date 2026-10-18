"""Local native follow-up tables, atomically linked by persisted source authority.

The source link is the durable single operation identity, including after a
lost response or a new command ID. No password enters an ACK digest. Public
HTTP authentication is separate from this trusted account service.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass, replace
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from .auth import require_csrf, resolve_session
from .auth_protection import enforce_game_creation_rate_limit
from .database import session_scope
from .game_state import games
from .models import ActiveGame, User
from .moderation import ensure_play_allowed
from .security import hash_password, utcnow, verify_password
from .watten_access import require_watten_access
from .watten_http import _response
from .watten_public_titles import refresh_public_titles
from .watten_recipe import loads_strict_json, require_fields
from .watten_room import create_rematch
from .watten_runtime import (
    WattenRuntime,
    _cpu_names,
    _sync,
    _write_checkpoint,
    copy_game,
    game_lock,
    new_watten_game,
    restore_watten_json,
)

router = APIRouter()
_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


class WattenRematchError(ValueError):
    pass


class _LostSourceCAS(Exception):
    pass


@dataclass(frozen=True, slots=True)
class FollowUp:
    source: dict
    target: dict
    created: bool

    def payload(self):
        return {"schema_version": 1, "game_type": "watten", "source_game_id": self.source["_id"],
                "game_id": self.target["_id"], "created": self.created,
                "source_revision": self.source["_watten"].room.revision,
                "room_revision": self.target["_watten"].room.revision}


def _request(data):
    fields = require_fields(data, frozenset({"command_id", "revision", "protection"}), WattenRematchError, "watten_rematch")
    if (type(fields["command_id"]) is not str or not 1 <= len(fields["command_id"]) <= 160
            or type(fields["revision"]) is not int or fields["revision"] < 0):
        raise WattenRematchError("watten_rematch_invalid_request")
    protection = fields["protection"]
    if type(protection) is not dict:
        raise WattenRematchError("watten_rematch_invalid_protection")
    if protection == {"mode": "disabled"}:
        return fields["revision"], None
    require_fields(protection, frozenset({"mode", "password"}), WattenRematchError, "watten_rematch_protection")
    password = protection["password"]
    if (protection["mode"] != "fresh_password" or type(password) is not str
            or not 1 <= len(password) <= 100 or not password.strip() or password != password.strip()):
        raise WattenRematchError("watten_rematch_invalid_protection")
    return fields["revision"], password


def _stored(db, game_id, *, lock=False):
    query = select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)
    if lock:
        query = query.with_for_update()
    raw = db.scalar(query)
    if raw is None:
        raise WattenRematchError("watten_rematch_source_unavailable")
    game = restore_watten_json(raw, refresh_titles=False)
    if game["_id"] != game_id:
        raise WattenRematchError("watten_rematch_invalid_checkpoint")
    return raw, game


def _attempt(source_id, identity, revision, password, before_create):
    with session_scope() as db:
        raw, source = _stored(db, source_id, lock=True)
        runtime, now = source["_watten"], utcnow()
        room = runtime.room
        host = next((item for item in room.members if item.participant_id == room.host_participant_id), None)
        user = db.get(User, identity.user_id)
        if host is None or host.account_id != identity.user_id or user is None or not user.is_active:
            raise WattenRematchError("watten_host_required")
        if room.rematch_room_id is not None:
            if revision not in {room.revision - 1, room.revision}:
                raise WattenRematchError("watten_stale_room_revision")
            _target_raw, target = _stored(db, room.rematch_room_id)
            if (target["_watten"].room.rematch_of != source_id
                    or bool(target["_passphrase"]) != (password is not None)
                    or password is not None and not verify_password(password, target["_passphrase"])):
                raise WattenRematchError("watten_rematch_conflict")
            created = False
        else:
            if revision != room.revision:
                raise WattenRematchError("watten_stale_room_revision")
            if room.status not in {"finished", "closed"}:
                raise WattenRematchError("watten_rematch_requires_finished_room")
            if runtime.engine is not None and not source["_completion_persisted"]:
                raise WattenRematchError("watten_rematch_result_not_persisted")
            if before_create is not None:
                before_create()
            active = set(db.scalars(select(User.id).where(User.is_active.is_(True))))
            suggestions = {item.account_id: item.seat for item in room.members
                           if item.seat is not None and item.account_id in active}
            verifier = hash_password(password) if password is not None else None
            result = create_rematch(room, revision=revision, account_id=identity.user_id, target_room_id=secrets.token_hex(8),
                now=now, wait_seconds=room.wait_seconds, reservations=suggestions,
                reservations_expire_at=now + timedelta(seconds=300) if suggestions else None,
                protection_verifier=verifier, password_required=password is not None)
            candidate = copy_game(source)
            _sync(candidate, replace(runtime, room=result.source), public=True)
            # This write must precede the target INSERT; a losing process leaves
            # neither an orphan target nor a second durable follow-up.
            if not _write_checkpoint(db, candidate, expected_json=raw):
                raise _LostSourceCAS()
            source = candidate
            target = new_watten_game(result.room.room_id, source["_name"], source["_mode"])
            names = _cpu_names(result.room, {result.room.host_participant_id: identity.username})
            from .watten_cpu_runtime import observe_cpu_memories

            target["_watten"] = observe_cpu_memories(WattenRuntime(result.room, None, tuple(names.items())))
            target["_passphrase"] = result.protection_verifier
            target["_players"] = [{"id": result.room.host_participant_id, "name": identity.username,
                                   "user_id": identity.user_id, "ws": None}]
            _write_checkpoint(db, target, creating=True)
            created = True
        db.flush()
        source["_watten_public_titles"] = refresh_public_titles(db, source)
        target["_watten_public_titles"] = refresh_public_titles(db, target)
    return FollowUp(source, target, created)


def create_follow_up(source_id: str, identity, data: dict, *, before_create=None) -> FollowUp:
    """Trusted account input; caller holds the local lock, DB is the authority.

    PostgreSQL locks the actual source row; SQLite uses its exact JSON CAS.
    A bounded transaction retry after losing that race reloads the winning link.
    Both source and target writes commit together; no result/grant writer runs.
    """
    revision, password = _request(data)
    for attempt in range(2):
        try:
            return _attempt(source_id, identity, revision, password, before_create)
        except _LostSourceCAS:
            if attempt:
                raise WattenRematchError("watten_rematch_retry") from None
        except OperationalError as exc:
            busy = getattr(exc.orig, "sqlite_errorcode", None) in {5, 6, 517}
            if not busy or attempt:
                raise
    raise WattenRematchError("watten_rematch_retry")


def _install(result):
    for restored in (result.source, result.target):
        current = games.get(restored["_id"])
        if current is None:
            if restored is result.target and restored["_watten"].room.status == "started":
                # A linked match already started elsewhere remains that same
                # target. Running recovery belongs to normal process startup,
                # which also restores its CPU coordinator, not this retry.
                continue
            games[restored["_id"]] = restored
        elif current.get("_game_type") != "watten":
            raise WattenRematchError("watten_game_id_collision")
        elif restored is result.source:
            sockets = {(item["id"], item.get("user_id")): item.get("ws") for item in current["_players"]}
            for item in restored["_players"]:
                item["ws"] = sockets.get((item["id"], item.get("user_id")))
            restored["_spectators"] = list(current["_spectators"])
            current.clear()
            current.update(restored)


def _identity(request):
    try:
        identity = require_watten_access(request, resolve_session(request))
        expected = request.headers.getlist("X-Watten-Expected-Account-Id")
        if expected and (len(expected) != 1 or not expected[0].isascii() or not expected[0].isdecimal()
                         or expected[0] != str(identity.user_id)):
            raise HTTPException(status_code=409, detail="watten_account_changed")
        require_csrf(request, identity)
        ensure_play_allowed(identity)
        return identity
    except HTTPException as exc:
        exc.headers = {**(exc.headers or {}), **_HEADERS}
        raise


@router.post("/api/watten/games/{source_id}/rematch")
async def watten_rematch(source_id: str, request: Request):
    identity = _identity(request)
    source = games.get(source_id)
    if source is None:
        from .watten_recovery import restore_owned_watten_game

        try:
            source = restore_owned_watten_game(source_id, identity.user_id)
        except (ValueError, SQLAlchemyError) as exc:
            raise HTTPException(status_code=503, detail="watten_storage_unavailable", headers=_HEADERS) from exc
    if source is None or source.get("_game_type") != "watten":
        raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)
    try:
        data = loads_strict_json((await request.body()).decode("utf-8"))
        async with game_lock(source):
            identity = _identity(request)
            result = create_follow_up(source_id, identity, data,
                before_create=lambda: enforce_game_creation_rate_limit(request))
            _install(result)
            from .watten_websocket import broadcast_watten

            await broadcast_watten(source)
        return _response(result.payload())
    except HTTPException as exc:
        exc.headers = {**(exc.headers or {}), **_HEADERS}
        raise
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=409, detail=str(exc) if str(exc).startswith("watten_") else "watten_rematch_invalid_request", headers=_HEADERS) from exc
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=503, detail="watten_storage_unavailable", headers=_HEADERS) from exc
