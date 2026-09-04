"""WebSocket integration for the separate, server-authoritative Zilch engine."""

from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from .game_realtime import broadcast, send_game_message
from .game_snapshot import snapshot
from .game_state import roll_cooldown_ok, touch
from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .game_ws_session import GameSocketSession
from .zilch_engine import (
    ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED,
    ZILCH_PHASE_READY_TO_ROLL,
    ZilchHoldResult,
    ZilchRuleError,
    ZilchScoringOption,
    ZilchTurn,
    bank_allowed,
    fair_zilch_randint,
    roll_zilch_start_die,
    roll_zilch_turn,
    select_zilch_option,
)
from .zilch_state import (
    advance_after_zilch_turn,
    current_zilch_start_roll,
    current_zilch_turn,
    ensure_zilch_engine_state,
    finish_zilch_game,
    finish_zilch_solo_game,
    record_zilch_bank,
    record_zilch_loss,
    record_zilch_solo_hot_dice,
    record_zilch_solo_roll,
    record_zilch_start_roll,
    sync_zilch_turn,
    zilch_is_configured_solo_game,
    zilch_participant_ids,
)

# These names intentionally do not overlap the ZDWA five-dice actions.
# Manual score input is preserved as an explicit rejected legacy scaffold;
# the confirmed rules use server-calculated holds and banking only.
ZILCH_GAMEPLAY_ACTIONS = frozenset(
    {
        "zilch_start_roll",
        "zilch_roll_dice",
        "zilch_select_hold",
        "zilch_bank_points",
        "zilch_abandon_solo",
        "zilch_submit_score",
    }
)

logger = logging.getLogger(__name__)

FinalizeGame = Callable[[dict], Any]


@dataclass(frozen=True)
class ZilchActionTransition:
    """One validated domain transition, ready for shared publication.

    The WebSocket edge owns authentication and error delivery.  The CPU runner
    owns neither a socket nor a session, so both callers use these compact
    transition values after the same engine/state mutation has succeeded.
    """

    event: dict[str, Any]
    terminal: bool = False


def _error_key(code: str) -> str:
    return f"zilch.error.{code}"


async def _send_error(session: GameSocketSession, code: str, **params: Any) -> None:
    """Send a localizable, machine-readable rejection without state mutation."""
    await send_game_message(
        session.websocket,
        {
            "error": "zilch_action_rejected",
            "zilch_error": {
                "code": code,
                "message_key": _error_key(code),
                "params": params,
            },
        },
    )


async def _publish_game(game: dict[str, Any], *, event: dict[str, Any], **message: Any) -> None:
    """Persist and broadcast a Zilch event without a transport actor."""
    game["_zilch_last_event"] = dict(event)
    touch(game)
    await broadcast(game, {"scoreboard": snapshot(game), "zilch_event": event, **message})


async def _publish(session: GameSocketSession, *, event: dict[str, Any], **message: Any) -> None:
    """Compatibility wrapper for existing WebSocket edge calls."""
    await _publish_game(session.game, event=event, **message)


def _strict_int(data: dict[str, Any], key: str) -> int:
    value = data.get(key)
    if type(value) is not int:
        raise ZilchRuleError(f"zilch_{key}_required")
    return value


def _require_human_session_actor(session: GameSocketSession) -> str:
    """Prove that a public socket represents a joined human seat.

    A CPU participant deliberately has no transport record, resume token or
    WebSocket.  This check therefore rejects even direct test calls that try
    to manufacture a session using a CPU participant ID.
    """
    try:
        if game_type_from_state(session.game) != ZILCH_GAME_TYPE:
            raise ZilchRuleError("zilch_wrong_game_type")
    except ValueError as exc:
        raise ZilchRuleError("zilch_wrong_game_type") from exc
    player_id = str(session.player_id or "")
    if not player_id:
        raise ZilchRuleError("zilch_not_participant")
    player = next(
        (
            candidate
            for candidate in session.game.get("_players", [])
            if isinstance(candidate, dict) and str(candidate.get("id") or "") == player_id
        ),
        None,
    )
    if player is None:
        raise ZilchRuleError("zilch_cpu_action_not_allowed")
    return player_id


def _current_actor_turn(session: GameSocketSession, data: dict[str, Any]):
    """Verify type, participant ownership, current turn, and command version."""
    game = session.game
    try:
        if game_type_from_state(game) != ZILCH_GAME_TYPE:
            raise ZilchRuleError("zilch_wrong_game_type")
    except ValueError as exc:
        raise ZilchRuleError("zilch_wrong_game_type") from exc
    if game.get("_finished") or game.get("_aborted"):
        raise ZilchRuleError("zilch_game_finished")
    if not game.get("_started"):
        raise ZilchRuleError("zilch_not_started")
    player_id = str(session.player_id or "")
    if not player_id or player_id not in zilch_participant_ids(game):
        raise ZilchRuleError("zilch_not_participant")
    ensure_zilch_engine_state(game)
    if not zilch_is_configured_solo_game(game):
        start_roll = current_zilch_start_roll(game)
        if start_roll.get("phase") != "resolved":
            raise ZilchRuleError("zilch_start_roll_pending")
    turn = current_zilch_turn(game)
    if turn.player_id != player_id:
        raise ZilchRuleError("zilch_not_your_turn")
    if _strict_int(data, "turn_id") != turn.turn_id:
        raise ZilchRuleError("zilch_stale_turn")
    if _strict_int(data, "version") != turn.version:
        raise ZilchRuleError("zilch_stale_state")
    return turn


def _current_start_roll_actor(session: GameSocketSession, data: dict[str, Any]) -> dict:
    """Validate a participant's versioned, one-time opening roll command."""
    game = session.game
    try:
        if game_type_from_state(game) != ZILCH_GAME_TYPE:
            raise ZilchRuleError("zilch_wrong_game_type")
    except ValueError as exc:
        raise ZilchRuleError("zilch_wrong_game_type") from exc
    if game.get("_finished") or game.get("_aborted"):
        raise ZilchRuleError("zilch_game_finished")
    if not game.get("_started"):
        raise ZilchRuleError("zilch_not_started")
    player_id = str(session.player_id or "")
    if not player_id or player_id not in zilch_participant_ids(game):
        raise ZilchRuleError("zilch_not_participant")
    ensure_zilch_engine_state(game)
    if zilch_is_configured_solo_game(game):
        raise ZilchRuleError("zilch_start_roll_not_required")
    start_roll = current_zilch_start_roll(game)
    if start_roll.get("phase") != "awaiting_rolls":
        raise ZilchRuleError("zilch_start_roll_finished")
    if _strict_int(data, "start_roll_version") != int(start_roll.get("version", 0) or 0):
        raise ZilchRuleError("zilch_stale_start_roll")
    if player_id not in start_roll.get("pending_player_ids", []):
        raise ZilchRuleError("zilch_start_roll_already_recorded")
    return start_roll


def _validate_option_reference(data: dict[str, Any], option) -> None:
    """Reject forged optional mirrors in addition to the authoritative ID."""
    if _strict_int(data, "roll_id") != option.roll_id:
        raise ZilchRuleError("zilch_stale_option")
    if data.get("option_id") != option.option_id:
        raise ZilchRuleError("zilch_stale_option")
    if "dice_indices" in data:
        indices = data["dice_indices"]
        if (
            not isinstance(indices, list)
            or any(type(index) is not int for index in indices)
            or indices != list(option.dice_indices)
        ):
            raise ZilchRuleError("zilch_option_reference_mismatch")
    if "points" in data and (type(data["points"]) is not int or data["points"] != option.points):
        raise ZilchRuleError("zilch_option_reference_mismatch")
    if "combination_type" in data and data["combination_type"] != option.combination_type:
        raise ZilchRuleError("zilch_option_reference_mismatch")


def _referenced_hold_result(
    turn: ZilchTurn,
    *,
    roll_id: object,
    option_id: object,
    dice_indices: object | None = None,
    points: object | None = None,
    combination_type: object | None = None,
) -> ZilchHoldResult:
    """Return one pure, fully revalidated hold result for a current roll."""
    result = select_zilch_option(turn, option_id)
    reference: dict[str, Any] = {"roll_id": roll_id, "option_id": option_id}
    if dice_indices is not None:
        reference["dice_indices"] = dice_indices
    if points is not None:
        reference["points"] = points
    if combination_type is not None:
        reference["combination_type"] = combination_type
    _validate_option_reference(reference, result.option)
    return result


def _turn_with_optional_hold(
    turn: ZilchTurn,
    *,
    roll_id: object | None = None,
    option_id: object | None = None,
    dice_indices: object | None = None,
    points: object | None = None,
    combination_type: object | None = None,
) -> tuple[ZilchTurn, ZilchHoldResult | None]:
    """Attach an optional current-roll hold without mutating shared state.

    Human clients use this for one-gesture ``Weiterwürfeln`` and ``Sichern``.
    Supplying mirror fields without an option ID is rejected instead of being
    silently interpreted as a plain roll or bank command.
    """
    if option_id is None:
        if any(value is not None for value in (roll_id, dice_indices, points, combination_type)):
            raise ZilchRuleError("zilch_stale_or_invalid_option")
        return turn, None
    result = _referenced_hold_result(
        turn,
        roll_id=roll_id,
        option_id=option_id,
        dice_indices=dice_indices,
        points=points,
        combination_type=combination_type,
    )
    return result.turn, result


def _hold_threshold_loss(
    game: dict[str, Any],
    result: ZilchHoldResult | None,
) -> ZilchActionTransition | None:
    """Apply the existing third-roll loss boundary for an optional hold."""
    if result is None or not result.third_roll_threshold_zilch:
        return None
    loss = record_zilch_loss(game, result.turn, reason="third_roll_minimum_not_met")
    outcome = _complete_or_advance(game, result.turn.player_id)
    return ZilchActionTransition(
        event={
            "type": "zilch",
            "reason": "third_roll_minimum_not_met",
            "player_id": result.turn.player_id,
            "rolled_dice": list(result.turn.dice),
            "held_dice_indices": list(result.turn.held_indices),
            "penalty": loss["penalty"],
            "outcome": outcome,
            "committed_option": result.option.payload(),
        },
        terminal=outcome is not None,
    )


def _event_with_committed_option(
    event: dict[str, Any],
    option: ZilchScoringOption | None,
) -> dict[str, Any]:
    if option is None:
        return event
    return {**event, "committed_option": option.payload()}


def _require_zilch_live_game(game: dict[str, Any]) -> None:
    """Validate the common live-state boundary for a trusted actor command."""
    try:
        if game_type_from_state(game) != ZILCH_GAME_TYPE:
            raise ZilchRuleError("zilch_wrong_game_type")
    except ValueError as exc:
        raise ZilchRuleError("zilch_wrong_game_type") from exc
    if game.get("_finished") or game.get("_aborted"):
        raise ZilchRuleError("zilch_game_finished")
    if not game.get("_started"):
        raise ZilchRuleError("zilch_not_started")
    ensure_zilch_engine_state(game)


def _command_int(value: object, key: str) -> int:
    if type(value) is not int:
        raise ZilchRuleError(f"zilch_{key}_required")
    return value


def _turn_for_actor(
    game: dict[str, Any],
    actor_id: str,
    *,
    turn_id: object,
    version: object,
):
    """Return the versioned current turn for a human or trusted CPU actor."""
    _require_zilch_live_game(game)
    if not actor_id or actor_id not in zilch_participant_ids(game):
        raise ZilchRuleError("zilch_not_participant")
    if not zilch_is_configured_solo_game(game):
        start_roll = current_zilch_start_roll(game)
        if start_roll.get("phase") != "resolved":
            raise ZilchRuleError("zilch_start_roll_pending")
    turn = current_zilch_turn(game)
    if turn.player_id != actor_id:
        raise ZilchRuleError("zilch_not_your_turn")
    if _command_int(turn_id, "turn_id") != turn.turn_id:
        raise ZilchRuleError("zilch_stale_turn")
    if _command_int(version, "version") != turn.version:
        raise ZilchRuleError("zilch_stale_state")
    return turn


def _start_roll_for_actor(game: dict[str, Any], actor_id: str, *, version: object) -> dict:
    """Return the current start-roll procedure for a versioned actor command."""
    _require_zilch_live_game(game)
    if zilch_is_configured_solo_game(game):
        raise ZilchRuleError("zilch_start_roll_not_required")
    if not actor_id or actor_id not in zilch_participant_ids(game):
        raise ZilchRuleError("zilch_not_participant")
    start_roll = current_zilch_start_roll(game)
    if start_roll.get("phase") != "awaiting_rolls":
        raise ZilchRuleError("zilch_start_roll_finished")
    if _command_int(version, "start_roll_version") != int(start_roll.get("version", 0) or 0):
        raise ZilchRuleError("zilch_stale_start_roll")
    if actor_id not in start_roll.get("pending_player_ids", []):
        raise ZilchRuleError("zilch_start_roll_already_recorded")
    return start_roll


def apply_zilch_start_roll(
    game: dict[str, Any],
    actor_id: str,
    *,
    start_roll_version: object,
    randint_fn=None,
) -> ZilchActionTransition:
    """Apply one server-generated opening die without a socket dependency."""
    _start_roll_for_actor(game, actor_id, version=start_roll_version)
    die_value = roll_zilch_start_die(randint_fn=randint_fn or fair_zilch_randint)
    event = record_zilch_start_roll(game, actor_id, die_value)
    return ZilchActionTransition(event=event)


def apply_zilch_roll_dice(
    game: dict[str, Any],
    actor_id: str,
    *,
    turn_id: object,
    version: object,
    roll_id: object | None = None,
    option_id: object | None = None,
    dice_indices: object | None = None,
    points: object | None = None,
    combination_type: object | None = None,
    randint_fn=None,
) -> ZilchActionTransition:
    """Apply a roll, optionally committing its current draft beforehand."""
    turn = _turn_for_actor(game, actor_id, turn_id=turn_id, version=version)
    turn, hold_result = _turn_with_optional_hold(
        turn,
        roll_id=roll_id,
        option_id=option_id,
        dice_indices=dice_indices,
        points=points,
        combination_type=combination_type,
    )
    threshold_loss = _hold_threshold_loss(game, hold_result)
    if threshold_loss is not None:
        return threshold_loss
    rolled_turn, evaluation = roll_zilch_turn(turn, randint_fn=randint_fn or fair_zilch_randint)
    if hold_result is not None and hold_result.option.hot_dice:
        record_zilch_solo_hot_dice(game, hold_result.turn)
    record_zilch_solo_roll(game, rolled_turn)
    if evaluation.zilch:
        loss = record_zilch_loss(game, rolled_turn, reason="no_scoring_option")
        outcome = _complete_or_advance(game, rolled_turn.player_id)
        return ZilchActionTransition(
            event=_event_with_committed_option(
                {
                    "type": "zilch",
                    "reason": "no_scoring_option",
                    "player_id": rolled_turn.player_id,
                    "rolled_dice": list(rolled_turn.dice),
                    "held_dice_indices": list(rolled_turn.held_indices),
                    "penalty": loss["penalty"],
                    "outcome": outcome,
                },
                hold_result.option if hold_result is not None else None,
            ),
            terminal=outcome is not None,
        )
    if evaluation.third_roll_threshold_zilch:
        loss = record_zilch_loss(game, rolled_turn, reason="third_roll_minimum_not_reachable")
        outcome = _complete_or_advance(game, rolled_turn.player_id)
        return ZilchActionTransition(
            event=_event_with_committed_option(
                {
                    "type": "zilch",
                    "reason": "third_roll_minimum_not_reachable",
                    "player_id": rolled_turn.player_id,
                    "rolled_dice": list(rolled_turn.dice),
                    "held_dice_indices": list(rolled_turn.held_indices),
                    "penalty": loss["penalty"],
                    "outcome": outcome,
                },
                hold_result.option if hold_result is not None else None,
            ),
            terminal=outcome is not None,
        )
    sync_zilch_turn(game, rolled_turn)
    return ZilchActionTransition(
        event=_event_with_committed_option(
            {
                "type": "roll",
                "player_id": rolled_turn.player_id,
                "turn_id": rolled_turn.turn_id,
                "roll_id": rolled_turn.roll_id,
            },
            hold_result.option if hold_result is not None else None,
        )
    )


def apply_zilch_select_hold(
    game: dict[str, Any],
    actor_id: str,
    *,
    turn_id: object,
    version: object,
    roll_id: object,
    option_id: object,
    dice_indices: object | None = None,
    points: object | None = None,
    combination_type: object | None = None,
) -> ZilchActionTransition:
    """Commit one current Quick Hold after full server-side revalidation."""
    turn = _turn_for_actor(game, actor_id, turn_id=turn_id, version=version)
    result = _referenced_hold_result(
        turn,
        roll_id=roll_id,
        option_id=option_id,
        dice_indices=dice_indices,
        points=points,
        combination_type=combination_type,
    )
    threshold_loss = _hold_threshold_loss(game, result)
    if threshold_loss is not None:
        return threshold_loss
    sync_zilch_turn(game, result.turn)
    if result.option.hot_dice:
        record_zilch_solo_hot_dice(game, result.turn)
    return ZilchActionTransition(
        event={
            "type": "hold",
            "player_id": result.turn.player_id,
            "option": result.option.payload(),
        }
    )


def apply_zilch_bank_points(
    game: dict[str, Any],
    actor_id: str,
    *,
    turn_id: object,
    version: object,
    roll_id: object | None = None,
    option_id: object | None = None,
    dice_indices: object | None = None,
    points: object | None = None,
    combination_type: object | None = None,
) -> ZilchActionTransition:
    """Bank a legal turn, optionally committing its current draft first."""
    turn = _turn_for_actor(game, actor_id, turn_id=turn_id, version=version)
    turn, hold_result = _turn_with_optional_hold(
        turn,
        roll_id=roll_id,
        option_id=option_id,
        dice_indices=dice_indices,
        points=points,
        combination_type=combination_type,
    )
    threshold_loss = _hold_threshold_loss(game, hold_result)
    if threshold_loss is not None:
        return threshold_loss
    allowed, reason = bank_allowed(turn)
    if not allowed:
        raise ZilchRuleError(str(reason or "zilch_bank_not_allowed"))
    had_final_round = isinstance(game.get("_zilch_final_round"), dict)
    total = record_zilch_bank(game, turn)
    outcome = _complete_or_advance(game, turn.player_id)
    final_round = game.get("_zilch_final_round")
    final_round_started = bool(
        not had_final_round
        and isinstance(final_round, dict)
        and str(final_round.get("triggered_by") or "") == turn.player_id
        and outcome is None
    )
    is_solo_completion = bool(
        outcome is not None
        and zilch_is_configured_solo_game(game)
        and str(outcome.get("status") or "") == "completed"
    )
    return ZilchActionTransition(
        event=_event_with_committed_option(
            {
                "type": "solo_completed" if is_solo_completion else "bank",
                "player_id": turn.player_id,
                "points": turn.round_points,
                "total": total,
                "outcome": outcome,
                "final_round_started": final_round_started,
            },
            hold_result.option if hold_result is not None else None,
        ),
        terminal=outcome is not None,
    )


def apply_zilch_abandon_solo(
    game: dict[str, Any],
    actor_id: str,
    *,
    turn_id: object,
    version: object,
    confirmed: object,
) -> ZilchActionTransition:
    """Finish a currently active Solo Sprint after explicit client consent.

    The browser confirmation is UX only.  The server also requires the exact
    boolean and the current actor/turn/version so a stale or forged request
    cannot terminate another run.
    """
    if confirmed is not True:
        raise ZilchRuleError("zilch_solo_abandon_confirmation_required")
    turn = _turn_for_actor(game, actor_id, turn_id=turn_id, version=version)
    if not zilch_is_configured_solo_game(game):
        raise ZilchRuleError("zilch_solo_action_not_allowed")
    outcome = finish_zilch_solo_game(game, status="abandoned")
    return ZilchActionTransition(
        event={
            "type": "solo_abandoned",
            "player_id": turn.player_id,
            "outcome": outcome,
        },
        terminal=True,
    )


def _complete_or_advance(game: dict, player_id: str) -> dict[str, Any] | None:
    if advance_after_zilch_turn(game, player_id):
        return finish_zilch_game(game)
    return None


async def _publish_terminal_and_finalize(
    game: dict[str, Any],
    *,
    event: dict[str, Any],
    finalize_game: FinalizeGame | None,
) -> None:
    """Persist the terminal live snapshot before trying typed finalization.

    The first publish is intentionally before the blocking database work: it
    lets both players see the outcome and stores restart recovery data.  The
    second publish carries the durable result route when (and only when) the
    game-specific finalizer confirmed persistence.
    """
    game["_finalization_pending"] = True
    await _publish_game(game, event=event, finalization_pending=True)
    completion: dict[str, Any] = {}
    if finalize_game is not None:
        try:
            result = await asyncio.to_thread(finalize_game, game)
            if inspect.isawaitable(result):
                result = await result
            completion = result if isinstance(result, dict) else {}
        except Exception:
            # The active terminal snapshot deliberately remains persisted for
            # startup recovery.  A transient storage failure must not hide an
            # already finished board or route it through ZDWA.
            logger.exception("Could not finalize terminal Zilch game %s", game.get("_id"))
            completion = {"result_persisted": False, "persistence_error": "zilch_result_persistence_failed"}
    game["_final_completion"] = completion
    game["_finalization_pending"] = False
    await _publish_game(
        game,
        event=event,
        finalization_pending=False,
        zilch_result=completion,
    )


async def publish_zilch_transition(
    game: dict[str, Any],
    transition: ZilchActionTransition,
    *,
    finalize_game: FinalizeGame | None = None,
) -> None:
    """Publish a shared human/CPU transition and finalize terminal states.

    The mutation was already performed by one of the ``apply_zilch_*``
    commands.  Keeping finalization here makes CPU terminal states follow the
    exact Part-4 persistence ordering without creating a fake socket session.
    """
    if transition.terminal:
        await _publish_terminal_and_finalize(game, event=transition.event, finalize_game=finalize_game)
    else:
        await _publish_game(game, event=transition.event)


async def _roll_dice(
    session: GameSocketSession,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None,
) -> bool:
    try:
        player_id = _require_human_session_actor(session)
        # Validate the versioned command and optional hold before consuming
        # the cooldown. A stale request from a replaced socket must not block
        # the current tab's next legitimate roll.
        turn = _turn_for_actor(
            session.game,
            player_id,
            turn_id=data.get("turn_id"),
            version=data.get("version"),
        )
        turn, hold_result = _turn_with_optional_hold(
            turn,
            roll_id=data.get("roll_id") if "roll_id" in data else None,
            option_id=data.get("option_id") if "option_id" in data else None,
            dice_indices=data.get("dice_indices") if "dice_indices" in data else None,
            points=data.get("points") if "points" in data else None,
            combination_type=data.get("combination_type") if "combination_type" in data else None,
        )
        if hold_result is None or not hold_result.third_roll_threshold_zilch:
            if turn.phase not in {ZILCH_PHASE_READY_TO_ROLL, ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED}:
                raise ZilchRuleError("zilch_roll_not_allowed")
            if not roll_cooldown_ok(session.game, player_id, cooldown_s=0.6):
                await _send_error(session, "zilch_roll_cooldown")
                return False
        transition = apply_zilch_roll_dice(
            session.game,
            player_id,
            turn_id=data.get("turn_id"),
            version=data.get("version"),
            roll_id=data.get("roll_id") if "roll_id" in data else None,
            option_id=data.get("option_id") if "option_id" in data else None,
            dice_indices=data.get("dice_indices") if "dice_indices" in data else None,
            points=data.get("points") if "points" in data else None,
            combination_type=data.get("combination_type") if "combination_type" in data else None,
            randint_fn=fair_zilch_randint,
        )
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return False
    await publish_zilch_transition(session.game, transition, finalize_game=finalize_game)
    return True


async def _start_roll(session: GameSocketSession, data: dict[str, Any]) -> bool:
    try:
        player_id = _require_human_session_actor(session)
        transition = apply_zilch_start_roll(
            session.game,
            player_id,
            start_roll_version=data.get("start_roll_version"),
            randint_fn=fair_zilch_randint,
        )
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return False
    await publish_zilch_transition(session.game, transition)
    return True


async def _select_hold(
    session: GameSocketSession,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None,
) -> bool:
    try:
        player_id = _require_human_session_actor(session)
        transition = apply_zilch_select_hold(
            session.game,
            player_id,
            turn_id=data.get("turn_id"),
            version=data.get("version"),
            roll_id=data.get("roll_id"),
            option_id=data.get("option_id"),
            dice_indices=data.get("dice_indices") if "dice_indices" in data else None,
            points=data.get("points") if "points" in data else None,
            combination_type=data.get("combination_type") if "combination_type" in data else None,
        )
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return False
    await publish_zilch_transition(session.game, transition, finalize_game=finalize_game)
    return True


async def _bank_points(
    session: GameSocketSession,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None,
) -> bool:
    try:
        player_id = _require_human_session_actor(session)
        transition = apply_zilch_bank_points(
            session.game,
            player_id,
            turn_id=data.get("turn_id"),
            version=data.get("version"),
            roll_id=data.get("roll_id") if "roll_id" in data else None,
            option_id=data.get("option_id") if "option_id" in data else None,
            dice_indices=data.get("dice_indices") if "dice_indices" in data else None,
            points=data.get("points") if "points" in data else None,
            combination_type=data.get("combination_type") if "combination_type" in data else None,
        )
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return False
    await publish_zilch_transition(session.game, transition, finalize_game=finalize_game)
    return True


async def _abandon_solo(
    session: GameSocketSession,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None,
) -> bool:
    try:
        player_id = _require_human_session_actor(session)
        transition = apply_zilch_abandon_solo(
            session.game,
            player_id,
            turn_id=data.get("turn_id"),
            version=data.get("version"),
            confirmed=data.get("confirmed"),
        )
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return False
    await publish_zilch_transition(session.game, transition, finalize_game=finalize_game)
    return True


async def handle_zilch_gameplay_action(
    session: GameSocketSession,
    action: str,
    data: dict[str, Any],
    *,
    finalize_game: FinalizeGame | None = None,
    **_kwargs: Any,
) -> None:
    """Dispatch an action without ever invoking ZDWA gameplay or scoring."""
    changed = False
    if action == "zilch_start_roll":
        changed = await _start_roll(session, data)
    elif action == "zilch_roll_dice":
        changed = await _roll_dice(session, data, finalize_game=finalize_game)
    elif action == "zilch_select_hold":
        changed = await _select_hold(session, data, finalize_game=finalize_game)
    elif action == "zilch_bank_points":
        changed = await _bank_points(session, data, finalize_game=finalize_game)
    elif action == "zilch_abandon_solo":
        changed = await _abandon_solo(session, data, finalize_game=finalize_game)
    elif action == "zilch_submit_score":
        await _send_error(session, "zilch_manual_score_not_supported")
        return
    else:
        raise ValueError(f"Unsupported Zilch gameplay action: {action}")
    if changed:
        # The runner is a trusted server-side observer, not a socket actor.
        # Importing lazily keeps the existing game adapter free of a task
        # registry at module import time and avoids a circular dependency.
        from .zilch_cpu_runner import maybe_schedule_cpu_turn

        maybe_schedule_cpu_turn(session.game, finalize_game=finalize_game)
