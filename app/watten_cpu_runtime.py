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
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import dataclass, replace
from functools import partial
from urllib.parse import urlsplit
from weakref import WeakKeyDictionary, ref

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from .database import database_schema_ready, session_scope
from .models import ActiveGame, CompletedGame, GameParticipant, User
from .moderation import active_bans
from .product_hosts import site_origin
from .watten_access import _local, watten_founder_account_id, watten_founder_deployment_enabled
from .watten_cpu import CpuBudget, CpuProposal, CpuWait, decide
from .watten_cpu_memory import CpuMemory, new_memory, observe
from .watten_cpu_skill import CpuSkill, skill_for_table
from .watten_engine import EngineActor, EngineCommand
from .watten_readiness import watten_public_beta_enabled
from .watten_views import cpu_view

logger = logging.getLogger(__name__)
# Policy readiness is a pure deployment capability, never a room permission.
CPU_POLICY_READY = True
THINK_MIN_SECONDS = 0.35
THINK_MAX_SECONDS = 1.25
TRICK_REVEAL_SECONDS = 3.6
_RANDOM = secrets.SystemRandom()
_POLICY_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="watten-cpu-policy")
_POLICY_SLOTS: WeakKeyDictionary = WeakKeyDictionary()


async def _decide_snapshot(view, memory, *, seed, events, budget, skill):
    """Only pure, detached policy inputs enter the two-worker computation pool.

    Cancellation retires the caller immediately, but its slot stays occupied
    until that calculation actually finishes. This also bounds queued work.
    Each ASGI loop owns its semaphore; isolated test loops cannot inherit one.
    """
    loop = asyncio.get_running_loop()
    reference = _POLICY_SLOTS.get(loop)
    slots = reference() if reference is not None else None
    if slots is None:
        slots = asyncio.Semaphore(2)
        _POLICY_SLOTS[loop] = ref(slots)
    await slots.acquire()
    try:
        pending = loop.run_in_executor(_POLICY_EXECUTOR, partial(
            decide, deepcopy(view), deepcopy(memory), seed=seed, events=events, budget=budget, skill=skill))
    except BaseException:
        slots.release()
        raise

    def completed(result):
        slots.release()
        if not result.cancelled():
            result.exception()  # A retired caller must not leave an unobserved failure.

    pending.add_done_callback(completed)
    return await asyncio.shield(pending)


def _local_preview_enabled() -> bool:
    return bool(os.getenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0") == "1"
                and _local((urlsplit(site_origin()).hostname or "").casefold()))


def cpu_autoplay_enabled() -> bool:
    """Pure capability for existing DTOs; actual execution needs authority."""
    return bool(CPU_POLICY_READY and (watten_public_beta_enabled() or _local_preview_enabled()
                                      or watten_founder_deployment_enabled()))


@dataclass(frozen=True, slots=True, repr=False)
class _Authority:
    source: str
    local: bool
    founder_id: int | None
    skill: CpuSkill
    public: bool = False


def _table_skill(db, runtime) -> CpuSkill:
    """Only aggregate finished Watten counts of the table's actual humans.

    Use the median configured difficulty in a mixed table. Counts come from
    existing durable results, so progression survives restarts without any
    new history store, private hand access, or per-opponent profile.
    """
    accounts = tuple(sorted({member.account_id for member in runtime.room.members if member.seat is not None}))
    if not accounts:
        return skill_for_table(())
    counts = dict(db.execute(select(GameParticipant.user_id, func.count(func.distinct(CompletedGame.id)))
        .join(CompletedGame, CompletedGame.id == GameParticipant.game_id)
        .where(GameParticipant.user_id.in_(accounts), CompletedGame.game_type == "watten",
               CompletedGame.imported_from_legacy.is_(False))
        .group_by(GameParticipant.user_id)).all())
    return skill_for_table(counts.get(account, 0) for account in accounts)


def _founder_room(runtime, founder_id: int) -> bool:
    room = runtime.room
    if (len(room.members) != 1 or room.members[0].account_id != founder_id
            or room.members[0].participant_id != room.host_participant_id
            or any(item.account_id != founder_id for item in room.reservations)):
        return False
    return runtime.engine is None or all(
        binding.account_id is None or binding.account_id == founder_id for binding in runtime.engine.recipe.bindings)


def _founder_permission(db, runtime, *, lock=False) -> int | None:
    if not watten_founder_deployment_enabled():
        return None
    founder = watten_founder_account_id(db, lock=lock)
    if founder is None or not _founder_room(runtime, founder) or active_bans(db, founder, scope="play"):
        return None
    return founder


def _public_permission(db, runtime, *, lock=False) -> bool:
    accounts = {binding.account_id for binding in runtime.engine.recipe.bindings
                if binding.account_id is not None} if runtime.engine is not None else {
                    member.account_id for member in runtime.room.members if member.seat is not None}
    if not accounts:
        return False
    statement = select(User).where(User.id.in_(accounts))
    if lock:
        statement = statement.with_for_update()
    users = db.scalars(statement).all()
    return ({user.id for user in users if user.is_active} == accounts
            and not any(active_bans(db, account, scope="play") for account in sorted(accounts)))


def _authority(game: dict) -> _Authority | None:
    """Read actual source before scheduling/deciding; no projection performs I/O."""
    from .watten_runtime import restore_watten_json, serialize_watten_game

    if not cpu_autoplay_enabled() or not database_schema_ready():
        return None
    try:
        with session_scope() as db:
            raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
            if raw is None:
                return None
            stored = restore_watten_json(raw, refresh_titles=False)
            if (stored.get("_aborted") or stored["_id"] != game["_id"]
                    or serialize_watten_game(stored) != serialize_watten_game(game)):
                return None
            local = _local_preview_enabled()
            public = watten_public_beta_enabled()
            founder = None if local or public else _founder_permission(db, stored["_watten"])
            if public and not _public_permission(db, stored["_watten"]):
                return None
            if not public and not local and founder is None:
                return None
            return _Authority(raw, local, founder, _table_skill(db, stored["_watten"]), public)
    except (SQLAlchemyError, ValueError, TypeError, KeyError):
        logger.warning("Watten CPU cannot authorize stored table %s", game["_id"])
        return None


def _commit_guard(authority: _Authority):
    def guard(db, checkpoint):
        if (not cpu_autoplay_enabled() or _local_preview_enabled() != authority.local
                or watten_public_beta_enabled() != authority.public):
            raise ValueError("watten_cpu_access_required")
        # persist_watten_game already owns the actual source lock and checked
        # authority.source. Account/ownership locks therefore follow source.
        if authority.public and not _public_permission(db, checkpoint["_watten"], lock=True):
            raise ValueError("watten_cpu_access_required")
        if (not authority.public and not authority.local
                and _founder_permission(db, checkpoint["_watten"], lock=True) != authority.founder_id):
            raise ValueError("watten_cpu_access_required")

    return guard


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
_TRICK_REVEALS: dict[str, tuple[dict, str, int, float]] = {}
_STOPPING = False


def _may_decide(view: dict) -> bool:
    actions = set(view["actions"])
    return bool(actions & {"announce_strike", "announce_colour", "show_ready", "inspection_ack", "play_card", "bid",
                           "respond_hold", "respond_go", "respond_counter", "retourschneider", "preplay_accept", "request_bloedeln"}
                or (view["phase"] == "bid_response" and "partner_feedback" in actions))


def _cpu_partner_feedback_pending(runtime, view: dict, cpu_ids: set[str]) -> bool:
    """Let a blind CPU knower use its CPU partner's one permitted signal first."""
    if (not view["profile"]["blind"] or view["phase"] != "bid_response"
            or "respond_hold" not in view["actions"]):
        return False
    own = view["seats"][view["viewer"]["seat"]]
    partner = next((seat["player_id"] for seat in view["seats"]
                    if seat["party"] == own["party"] and seat["player_id"] != own["player_id"]), None)
    return partner in cpu_ids and "partner_feedback" in _view(runtime, partner)["actions"]


def watch_game(game: dict) -> None:
    """Called on the ASGI loop under its table lock, or during startup recovery."""
    from .game_state import games

    if _STOPPING or games.get(game["_id"]) is not game:
        return
    from .watten_round_runtime import watch_game as watch_round

    watch_round(game)
    runtime = game["_watten"]
    now = asyncio.get_running_loop().time()
    engine = runtime.engine
    completed = len(engine.play.tricks) if engine is not None and engine.play is not None else 0
    if not game.get("_aborted") and completed and engine.phase != "match_complete":
        previous_reveal = _TRICK_REVEALS.get(game["_id"])
        if (previous_reveal is None or previous_reveal[0] is not game
                or previous_reveal[1:3] != (engine.deal_id, completed)):
            _TRICK_REVEALS[game["_id"]] = (game, engine.deal_id, completed, now + TRICK_REVEAL_SECONDS)
    else:
        _TRICK_REVEALS.pop(game["_id"], None)
    active = (not game.get("_aborted") and cpu_autoplay_enabled() and runtime.engine is not None and not runtime.absent
              and runtime.engine.phase != "match_complete")
    if active:
        active = _authority(game) is not None
    wanted = set()
    if active:
        cpu_ids = {cpu.participant_id for cpu in runtime.room.cpus}
        for cpu in runtime.room.cpus:
            view = _view(runtime, cpu.participant_id)
            if not _may_decide(view) or _cpu_partner_feedback_pending(runtime, view, cpu_ids):
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
            deadline = now + _RANDOM.uniform(THINK_MIN_SECONDS, THINK_MAX_SECONDS)
            reveal = _TRICK_REVEALS.get(game["_id"])
            if reveal is not None and view["phase"] == "play" and not view["current_trick"]["cards"]:
                deadline = max(deadline, reveal[3])
            job = _Job(game, context, deadline,
                       secrets.randbits(64))
            _JOBS[key] = job
            job.task = asyncio.create_task(_run(game, cpu.participant_id, job), name=f"watten-cpu-{game['_id']}-{cpu.participant_id}")
    for key, job in list(_JOBS.items()):
        if key[0] == game["_id"] and key not in wanted:
            _JOBS.pop(key, None)
            if job.task is not None and job.task is not asyncio.current_task():
                job.task.cancel()
    for key, (owner, _context_value) in list(_BLOCKED.items()):
        if key[0] == game["_id"] and (owner is not game or key not in wanted):
            _BLOCKED.pop(key)


async def _run(game: dict, player: str, job: _Job) -> None:
    from .game_state import games
    from .watten_runtime import _apply_engine_command, game_lock, persist_watten_game
    from .watten_websocket import broadcast_watten, expire_watten_game

    key = game["_id"], player
    try:
        await asyncio.sleep(max(0, job.deadline - asyncio.get_running_loop().time()))
        async with game_lock(game):
            runtime = game["_watten"]
            if (games.get(game["_id"]) is not game or _JOBS.get(key) is not job or not cpu_autoplay_enabled()
                    or runtime.absent or runtime.engine is None
                    or not any(cpu.participant_id == player for cpu in runtime.room.cpus)):
                return
            if await expire_watten_game(game):
                return
            authority = _authority(game)
            if authority is None:
                return
            view = _view(runtime, player)
            if _context(runtime, view) != job.context:
                return
            memory = next(item for item in runtime.cpu_memories if item.player_id == player)
            events = _events(runtime, player)
            turn = await _decide_snapshot(view, memory, seed=job.seed, events=events,
                                          budget=CpuBudget(authority.skill.samples), skill=authority.skill)
            if (games.get(game["_id"]) is not game or _JOBS.get(key) is not job
                    or game["_watten"] is not runtime):
                return
            # A suspended event loop or queued policy calculation can cross
            # the deadline while holding this table lock. Retire the original
            # source before a public CPU transition could renew its clock.
            if await expire_watten_game(game):
                return
            # Account moderation and rollout capabilities may change while the
            # pure policy is awaiting a thread, despite our per-table lock.
            current = _authority(game)
            if (games.get(game["_id"]) is not game or _JOBS.get(key) is not job
                    or game["_watten"] is not runtime or current is None
                    or (current.source, current.local, current.public, current.founder_id)
                    != (authority.source, authority.local, authority.public, authority.founder_id)):
                return
            authority = current
            if (not isinstance(turn.memory, CpuMemory) or turn.memory.player_id != player
                    or turn.memory != observe(memory, view, events)):
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
                persist_watten_game(candidate, expected_source=authority.source, commit_guard=_commit_guard(authority))
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
    global _STOPPING
    from .watten_round_runtime import stop_round_runners

    _STOPPING = True
    try:
        jobs = list(_JOBS.values())
        _JOBS.clear()
        _BLOCKED.clear()
        _TRICK_REVEALS.clear()
        tasks = [job.task for job in jobs if job.task is not None]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await stop_round_runners()
    finally:
        _STOPPING = False
