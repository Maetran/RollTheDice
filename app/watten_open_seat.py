"""General-call foundation. Public delivery is deliberately unavailable.

The HTTP adapter never claims cooldowns or invokes a transport. There is no
delivery switch: stored-only Watten Push stays excluded by web_push. The
internal coordinator exists for isolated fake-transport verification only;
recipient authorization, workers and release approval remain separate work.
Personal invitations/password grants and friend starts are unrelated.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError, SQLAlchemyError

from .auth import require_csrf
from .database import session_scope
from .models import ActiveGame, User, WattenOpenSeatClaim
from .moderation import ensure_play_allowed
from .security import as_utc, utcnow
from .watten_access import watten_request_enabled
from .watten_http import _HEADERS
from .watten_http import _identity as _http_identity
from .watten_recipe import loads_strict_json, require_fields
from .watten_room import WattenRoom
from .watten_runtime import game_lock, restore_watten_json
from .web_push import GAME_INVITE_PUSH_COOLDOWN_SECONDS, claim_game_invite_push_in_session

_ID = re.compile(r"[0-9a-f]{16}")


class WattenOpenSeatError(ValueError):
    def __init__(self, code: str, retry_after: int | None = None):
        self.retry_after = retry_after
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class OpenSeatClaim:
    """Internal transport proof only; no checkpoint or private roster payload."""

    game_id: str
    sender_user_id: int
    room_revision: int
    claimed_at: datetime


def eligible_open_seat(room: WattenRoom, account_id: int, *, now: datetime) -> None:
    """Validate an actual seated human and capacity for an unreserved newcomer."""
    if type(account_id) is not int or account_id < 1:
        raise WattenOpenSeatError("game_invite_not_player")
    if not isinstance(now, datetime) or now.utcoffset() is None:
        raise WattenOpenSeatError("watten_invalid_time")
    if room.recipe.password_required:
        raise WattenOpenSeatError("game_invite_private_room")
    if room.status != "waiting" or now >= room.wait_expires_at:
        raise WattenOpenSeatError("game_invite_not_waiting")
    if not any(member.account_id == account_id and member.seat is not None for member in room.members):
        raise WattenOpenSeatError("game_invite_not_player")
    members = {member.account_id for member in room.members}
    held = sum(item.valid_at(now) and item.account_id not in members for item in room.reservations)
    occupied = {member.seat for member in room.members if member.seat is not None}
    reserved = {item.seat for item in room.reservations if item.valid_at(now)}
    if (len(room.members) + held >= room.recipe.player_count
            or not set(range(room.recipe.player_count)) - occupied - reserved):
        raise WattenOpenSeatError("game_invite_no_open_seat")


def _stored(db, game_id, account_id, revision, now):
    if type(game_id) is not str or not _ID.fullmatch(game_id):
        raise WattenOpenSeatError("game_not_found")
    if type(revision) is not int or revision < 0:
        raise WattenOpenSeatError("watten_invalid_request")
    if type(account_id) is not int or account_id < 1:
        raise WattenOpenSeatError("game_invite_not_player")
    raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id).with_for_update())
    if raw is None:
        raise WattenOpenSeatError("game_not_found")
    # Match native source-first lock ordering before locking an account row.
    active = db.scalar(select(User.id).where(User.id == account_id, User.is_active.is_(True)).with_for_update())
    if active is None:
        raise WattenOpenSeatError("game_invite_not_player")
    source = restore_watten_json(raw, refresh_titles=False)
    if source["_id"] != game_id:
        raise WattenOpenSeatError("watten_invalid_checkpoint")
    room = source["_watten"].room
    if revision != room.revision:
        raise WattenOpenSeatError("watten_stale_room_revision")
    eligible_open_seat(room, account_id, now=now)
    return raw, room


def _room_upsert(dialect, game_id, now):
    insert = {"sqlite": sqlite_insert, "postgresql": pg_insert}.get(dialect)
    if insert is None:
        raise WattenOpenSeatError("watten_storage_unavailable")
    return insert(WattenOpenSeatClaim).values(game_id=game_id, claimed_at=now).on_conflict_do_update(
        index_elements=[WattenOpenSeatClaim.game_id], set_={"claimed_at": now},
        where=WattenOpenSeatClaim.claimed_at <= now - timedelta(seconds=GAME_INVITE_PUSH_COOLDOWN_SECONDS),
    ).returning(WattenOpenSeatClaim.game_id)


def _claim_source(db, game_id, raw):
    changed = db.execute(update(ActiveGame).where(ActiveGame.game_id == game_id,
        ActiveGame.state_json == raw).values(state_json=raw))
    if changed.rowcount != 1:
        raise WattenOpenSeatError("watten_open_seat_retry")


def claim_open_seat_in_session(db, game_id: str, account_id: int, revision: int, *, now=None) -> OpenSeatClaim:
    """Caller owns commit/rollback; either both durable barriers change or neither.

    The real source row is locked on PostgreSQL. Exact JSON CAS serializes
    SQLite against ordinary checkpoint writers without changing the source,
    room revision, timestamps, reservations, seats or any activity counters.
    A fresh SQLite transaction reserves its writer before reading. If the
    caller already owns a deferred read snapshot, BUSY(_SNAPSHOT) still belongs
    to that caller: roll back/restart the entire transaction, never just retry
    inside its old snapshot. This function does not replace an existing TX.
    """
    now = utcnow() if now is None else now
    if not isinstance(now, datetime) or now.utcoffset() is None:
        raise WattenOpenSeatError("watten_invalid_time")
    now = as_utc(now)
    # Reserve before any read: a deferred read-to-write upgrade can fail
    # immediately despite busy_timeout. IMMEDIATE waits before the snapshot.
    # An explicit outer BEGIN also prevents SAVEPOINT release from committing
    # a caller's uncommitted claim under SQLite's legacy transaction driver.
    if db.get_bind().dialect.name == "sqlite":
        connection = db.connection()
        if not connection.connection.driver_connection.in_transaction:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
    with db.begin_nested():
        raw, room = _stored(db, game_id, account_id, revision, now)
        _claim_source(db, game_id, raw)
        claimed = db.scalar(_room_upsert(db.get_bind().dialect.name, game_id, now))
        if claimed is None:
            previous = db.scalar(select(WattenOpenSeatClaim.claimed_at).where(WattenOpenSeatClaim.game_id == game_id))
            remaining = max(1, math.ceil(GAME_INVITE_PUSH_COOLDOWN_SECONDS - (now - as_utc(previous)).total_seconds()))
            raise WattenOpenSeatError("game_invite_cooldown", remaining)
        remaining = claim_game_invite_push_in_session(db, account_id, now=now)
        if remaining:
            raise WattenOpenSeatError("game_invite_account_cooldown", remaining)
    return OpenSeatClaim(game_id, account_id, room.revision, now)


async def coordinate_open_seat(game_id, revision, *, resolve_actor, transport):
    """Internal only: caller supplies fresh identity and an isolated transport.

    Claims commit before the transport, including on its failure. No retry of
    an uncertain send is automatic. This function has no HTTP/send binding.
    """
    account_id = resolve_actor()
    async with game_lock({"_id": game_id}):
        current = resolve_actor()
        if type(current) is not int or current != account_id:
            raise WattenOpenSeatError("watten_account_changed")
        for attempt in range(2):
            try:
                with session_scope() as db:
                    claim = claim_open_seat_in_session(db, game_id, account_id, revision)
                break
            except OperationalError as exc:
                busy = getattr(exc.orig, "sqlite_errorcode", None) in {5, 6, 517}
                if not busy or attempt:
                    raise
            except WattenOpenSeatError as exc:
                if str(exc) != "watten_open_seat_retry" or attempt:
                    raise
        current = resolve_actor()
        if type(current) is not int or current != account_id:
            raise WattenOpenSeatError("watten_account_changed")
    notified = await transport(claim)
    if type(notified) is not bool:
        raise WattenOpenSeatError("watten_invalid_transport_result")
    return {"ok": True, "notified": notified}


def _identity(request, expected=None):
    if not watten_request_enabled(request):
        raise HTTPException(status_code=404, detail="game_not_found", headers=_HEADERS)
    identity = _http_identity(request)
    values = request.headers.getlist("X-Watten-Expected-Account-Id")
    if len(values) != 1 or values[0] != str(identity.user_id) or expected is not None and identity.user_id != expected:
        raise HTTPException(status_code=409, detail="watten_account_changed", headers=_HEADERS)
    require_csrf(request, identity)
    ensure_play_allowed(identity)
    return identity


async def _body(request):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > 256:
            raise WattenOpenSeatError("watten_invalid_request")
        chunks.append(chunk)
    try:
        return require_fields(loads_strict_json(b"".join(chunks).decode("utf-8")), frozenset({"revision"}),
                              WattenOpenSeatError, "watten")
    except (ValueError, UnicodeError) as exc:
        raise WattenOpenSeatError("watten_invalid_request") from exc


async def maybe_notify_open_seat(game_id, request, game):
    """Thin existing-route dispatch; native delivery always stops before claims."""
    if game is not None and game.get("_game_type") != "watten" and "_watten" not in game:
        return None
    if game is None and not watten_request_enabled(request):
        return None
    try:
        if game is None:
            # Recognition must not impose the new native header contract on
            # an existing legacy table absent from the in-memory dictionary.
            identity = _http_identity(request)
            require_csrf(request, identity)
            ensure_play_allowed(identity)
            with session_scope() as db:
                raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
            if raw is None:
                return None
            value = loads_strict_json(raw)
            if type(value) is not dict or value.get("_game_type") != "watten" and "_watten" not in value:
                return None
        identity = _identity(request)
        data = await _body(request)
        identity = _identity(request, identity.user_id)
        async with game_lock({"_id": game_id}):
            identity = _identity(request, identity.user_id)
            with session_scope() as db:
                _stored(db, game_id, identity.user_id, data["revision"], utcnow())
            raise HTTPException(status_code=503, detail="watten_push_unavailable", headers=_HEADERS)
    except HTTPException as exc:
        exc.headers = {**(exc.headers or {}), **_HEADERS}
        raise
    except WattenOpenSeatError as exc:
        status = 404 if str(exc) == "game_not_found" else 403 if str(exc) == "game_invite_not_player" else 409
        raise HTTPException(status_code=status, detail=str(exc), headers=_HEADERS) from exc
    except (ValueError, UnicodeError, SQLAlchemyError) as exc:
        raise HTTPException(status_code=503, detail="watten_storage_unavailable", headers=_HEADERS) from exc
