"""Live-only, private fan-out when selected accounts begin a watchable game.

There is no event database, replay queue or operating-system push. Only sockets
already connected at the actual start are considered, with authorization checked
again immediately before each delivery. This channel is independent of chat.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy import select

from .auth import AuthIdentity, resolve_session, websocket_origin_allowed
from .database import session_scope
from .game_access import can_access_game
from .game_state import GameDict
from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .models import PushInviteAllowedSender, User
from .security import as_utc, utcnow
from .zilch_state import zilch_spectating_available

logger = logging.getLogger(__name__)
FRIEND_ACTIVITY_TTL_SECONDS = 60
SEND_TIMEOUT_SECONDS = 3


def _watchable(game: GameDict) -> bool:
    if not game.get("_started") or game.get("_finished") or game.get("_aborted") or game.get("_passphrase"):
        return False
    return game_type_from_state(game) != ZILCH_GAME_TYPE or zilch_spectating_available(game)


def _started_at(game: GameDict) -> datetime | None:
    try:
        return as_utc(datetime.fromisoformat(str(game.get("_started_at") or "")))
    except (TypeError, ValueError):
        return None


def friend_activity_enabled(user_id: int) -> bool:
    with session_scope() as db:
        return bool(db.scalar(select(User.friend_activity_enabled).where(User.id == user_id, User.is_active.is_(True))))


def _recipient_payload(game: GameDict, identity: AuthIdentity, *, now: datetime) -> dict | None:
    started_at = _started_at(game)
    if (
        not _watchable(game) or not can_access_game(identity, game) or started_at is None
        or not started_at <= now < started_at + timedelta(seconds=FRIEND_ACTIVITY_TTL_SECONDS)
    ):
        return None
    player_ids = {
        player.get("user_id") for player in game.get("_players", [])
        if isinstance(player, dict) and type(player.get("user_id")) is int and player["user_id"] > 0
    }
    # Participants already see their own start; they never receive a link that
    # might turn their seat into a spectator connection.
    if identity.user_id in player_ids or not player_ids:
        return None
    with session_scope() as db:
        recipient = db.get(User, identity.user_id)
        if recipient is None or not recipient.is_active or not recipient.friend_activity_enabled:
            return None
        players = db.scalars(select(User).join(
            PushInviteAllowedSender, PushInviteAllowedSender.sender_user_id == User.id,
        ).where(
            PushInviteAllowedSender.recipient_user_id == identity.user_id,
            User.id.in_(player_ids), User.is_active.is_(True),
        ).order_by(User.username_normalized)).all()
        if not players:
            return None
        names = [{"id": player.id, "username": player.username} for player in players]
    game_type = game_type_from_state(game)
    mode = str(game.get("_mode") or game.get("_expected") or "")
    if mode not in {"1", "2", "3", "2v2"}:
        return None
    return {"friend_activity": {
        "id": f"start:{game_type}:{game['_id']}",
        "game_id": str(game["_id"]), "game_type": game_type, "players": names,
        "player_count": len(game.get("_players", [])), "mode": mode,
        "hardcore": bool(game.get("_hardcore")), "started_at": started_at.isoformat(),
        "expires_at": (started_at + timedelta(seconds=FRIEND_ACTIVITY_TTL_SECONDS)).isoformat(),
    }}


@dataclass(frozen=True)
class FriendActivityConnection:
    websocket: WebSocket
    user_id: int


class FriendActivityHub:
    def __init__(self) -> None:
        self._connections: list[FriendActivityConnection] = []

    def connect(self, websocket: WebSocket, user_id: int) -> None:
        if not any(connection.websocket is websocket for connection in self._connections):
            self._connections.append(FriendActivityConnection(websocket, user_id))

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections = [connection for connection in self._connections if connection.websocket is not websocket]

    async def publish_start(self, game: GameDict, *, resolve_identity: Callable = resolve_session) -> None:
        if game.get("_friend_activity_announced"):
            return
        # Claim before the first await. No reconnect, retry or newly connected
        # tab can turn this start into a replay, even if nobody was listening.
        game["_friend_activity_announced"] = True
        if not _watchable(game):
            return
        connections = tuple(self._connections)

        async def deliver(connection: FriendActivityConnection) -> None:
            identity = resolve_identity(connection.websocket)
            if identity is None or identity.user_id != connection.user_id:
                self.disconnect(connection.websocket)
                return
            payload = _recipient_payload(game, identity, now=utcnow())
            if payload is None:
                return
            try:
                await asyncio.wait_for(connection.websocket.send_json(payload), timeout=SEND_TIMEOUT_SECONDS)
            except (TimeoutError, WebSocketDisconnect, RuntimeError, OSError):
                self.disconnect(connection.websocket)

        results = await asyncio.gather(*(deliver(connection) for connection in connections), return_exceptions=True)
        for result in results:
            if isinstance(result, BaseException):
                logger.warning("Could not deliver friend activity", exc_info=(type(result), result, result.__traceback__))

    async def close(self) -> None:
        connections, self._connections = tuple(self._connections), []
        await asyncio.gather(*(
            asyncio.wait_for(connection.websocket.close(code=1001), timeout=SEND_TIMEOUT_SECONDS)
            for connection in connections
        ), return_exceptions=True)


friend_activity_hub = FriendActivityHub()


async def publish_friend_game_start(game: GameDict) -> None:
    """Best-effort notice; a transport failure must never break a game join."""
    try:
        await friend_activity_hub.publish_start(game)
    except Exception:
        logger.exception("Could not publish friend game start")


async def shutdown_friend_activity() -> None:
    await friend_activity_hub.close()


async def serve_friend_activity_websocket(
    websocket: WebSocket, *, reserve_connection: Callable, release_connection: Callable,
) -> None:
    if not websocket_origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin rejected")
        return
    identity = resolve_session(websocket)
    if identity is None:
        await websocket.close(code=1008, reason="Authentication required")
        return
    address = reserve_connection(websocket)
    if address is None:
        await websocket.close(code=1013, reason="Too many connections")
        return
    user_id = identity.user_id
    received: deque[float] = deque()
    try:
        await websocket.accept()
        enabled = friend_activity_enabled(user_id)
        await websocket.send_json({"friend_activity_ready": {"viewer_id": user_id, "enabled": enabled}})
        if not enabled:
            await websocket.close(code=1000)
            return
        friend_activity_hub.connect(websocket, user_id)
        while True:
            payload = await asyncio.wait_for(websocket.receive_json(), timeout=45)
            now = time.monotonic()
            while received and received[0] < now - 10:
                received.popleft()
            received.append(now)
            if len(received) > 20 or payload != {"action": "ping"}:
                await websocket.close(code=1008, reason="Invalid activity heartbeat")
                return
            identity = resolve_session(websocket)
            if identity is None or identity.user_id != user_id or not friend_activity_enabled(user_id):
                await websocket.close(code=1008, reason="Activity subscription expired")
                return
            await websocket.send_json({"pong": True})
    except (TimeoutError, ValueError):
        await websocket.close(code=1008, reason="Activity heartbeat required")
    except WebSocketDisconnect:
        pass
    finally:
        friend_activity_hub.disconnect(websocket)
        release_connection(address)
