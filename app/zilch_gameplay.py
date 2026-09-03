"""WebSocket integration for the separate, server-authoritative Zilch engine."""

from __future__ import annotations

from typing import Any

from .game_realtime import broadcast, send_game_message
from .game_snapshot import snapshot
from .game_state import roll_cooldown_ok, touch
from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .game_ws_session import GameSocketSession
from .zilch_engine import (
    ZilchRuleError,
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
    record_zilch_bank,
    record_zilch_loss,
    record_zilch_start_roll,
    sync_zilch_turn,
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
        "zilch_submit_score",
    }
)


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


async def _publish(session: GameSocketSession, *, event: dict[str, Any]) -> None:
    session.game["_zilch_last_event"] = dict(event)
    touch(session.game)
    await broadcast(session.game, {"scoreboard": snapshot(session.game), "zilch_event": event})


def _strict_int(data: dict[str, Any], key: str) -> int:
    value = data.get(key)
    if type(value) is not int:
        raise ZilchRuleError(f"zilch_{key}_required")
    return value


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


def _complete_or_advance(game: dict, player_id: str) -> dict[str, Any] | None:
    if advance_after_zilch_turn(game, player_id):
        return finish_zilch_game(game)
    return None


async def _roll_dice(session: GameSocketSession, data: dict[str, Any]) -> None:
    try:
        turn = _current_actor_turn(session, data)
        if not roll_cooldown_ok(session.game, str(session.player_id), cooldown_s=0.6):
            await _send_error(session, "zilch_roll_cooldown")
            return
        rolled_turn, evaluation = roll_zilch_turn(turn, randint_fn=fair_zilch_randint)
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return

    if evaluation.zilch:
        loss = record_zilch_loss(session.game, rolled_turn, reason="no_scoring_option")
        outcome = _complete_or_advance(session.game, rolled_turn.player_id)
        await _publish(
            session,
            event={
                "type": "zilch",
                "reason": "no_scoring_option",
                "player_id": rolled_turn.player_id,
                "penalty": loss["penalty"],
                "outcome": outcome,
            },
        )
        return
    if evaluation.third_roll_threshold_zilch:
        loss = record_zilch_loss(session.game, rolled_turn, reason="third_roll_minimum_not_reachable")
        outcome = _complete_or_advance(session.game, rolled_turn.player_id)
        await _publish(
            session,
            event={
                "type": "zilch",
                "reason": "third_roll_minimum_not_reachable",
                "player_id": rolled_turn.player_id,
                "penalty": loss["penalty"],
                "outcome": outcome,
            },
        )
        return

    sync_zilch_turn(session.game, rolled_turn)
    await _publish(
        session,
        event={
            "type": "roll",
            "player_id": rolled_turn.player_id,
            "turn_id": rolled_turn.turn_id,
            "roll_id": rolled_turn.roll_id,
        },
    )


async def _start_roll(session: GameSocketSession, data: dict[str, Any]) -> None:
    try:
        _current_start_roll_actor(session, data)
        player_id = str(session.player_id or "")
        die_value = roll_zilch_start_die(randint_fn=fair_zilch_randint)
        event = record_zilch_start_roll(session.game, player_id, die_value)
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return
    await _publish(session, event=event)


async def _select_hold(session: GameSocketSession, data: dict[str, Any]) -> None:
    try:
        turn = _current_actor_turn(session, data)
        result = select_zilch_option(turn, data.get("option_id"))
        _validate_option_reference(data, result.option)
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return

    if result.third_roll_threshold_zilch:
        loss = record_zilch_loss(session.game, result.turn, reason="third_roll_minimum_not_met")
        outcome = _complete_or_advance(session.game, result.turn.player_id)
        await _publish(
            session,
            event={
                "type": "zilch",
                "reason": "third_roll_minimum_not_met",
                "player_id": result.turn.player_id,
                "penalty": loss["penalty"],
                "outcome": outcome,
            },
        )
        return

    sync_zilch_turn(session.game, result.turn)
    await _publish(
        session,
        event={
            "type": "hold",
            "player_id": result.turn.player_id,
            "option": result.option.payload(),
        },
    )


async def _bank_points(session: GameSocketSession, data: dict[str, Any]) -> None:
    try:
        turn = _current_actor_turn(session, data)
        allowed, reason = bank_allowed(turn)
        if not allowed:
            raise ZilchRuleError(str(reason or "zilch_bank_not_allowed"))
    except ZilchRuleError as exc:
        await _send_error(session, exc.code)
        return

    had_final_round = isinstance(session.game.get("_zilch_final_round"), dict)
    total = record_zilch_bank(session.game, turn)
    outcome = _complete_or_advance(session.game, turn.player_id)
    final_round = session.game.get("_zilch_final_round")
    final_round_started = bool(
        not had_final_round
        and isinstance(final_round, dict)
        and str(final_round.get("triggered_by") or "") == turn.player_id
        and outcome is None
    )
    await _publish(
        session,
        event={
            "type": "bank",
            "player_id": turn.player_id,
            "points": turn.round_points,
            "total": total,
            "outcome": outcome,
            "final_round_started": final_round_started,
        },
    )


async def handle_zilch_gameplay_action(
    session: GameSocketSession,
    action: str,
    data: dict[str, Any],
    **_kwargs: Any,
) -> None:
    """Dispatch an action without ever invoking ZDWA gameplay or scoring."""
    if action == "zilch_start_roll":
        await _start_roll(session, data)
        return
    if action == "zilch_roll_dice":
        await _roll_dice(session, data)
        return
    if action == "zilch_select_hold":
        await _select_hold(session, data)
        return
    if action == "zilch_bank_points":
        await _bank_points(session, data)
        return
    if action == "zilch_submit_score":
        await _send_error(session, "zilch_manual_score_not_supported")
        return
    raise ValueError(f"Unsupported Zilch gameplay action: {action}")
