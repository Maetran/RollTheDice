"""Delayed, cancellable CPU seats using only their private game projection."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import os
import time
from collections import OrderedDict
from random import Random
from secrets import SystemRandom

from .game_state import games, multiplayer_pause_reason
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state
from .hausdepp_cpu_tempo import fast_cpu_tempo, paced_cpu_delay

logger = logging.getLogger(__name__)
_TASKS: dict[str, asyncio.Task] = {}
_SLEEPING: dict[asyncio.Task, int] = {}
_WAKE_REQUESTS: set[asyncio.Task] = set()
_RANDOM = SystemRandom()
_MEMORIES: OrderedDict[str, tuple[int, int, dict]] = OrderedDict()


def _now() -> float:
    return time.monotonic()


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
                and (any(player.get("ws") is not None for player in game.get("_players", []))
                     or _unattended_cpu_remainder(game))
                and _cpu_decision(game) is not None)



def _unattended_cpu_remainder(game: dict) -> bool:
    """Complete an already dealt round after the final person deliberately left."""
    state = game.get("_hausdepp") or {}
    active = [player for player in state.get("players", []) if not player.get("finished")
              and player.get("id") not in state.get("withdrawn_ids", [])]
    return bool(game.get("_hausdepp_departures") and active
                and all(player.get("is_cpu") for player in active))


def _personality(game: dict, actor_id: str) -> float:
    """A stable per-table nudge: some computers play a little better than others."""
    digest = hashlib.sha256(f"{game.get('_id')}:{actor_id}".encode()).digest()
    return (int.from_bytes(digest[:2], "big") / 0xFFFF - 0.5) * 0.16


def _cpu_choices(game: dict, memories: dict | None = None) -> list[tuple[str, dict, dict]]:
    from .hausdepp_cpu_strategy import choose_cpu_action
    from .hausdepp_engine import project_state
    from .hausdepp_experience import table_skill

    state = game.get("_hausdepp")
    if not state:
        return []
    choices = []
    base_skill = table_skill(game)
    for participant in game.get("_participants", []):
        if participant.get("is_cpu"):
            actor_id = participant["id"]
            projection = project_state(state, actor_id)
            skill = max(0.45, min(1.0, base_skill + _personality(game, actor_id)))
            # Seeded by table, seat and state: repeated evaluations while the
            # computer waits keep the same judgement instead of flip-flopping.
            rng = Random(f"{game.get('_id')}:{actor_id}:{state.get('version')}")  # nosec B311 - game judgement, not security
            decision = choose_cpu_action(projection, memory=memories.get(actor_id) if memories else None,
                                         skill=skill, rng=rng)
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
    if event.get("type") == "round_started" and (state.get("peek_information") or {}).get("success"):
        # Everyone first watches the won cut cards reach their new owner.
        return 3.0
    if event.get("burn_reason"):
        return 1.95
    if event.get("type") in {"play", "afterthrow", "gamble"}:
        return 1.65 if event.get("type") == "gamble" and not event.get("success") else 1.3
    return 0.0


def note_human_presentation(game: dict) -> None:
    """Give a human public card the same landing time as a computer card.

    A runner that is already waiting (for example on a computer refill) must
    not let the next computer act while the human card is still in flight;
    that would close the human afterthrow before it can be read.
    """
    delay = _presentation_delay(game.get("_hausdepp") or {})
    if delay:
        until = _now() + delay
        game["_hausdepp_presentation_until"] = max(until, game.get("_hausdepp_presentation_until") or 0.0)


async def _run(game: dict, *, finalize_game=None) -> None:
    from .hausdepp_engine import HausdeppRuleError
    from .hausdepp_gameplay import apply_hausdepp_command, game_lock, publish_hausdepp_transition

    game_id = str(game["_id"])
    memories = _memories_for(game)
    # Unscaled deadlines arbitrate concurrent throws. The separately paced
    # deadline controls only waiting: a readability floor must never turn a
    # faster reaction into a participant-order tie.
    pending: dict[str, tuple[tuple, float, float]] = {}
    previous_actor = None
    clock = _now
    presentation_until = clock() + paced_cpu_delay(game, _presentation_delay(game.get("_hausdepp") or {}))
    fast = fast_cpu_tempo(game)

    def update_tempo() -> None:
        nonlocal pending, presentation_until, fast
        if not fast and fast_cpu_tempo(game):
            now = clock()
            pending = {actor: (window, sampled_deadline, now + paced_cpu_delay(game, max(0.0, deadline - now)))
                       for actor, (window, sampled_deadline, deadline) in pending.items()}
            presentation_until = now + paced_cpu_delay(game, max(0.0, presentation_until - now))
            fast = True

    def human_landing() -> float:
        return game.get("_hausdepp_presentation_until") or 0.0

    try:
        while cpu_action_is_due(game) and games.get(game_id) is game:
            update_tempo()
            choices = _cpu_choices(game, memories)
            eligible = {actor for actor, _, _ in choices}
            pending = {actor: wait for actor, wait in pending.items() if actor in eligible}
            sampled_at = clock()
            for actor, projection, command in choices:
                window = _decision_window(projection, command)
                if actor not in pending or pending[actor][0] != window:
                    delay = _delay(projection, command, following=actor == previous_actor)
                    pending[actor] = (window, sampled_at + delay, sampled_at + paced_cpu_delay(game, delay))
            if not pending:
                break
            actor_id = min(pending, key=lambda actor: pending[actor][1])

            def ready_at(actor: str) -> float:
                window, _, deadline = pending[actor]
                if window[1] == "draw":
                    return deadline
                return max(deadline, presentation_until, human_landing())

            # Preserve the sampled race between public throws. A refill can
            # nevertheless arrive while that winner's public card must wait.
            for actor, (window, _, _) in pending.items():
                if window[1] == "draw" and ready_at(actor) <= max(clock(), ready_at(actor_id)):
                    actor_id = actor
            window = pending[actor_id][0]
            game["_hausdepp_cpu_thinking"] = True
            # Keep the independently sampled CPU deadlines and their ordering.
            # Public cards land before the next computer move; a computer refill
            # closes no afterthrow and need not wait. Human commands stay open.
            task = asyncio.current_task()
            _SLEEPING[task] = game["_hausdepp"]["version"]
            try:
                await asyncio.sleep(max(0.0, ready_at(actor_id) - clock()))
            except asyncio.CancelledError:
                if task not in _WAKE_REQUESTS or task.cancelling() != 1:
                    raise
                task.uncancel()
                # Continue this same runner with its sampled reactions, pending
                # windows and strategy memory intact. Recheck newly due refills.
                continue
            finally:
                _SLEEPING.pop(task, None)
                _WAKE_REQUESTS.discard(task)
            async with game_lock(game):
                if not cpu_action_is_due(game) or games.get(game_id) is not game:
                    break
                if window[1] != "draw" and human_landing() > clock():
                    # A human card was played during this wait; let it land first.
                    continue
                update_tempo()
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
                # A private refill must not erase the landing time of the last
                # public card and let the next throw close its afterthrow early.
                if command["action"] != "draw":
                    presentation_until = max(presentation_until,
                                             clock() + paced_cpu_delay(game, _presentation_delay(game["_hausdepp"])))
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
        _SLEEPING.pop(asyncio.current_task(), None)
        _WAKE_REQUESTS.discard(asyncio.current_task())
        game["_hausdepp_cpu_thinking"] = False
        if game.get("_finished") or game.get("_aborted"):
            _MEMORIES.pop(game_id, None)
        if _TASKS.get(game_id) is asyncio.current_task():
            _TASKS.pop(game_id, None)


def maybe_schedule_cpu_turn(game: dict, *, finalize_game=None) -> None:
    game_id = str(game["_id"])
    existing = _TASKS.get(game_id)
    if existing and not existing.done():
        # Scheduling the same state again is idempotent. Only an accepted
        # transition can expose a new refill or change the public-card race.
        if existing is not asyncio.current_task() and _SLEEPING.get(existing) != game["_hausdepp"]["version"]:
            _wake_sleeping_runner(existing)
        return
    if cpu_action_is_due(game):
        _TASKS[game_id] = asyncio.create_task(_run(game, finalize_game=finalize_game), name=f"hausdepp-cpu:{game_id}")


async def refresh_cpu_tempo(game: dict) -> None:
    """Wake only a runner's sleep; never replace or resample its reactions."""
    _wake_sleeping_runner(_TASKS.get(str(game["_id"])))


def _wake_sleeping_runner(task: asyncio.Task | None) -> None:
    if task in _SLEEPING and task not in _WAKE_REQUESTS and not task.cancelling():
        _WAKE_REQUESTS.add(task)
        task.cancel()


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
