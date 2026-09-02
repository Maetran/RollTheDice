"""Chat, reactions and non-scoring game controls for game WebSockets."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from .game_realtime import broadcast, broadcast_chat
from .game_snapshot import snapshot
from .game_state import (
    _format_duration_hm,
    _player_name,
    pause_remaining_seconds,
    touch,
)
from .game_ws_session import GameSocketSession

logger = logging.getLogger(__name__)

SOCIAL_ACTIONS = frozenset({"send_emoji", "chat_message", "pause_game", "end_game"})


async def handle_social_action(
    session: GameSocketSession,
    action: str,
    data: dict[str, Any],
) -> None:
    if action == "send_emoji":
        await _send_emoji(session, data)
    elif action == "chat_message":
        await _chat_message(session, data)
    elif action == "pause_game":
        await _pause_game(session, data)
    elif action == "end_game":
        await _end_game(session, data)
    else:
        raise ValueError(f"Unsupported social action: {action}")


async def _send_error(session: GameSocketSession, message: str) -> None:
    await session.websocket.send_json({"error": message})


def _sender(session: GameSocketSession) -> tuple[str, dict] | None:
    if session.player_id:
        player = next(
            (
                player
                for player in session.game.get("_players", [])
                if player.get("id") == session.player_id
            ),
            {"name": "Gast"},
        )
        return session.player_id, player
    if session.spectator_id:
        spectator = next(
            (
                spectator
                for spectator in session.game.get("_spectators", [])
                if spectator.get("id") == session.spectator_id
            ),
            {"name": "Gast"},
        )
        return f"S-{session.spectator_id}", spectator
    return None


async def _send_emoji(session: GameSocketSession, data: dict[str, Any]) -> None:
    emoji = str(data.get("emoji") or "").strip()
    if not emoji:
        await _send_error(session, "Kein Emoji")
        return
    if len(emoji) > 16:
        await _send_error(session, "Ungültige Reaktion")
        return
    sender = _sender(session)
    if not sender:
        await _send_error(session, "Nicht beigetreten")
        return
    sender_id, sender_player = sender
    sender_name = sender_player.get("name", "Gast")
    sender_rank = sender_player.get("achievement_rank")
    touch(session.game)
    await broadcast(
        session.game,
        {
            "emoji": {
                "from_id": sender_id,
                "from": sender_name,
                "emoji": emoji,
                "ts": datetime.now(timezone.utc).isoformat(),
                **({"achievement_rank": sender_rank} if isinstance(sender_rank, dict) else {}),
            }
        },
    )


async def _chat_message(session: GameSocketSession, data: dict[str, Any]) -> None:
    text = str(data.get("text") or "").strip()
    if not text:
        return
    sender = _sender(session)
    if not sender:
        await _send_error(session, "Nicht beigetreten")
        return
    sender_id, sender_player = sender
    sender_name = sender_player.get("name", "Gast")
    sender_rank = sender_player.get("achievement_rank")
    touch(session.game)
    await broadcast_chat(
        session.game,
        {
            "from_id": sender_id,
            "sender": sender_name,
            "text": text[:400],
            "ts": datetime.now(timezone.utc).isoformat(),
            "kind": "chat",
            "user_id": sender_player.get("user_id"),
            **({"achievement_rank": sender_rank} if isinstance(sender_rank, dict) else {}),
        },
    )


async def _pause_game(session: GameSocketSession, _data: dict[str, Any]) -> None:
    if not session.player_id:
        await _send_error(session, "Nur Spieler koennen das Spiel pausieren")
        return
    if session.game.get("_finished") or session.game.get("_aborted"):
        await _send_error(session, "Spiel ist bereits beendet")
        return
    by_name = _player_name(session.game, session.player_id)
    touch(session.game)
    session.game["_manual_pause"] = True
    session.game["_manual_pause_by"] = session.player_id
    session.game["_manual_pause_by_name"] = by_name
    session.game["_manual_pause_at"] = datetime.now(timezone.utc).isoformat()
    pause_left = pause_remaining_seconds(session.game)
    await session.websocket.send_json(
        {
            "paused": True,
            "pause_remaining_seconds": pause_left,
            "pause_remaining_label": _format_duration_hm(pause_left),
        }
    )
    await broadcast(session.game, {"scoreboard": snapshot(session.game)})


async def _end_game(session: GameSocketSession, _data: dict[str, Any]) -> None:
    if not session.player_id:
        await _send_error(session, "Nur Spieler koennen das Spiel beenden")
        return
    if session.game.get("_finished") or session.game.get("_aborted"):
        await _send_error(session, "Spiel ist bereits beendet")
        return
    by_name = _player_name(session.game, session.player_id)
    try:
        await broadcast(session.game, {"notice": {"type": "ended", "by": by_name}})
    except Exception:
        logger.debug("Could not broadcast game-end notice", exc_info=True)
    session.game["_aborted"] = True
    session.game["_results"] = None
    session.game["_started"] = False
    session.game["_finished"] = True
    touch(session.game)
    await broadcast(session.game, {"scoreboard": snapshot(session.game)})
