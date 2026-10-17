"""Delayed, cancellable CPU seats using only their private game projection."""

from __future__ import annotations

import asyncio
import logging
import math
import os
from collections import OrderedDict
from secrets import SystemRandom

from .game_state import games, multiplayer_pause_reason
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state

logger = logging.getLogger(__name__)
_TASKS: dict[str, asyncio.Task] = {}
_RANDOM = SystemRandom()
_MEMORIES: OrderedDict[str, tuple[int, int, dict]] = OrderedDict()


def _memories_for(game: dict) -> dict:
    from .hausdepp_cpu_strategy import CpuMemory

    game_id = str(game["_id"])
    round_number = (game.get("_hausdepp_tournament") or {}).get("round_number", 1)
    for stale in list(_MEMORIES):
        if stale not in games:
            _MEMORIES.pop(stale, None)
    previous = _MEMORIES.get(game_id)
    if previous is None or previous[:2] != (id(game), round_number):
        memories = {participant["id"]: CpuMemory() for participant in game.get("_participants", [])
                    if participant.get("is_cpu")}
        _MEMORIES[game_id] = (id(game), round_number, memories)
    _MEMORIES.move_to_end(game_id)
    while len(_MEMORIES) > 128:
        _MEMORIES.popitem(last=False)
    return _MEMORIES[game_id][2]


def cpu_action_is_due(game: dict) -> bool:
    return bool(game_type_from_state(game) == HAUSDEPP_GAME_TYPE and game.get("_started")
                and not game.get("_finished") and not game.get("_aborted") and not multiplayer_pause_reason(game)
                and any(player.get("ws") is not None for player in game.get("_players", []))
                and _cpu_decision(game) is not None)


def _cpu_choices(game: dict, memories: dict | None = None) -> list[tuple[str, dict, dict]]:
    from .hausdepp_cpu_strategy import choose_cpu_action
    from .hausdepp_engine import project_state

    state = game.get("_hausdepp")
    if not state:
        return []
    choices = []
    for participant in game.get("_participants", []):
        if participant.get("is_cpu"):
            actor_id = participant["id"]
            projection = project_state(state, actor_id)
            decision = choose_cpu_action(projection, memory=memories.get(actor_id) if memories else None)
            if decision:
                choices.append((actor_id, projection, decision))
    return choices


def _cpu_decision(game: dict) -> tuple[str, dict] | None:
    choices = _cpu_choices(game)
    return (choices[0][0], choices[0][2]) if choices else None


def _delay(projection: dict, command: dict, *, following: bool = False, rng=None) -> float:
    # An explicit override remains deterministic for isolated integration tests
    # and operations. Normal games have no fixed additional-card time window.
    override = os.getenv("ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS")
    if override is not None:
        try:
            value = float(override)
            if math.isfinite(value):
                return max(0.0, min(5.0, value))
        except ValueError:
            pass
    timing_rng = rng if rng is not None else _RANDOM

    def reaction(lower: float, upper: float) -> float:
        # Keep the familiar variation and relative action speeds, uniformly
        # slowed by 12.5%. Explicit integration-test overrides stay unscaled.
        return timing_rng.uniform(lower, upper) * 1.125

    action = command["action"]
    if action == "peek":
        return reaction(0.45, 1.3)
    if action == "draw":
        return reaction(0.15, 0.65)
    if action == "afterthrow":
        return reaction(0.1, 0.85)
    roll = timing_rng.random()
    if following:
        return reaction(0.12, 0.65) if roll < 0.85 else reaction(0.8, 1.35)
    if roll < 0.18:
        return reaction(0.16, 0.37)
    if roll < 0.85:
        return reaction(0.45, 1.2)
    return reaction(1.3, 2.4)


def _decision_window(projection: dict, command: dict) -> tuple:
    action = command["action"]
    return (projection["phase"], action if action in {"peek", "draw", "afterthrow"} else "turn",
            (projection.get("afterthrow") or {}).get("rank") if action == "afterthrow" else None)


def _presentation_delay(state: dict) -> float:
    """Let a public card land and a cleared packet leave before the next CPU move."""
    override = os.getenv("ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS")
    if override is not None:
        try:
            if math.isfinite(float(override)):
                return 0.0
        except ValueError:
            pass
    event = state.get("last_event") or {}
    if event.get("burn_reason"):
        return 1.95
    if event.get("type") in {"play", "afterthrow", "gamble"}:
        return 1.65 if event.get("type") == "gamble" and not event.get("success") else 1.3
    return 0.0


async def _run(game: dict, *, finalize_game=None) -> None:
    from .hausdepp_engine import HausdeppRuleError
    from .hausdepp_gameplay import apply_hausdepp_command, game_lock, publish_hausdepp_transition

    game_id = str(game["_id"])
    memories = _memories_for(game)
    pending: dict[str, tuple[tuple, float]] = {}
    previous_actor = None
    clock = asyncio.get_running_loop().time
    presentation_until = clock() + _presentation_delay(game.get("_hausdepp") or {})
    try:
        while cpu_action_is_due(game) and games.get(game_id) is game:
            choices = _cpu_choices(game, memories)
            eligible = {actor for actor, _, _ in choices}
            pending = {actor: wait for actor, wait in pending.items() if actor in eligible}
            for actor, projection, command in choices:
                window = _decision_window(projection, command)
                if actor not in pending or pending[actor][0] != window:
                    pending[actor] = (window, clock() + _delay(projection, command, following=actor == previous_actor))
            if not pending:
                break
            actor_id = min(pending, key=lambda actor: pending[actor][1])
            window, deadline = pending[actor_id]
            game["_hausdepp_cpu_thinking"] = True
            # Keep the independently sampled CPU deadlines and their ordering.
            # Only computer presentation waits; human commands remain available.
            await asyncio.sleep(max(0.0, max(deadline, presentation_until) - clock()))
            async with game_lock(game):
                if not cpu_action_is_due(game) or games.get(game_id) is not game:
                    break
                # Compute after the presentation delay: a human afterthrow may
                # have changed the table. Unrelated draws never restart a wait.
                decision = next((choice for choice in _cpu_choices(game, memories) if choice[0] == actor_id), None)
                if decision is None:
                    pending.pop(actor_id, None)
                    continue
                _, projection, command = decision
                if _decision_window(projection, command) != window:
                    pending.pop(actor_id, None)
                    continue
                apply_hausdepp_command(game, actor_id, command, trusted_cpu=True)
                presentation_until = clock() + _presentation_delay(game["_hausdepp"])
                memories[actor_id].remember(projection, command)
                pending.pop(actor_id, None)
                previous_actor = actor_id
                game["_hausdepp_cpu_thinking"] = False
                await publish_hausdepp_transition(game, finalize_game=finalize_game)
    except asyncio.CancelledError:
        raise
    except HausdeppRuleError:
        logger.exception("Hausdepp CPU could not apply its legal decision for %s", game_id)
    finally:
        game["_hausdepp_cpu_thinking"] = False
        if game.get("_finished") or game.get("_aborted"):
            _MEMORIES.pop(game_id, None)
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
    _MEMORIES.pop(str(game_id), None)
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
    _MEMORIES.clear()


async def resume_cpu_games(active_games: dict, *, finalize_game=None) -> None:
    for game in active_games.values():
        if game_type_from_state(game) == HAUSDEPP_GAME_TYPE:
            maybe_schedule_cpu_turn(game, finalize_game=finalize_game)
