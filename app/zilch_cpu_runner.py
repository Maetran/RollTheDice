"""Trusted, cancellable server runner for Zilch CPU participants.

The runner has no HTTP, WebSocket or account identity.  It observes a durable
Zilch state, waits briefly, then executes the same versioned domain commands
as a human action.  A process-local task is intentionally *not* persisted:
after recovery the authoritative state decides whether a single new task is
needed.
"""

from __future__ import annotations

import asyncio
import logging
import os
from collections.abc import Callable
from typing import Any

from .game_realtime import broadcast
from .game_snapshot import snapshot
from .game_state import multiplayer_pause_reason, touch
from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .zilch_cpu_strategy import (
    CpuQuickHoldOption,
    CpuStrategyContext,
    ZilchCpuStrategyError,
    choose_zilch_cpu_decision,
    validate_zilch_cpu_strategy,
)
from .zilch_engine import ZILCH_TARGET_SCORE, ZilchRuleError, bank_allowed, fair_zilch_randint, options_for_turn
from .zilch_gameplay import (
    FinalizeGame,
    apply_zilch_bank_points,
    apply_zilch_roll_dice,
    apply_zilch_select_hold,
    apply_zilch_start_roll,
    publish_zilch_transition,
)
from .zilch_state import (
    current_zilch_start_roll,
    current_zilch_turn,
    ensure_zilch_engine_state,
    zilch_cpu_participant,
    zilch_participants,
)

logger = logging.getLogger(__name__)

_CPU_TASKS: dict[str, asyncio.Task[None]] = {}
_DEFAULT_DELAY_SECONDS = 0.9
_ZILCH_HANDOFF_DELAY_SECONDS = 1.9
_MAX_DELAY_SECONDS = 5.0


def cpu_action_delay_seconds() -> float:
    """Read the bounded product pacing control without blocking the loop."""
    raw = os.getenv("ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS", str(_DEFAULT_DELAY_SECONDS))
    try:
        return min(_MAX_DELAY_SECONDS, max(0.0, float(raw)))
    except (TypeError, ValueError):
        return _DEFAULT_DELAY_SECONDS


def _game_id(game: dict[str, Any]) -> str:
    return str(game.get("_id") or "")


def _is_cpu_game(game: dict[str, Any]) -> bool:
    try:
        return game_type_from_state(game) == ZILCH_GAME_TYPE and game.get("_play_mode") == "cpu"
    except ValueError:
        return False


def _runner_allowed(game: dict[str, Any]) -> bool:
    if not _is_cpu_game(game):
        return False
    if game.get("_finished") or game.get("_aborted") or game.get("_finalization_pending") or game.get("_zilch_cpu_error"):
        return False
    if not game.get("_started") or multiplayer_pause_reason(game):
        return False
    return zilch_cpu_participant(game) is not None


def _normalise_reason_key(key: str) -> str:
    """Keep strategy reasons in the public Zilch i18n namespace."""
    return key.replace("zilch.cpu.reason.", "zilch.cpu_reason.", 1)


def _opponent_total(game: dict[str, Any], cpu_id: str) -> int:
    totals = game.get("_total_points") if isinstance(game.get("_total_points"), dict) else {}
    others = [
        int(totals.get(str(participant.get("id") or ""), 0) or 0)
        for participant in zilch_participants(game)
        if str(participant.get("id") or "") != cpu_id
    ]
    return max(others, default=0)


def _cpu_strategy_context(game: dict[str, Any], cpu: dict) -> CpuStrategyContext:
    """Build a read-only strategy view entirely from current server state."""
    ensure_zilch_engine_state(game)
    turn = current_zilch_turn(game)
    if turn.player_id != str(cpu.get("id") or ""):
        raise ZilchRuleError("zilch_not_your_turn")
    options = tuple(
        CpuQuickHoldOption(
            option_id=option.option_id,
            combination_type=option.combination_type,
            points=option.points,
            dice_indices=option.dice_indices,
            all_available_dice=option.all_available_dice,
            hot_dice=option.hot_dice,
            free_roll=option.free_roll,
        )
        for option in options_for_turn(turn)
    )
    can_bank, _reason = bank_allowed(turn)
    totals = game.get("_total_points") if isinstance(game.get("_total_points"), dict) else {}
    cpu_id = str(cpu.get("id") or "")
    final_round = game.get("_zilch_final_round")
    final_reply = isinstance(final_round, dict) and cpu_id in {
        str(value) for value in final_round.get("pending_player_ids", [])
    }
    opponent_total = _opponent_total(game, cpu_id)
    # A tie is a valid final outcome under zilch-house-v1; it avoids a known
    # loss.  The strategy will nevertheless keep rolling if it needs more.
    needed_to_beat = max(
        int(game.get("_target_score", ZILCH_TARGET_SCORE) or ZILCH_TARGET_SCORE),
        opponent_total,
    ) if final_reply else None
    return CpuStrategyContext(
        strategy=validate_zilch_cpu_strategy(cpu.get("cpu_strategy")),
        own_total=int(totals.get(cpu_id, 0) or 0),
        opponent_total=opponent_total,
        target_score=int(game.get("_target_score", ZILCH_TARGET_SCORE) or ZILCH_TARGET_SCORE),
        round_points=turn.round_points,
        available_dice_count=len(turn.available_indices),
        confirmation_required=turn.confirmation_required,
        hot_dice=turn.last_event == "hot_dice",
        final_round=final_reply,
        needed_to_beat=needed_to_beat,
        quick_holds=options,
        can_roll=turn.phase in {"ready_to_roll", "confirmation_roll_required"},
        can_bank=can_bank,
    )


def _cpu_opening_roll_is_due(game: dict[str, Any], cpu_id: str) -> tuple[bool, int | None]:
    """CPU rolls second in every opening attempt, including a tie re-roll."""
    try:
        opening = current_zilch_start_roll(game)
    except ZilchRuleError:
        return False, None
    if opening.get("phase") != "awaiting_rolls" or cpu_id not in opening.get("pending_player_ids", []):
        return False, None
    human_pending = any(
        str(participant.get("id") or "") != cpu_id
        and str(participant.get("id") or "") in opening.get("pending_player_ids", [])
        for participant in zilch_participants(game)
    )
    if human_pending:
        return False, None
    return True, int(opening.get("version", 0) or 0)


def cpu_action_is_due(game: dict[str, Any]) -> bool:
    """Return whether the current durable state needs a CPU action now."""
    if not _runner_allowed(game):
        return False
    cpu = zilch_cpu_participant(game)
    if not cpu:
        return False
    cpu_id = str(cpu.get("id") or "")
    due, _version = _cpu_opening_roll_is_due(game, cpu_id)
    if due:
        return True
    try:
        return current_zilch_turn(game).player_id == cpu_id
    except ZilchRuleError:
        return False


def _annotate_cpu_event(event: dict[str, Any], *, cpu_id: str, reason_key: str, reason_params: dict[str, Any]) -> dict[str, Any]:
    annotated = dict(event)
    annotated["actor_participant_id"] = cpu_id
    annotated["cpu_reason_key"] = _normalise_reason_key(reason_key)
    annotated["cpu_reason_params"] = dict(reason_params)
    return annotated


async def _perform_cpu_step(
    game: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None,
    randint_fn: Callable[[int, int], int],
) -> bool:
    """Revalidate and perform exactly one visible CPU command."""
    if not _runner_allowed(game):
        return False
    cpu = zilch_cpu_participant(game)
    if not cpu:
        return False
    cpu_id = str(cpu.get("id") or "")
    due, opening_version = _cpu_opening_roll_is_due(game, cpu_id)
    if due:
        transition = apply_zilch_start_roll(
            game,
            cpu_id,
            start_roll_version=opening_version,
            randint_fn=randint_fn,
        )
        transition = transition.__class__(
            event=_annotate_cpu_event(
                transition.event,
                cpu_id=cpu_id,
                reason_key="zilch.cpu_reason.opening_roll",
                reason_params={"strategy": str(cpu.get("cpu_strategy") or "")},
            ),
            terminal=transition.terminal,
        )
        await publish_zilch_transition(game, transition, finalize_game=finalize_game)
        return True

    context = _cpu_strategy_context(game, cpu)
    decision = choose_zilch_cpu_decision(context)
    turn = current_zilch_turn(game)
    if decision.action == "select_hold":
        option = next((option for option in options_for_turn(turn) if option.option_id == decision.option_id), None)
        if option is None:
            raise ZilchRuleError("zilch_stale_or_invalid_option")
        transition = apply_zilch_select_hold(
            game,
            cpu_id,
            turn_id=turn.turn_id,
            version=turn.version,
            roll_id=option.roll_id,
            option_id=option.option_id,
        )
    elif decision.action == "roll":
        transition = apply_zilch_roll_dice(
            game,
            cpu_id,
            turn_id=turn.turn_id,
            version=turn.version,
            randint_fn=randint_fn,
        )
    elif decision.action == "bank":
        transition = apply_zilch_bank_points(
            game,
            cpu_id,
            turn_id=turn.turn_id,
            version=turn.version,
        )
    else:  # Defensive: the strategy action union is deliberately closed.
        raise ZilchCpuStrategyError("zilch_cpu_no_legal_action")
    transition = transition.__class__(
        event=_annotate_cpu_event(
            transition.event,
            cpu_id=cpu_id,
            reason_key=decision.reason_key,
            reason_params=decision.reason_params,
        ),
        terminal=transition.terminal,
    )
    await publish_zilch_transition(game, transition, finalize_game=finalize_game)
    return True


async def _run_cpu_game(
    game: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None,
    delay_seconds: float,
    first_delay_seconds: float,
    randint_fn: Callable[[int, int], int],
) -> None:
    """Run visible CPU steps until the current authoritative CPU turn ends."""
    game_id = _game_id(game)
    first_step = True
    try:
        while cpu_action_is_due(game):
            step_delay = first_delay_seconds if first_step else delay_seconds
            first_step = False
            if step_delay:
                await asyncio.sleep(step_delay)
            # The state may have paused, finished, or been replaced while the
            # CPU was thinking.  Never replay an old decision after a delay.
            if not cpu_action_is_due(game):
                return
            try:
                changed = await _perform_cpu_step(
                    game,
                    finalize_game=finalize_game,
                    randint_fn=randint_fn,
                )
            except ZilchRuleError:
                # A concurrent/rejoined human command made the view stale;
                # re-evaluate once from the current state rather than forcing
                # the pre-delay action.
                if not cpu_action_is_due(game):
                    return
                continue
            if not changed or game.get("_finished") or game.get("_aborted"):
                return
    except asyncio.CancelledError:
        raise
    except (ZilchCpuStrategyError, ValueError):
        await _publish_cpu_failure(game, game_id)
        logger.exception("CPU strategy is invalid for Zilch game %s", game_id)
    except Exception:
        await _publish_cpu_failure(game, game_id)
        logger.exception("CPU runner failed for Zilch game %s", game_id)


async def _publish_cpu_failure(game: dict[str, Any], game_id: str) -> None:
    """Make a damaged CPU configuration visible without inventing a move."""
    game["_zilch_cpu_error"] = "zilch_cpu_game_cannot_continue"
    event = {"type": "cpu_unavailable", "cpu_reason_key": "zilch.cpu_reason.unavailable", "game_id": game_id}
    game["_zilch_last_event"] = event
    touch(game)
    await broadcast(game, {"scoreboard": snapshot(game), "zilch_event": event})


def maybe_schedule_cpu_turn(
    game: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None = None,
    delay_seconds: float | None = None,
    randint_fn: Callable[[int, int], int] | None = None,
) -> asyncio.Task[None] | None:
    """Start at most one cancellable CPU task for a currently due game.

    ``delay_seconds`` and ``randint_fn`` are internal test seams.  Production
    callers do not accept client-controlled timing or randomness; they use the
    bounded environment pacing and the same fair Zilch RNG as human actions.
    """
    if not cpu_action_is_due(game):
        return None
    game_id = _game_id(game)
    if not game_id:
        return None
    existing = _CPU_TASKS.get(game_id)
    if existing is not None and not existing.done():
        return existing
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        # Startup/recovery callers in a synchronous context cannot create an
        # async task.  The next rejoin/action inside the app loop retries.
        return None
    resolved_delay = cpu_action_delay_seconds() if delay_seconds is None else max(0.0, delay_seconds)
    last_event = game.get("_zilch_last_event")
    last_event_type = str(last_event.get("type") or "") if isinstance(last_event, dict) else ""
    first_delay = (
        max(resolved_delay, _ZILCH_HANDOFF_DELAY_SECONDS)
        if delay_seconds is None and last_event_type == "zilch"
        else resolved_delay
    )
    task = loop.create_task(
        _run_cpu_game(
            game,
            finalize_game=finalize_game,
            delay_seconds=resolved_delay,
            first_delay_seconds=first_delay,
            randint_fn=randint_fn or fair_zilch_randint,
        ),
        name=f"zilch-cpu:{game_id}",
    )
    _CPU_TASKS[game_id] = task

    def _clear(completed: asyncio.Task[None]) -> None:
        if _CPU_TASKS.get(game_id) is completed:
            _CPU_TASKS.pop(game_id, None)

    task.add_done_callback(_clear)
    return task


async def resume_cpu_games(
    games: dict[str, dict[str, Any]],
    *,
    finalize_game: FinalizeGame | None = None,
) -> None:
    """Schedule eligible recovered CPU games exactly once on app startup."""
    for game in list(games.values()):
        maybe_schedule_cpu_turn(game, finalize_game=finalize_game)


async def stop_cpu_runners() -> None:
    """Cancel and await all managed tasks during application shutdown."""
    tasks = list(_CPU_TASKS.values())
    _CPU_TASKS.clear()
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
