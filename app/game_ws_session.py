"""Connection lifecycle and player/spectator session actions for game sockets."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from fastapi import WebSocket

from .auth import AuthIdentity, username_is_registered
from .game_engine import _set_roll_cap_for_current_turn
from .game_realtime import broadcast
from .game_snapshot import snapshot
from .game_state import (
    GameDict,
    _clear_correction,
    _join_block_reason,
    _offline_players,
    _passphrase_matches,
    assign_team_for_join,
    is_team_mode,
    touch,
)

logger = logging.getLogger(__name__)

SESSION_ACTIONS = frozenset({"join_game", "spectate_game", "rejoin_game"})


@dataclass
class GameSocketSession:
    """Mutable identity attached to one game WebSocket connection."""

    websocket: WebSocket
    game: GameDict
    auth_identity: AuthIdentity | None
    player_id: str | None = None
    spectator_id: str | None = None
    is_spectator: bool = False


async def close_with_error(
    websocket: WebSocket,
    error: str,
    *,
    fatal: bool = False,
    code: int = 1008,
) -> None:
    """Send a final structured error before closing a game socket."""
    try:
        payload: dict[str, Any] = {"error": error}
        if fatal:
            payload["fatal"] = True
        await websocket.send_json(payload)
    except Exception:
        logger.debug("Could not send final WebSocket error payload", exc_info=True)
    await websocket.close(code=code)


async def handle_session_action(
    session: GameSocketSession,
    action: str,
    data: dict[str, Any],
) -> bool:
    """Handle join/rejoin actions; return true when the socket should close."""
    if session.player_id or (session.spectator_id and action != "rejoin_game"):
        await session.websocket.send_json({"error": "Bereits beigetreten"})
        return False
    if action == "join_game":
        return await _join_game(session, data)
    if action == "spectate_game":
        return await _spectate_game(session, data)
    if action == "rejoin_game":
        return await _rejoin_game(session, data)
    raise ValueError(f"Unsupported session action: {action}")


async def _join_game(session: GameSocketSession, data: dict[str, Any]) -> bool:
    g = session.game
    websocket = session.websocket
    if not _passphrase_matches(g, data):
        await close_with_error(websocket, "Falsche Passphrase")
        return True

    if blocked_reason := _join_block_reason(g):
        await close_with_error(websocket, blocked_reason, fatal=True)
        return True

    requested_name = (str(data.get("name") or "Gast").strip() or "Gast")[:64]
    identity = session.auth_identity
    if identity:
        requested_name = identity.username
        duplicate_account = next(
            (p for p in g.get("_players", []) if p.get("user_id") == identity.user_id),
            None,
        )
        if duplicate_account:
            await close_with_error(
                websocket,
                "Dieser Benutzer ist der Partie bereits beigetreten. Bitte Spiel fortsetzen.",
                fatal=True,
            )
            return True
    elif username_is_registered(requested_name):
        await close_with_error(
            websocket,
            "Dieser Spielername ist registriert. Bitte anmelden oder einen anderen Gastnamen verwenden.",
            fatal=True,
        )
        return True

    player_id = str(uuid.uuid4())[:6]
    player = {
        "id": player_id,
        "name": requested_name,
        "user_id": identity.user_id if identity else None,
        "ws": websocket,
        "resume_token": uuid.uuid4().hex,
    }
    session.player_id = player_id
    session.spectator_id = None
    session.is_spectator = False
    g["_players"].append(player)
    g["_scoreboards"][player_id] = {}
    if is_team_mode(g):
        assign_team_for_join(g, player_id)
    if len(g["_players"]) == g["_expected"] and not g["_started"]:
        g["_started"] = True
        g["_started_at"] = datetime.now(timezone.utc).isoformat()
        g["_turn"] = {
            "player_id": g["_players"][0]["id"],
            "roll_index": 0,
            "first4oak_roll": None,
        }
        _set_roll_cap_for_current_turn(g)

    await websocket.send_json({"player_id": player_id, "resume_token": player["resume_token"]})
    touch(g)
    await broadcast(g, {"scoreboard": snapshot(g)})
    return False


async def _spectate_game(session: GameSocketSession, data: dict[str, Any]) -> bool:
    g = session.game
    websocket = session.websocket
    if not _passphrase_matches(g, data):
        await close_with_error(websocket, "Falsche Passphrase")
        return True

    identity = session.auth_identity
    requested_name = (str(data.get("name") or "Gast").strip() or "Gast")[:64]
    if not identity and username_is_registered(requested_name):
        await close_with_error(
            websocket,
            "Dieser Spielername ist registriert. Bitte anmelden oder einen anderen Gastnamen verwenden.",
            fatal=True,
        )
        return True
    spectator_id = str(uuid.uuid4())[:6]
    spectator = {
        "id": spectator_id,
        "name": identity.username if identity else requested_name,
        "user_id": identity.user_id if identity else None,
        "ws": websocket,
    }
    session.player_id = None
    session.spectator_id = spectator_id
    session.is_spectator = True
    g.setdefault("_spectators", []).append(spectator)

    await websocket.send_json({"spectator_id": spectator_id, "spectator": True})
    touch(g)
    try:
        await broadcast(g, {"spectator": {"event": "joined", "name": spectator["name"]}})
    except Exception:
        logger.debug("Could not broadcast spectator join", exc_info=True)
    await broadcast(g, {"scoreboard": snapshot(g)})
    return False


async def _rejoin_game(session: GameSocketSession, data: dict[str, Any]) -> bool:
    g = session.game
    websocket = session.websocket
    if not _passphrase_matches(g, data):
        await close_with_error(websocket, "Falsche Passphrase")
        return True
    if g.get("_finished") or g.get("_aborted"):
        await close_with_error(websocket, "Spiel ist bereits beendet", fatal=True)
        return True

    requested_id = str(data.get("player_id") or "")
    player = next(
        (p for p in g.get("_players", []) if str(p.get("id")) == requested_id),
        None,
    )
    if not player:
        await close_with_error(
            websocket,
            "Spieler-Sitzung nicht gefunden. Bitte der Partie neu beitreten oder zuschauen.",
            fatal=True,
        )
        return True

    expected_token = str(player.get("resume_token") or "")
    provided_token = str(data.get("resume_token") or "")
    identity = session.auth_identity
    account_matches = bool(
        identity and player.get("user_id") is not None and int(player["user_id"]) == identity.user_id
    )
    if not account_matches and (not expected_token or provided_token != expected_token):
        await close_with_error(
            websocket,
            "Wiederaufnahme abgelehnt. Die gespeicherte Spieler-Sitzung passt nicht.",
            fatal=True,
        )
        return True

    old_websocket = player.get("ws")
    if session.spectator_id:
        spectator_id = session.spectator_id
        g["_spectators"] = [
            spectator
            for spectator in g.get("_spectators", [])
            if not (str(spectator.get("id")) == str(spectator_id) and spectator.get("ws") is websocket)
        ]
    session.player_id = requested_id
    session.spectator_id = None
    session.is_spectator = False
    player["ws"] = websocket
    if old_websocket and old_websocket is not websocket:
        try:
            await old_websocket.close(code=1000)
        except Exception:
            logger.debug("Could not close replaced WebSocket", exc_info=True)

    g["_manual_pause"] = False
    g["_manual_pause_by"] = None
    g["_manual_pause_by_name"] = None
    g["_manual_pause_at"] = None
    if not _offline_players(g):
        g["_resume_required"] = False
    if not player.get("resume_token"):
        player["resume_token"] = uuid.uuid4().hex
    await websocket.send_json(
        {
            "player_id": requested_id,
            "resume_token": player["resume_token"],
            "resumed": True,
        }
    )
    touch(g)
    await broadcast(g, {"scoreboard": snapshot(g)})
    return False


async def disconnect_session(session: GameSocketSession) -> None:
    """Detach one player/spectator and publish resumable connection state."""
    g = session.game
    player_id = session.player_id
    spectator_id = session.spectator_id
    correction_cancelled = False
    superadmin_cancelled = False

    if player_id:
        owns_player_socket = False
        for player in g.get("_players", []):
            if player.get("id") == player_id:
                if player.get("ws") is session.websocket:
                    player["ws"] = None
                    owns_player_socket = True
                break
        # A rejoin replaces the old socket before closing it. The old handler
        # must not pause or alter the newly attached player session.
        if owns_player_socket and player_id in g.get("_superadmins", {}):
            g.setdefault("_superadmins", {}).pop(player_id, None)
            touch(g)
            superadmin_cancelled = True
        if (
            owns_player_socket
            and g.get("_correction", {}).get("active")
            and g.get("_correction", {}).get("player_id") == player_id
        ):
            _clear_correction(g)
            touch(g)
            correction_cancelled = True
    elif spectator_id:
        spectators = g.get("_spectators", [])
        left_name = None
        for index, spectator in enumerate(list(spectators)):
            if spectator.get("id") == spectator_id:
                left_name = spectator.get("name")
                spectators.pop(index)
                break
        try:
            if left_name:
                await broadcast(g, {"spectator": {"event": "left", "name": left_name}})
        except Exception:
            logger.debug("Could not broadcast spectator departure", exc_info=True)

    if player_id and owns_player_socket and g.get("_started") and not g.get("_finished") and not g.get("_aborted"):
        g["_resume_required"] = True
        touch(g)
    if correction_cancelled or superadmin_cancelled or (player_id and owns_player_socket):
        try:
            await broadcast(g, {"scoreboard": snapshot(g)})
        except Exception:
            logger.debug("Could not broadcast disconnect snapshot", exc_info=True)
