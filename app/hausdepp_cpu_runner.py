"""Delayed, cancellable CPU seats using only their private game projection."""

from __future__ import annotations

import asyncio
import logging
import os

from .game_state import games, multiplayer_pause_reason
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state

logger = logging.getLogger(__name__)
_TASKS: dict[str, asyncio.Task] = {}


def cpu_action_is_due(game: dict) -> bool:
    return bool(game_type_from_state(game) == HAUSDEPP_GAME_TYPE and game.get("_started")
                and not game.get("_finished") and not game.get("_aborted") and not multiplayer_pause_reason(game)
                and any(player.get("ws") is not None for player in game.get("_players", []))
                and _cpu_decision(game) is not None)


def _cpu_decision(game: dict) -> tuple[str, dict] | None:
    from .hausdepp_cpu_strategy import choose_cpu_action
    from .hausdepp_engine import project_state

    state = game.get("_hausdepp")
    if not state:
        return None
    for participant in game.get("_participants", []):
        if participant.get("is_cpu"):
            actor_id = participant["id"]
            decision = choose_cpu_action(project_state(state, actor_id))
            if decision:
                return actor_id, decision
    return None


def _delay() -> float:
    try:
        return max(0.0, min(5.0, float(os.getenv("ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS", "0.8"))))
    except ValueError:
        return 0.8


async def _run(game: dict, *, finalize_game=None) -> None:
    from .hausdepp_engine import HausdeppRuleError
    from .hausdepp_gameplay import apply_hausdepp_command, game_lock, publish_hausdepp_transition

    game_id = str(game["_id"])
    try:
        while cpu_action_is_due(game) and games.get(game_id) is game:
            game["_hausdepp_cpu_thinking"] = True
            await asyncio.sleep(_delay())
            async with game_lock(game):
                if not cpu_action_is_due(game) or games.get(game_id) is not game:
                    break
                # Compute after the presentation delay: a human afterthrow may
                # have changed the table. Unrelated draws never restart a wait.
                decision = _cpu_decision(game)
                if decision is None:
                    break
                actor_id, command = decision
                apply_hausdepp_command(game, actor_id, command, trusted_cpu=True)
                game["_hausdepp_cpu_thinking"] = False
                await publish_hausdepp_transition(game, finalize_game=finalize_game)
    except asyncio.CancelledError:
        raise
    except HausdeppRuleError:
        logger.exception("Hausdepp CPU could not apply its legal decision for %s", game_id)
    finally:
        game["_hausdepp_cpu_thinking"] = False
        if _TASKS.get(game_id) is asyncio.current_task():
            _TASKS.pop(game_id, None)


def maybe_schedule_cpu_turn(game: dict, *, finalize_game=None) -> None:
    game_id = str(game["_id"])
    existing = _TASKS.get(game_id)
    if existing and not existing.done():
        return
    if cpu_action_is_due(game):
        _TASKS[game_id] = asyncio.create_task(_run(game, finalize_game=finalize_game), name=f"hausdepp-cpu:{game_id}")


async def stop_cpu_runner(game_id: str) -> None:
    task = _TASKS.pop(str(game_id), None)
    if task and task is not asyncio.current_task():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def stop_cpu_runners() -> None:
    for game_id in list(_TASKS):
        await stop_cpu_runner(game_id)


async def resume_cpu_games(active_games: dict, *, finalize_game=None) -> None:
    for game in active_games.values():
        if game_type_from_state(game) == HAUSDEPP_GAME_TYPE:
            maybe_schedule_cpu_turn(game, finalize_game=finalize_game)
