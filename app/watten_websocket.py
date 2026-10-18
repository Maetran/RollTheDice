"""Authenticated local Watten sockets, isolated from guest/dice/social actions."""

import logging
import secrets

from fastapi import WebSocketDisconnect

from .auth import resolve_session, websocket_origin_allowed
from .database import session_scope
from .game_ws_session import GameSocketSession
from .models import User
from .moderation import user_play_banned
from .watten_access import can_access_watten
from .watten_runtime import (
    WATTEN_ACTIONS,
    admit_account,
    apply_runtime_action,
    expire_waiting_game,
    game_lock,
    persist_watten_game,
    resume_account,
    snapshot_watten,
)

logger = logging.getLogger(__name__)


async def sweep_watten_waiting_games() -> int:
    from .game_state import games

    expired = 0
    for game in list(games.values()):
        if game.get("_game_type") == "watten":
            async with game_lock(game):
                if expire_waiting_game(game):
                    expired += 1
                    await broadcast_watten(game)
    return expired


def _identity(websocket):
    identity = resolve_session(websocket)
    return identity if can_access_watten(identity, websocket) and not user_play_banned(identity.user_id) else None


async def _error(websocket, code: str, *, fatal=False):
    await websocket.send_json({"error": code, "error_code": code, "fatal": fatal})
    if fatal:
        await websocket.close(code=1008)


async def broadcast_watten(game: dict, *, participant_ids: set[str] | None = None,
                           public_call_events: tuple[dict, ...] = ()) -> None:
    """Reproject every recipient, even if a caller supplied somebody else's DTO."""
    for collection, member in ((game.get("_players", []), True), (game.get("_spectators", []), False)):
        for recipient in list(collection):
            websocket = recipient.get("ws")
            if websocket is None or (participant_ids is not None and recipient["id"] not in participant_ids):
                continue
            try:
                identity = _identity(websocket)
                live = any(item["id"] == recipient["id"] and item.get("ws") is websocket
                           and item.get("user_id") == recipient.get("user_id")
                           for item in game["_players" if member else "_spectators"])
                bound = not member or any(item.participant_id == recipient["id"] and item.account_id == recipient.get("user_id")
                                          for item in game["_watten"].room.members)
                if identity is None or identity.user_id != recipient.get("user_id") or not live or not bound:
                    recipient["ws"] = None
                    await websocket.close(code=1008)
                    continue
                # Staff/owner status is intentionally absent from this choice.
                viewer = recipient["id"] if member else None
                payload = {"scoreboard": snapshot_watten(game, viewer)}
                if not member and public_call_events:
                    # Live spectators may hear a public announcement once.
                    # Their ephemeral subscription has no durable call history.
                    payload["watten_public_call_events"] = list(public_call_events)
                await websocket.send_json(payload)
            except (WebSocketDisconnect, RuntimeError, OSError):
                if recipient.get("ws") is websocket:
                    recipient["ws"] = None


def _install(game: dict, candidate: dict) -> None:
    game.clear()
    game.update(candidate)


def _eligible_accounts(game: dict) -> frozenset[int]:
    with session_scope() as db:
        return frozenset(member.account_id for member in game["_watten"].room.members
                         if (user := db.get(User, member.account_id)) is not None and user.is_active
                         and not user_play_banned(member.account_id))


async def _session_action(session, data: dict) -> None:
    game, websocket, identity = session.game, session.websocket, session.auth_identity
    action = data["action"]
    if action == "spectate_game":
        if set(data) - {"action", "pass", "passphrase"}:
            raise ValueError("watten_invalid_command")
        from .watten_runtime import passphrase_matches

        own_member = any(member.account_id == identity.user_id for member in game["_watten"].room.members)
        if not own_member and not passphrase_matches(game, data.get("pass", data.get("passphrase"))):
            raise ValueError("watten_wrong_passphrase")
        if session.player_id is not None or session.spectator_id is not None:
            raise ValueError("watten_already_joined")
        spectator_id = f"s-{secrets.token_hex(8)}"
        game["_spectators"].append({"id": spectator_id, "user_id": identity.user_id, "ws": websocket})
        session.spectator_id, session.is_spectator = spectator_id, True
        await websocket.send_json({"spectator_id": spectator_id, "spectator": True, "scoreboard": snapshot_watten(game)})
        return
    if set(data) - {"action", "revision", "pass", "passphrase", "player_id", "resume"}:
        raise ValueError("watten_invalid_command")
    if "resume" in data and (action != "rejoin_game" or type(data["resume"]) is not bool):
        raise ValueError("watten_invalid_command")
    existing = next((item for item in game["_watten"].room.members if item.account_id == identity.user_id), None)
    if data.get("player_id") is not None and (existing is None or data["player_id"] != existing.participant_id):
        raise ValueError("watten_actor_not_bound")
    if session.spectator_id is not None:
        raise ValueError("watten_already_joined")
    revision = data.get("revision")
    if type(revision) is not int:
        raise ValueError("watten_stale_room_revision")
    candidate, player = admit_account(game, identity, revision, data.get("pass", data.get("passphrase")))
    if data.get("resume") is True:
        resume_account(candidate, identity.user_id, player)
    record = next(item for item in candidate["_players"] if item["id"] == player)
    previous = record.get("ws")
    record["ws"] = websocket
    persist_watten_game(candidate)
    # Replacement is synchronous before any await: queued commands from the
    # previous device fail the ownership check after taking this same lock.
    _install(game, candidate)
    session.player_id, session.is_spectator = player, False
    if previous is not None and previous is not websocket:
        try:
            await previous.close(code=1008, reason="Session replaced")
        except (RuntimeError, OSError):
            pass
    await websocket.send_json({"player_id": player, "game_type": "watten"})
    await broadcast_watten(game)


async def handle_watten_gameplay_action(session, action: str, data: dict, **_kwargs) -> None:
    """The adapter entry is also safe when called outside our receive loop."""
    async with game_lock(session.game):
        await _handle_locked(session, action, data)


async def _handle_locked(session, action: str, data: dict) -> bool:
    game, websocket = session.game, session.websocket
    if type(data) is not dict or data.get("action") != action:
        raise ValueError("watten_invalid_command")
    identity = _identity(websocket)
    if identity is None or (session.auth_identity is not None and identity.user_id != session.auth_identity.user_id):
        await _error(websocket, "watten_access_required", fatal=True)
        return True
    session.auth_identity = identity
    expire_waiting_game(game)
    # A replaced socket cannot reclaim its seat with a queued join/rejoin.
    # Only an as-yet unbound new connection may establish account ownership.
    if session.player_id is not None or session.spectator_id is not None:
        collection = game["_spectators"] if session.is_spectator else game["_players"]
        role_id = session.spectator_id if session.is_spectator else session.player_id
        if not any(item["id"] == role_id and item.get("ws") is websocket and item.get("user_id") == identity.user_id for item in collection):
            await _error(websocket, "watten_actor_not_bound", fatal=True)
            return True
    if action in {"join_game", "rejoin_game", "spectate_game"}:
        await _session_action(session, data)
        return False
    collection = game["_spectators"] if session.is_spectator else game["_players"]
    role_id = session.spectator_id if session.is_spectator else session.player_id
    owned = any(item["id"] == role_id and item.get("ws") is websocket and item.get("user_id") == identity.user_id for item in collection)
    if not owned:
        await _error(websocket, "watten_actor_not_bound", fatal=True)
        return True
    if action == "get_state":
        if set(data) != {"action"}:
            raise ValueError("watten_invalid_command")
        await websocket.send_json({"scoreboard": snapshot_watten(game, session.player_id if not session.is_spectator else None)})
        return False
    if action not in WATTEN_ACTIONS or session.is_spectator:
        raise ValueError("watten_action_unavailable")
    if action == "watten_start" and not game["_started"] and any(item.get("ws") is None for item in game["_players"]):
        raise ValueError("watten_players_offline")
    candidate, ack, replayed, private = apply_runtime_action(
        game, identity.user_id, session.player_id, data,
        eligible_accounts=_eligible_accounts(game) if action == "leave_waiting_game" else None)
    public_call_events = ()
    if not replayed:
        previous = {item.delivery_id for item in game["_watten"].deliveries}
        fresh = {(item.kind, item.seat, item.value) for item in candidate["_watten"].deliveries
                 if item.delivery_id not in previous}
        public_call_events = tuple({"kind": kind, "seat": seat, "value": value}
                                   for kind, seat, value in sorted(fresh))
        persist_watten_game(candidate)
        _install(game, candidate)
    leaving = action == "watten_leave" and session.player_id in game["_watten"].absent
    if leaving:
        # Revoke this transport synchronously before notifying any peer. Its
        # queued messages cannot deliberate-return or play after the leave.
        next(item for item in game["_players"] if item["id"] == session.player_id)["ws"] = None
    # Private feedback and delivery acknowledgements deliberately do not pass
    # through global broadcast/touch or publish a room revision/timestamp.
    await broadcast_watten(game, participant_ids=private, public_call_events=public_call_events)
    if leaving:
        await websocket.send_json({"scoreboard": snapshot_watten(game, session.player_id)})
    await websocket.send_json({"watten_command": ack})
    if action == "leave_waiting_game" or leaving:
        await websocket.close(code=1000)
        return True
    return False


async def serve_watten_websocket(websocket, game: dict, *, reserve_connection, release_connection) -> None:
    identity = _identity(websocket)
    if identity is None or not websocket_origin_allowed(websocket):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    address = reserve_connection(websocket)
    if address is None:
        await websocket.close(code=1013)
        return
    from .game_websocket import MessageRateLimiter, _register_live_socket, _unregister_live_socket

    limiter = MessageRateLimiter()
    session = GameSocketSession(websocket, game, identity)
    _register_live_socket(game, websocket)
    try:
        await websocket.send_json({"game_type": "watten", "id": game["_id"], "room_revision": game["_watten"].room.revision,
                                   "locked": bool(game["_passphrase"]), "lifecycle_revision": game["_watten"].lifecycle_revision,
                                   "capabilities": {"cpu_autoplay": False}})
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                await _error(websocket, "watten_invalid_command")
                continue
            if type(data) is not dict or type(data.get("action")) is not str:
                await _error(websocket, "watten_invalid_command")
                continue
            action = data["action"]
            if limiter.check(action) is not None:
                await _error(websocket, "watten_rate_limited", fatal=True)
                return
            try:
                async with game_lock(game):
                    if await _handle_locked(session, action, data):
                        return
            except (ValueError, TypeError, KeyError) as exc:
                code = getattr(exc, "code", None) or (str(exc) if isinstance(exc, ValueError) else "watten_invalid_command")
                await _error(websocket, code)
            except Exception:
                # Failed commits retain the previous in-memory state and emit
                # no success ACK or speculative private/public projection.
                logger.exception("Watten checkpoint rejected for game %s", game["_id"])
                await _error(websocket, "watten_storage_unavailable")
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass
    finally:
        async with game_lock(game):
            for player in game["_players"]:
                if player.get("ws") is websocket:
                    player["ws"] = None
            game["_spectators"] = [item for item in game["_spectators"] if item.get("ws") is not websocket]
            _unregister_live_socket(game, websocket)
        # Network loss never calls room.leave, changes seats or grants a CPU.
        release_connection(address)
