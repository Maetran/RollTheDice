"""Local native CPU coordination; private state never enters the policy API.

One bounded deadline belongs to one CPU's allowed decision context. Timers are
process-local; only explicitly observed seat memory joins the game transaction.
An unexpected policy/storage rejection blocks that context instead of retrying
in a loop. A new relevant context or a clean process restart can try again.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
from dataclasses import dataclass, replace
from urllib.parse import urlsplit

from .product_hosts import site_origin
from .watten_access import _local
from .watten_cpu import CpuBudget, CpuProposal, CpuWait, decide
from .watten_cpu_memory import CpuMemory, new_memory, observe
from .watten_engine import EngineActor, EngineCommand
from .watten_views import cpu_view

logger = logging.getLogger(__name__)
# Root activates this only after the separately owned policy passes review.
CPU_POLICY_READY = False
THINK_MIN_SECONDS = 0.35
THINK_MAX_SECONDS = 1.25
_RANDOM = secrets.SystemRandom()


def cpu_autoplay_enabled() -> bool:
    return bool(CPU_POLICY_READY and os.getenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0") == "1"
                and _local((urlsplit(site_origin()).hostname or "").casefold()))


def _view(runtime, player: str) -> dict:
    # This is the only selector boundary. The policy receives the returned
    # personal DTO, never this runtime/engine, another seat or the real deck.
    return cpu_view(runtime.engine, player_id=player)


def _events(runtime, player: str) -> tuple:
    return tuple((item.deal_id, item.kind, item.seat, item.value)
                 for item in runtime.deliveries if item.participant_id == player)


def observe_cpu_memories(runtime):
    existing = {item.player_id: item for item in runtime.cpu_memories}
    memories = []
    for cpu in runtime.room.cpus:
        memory = existing.get(cpu.participant_id, new_memory(cpu.participant_id))
        if runtime.engine is not None:
            memory = observe(memory, _view(runtime, cpu.participant_id), _events(runtime, cpu.participant_id))
        memories.append(memory)
    # Public/open call first delivery to a CPU is acknowledged by the same
    # transaction that stores its observed memory. Human receipts are untouched.
    cpu_ids = {item.player_id for item in memories}
    deliveries = tuple(item for item in runtime.deliveries if item.participant_id not in cpu_ids)
    return replace(runtime, cpu_memories=tuple(memories), deliveries=deliveries)


def validate_stored_memories(runtime, *, allow_empty_waiting: bool = False) -> None:
    expected = {item.participant_id for item in runtime.room.cpus}
    if allow_empty_waiting and runtime.engine is None and not runtime.cpu_memories:
        return
    if {item.player_id for item in runtime.cpu_memories} != expected:
        raise ValueError("watten_invalid_cpu_memory")
    for memory in runtime.cpu_memories:
        if runtime.engine is None:
            if memory != new_memory(memory.player_id):
                raise ValueError("watten_invalid_cpu_memory")
        else:
            seat = runtime.engine.recipe.seats.index(memory.player_id)
            if (memory.deal_id != runtime.engine.deal_id or memory.seat != seat
                    or memory.profile != runtime.engine.recipe.profile
                    or memory.opportunity != runtime.engine.opportunity
                    or observe(memory, _view(runtime, memory.player_id)) != memory):
                raise ValueError("watten_invalid_cpu_memory")


def _context(runtime, view: dict) -> tuple:
    # Neither other actors' private ACKs nor unrelated feedback alter this key.
    feedback = tuple((item["sender"], item["recipient"], item["value"], item["sequence"]) for item in view["feedback"])
    return (runtime.lifecycle_revision, view["deal_id"], view["phase"], view["opportunity"],
            view["feedback_opportunity"], feedback)


@dataclass(slots=True, repr=False)
class _Job:
    owner: dict
    context: tuple
    deadline: float
    seed: int
    task: asyncio.Task | None = None


_JOBS: dict[tuple[str, str], _Job] = {}
_BLOCKED: dict[tuple[str, str], tuple[dict, tuple]] = {}


def _may_decide(view: dict) -> bool:
    actions = set(view["actions"])
    return bool(actions & {"announce_strike", "announce_colour", "show_ready", "inspection_ack", "play_card",
                           "respond_hold", "respond_go", "respond_counter"}
                or (view["phase"] == "bid_response" and "partner_feedback" in actions))


def watch_game(game: dict) -> None:
    """Called on the ASGI loop under its table lock, or during startup recovery."""
    from .game_state import games

    if games.get(game["_id"]) is not game:
        return
    runtime = game["_watten"]
    active = (cpu_autoplay_enabled() and runtime.engine is not None and not runtime.absent
              and runtime.engine.phase not in {"deal_complete", "match_complete"})
    wanted = set()
    if active:
        for cpu in runtime.room.cpus:
            view = _view(runtime, cpu.participant_id)
            if not _may_decide(view):
                continue
            key = game["_id"], cpu.participant_id
            wanted.add(key)
            context = _context(runtime, view)
            previous = _JOBS.get(key)
            if previous is not None and previous.owner is game and previous.context == context:
                continue
            if previous is not None and previous.task is not None:
                previous.task.cancel()
            blocked = _BLOCKED.get(key)
            if blocked is not None and blocked[0] is game and blocked[1] == context:
                continue
            _BLOCKED.pop(key, None)
            job = _Job(game, context, asyncio.get_running_loop().time() + _RANDOM.uniform(THINK_MIN_SECONDS, THINK_MAX_SECONDS),
                       secrets.randbits(64))
            _JOBS[key] = job
            job.task = asyncio.create_task(_run(game, cpu.participant_id, job), name=f"watten-cpu-{game['_id']}-{cpu.participant_id}")
    for key, job in list(_JOBS.items()):
        if key[0] == game["_id"] and key not in wanted:
            _JOBS.pop(key, None)
            if job.task is not None:
                job.task.cancel()
    for key, (owner, _context_value) in list(_BLOCKED.items()):
        if key[0] == game["_id"] and (owner is not game or key not in wanted):
            _BLOCKED.pop(key)


async def _run(game: dict, player: str, job: _Job) -> None:
    from .game_state import games
    from .watten_runtime import _apply_engine_command, game_lock, persist_watten_game
    from .watten_websocket import broadcast_watten

    key = game["_id"], player
    try:
        await asyncio.sleep(max(0, job.deadline - asyncio.get_running_loop().time()))
        async with game_lock(game):
            runtime = game["_watten"]
            if (games.get(game["_id"]) is not game or _JOBS.get(key) is not job or not cpu_autoplay_enabled()
                    or runtime.absent or runtime.engine is None
                    or not any(cpu.participant_id == player for cpu in runtime.room.cpus)):
                return
            view = _view(runtime, player)
            if _context(runtime, view) != job.context:
                return
            memory = next(item for item in runtime.cpu_memories if item.player_id == player)
            turn = decide(view, memory, seed=job.seed, events=_events(runtime, player), budget=CpuBudget())
            if (not isinstance(turn.memory, CpuMemory) or turn.memory.player_id != player
                    or turn.memory != observe(memory, view, _events(runtime, player))):
                raise ValueError("watten_cpu_invalid_memory")
            if isinstance(turn.decision, CpuWait):
                _BLOCKED[key] = (game, job.context)
                return
            proposal = turn.decision
            if (not isinstance(proposal, CpuProposal) or proposal.player_id != player
                    or (proposal.deal_id, proposal.phase, proposal.opportunity) != (view["deal_id"], view["phase"], view["opportunity"])):
                raise ValueError("watten_cpu_stale_proposal")
            # Only a real CPU binding authorizes account=None. No human
            # identity, permission callback or socket is manufactured here.
            binding = runtime.engine.recipe.bindings[runtime.engine.recipe.seats.index(player)]
            if binding.account_id is not None:
                raise ValueError("watten_cpu_actor_not_bound")
            prepared = dict(game)
            prepared["_watten"] = replace(runtime, cpu_memories=tuple(turn.memory if item.player_id == player else item
                                                                     for item in runtime.cpu_memories))
            candidate, _ack, replayed, private = _apply_engine_command(prepared, EngineActor(player, None),
                                                                       EngineCommand(**proposal.command_fields()))
            if not replayed:
                previous = {item.delivery_id for item in runtime.deliveries}
                calls = {(item.kind, item.seat, item.value) for item in candidate["_watten"].deliveries
                         if item.delivery_id not in previous}
                persist_watten_game(candidate)
                game.clear()
                game.update(candidate)
                events = tuple({"kind": kind, "seat": seat, "value": value} for kind, seat, value in sorted(calls))
                await broadcast_watten(game, participant_ids=private, public_call_events=events)
    except asyncio.CancelledError:
        raise
    except Exception:
        _BLOCKED[key] = (game, job.context)
        logger.exception("Watten CPU waits after a rejected decision/checkpoint for table %s seat %s", game["_id"], player)
    finally:
        if _JOBS.get(key) is job:
            _JOBS.pop(key, None)
            # Schedule the current authoritative state, preserving other seats'
            # deadlines. A failed/waiting context remains explicitly blocked.
            if games.get(game["_id"]) is game:
                watch_game(game)


async def resume_cpu_games(games: dict) -> None:
    from .watten_runtime import game_lock

    for game in list(games.values()):
        if game.get("_game_type") == "watten":
            async with game_lock(game):
                watch_game(game)


async def stop_cpu_runners() -> None:
    jobs = list(_JOBS.values())
    _JOBS.clear()
    _BLOCKED.clear()
    tasks = [job.task for job in jobs if job.task is not None]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
