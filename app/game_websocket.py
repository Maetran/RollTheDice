"""Thin game WebSocket coordinator with action-specific handlers."""

from __future__ import annotations

import logging
import time
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from .auth import auth_identity_payload, resolve_session, websocket_origin_allowed
from .game_access import can_access_game
from .game_admin import action_blocked_by_superadmin
from .game_registry import (
    dispatch_gameplay_action,
    gameplay_actions_for_game,
    superadmin_actions_for_game,
)
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
TimeoutAbortPublisher = Callable[[GameDict], Awaitable[None]]


def _register_live_socket(game: GameDict, websocket: WebSocket) -> None:
    """Track an accepted socket before it has chosen a room role.

    Players and spectators are recorded on their respective entities only
    after their first action. The small interval beforehand still needs to be
    retired by an inactivity timeout, otherwise a silent client could retain
    a receive loop and a connection reservation forever.
    """
    live = game.get("_live_sockets")
    if not isinstance(live, list):
        live = []
        game["_live_sockets"] = live
    if not any(candidate is websocket for candidate in live):
        live.append(websocket)


def _unregister_live_socket(game: GameDict, websocket: WebSocket) -> None:
    live = game.get("_live_sockets")
    if not isinstance(live, list):
        return
    remaining = [candidate for candidate in live if candidate is not websocket]
    if remaining:
        game["_live_sockets"] = remaining
    else:
        game.pop("_live_sockets", None)


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
    timeout_abort_publisher: TimeoutAbortPublisher | None = None,
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

    # A lifecycle sweep can mark a room terminal while it is still delivering
    # its final frame to existing peers. Do not let a concurrent new socket
    # reserve a connection or briefly recreate a participant in that window.
    if game.get("_aborted") and game.get("_abort_reason") == "inactivity_timeout":
        await websocket.accept()
        await close_with_error(websocket, "Spiel ist bereits beendet", fatal=True, code=1000)
        return

    await websocket.accept()

    connection_address = reserve_connection(websocket)
    if connection_address is None:
        await close_with_error(websocket, "Zu viele Verbindungen", fatal=True, code=1013)
        return

    session = GameSocketSession(websocket=websocket, game=game, auth_identity=identity)
    limiter = MessageRateLimiter()
    _register_live_socket(game, websocket)
    try:
        # The timeout can race with ``accept``. Registering first makes an
        # immediately subsequent timeout close this peer too; this second
        # check covers a sweep that completed just before registration.
        if game.get("_aborted") and game.get("_abort_reason") == "inactivity_timeout":
            await close_with_error(websocket, "Spiel ist bereits beendet", fatal=True, code=1000)
            return
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
        await _receive_messages(
            session,
            limiter=limiter,
            finalize_game=finalize_game,
            timeout_abort_publisher=timeout_abort_publisher,
        )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Unexpected WebSocket failure for game %s", game_id)
    finally:
        _unregister_live_socket(game, websocket)
        await disconnect_session(session)
        release_connection(connection_address)


async def _receive_messages(
    session: GameSocketSession,
    *,
    limiter: MessageRateLimiter,
    finalize_game: FinalizeGame,
    timeout_abort_publisher: TimeoutAbortPublisher | None = None,
) -> None:
    while True:
        data = await session.websocket.receive_json()
        if not isinstance(data, dict):
            await session.websocket.send_json({"error": "Ungültige Nachricht"})
            continue
        action_value = data.get("action")
        action = action_value if isinstance(action_value, str) else None

        # Zilch access is checked again for every received action. A
        # deleted session, role change, or account deactivation therefore does
        # not leave an already-open socket authorized indefinitely.
        if session.game.get("_game_type", "zdwa") == "zilch":
            session.auth_identity = resolve_session(session.websocket)
            if not can_access_game(session.auth_identity, session.game):
                await close_with_error(
                    session.websocket,
                    "Zilch-Zugang nicht mehr verfügbar",
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
            # Reactions use the same short-lived broadcast path as ZDWA.
            # They do not belong in the persistent chat history.
            frozenset({"send_emoji", "chat_message", "pause_game"})
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
            # The app lifecycle owns terminal delivery and retirement.  Calling
            # its injected publisher here gives an action that lands exactly on
            # the deadline the same immediate final frame as the background
            # sweeper, without a second broadcast fifteen seconds later.
            if timeout_abort_publisher is not None:
                await timeout_abort_publisher(session.game)
                # The publisher has sent the sole terminal frame and closed
                # the room sockets. This handler must now reach its ``finally``
                # so it releases the connection reservation instead of waiting
                # for one more inbound browser frame.
                return
            # Focused lower-level callers without the application lifecycle
            # injection retain the prior defensive fallback below.
            continue
        # A room may have been retired by the periodic lifecycle sweep while
        # this socket still owns its in-memory reference.  Never let a late
        # chat, reaction, rejoin or game command touch that terminal object:
        # it must not look active again or schedule a delayed CPU action.
        if session.game.get("_aborted"):
            if session.player_id or session.spectator_id:
                await session.websocket.close(code=1000)
            else:
                await close_with_error(session.websocket, "Spiel ist bereits beendet", fatal=True, code=1000)
            return
        # A Zilch spectator remains a spectator for the entire socket
        # lifetime.  Unlike ZDWA's legacy generic view, its read-only route
        # must not be turned back into a player session by a crafted rejoin
        # frame. Opening the ordinary player route remains the explicit way
        # for a seated player to resume.
        spectator_actions = {"send_emoji", "chat_message"}
        if game_type_from_state(session.game) != ZILCH_GAME_TYPE:
            spectator_actions.add("rejoin_game")
        if session.is_spectator and action not in spectator_actions:
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
