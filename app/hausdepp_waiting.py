"""Deliberately leave an unstarted card table without scoring an abandoned round."""

from __future__ import annotations

from .active_games import delete_active_game, save_active_game
from .game_realtime import broadcast
from .game_snapshot import snapshot
from .game_state import games, touch
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state


def waiting_permissions(game: dict, viewer_id: str | None) -> dict:
    player = next((item for item in game.get("_players", []) if item.get("id") == viewer_id), None)
    return {
        "can_leave": bool(player and not game.get("_started") and not game.get("_finished")
                          and not game.get("_aborted") and game.get("_hausdepp") is None),
        "is_host": bool(player and player.get("user_id") == game.get("_hausdepp_host_user_id")),
    }


async def leave_waiting_session(session) -> bool:
    """Release only the authenticated caller's current seat; return close flag."""
    game = session.game
    player = next((item for item in game.get("_players", []) if item.get("id") == session.player_id), None)
    identity = session.auth_identity
    if (game_type_from_state(game) != HAUSDEPP_GAME_TYPE or not identity or not player
            or session.is_spectator or player.get("user_id") != identity.user_id
            or player.get("ws") is not session.websocket):
        await session.websocket.send_json({"error": "hausdepp_waiting_leave_not_seated"})
        return False
    if not waiting_permissions(game, session.player_id)["can_leave"]:
        await session.websocket.send_json({"error": "hausdepp_waiting_already_started"})
        return False

    # All state changes happen before the first await. A concurrent join sees
    # either this open seat or an already-started game, never half a departure.
    game["_players"] = [item for item in game["_players"] if item is not player]
    game["_participants"] = [item for item in game.get("_participants", []) if item.get("id") != player["id"]]
    was_host = player.get("user_id") == game.get("_hausdepp_host_user_id")
    closed = not game["_players"]
    if was_host and not closed:
        game["_hausdepp_host_user_id"] = game["_players"][0]["user_id"]
    if closed:
        game.update(_aborted=True, _abort_reason="waiting_empty", _finished=True, _abandonment_accounted=True)
        games.pop(str(game["_id"]), None)
        delete_active_game(str(game["_id"]))
    touch(game)
    session.player_id = None
    save_active_game(game)
    await session.websocket.send_json({"left_waiting_game": True, "table_closed": closed,
                                       "host_transferred": was_host and not closed, "redirect": "/hausdepp"})
    await broadcast(game, {"scoreboard": snapshot(game), **({"waiting_table_closed": True} if closed else {})})
    if closed:
        for socket in list(game.get("_live_sockets", [])):
            if socket is not session.websocket:
                try:
                    await socket.close(code=1000)
                except (RuntimeError, OSError):
                    pass
    await session.websocket.close(code=1000)
    return True
