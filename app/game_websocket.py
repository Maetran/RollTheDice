"""Thin game WebSocket coordinator with action-specific handlers."""

from __future__ import annotations

import logging
import time
from collections import deque
from collections.abc import Callable
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from .auth import auth_identity_payload, resolve_session, websocket_origin_allowed
from .game_access import can_access_game
from .game_admin import action_blocked_by_superadmin
from .game_realtime import broadcast
from .game_registry import (
    dispatch_gameplay_action,
    gameplay_actions_for_game,
    superadmin_actions_for_game,
)
from .game_snapshot import snapshot
from .game_state import (
    MULTIPLAYER_PAUSE_BLOCKED_ACTIONS,
    GameDict,
    check_timeout_and_abort,
    games,
    multiplayer_pause_reason,
)
from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .game_ws_admin import SUPERADMIN_ACTIONS, handle_superadmin_action
from .game_ws_gameplay import GAMEPLAY_ACTIONS
from .game_ws_session import (
    SESSION_ACTIONS,
    GameSocketSession,
    close_with_error,
    disconnect_session,
    handle_session_action,
)
from .game_ws_social import SOCIAL_ACTIONS, handle_social_action
from .zilch_gameplay import ZILCH_GAMEPLAY_ACTIONS

logger = logging.getLogger(__name__)

# Kept as the complete public action vocabulary for compatibility with tests
# and diagnostics. Runtime validation below deliberately narrows it per game.
KNOWN_ACTIONS = SESSION_ACTIONS | GAMEPLAY_ACTIONS | ZILCH_GAMEPLAY_ACTIONS | SUPERADMIN_ACTIONS | SOCIAL_ACTIONS

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

    game = games.get(game_id)
    if game is None:
        await websocket.accept()
        await close_with_error(websocket, "Game nicht gefunden", fatal=True, code=1000)
        return

    identity = resolve_session(websocket)
    # Reject before accepting/sending any frame.  In particular, a known Zilch
    # ID must not disclose its lock state, players, board or chat to anyone.
    if not can_access_game(identity, game):
        await websocket.close(code=1008, reason="Zilch preview access required")
        return

    await websocket.accept()

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
                "game": {
                    "locked": bool(game.get("_passphrase")),
                    "game_type": game.get("_game_type", "zdwa"),
                },
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

        # Zilch preview access is checked again for every received action. A
        # deleted session, role change, or account deactivation therefore does
        # not leave an already-open socket authorized indefinitely.
        if session.game.get("_game_type", "zdwa") == "zilch":
            session.auth_identity = resolve_session(session.websocket)
            if not can_access_game(session.auth_identity, session.game):
                await close_with_error(
                    session.websocket,
                    "Zilch-Vorschau nicht mehr verfügbar",
                    fatal=True,
                    code=1008,
                )
                return

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

        allowed_gameplay_actions = gameplay_actions_for_game(session.game)
        allowed_superadmin_actions = superadmin_actions_for_game(session.game)
        # Chat and pause are transport-neutral. The generic ``end_game``
        # action, however, marks a ZDWA-shaped aborted result and must not
        # bypass the Zilch engine's terminal-state boundary.
        allowed_social_actions = (
            frozenset({"chat_message", "pause_game"})
            if game_type_from_state(session.game) == ZILCH_GAME_TYPE
            else SOCIAL_ACTIONS
        )
        allowed_actions = SESSION_ACTIONS | allowed_gameplay_actions | allowed_superadmin_actions | allowed_social_actions
        if action not in allowed_actions:
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
        if allowed_superadmin_actions and action_blocked_by_superadmin(session.game, action):
            await session.websocket.send_json({"error": "Spielaktionen sind während Superadmin-Edit gesperrt"})
            continue
        paused_reason = multiplayer_pause_reason(session.game)
        # A Solo player may explicitly abandon an already paused private run.
        # It is still versioned and confirmation-gated in the Zilch handler;
        # every score-affecting action remains blocked while paused.
        pause_blocked_actions = (
            MULTIPLAYER_PAUSE_BLOCKED_ACTIONS | allowed_gameplay_actions | allowed_superadmin_actions
        ) - {"zilch_abandon_solo"}
        if paused_reason and action in pause_blocked_actions:
            await session.websocket.send_json({"error": paused_reason})
            continue

        if action in SESSION_ACTIONS:
            if await handle_session_action(session, action, data, finalize_game=finalize_game):
                return
        elif action in allowed_gameplay_actions:
            await dispatch_gameplay_action(
                session,
                action,
                data,
                finalize_game=finalize_game,
            )
        elif action in allowed_superadmin_actions:
            await handle_superadmin_action(
                session,
                action,
                data,
                finalize_game=finalize_game,
            )
        elif action in allowed_social_actions:
            await handle_social_action(session, action, data)
        else:  # Defensive: KNOWN_ACTIONS and the dispatch tables must stay aligned.
            raise RuntimeError(f"Action dispatch is incomplete: {action}")
