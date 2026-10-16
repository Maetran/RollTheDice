"""Socket commands and trusted CPU transitions for Hausdepp."""

from __future__ import annotations

import asyncio
import inspect
from datetime import datetime, timezone
from weakref import WeakValueDictionary

from .active_games import save_active_game
from .game_realtime import broadcast
from .game_state import multiplayer_pause_reason, touch

HAUSDEPP_GAMEPLAY_ACTIONS = frozenset({"hausdepp_play", "hausdepp_pickup", "hausdepp_gamble", "hausdepp_afterthrow", "hausdepp_draw"})
_LOCKS: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()


def game_lock(game: dict) -> asyncio.Lock:
    return _LOCKS.setdefault(str(game["_id"]), asyncio.Lock())


def apply_hausdepp_command(game: dict, player_id: str, command: dict, *, trusted_cpu: bool = False) -> None:
    from .hausdepp_engine import HausdeppRuleError, apply_action

    if not game.get("_started") or game.get("_finished") or game.get("_aborted"):
        raise HausdeppRuleError("hausdepp_game_not_running")
    if multiplayer_pause_reason(game):
        raise HausdeppRuleError("hausdepp_game_paused")
    participant = next((player for player in game.get("_participants", []) if player["id"] == player_id), None)
    if not participant or bool(participant.get("is_cpu")) != trusted_cpu:
        raise HausdeppRuleError("hausdepp_invalid_actor")
    version = command.get("version")
    if type(version) is not int:
        raise HausdeppRuleError("hausdepp_version_required")
    game["_hausdepp"] = apply_action(game["_hausdepp"], player_id, command["action"],
                                      cards=command.get("cards"), version=version)
    state = game["_hausdepp"]
    game["_turn"] = {"player_id": state["current_player_id"]} if state.get("current_player_id") else None
    if state["phase"] == "finished":
        game["_finished"] = True
        game["_finished_at"] = datetime.now(timezone.utc).isoformat()
        game["_results"] = {"loser_id": state["loser_id"], "finished_order": list(state["finished_order"])}
    touch(game)


async def publish_hausdepp_transition(game: dict, *, finalize_game=None) -> None:
    from .game_snapshot import snapshot

    save_active_game(game)
    await broadcast(game, {"scoreboard": snapshot(game)})
    if game.get("_finished") and not game.get("_aborted") and finalize_game:
        completion = finalize_game(game)
        if inspect.isawaitable(completion):
            await completion
    if not game.get("_finished"):
        from .hausdepp_cpu_runner import maybe_schedule_cpu_turn

        maybe_schedule_cpu_turn(game, finalize_game=finalize_game)


async def handle_hausdepp_gameplay_action(session, action: str, data: dict, *, finalize_game=None, **_kwargs) -> None:
    from .hausdepp_engine import HausdeppRuleError

    game = session.game
    async with game_lock(game):
        # Check after acquiring the lock: a reconnect may replace this socket
        # while a previously received command waits behind another action.
        if session.is_spectator or not session.player_id or not any(
            player.get("id") == session.player_id and player.get("ws") is session.websocket
            for player in game.get("_players", [])
        ):
            await session.websocket.send_json({"error_code": "hausdepp_invalid_actor", "error": "hausdepp_invalid_actor"})
            return
        try:
            apply_hausdepp_command(game, session.player_id,
                                   {"action": action.removeprefix("hausdepp_"), "cards": data.get("cards"),
                                    "version": data.get("version")})
        except (HausdeppRuleError, TypeError, KeyError) as exc:
            code = getattr(exc, "code", "hausdepp_invalid_command")
            await session.websocket.send_json({"error_code": code, "error": code})
            return
        from .game_activity import record_gameplay

        record_gameplay(session)
        await publish_hausdepp_transition(game, finalize_game=finalize_game)
