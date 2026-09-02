"""Thin game WebSocket coordinator with action-specific handlers."""

from __future__ import annotations

import logging
import time
from collections import deque
from collections.abc import Callable
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from .auth import auth_identity_payload, resolve_session, websocket_origin_allowed
from .game_admin import action_blocked_by_superadmin
from .game_realtime import broadcast
from .game_snapshot import snapshot
from .game_state import (
    MULTIPLAYER_PAUSE_BLOCKED_ACTIONS,
    GameDict,
    check_timeout_and_abort,
    games,
    multiplayer_pause_reason,
)
from .game_ws_admin import SUPERADMIN_ACTIONS, handle_superadmin_action
from .game_ws_gameplay import GAMEPLAY_ACTIONS, handle_gameplay_action
from .game_ws_session import (
    SESSION_ACTIONS,
    GameSocketSession,
    close_with_error,
    disconnect_session,
    handle_session_action,
)
from .game_ws_social import SOCIAL_ACTIONS, handle_social_action

logger = logging.getLogger(__name__)

KNOWN_ACTIONS = SESSION_ACTIONS | GAMEPLAY_ACTIONS | SUPERADMIN_ACTIONS | SOCIAL_ACTIONS

ReserveConnection = Callable[[WebSocket], str | None]
ReleaseConnection = Callable[[str | None], None]
FinalizeGame = Callable[[GameDict], Any]


class MessageRateLimiter:
    """Small per-connection sliding-window limiter for socket messages."""

    def __init__(self) -> None:
        self._messages: deque[float] = deque()
        self._social_messages: deque[float] = deque()

    def check(self, action: str | None) -> str | None:
        now = time.monotonic()
        self._prune(self._messages, now - 10)
        self._messages.append(now)
        if len(self._messages) > 60:
            return "close"
        if action in {"send_emoji", "chat_message"}:
            self._prune(self._social_messages, now - 5)
            self._social_messages.append(now)
            if len(self._social_messages) > 10:
                return "wait"
        return None

    @staticmethod
    def _prune(bucket: deque[float], cutoff: float) -> None:
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()


async def serve_game_websocket(
    websocket: WebSocket,
    game_id: str,
    *,
    reserve_connection: ReserveConnection,
    release_connection: ReleaseConnection,
    finalize_game: FinalizeGame,
) -> None:
    """Validate one socket and coordinate its focused action handlers."""
    if not websocket_origin_allowed(websocket):
        await websocket.close(code=1008, reason="Origin rejected")
        return

    identity = resolve_session(websocket)
    await websocket.accept()
    game = games.get(game_id)
    if game is None:
        await close_with_error(websocket, "Game nicht gefunden", fatal=True, code=1000)
        return

    connection_address = reserve_connection(websocket)
    if connection_address is None:
        await close_with_error(websocket, "Zu viele Verbindungen", fatal=True, code=1013)
        return

    session = GameSocketSession(websocket=websocket, game=game, auth_identity=identity)
    limiter = MessageRateLimiter()
    try:
        await websocket.send_json(
            {
                "auth": {
                    "authenticated": bool(identity),
                    "user": auth_identity_payload(identity) if identity else None,
                },
                # Do not expose a protected game's board or chat until the
                # client has authenticated through join/spectate/rejoin.
                "game": {"locked": bool(game.get("_passphrase"))},
            }
        )
        await _receive_messages(session, limiter=limiter, finalize_game=finalize_game)
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Unexpected WebSocket failure for game %s", game_id)
    finally:
        await disconnect_session(session)
        release_connection(connection_address)


async def _receive_messages(
    session: GameSocketSession,
    *,
    limiter: MessageRateLimiter,
    finalize_game: FinalizeGame,
) -> None:
    while True:
        data = await session.websocket.receive_json()
        if not isinstance(data, dict):
            await session.websocket.send_json({"error": "Ungültige Nachricht"})
            continue
        action_value = data.get("action")
        action = action_value if isinstance(action_value, str) else None

        rate_limit = limiter.check(action)
        if rate_limit == "close":
            await close_with_error(
                session.websocket,
                "Zu viele Nachrichten",
                fatal=True,
                code=1008,
            )
            return
        if rate_limit == "wait":
            await session.websocket.send_json({"error": "Bitte kurz warten"})
            continue

        if action not in KNOWN_ACTIONS:
            await session.websocket.send_json({"error": f"Unbekannte Aktion: {action_value}"})
            continue
        if not session.player_id and not session.spectator_id and action not in SESSION_ACTIONS:
            await session.websocket.send_json({"error": "Nicht beigetreten"})
            continue

        if check_timeout_and_abort(session.game):
            await broadcast(session.game, {"scoreboard": snapshot(session.game)})
            continue
        if session.is_spectator and action not in {"send_emoji", "chat_message", "rejoin_game"}:
            await session.websocket.send_json({"error": "Nur fuer Spieler"})
            continue
        if action_blocked_by_superadmin(session.game, action):
            await session.websocket.send_json({"error": "Spielaktionen sind während Superadmin-Edit gesperrt"})
            continue
        paused_reason = multiplayer_pause_reason(session.game)
        if paused_reason and action in MULTIPLAYER_PAUSE_BLOCKED_ACTIONS:
            await session.websocket.send_json({"error": paused_reason})
            continue

        if action in SESSION_ACTIONS:
            if await handle_session_action(session, action, data):
                return
        elif action in GAMEPLAY_ACTIONS:
            await handle_gameplay_action(
                session,
                action,
                data,
                finalize_game=finalize_game,
            )
        elif action in SUPERADMIN_ACTIONS:
            await handle_superadmin_action(
                session,
                action,
                data,
                finalize_game=finalize_game,
            )
        elif action in SOCIAL_ACTIONS:
            await handle_social_action(session, action, data)
        else:  # Defensive: KNOWN_ACTIONS and the dispatch tables must stay aligned.
            raise RuntimeError(f"Action dispatch is incomplete: {action}")
