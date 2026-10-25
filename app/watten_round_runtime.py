"""Server-owned review window and automatic continuation between Watten deals.

One persisted per-deal timestamp anchors the window durably: reloads, later
public/private decisions and a process restart cannot start it over. No client
clock or browser timer advances the engine, and no synthetic host is needed.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from dataclasses import dataclass, replace
from datetime import datetime, timedelta
from math import ceil

from .security import utcnow
from .watten_engine import retourschneider_offer

logger = logging.getLogger(__name__)
COLLECT_SECONDS = 3.6
REVIEW_SECONDS = 3.0


def review_deadlines(game: dict):
    engine = game["_watten"].engine
    if engine is None or engine.phase not in {"deal_complete", "match_complete"}:
        return None
    started = datetime.fromisoformat(game["_watten"].round_review_started_at or game["_updated_at"])
    collect = started + timedelta(seconds=COLLECT_SECONDS if engine.bid_state.result.reason == "tricks" else 0)
    return collect, collect + timedelta(seconds=REVIEW_SECONDS)


def _blocked(runtime) -> str | None:
    if runtime.absent:
        return "paused"
    if retourschneider_offer(runtime.engine) is not None:
        return "retourschneider"
    return None


def review_projection(game: dict) -> dict | None:
    deadlines = review_deadlines(game)
    if deadlines is None:
        return None
    runtime = game["_watten"]
    now = utcnow()
    return {"deal_id": runtime.engine.deal_id, "started_at": runtime.round_review_started_at or game["_updated_at"],
            "collect_remaining_ms": max(0, ceil((deadlines[0] - now).total_seconds() * 1000)),
            "review_remaining_ms": max(0, ceil((deadlines[1] - now).total_seconds() * 1000)),
            "auto_advance": runtime.engine.phase == "deal_complete" and _blocked(runtime) is None,
            "blocked": _blocked(runtime)}


@dataclass(slots=True)
class _Job:
    owner: dict
    context: tuple
    task: asyncio.Task | None = None


_JOBS: dict[str, _Job] = {}


def _context(game: dict) -> tuple:
    runtime = game["_watten"]
    return runtime.engine.deal_id, runtime.engine.opportunity, runtime.lifecycle_revision, runtime.round_review_started_at


def advance_reviewed_deal(game: dict) -> dict:
    """Pure trusted transition; the caller locks, authorizes and commits it."""
    from .watten_engine import next_deal
    from .watten_runtime import _sync, copy_game, cryptographic_deal

    runtime = game["_watten"]
    deadlines = review_deadlines(game)
    if (deadlines is None or runtime.engine.phase != "deal_complete" or _blocked(runtime) is not None
            or utcnow() < deadlines[1]):
        raise ValueError("watten_round_review_pending")
    dealer = (runtime.engine.dealer_seat + 1) % runtime.room.recipe.player_count
    engine = next_deal(runtime.engine, f"{runtime.room.room_id}-{secrets.token_hex(8)}",
                       cryptographic_deal(runtime.room.recipe.player_count, dealer))
    candidate = copy_game(game)
    _sync(candidate, replace(runtime, engine=engine, deliveries=(), round_review_started_at=None), public=True)
    return candidate


def watch_game(game: dict) -> None:
    from .game_state import games
    from .watten_cpu_runtime import _authority

    runtime = game["_watten"]
    eligible = (not game.get("_aborted") and games.get(game["_id"]) is game and runtime.engine is not None
                and runtime.engine.phase == "deal_complete" and _blocked(runtime) is None)
    previous = _JOBS.get(game["_id"])
    if previous and eligible and previous.owner is game and previous.context == _context(game):
        return
    if previous:
        _JOBS.pop(game["_id"], None)
        if previous.task and previous.task is not asyncio.current_task():
            previous.task.cancel()
    if not eligible or _authority(game) is None:
        return
    job = _Job(game, _context(game))
    _JOBS[game["_id"]] = job
    job.task = asyncio.create_task(_run(game, job), name=f"watten-next-deal-{game['_id']}")


async def _run(game: dict, job: _Job) -> None:
    from .game_state import games
    from .watten_cpu_runtime import _authority, _commit_guard
    from .watten_cpu_runtime import watch_game as watch_cpu
    from .watten_runtime import game_lock, persist_watten_game
    from .watten_websocket import broadcast_watten, expire_watten_game

    try:
        deadlines = review_deadlines(game)
        await asyncio.sleep(max(0, (deadlines[1] - utcnow()).total_seconds()))
        async with game_lock(game):
            if (games.get(game["_id"]) is not game or _JOBS.get(game["_id"]) is not job
                    or game["_watten"].engine is None or _context(game) != job.context):
                return
            if await expire_watten_game(game):
                return
            authority = _authority(game)
            if authority is None:
                return
            candidate = advance_reviewed_deal(game)
            persist_watten_game(candidate, expected_source=authority.source, commit_guard=_commit_guard(authority))
            game.clear()
            game.update(candidate)
            await broadcast_watten(game)
            watch_cpu(game)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.exception("Watten waits after rejected automatic deal for table %s", game["_id"])
    finally:
        if _JOBS.get(game["_id"]) is job:
            _JOBS.pop(game["_id"], None)


async def stop_round_runners() -> None:
    jobs = list(_JOBS.values())
    _JOBS.clear()
    tasks = [job.task for job in jobs if job.task is not None]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
