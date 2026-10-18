"""Bounded chat history and resilient fan-out for live game connections."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
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
    return {**clean, "is_admin": type(user_id) is int and entry.get("is_admin") is True}


async def broadcast(game: GameDict, message: dict[str, Any]) -> None:
    """Send to connected players and spectators, detaching dead sockets."""
    if game.get("_game_type") == "watten":
        from .watten_websocket import broadcast_watten

        # A caller-supplied snapshot/event is never an authority to disclose
        # Watten state. Its coordinator already persists accepted mutations.
        await broadcast_watten(game)
        return
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
            if game.get("_game_type") == "hausdepp" and isinstance(websocket, WebSocket):
                from .auth import resolve_session
                from .game_access import can_access_hausdepp
                from .game_ws_session import close_with_error

                identity = resolve_session(websocket)
                if (not can_access_hausdepp(identity) or identity.user_id != recipient.get("user_id")):
                    recipient["ws"] = None
                    await close_with_error(websocket, "hausdepp_preview_required", fatal=True)
                    continue
            if recipient.get("_admin_help"):
                from .admin_help import has_active_help_claim
                from .auth import resolve_session
                from .game_ws_session import close_with_error

                identity = resolve_session(websocket)
                if (not identity or identity.user_id != recipient.get("user_id")
                    or not has_active_help_claim(identity.user_id, game["_id"])):
                    recipient["ws"] = None
                    if recipient in game.get("_spectators", []):
                        game["_spectators"].remove(recipient)
                    await close_with_error(websocket, "Der Admin-Einsatz ist beendet.", fatal=True, code=1000)
                    continue
            recipient_payload = payload
            if game.get("_game_type") == "hausdepp" and "scoreboard" in message:
                from .game_snapshot import snapshot

                # Never trust a caller-supplied private snapshot for fan-out.
                viewer_id = recipient.get("id") if recipient in game.get("_players", []) else None
                recipient_payload = jsonable_encoder({**message, "scoreboard": snapshot(game, viewer_id)})
            await websocket.send_json(recipient_payload)
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
