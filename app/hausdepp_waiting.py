"""Deliberately leave an unstarted card table without scoring an abandoned round."""

from __future__ import annotations

from .active_games import delete_active_game, save_active_game
from .game_realtime import broadcast
from .game_snapshot import snapshot
from .game_state import games, touch
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state
from .hausdepp_state import (
    add_hausdepp_cpu,
    hausdepp_start_error,
    hausdepp_waiting_summary,
    remove_hausdepp_cpu,
    start_hausdepp_game,
)


def waiting_permissions(game: dict, viewer_id: str | None) -> dict:
    from .hausdepp_rematch import rematch_waiting_error

    player = next((item for item in game.get("_players", []) if item.get("id") == viewer_id), None)
    waiting = bool(not game.get("_started") and not game.get("_finished")
                   and not game.get("_aborted") and game.get("_hausdepp") is None)
    host = bool(player and player.get("user_id") == game.get("_hausdepp_host_user_id"))
    summary = hausdepp_waiting_summary(game)
    start_reason = hausdepp_start_error(game) if host else "hausdepp_host_required"
    can_add = bool(host and waiting and summary["free_seats"])
    if can_add and rematch_waiting_error(game, "hausdepp_add_cpu"):
        can_add = False
    if host and waiting and start_reason is None:
        start_reason = rematch_waiting_error(game, "hausdepp_start_game")
    return {
        "can_leave": bool(player and waiting), "is_host": host,
        "can_add_cpu": can_add,
        "can_remove_cpu": bool(host and waiting and summary["replaceable_cpus"]),
        "can_start": bool(host and waiting and start_reason is None), "start_reason": start_reason,
    }


async def handle_waiting_action(session, action: str, data: dict, *, finalize_game=None) -> None:
    """Host-only waiting commands; accepted mutations precede any socket await."""
    from .friend_activity import publish_friend_game_start
    from .hausdepp_cpu_runner import maybe_schedule_cpu_turn
    from .hausdepp_gameplay import game_lock
    from .hausdepp_rematch import rematch_waiting_guard
    from .hausdepp_voice import refresh_voice_game

    game = session.game
    async with game_lock(game):
        player = next((item for item in game.get("_players", []) if item.get("id") == session.player_id), None)
        identity = session.auth_identity
        try:
            if (game_type_from_state(game) != HAUSDEPP_GAME_TYPE or session.is_spectator or not identity
                    or not player or player.get("user_id") != identity.user_id
                    or player.get("ws") is not session.websocket):
                raise ValueError("hausdepp_invalid_actor")
            if player.get("user_id") != game.get("_hausdepp_host_user_id"):
                raise ValueError("hausdepp_host_required")
            if not waiting_permissions(game, session.player_id)["can_leave"]:
                raise ValueError("hausdepp_waiting_already_started")
            with rematch_waiting_guard(game, action):
                if action == "hausdepp_add_cpu":
                    add_hausdepp_cpu(game)
                elif action == "hausdepp_remove_cpu":
                    remove_hausdepp_cpu(game, data.get("participant_id"))
                elif action == "hausdepp_start_game":
                    start_hausdepp_game(game, manual=True)
                else:
                    raise ValueError("hausdepp_invalid_command")
            touch(game)
            save_active_game(game)
        except ValueError as exc:
            code = str(exc)
            await session.websocket.send_json({"error": code, "error_code": code,
                                               "scoreboard": snapshot(game, session.player_id)})
            return
        await refresh_voice_game(game)
        await broadcast(game, {"scoreboard": snapshot(game)})
        if action == "hausdepp_start_game":
            await publish_friend_game_start(game)
            maybe_schedule_cpu_turn(game, finalize_game=finalize_game)


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
        from .game_lifecycle import bound_revision

        # Capture the exact row revision before leaving the registry.
        revision = bound_revision(game)
        games.pop(str(game["_id"]), None)
        delete_active_game(str(game["_id"]), expected_revision=revision)
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
