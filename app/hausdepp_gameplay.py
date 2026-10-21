"""Socket commands and trusted CPU transitions for Hausdepp."""

from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timezone
from weakref import WeakValueDictionary

from .active_games import save_active_game
from .game_realtime import broadcast
from .game_state import multiplayer_pause_reason, touch

HAUSDEPP_GAMEPLAY_ACTIONS = frozenset({"hausdepp_play", "hausdepp_pickup", "hausdepp_gamble", "hausdepp_afterthrow", "hausdepp_draw", "hausdepp_peek", "hausdepp_next_round", "hausdepp_add_cpu", "hausdepp_remove_cpu", "hausdepp_start_game", "hausdepp_speed_up_cpus"})
_LOCKS: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()


def game_lock(game: dict) -> asyncio.Lock:
    return _LOCKS.setdefault(str(game["_id"]), asyncio.Lock())


def apply_hausdepp_command(game: dict, player_id: str, command: dict, *, trusted_cpu: bool = False) -> None:
    from .hausdepp_engine import HausdeppRuleError, apply_action

    if command.get("action") == "next_round":
        if trusted_cpu:
            raise HausdeppRuleError("hausdepp_host_required")
        from .hausdepp_tournament import start_next_round

        start_next_round(game, player_id, command.get("version"))
        touch(game)
        return
    if not game.get("_started") or game.get("_finished") or game.get("_aborted"):
        raise HausdeppRuleError("hausdepp_game_not_running")
    if game.get("_hausdepp_tournament") is not None:
        from .hausdepp_tournament import validate_tournament

        try:
            tournament = validate_tournament(game["_hausdepp_tournament"],
                                             {player["id"] for player in game["_participants"]})
            if (tournament["id"] != game["_id"] or tournament["completed"]
                    or len(tournament["round_losers"]) != tournament["round_number"] - 1):
                raise ValueError("hausdepp_invalid_tournament")
        except ValueError as exc:
            raise HausdeppRuleError("hausdepp_invalid_tournament") from exc
    if multiplayer_pause_reason(game):
        raise HausdeppRuleError("hausdepp_game_paused")
    participant = next((player for player in game.get("_participants", []) if player["id"] == player_id), None)
    if not participant or bool(participant.get("is_cpu")) != trusted_cpu:
        raise HausdeppRuleError("hausdepp_invalid_actor")
    if command.get("action") == "speed_up_cpus":
        from .hausdepp_cpu_tempo import enable_fast_cpu_tempo

        if trusted_cpu:
            raise HausdeppRuleError("hausdepp_invalid_actor")
        enable_fast_cpu_tempo(game, player_id, command.get("round_number"))
        touch(game)
        return
    version = command.get("version")
    if type(version) is not int:
        raise HausdeppRuleError("hausdepp_version_required")
    game["_hausdepp"] = apply_action(game["_hausdepp"], player_id, command["action"],
                                      cards=command.get("cards"), version=version)
    state = game["_hausdepp"]
    if not trusted_cpu:
        from .hausdepp_cpu_runner import note_human_presentation

        note_human_presentation(game)
    game["_turn"] = {"player_id": state["current_player_id"]} if state.get("current_player_id") else None
    if state["phase"] == "finished":
        game["_finished"] = True
        game["_finished_at"] = datetime.now(timezone.utc).isoformat()
        game["_results"] = {"loser_id": state["loser_id"], "finished_order": list(state["finished_order"])}
        from .hausdepp_tournament import record_finished_round

        record_finished_round(game)
    touch(game)


async def publish_hausdepp_transition(game: dict, *, finalize_game=None) -> None:
    from .game_snapshot import snapshot

    save_active_game(game)
    # The finished board triggers account loading. Commit durable round credits
    # first so that first account read can already show the earned XP and rank.
    if game.get("_finished") and not game.get("_aborted") and finalize_game:
        completion = finalize_game(game)
        if inspect.isawaitable(completion):
            await completion
    await broadcast(game, {"scoreboard": snapshot(game)})
    if not game.get("_finished"):
        from .hausdepp_cpu_runner import maybe_schedule_cpu_turn

        maybe_schedule_cpu_turn(game, finalize_game=finalize_game)


async def handle_hausdepp_gameplay_action(session, action: str, data: dict, *, finalize_game=None, **_kwargs) -> None:
    from .game_snapshot import snapshot
    from .hausdepp_engine import HausdeppRuleError

    if action in {"hausdepp_add_cpu", "hausdepp_remove_cpu", "hausdepp_start_game"}:
        from .hausdepp_waiting import handle_waiting_action

        await handle_waiting_action(session, action, data, finalize_game=finalize_game)
        return

    game = session.game
    command_id = data.get("command_id")
    command_id = command_id if isinstance(command_id, str) and 0 < len(command_id) <= 100 else None

    def acknowledgement(accepted: bool, version: int | None = None) -> dict:
        return ({"hausdepp_command": {"command_id": command_id, "accepted": accepted,
                                      "version": game["_hausdepp"]["version"] if version is None else version}} if command_id else {})

    async with game_lock(game):
        # Check after acquiring the lock: a reconnect may replace this socket
        # while a previously received command waits behind another action.
        if session.is_spectator or not session.player_id or not any(
            player.get("id") == session.player_id and player.get("ws") is session.websocket
            for player in game.get("_players", [])
        ):
            await session.websocket.send_json({"error_code": "hausdepp_invalid_actor", "error": "hausdepp_invalid_actor",
                                               **acknowledgement(False)})
            return
        try:
            if action == "hausdepp_speed_up_cpus" and (not session.auth_identity or not any(
                player.get("id") == session.player_id and player.get("user_id") == session.auth_identity.user_id
                for player in game.get("_participants", [])
            )):
                raise HausdeppRuleError("hausdepp_invalid_actor")
            apply_hausdepp_command(game, session.player_id,
                                   {"action": action.removeprefix("hausdepp_"), "cards": data.get("cards"),
                                    "version": data.get("version"), "round_number": data.get("round_number")})
        except (HausdeppRuleError, TypeError, KeyError) as exc:
            code = getattr(exc, "code", "hausdepp_invalid_command")
            await session.websocket.send_json({"error_code": code, "error": code,
                                               **acknowledgement(False), "scoreboard": snapshot(game, session.player_id)})
            return
        from .game_activity import record_gameplay

        accepted_version = game["_hausdepp"]["version"]
        record_gameplay(session)
        if action == "hausdepp_speed_up_cpus":
            from .hausdepp_cpu_runner import refresh_cpu_tempo

            await refresh_cpu_tempo(game)
        await publish_hausdepp_transition(game, finalize_game=finalize_game)
        if command_id:
            await session.websocket.send_json(acknowledgement(True, accepted_version))
