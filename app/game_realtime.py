"""Bounded chat history and resilient fan-out for live game connections."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocketDisconnect
from fastapi.encoders import jsonable_encoder

from .active_games import save_active_game
from .game_state import CHAT_HISTORY_LIMIT, GameDict

logger = logging.getLogger(__name__)


async def send_game_message(websocket: Any, message: dict[str, Any]) -> None:
    """Send one game payload after converting transport-only values to JSON.

    Terminal result metadata and other server-originated event payloads can
    contain timestamps as ``datetime`` instances.  Private Zilch awards are
    deliberately fetched from their per-session delivery queue instead of
    being copied into a shared game broadcast.  Unlike normal FastAPI
    responses, Starlette's
    :meth:`~starlette.websockets.WebSocket.send_json` does not run
    ``jsonable_encoder`` itself.  Sending such a terminal payload used to
    raise ``TypeError`` *after* the last field was persisted; ``broadcast``
    then detached the socket and the client remained on its old board.

    Keeping the conversion at the WebSocket boundary also makes future game
    payloads safe for UUIDs, enums and other standard FastAPI encodable
    values.
    """
    await websocket.send_json(jsonable_encoder(message))


def append_chat_history(game: GameDict, entry: dict) -> dict:
    """Store one sanitized chat/system message in the bounded game history."""
    clean = {
        "from_id": entry.get("from_id"),
        "sender": str(entry.get("sender") or "System")[:80],
        "text": str(entry.get("text") or "")[:400],
        "ts": entry.get("ts") or datetime.now(timezone.utc).isoformat(),
        "kind": str(entry.get("kind") or "chat")[:32],
    }
    user_id = entry.get("user_id")
    if isinstance(user_id, int):
        clean["user_id"] = user_id
    rank = entry.get("achievement_rank")
    if isinstance(rank, dict):
        clean["achievement_rank"] = {
            key: rank[key]
            for key in ("key", "title", "stars", "points", "points_possible")
            if key in rank
        }
    history = game.setdefault("_chat_history", [])
    history.append(clean)
    if len(history) > CHAT_HISTORY_LIMIT:
        del history[:-CHAT_HISTORY_LIMIT]
    return clean


async def broadcast(game: GameDict, message: dict[str, Any]) -> None:
    """Send to connected players and spectators, detaching dead sockets."""
    # Mutations converge here; persistence strips process-local sockets.
    save_active_game(game)
    # Encode once so every recipient receives the exact same JSON-safe
    # representation and a single datetime cannot silently detach all sockets.
    payload = jsonable_encoder(message)
    recipients = [*game.get("_players", []), *game.get("_spectators", [])]
    for recipient in recipients:
        websocket = recipient.get("ws")
        if websocket is None:
            continue
        try:
            await websocket.send_json(payload)
        except (WebSocketDisconnect, RuntimeError, OSError):
            if recipient.get("ws") is websocket:
                recipient["ws"] = None
        except Exception:
            logger.warning("Could not broadcast to game connection", exc_info=True)
            if recipient.get("ws") is websocket:
                recipient["ws"] = None


async def broadcast_chat(game: GameDict, entry: dict) -> None:
    """Persist and broadcast one sanitized chat message."""
    await broadcast(game, {"chat": append_chat_history(game, entry)})
