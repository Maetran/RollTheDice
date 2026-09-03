"""Typed, private persistence and read projections for completed Zilch games.

This module deliberately knows the Zilch live-state schema, but no FastAPI,
WebSocket or ZDWA scorecard concepts.  It turns an authoritative terminal
state into one versioned JSON payload and delegates its durable write to the
generic typed completed-game store.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select

from .active_games import delete_active_game
from .database import database_schema_ready, session_scope
from .game_history import CompletedGameWriteResult, persist_completed_game_result
from .game_types import ZILCH_GAME_TYPE, game_type_from_state
from .models import CompletedGame, GameParticipant
from .zilch_engine import ZILCH_RULESET_VERSION, ZILCH_TARGET_SCORE

logger = logging.getLogger(__name__)

ZILCH_RESULT_SCHEMA_VERSION = 1
ZILCH_RESULT_PAYLOAD_KIND = "zilch_result"


class ZilchResultValidationError(ValueError):
    """A terminal live state cannot safely be made into a historic result."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _required_text(value: object, code: str, *, limit: int | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ZilchResultValidationError(code)
    result = value.strip()
    return result[:limit] if limit is not None else result


def _integer(value: object, code: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ZilchResultValidationError(code)
    return value


def _optional_user_id(value: object) -> int | None:
    if value is None:
        return None
    if type(value) is not int or value < 1:
        raise ZilchResultValidationError("zilch_result_invalid_user_id")
    return value


def _timestamp(value: object, code: str) -> datetime:
    text = _required_text(value, code)
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    except ValueError as exc:
        raise ZilchResultValidationError(code) from exc
    if parsed.tzinfo is None:
        raise ZilchResultValidationError(code)
    return parsed.astimezone(timezone.utc)


def _timestamp_payload(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _json_copy(value: object, code: str) -> Any:
    """Copy only JSON data; terminal results must not retain runtime objects."""
    try:
        return json.loads(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    except (TypeError, ValueError) as exc:
        raise ZilchResultValidationError(code) from exc


def _participant_payloads(game: dict) -> tuple[list[dict], list[str]]:
    raw_participants = game.get("_participants")
    if not isinstance(raw_participants, list) or not 1 <= len(raw_participants) <= 2:
        raise ZilchResultValidationError("zilch_result_invalid_participants")
    payloads: list[dict] = []
    participant_ids: list[str] = []
    for position, raw in enumerate(raw_participants):
        if not isinstance(raw, dict):
            raise ZilchResultValidationError("zilch_result_invalid_participants")
        participant_id = _required_text(raw.get("id"), "zilch_result_invalid_participant_id", limit=64)
        if participant_id in participant_ids:
            raise ZilchResultValidationError("zilch_result_duplicate_participant")
        participant_type = raw.get("type")
        if participant_type not in {"human", "cpu"}:
            raise ZilchResultValidationError("zilch_result_invalid_participant_type")
        display_name = _required_text(raw.get("name"), "zilch_result_invalid_participant_name", limit=64)
        user_id = _optional_user_id(raw.get("user_id"))
        cpu_strategy = raw.get("cpu_strategy")
        if cpu_strategy is not None and not isinstance(cpu_strategy, str):
            raise ZilchResultValidationError("zilch_result_invalid_cpu_strategy")
        if participant_type == "human" and cpu_strategy is not None:
            raise ZilchResultValidationError("zilch_result_invalid_cpu_strategy")
        if participant_type == "cpu" and user_id is not None:
            raise ZilchResultValidationError("zilch_result_invalid_cpu_user")
        # The current shared session model uses the account username as the
        # in-game name. Persist that historical text under both clear labels,
        # so a future account rename cannot change a finished report.
        payloads.append(
            {
                "position": position,
                "participant_id": participant_id,
                "player_key": participant_id,
                "display_name": display_name,
                "username": display_name,
                "user_id": user_id,
                "participant_type": participant_type,
                "cpu_strategy": cpu_strategy,
            }
        )
        participant_ids.append(participant_id)
    return payloads, participant_ids


def _start_roll_payload(raw: object, participant_ids: list[str]) -> dict:
    if not isinstance(raw, dict) or raw.get("phase") != "resolved":
        raise ZilchResultValidationError("zilch_result_invalid_start_roll")
    if [str(value) for value in raw.get("player_ids", [])] != participant_ids:
        raise ZilchResultValidationError("zilch_result_invalid_start_roll")
    winner_id = _required_text(raw.get("winner_id"), "zilch_result_invalid_start_roll")
    if winner_id not in participant_ids or bool(raw.get("tied")):
        raise ZilchResultValidationError("zilch_result_invalid_start_roll")
    raw_attempts = raw.get("attempts")
    if not isinstance(raw_attempts, list) or not raw_attempts:
        raise ZilchResultValidationError("zilch_result_invalid_start_roll")
    attempts: list[dict] = []
    for position, attempt in enumerate(raw_attempts, start=1):
        if not isinstance(attempt, dict) or not isinstance(attempt.get("rolls"), dict):
            raise ZilchResultValidationError("zilch_result_invalid_start_roll")
        rolls = attempt["rolls"]
        cleaned_rolls = {
            player_id: _integer(rolls.get(player_id), "zilch_result_invalid_start_roll", minimum=1)
            for player_id in participant_ids
        }
        if any(value > 6 for value in cleaned_rolls.values()):
            raise ZilchResultValidationError("zilch_result_invalid_start_roll")
        attempts.append({"attempt": position, "rolls": cleaned_rolls})
    final_rolls = attempts[-1]["rolls"]
    if final_rolls[winner_id] != max(final_rolls.values()) or list(final_rolls.values()).count(final_rolls[winner_id]) != 1:
        raise ZilchResultValidationError("zilch_result_invalid_start_roll")
    return {"attempts": attempts, "winner_id": winner_id, "final_rolls": final_rolls}


def _round_payload(raw: object, *, participant_id: str) -> tuple[dict, int, int, int, int | None, bool]:
    """Return sanitized round plus summary contribution values.

    The final two values represent the recorded Hot-Dice count and whether the
    count is complete.  Part-3 Zilch loss entries did not retain their prior
    holds, so their historic count is explicitly unknown instead of guessed.
    """
    if not isinstance(raw, dict):
        raise ZilchResultValidationError("zilch_result_invalid_round")
    event = raw.get("event")
    if event not in {"bank", "zilch"}:
        raise ZilchResultValidationError("zilch_result_invalid_round")
    common = {
        "turn_id": _integer(raw.get("turn_id"), "zilch_result_invalid_round", minimum=1),
        "round": _integer(raw.get("round"), "zilch_result_invalid_round", minimum=1),
        "event": event,
        "rolls_used": _integer(raw.get("rolls_used"), "zilch_result_invalid_round"),
    }
    if event == "bank":
        points = _integer(raw.get("points"), "zilch_result_invalid_round")
        total_after = _integer(raw.get("total_after"), "zilch_result_invalid_round")
        holds = raw.get("committed_holds")
        if not isinstance(holds, list):
            raise ZilchResultValidationError("zilch_result_invalid_round")
        safe_holds = _json_copy(holds, "zilch_result_invalid_round")
        hot_dice = sum(
            1
            for hold in safe_holds
            if isinstance(hold, dict) and bool(hold.get("hot_dice"))
        )
        return (
            {
                **common,
                "participant_id": participant_id,
                "points": points,
                "total_after": total_after,
                "committed_holds": safe_holds,
            },
            points,
            0,
            0,
            hot_dice,
            True,
        )
    discarded = _integer(raw.get("discarded_points"), "zilch_result_invalid_round")
    penalty = _integer(raw.get("penalty"), "zilch_result_invalid_round")
    total_after = _integer(raw.get("total_after"), "zilch_result_invalid_round")
    streak = _integer(raw.get("zilch_streak"), "zilch_result_invalid_round")
    reason = _required_text(raw.get("reason"), "zilch_result_invalid_round", limit=80)
    holds = raw.get("committed_holds")
    complete_hot_dice_count = isinstance(holds, list)
    safe_holds = _json_copy(holds, "zilch_result_invalid_round") if complete_hot_dice_count else None
    hot_dice = (
        sum(1 for hold in safe_holds if isinstance(hold, dict) and bool(hold.get("hot_dice")))
        if isinstance(safe_holds, list)
        else None
    )
    payload = {
        **common,
        "participant_id": participant_id,
        "reason": reason,
        "discarded_points": discarded,
        "penalty": penalty,
        "total_after": total_after,
        "zilch_streak": streak,
    }
    if safe_holds is not None:
        payload["committed_holds"] = safe_holds
    return payload, 0, 1, penalty, hot_dice, complete_hot_dice_count


def _board_payloads(game: dict, participant_ids: list[str]) -> tuple[dict[str, dict], dict]:
    raw_boards = game.get("_zilch_boards")
    if not isinstance(raw_boards, dict):
        raise ZilchResultValidationError("zilch_result_invalid_boards")
    boards: dict[str, dict] = {}
    highest_banked_round = 0
    zilch_count = 0
    penalties: list[dict] = []
    hot_dice_count = 0
    hot_dice_complete = True
    for participant_id in participant_ids:
        raw_board = raw_boards.get(participant_id)
        if not isinstance(raw_board, dict):
            raise ZilchResultValidationError("zilch_result_invalid_boards")
        rounds_raw = raw_board.get("rounds")
        if not isinstance(rounds_raw, list):
            raise ZilchResultValidationError("zilch_result_invalid_boards")
        rounds: list[dict] = []
        for raw_round in rounds_raw:
            entry, banked, zilches, penalty, round_hot_dice, round_hot_dice_complete = _round_payload(
                raw_round,
                participant_id=participant_id,
            )
            rounds.append(entry)
            highest_banked_round = max(highest_banked_round, banked)
            zilch_count += zilches
            if penalty:
                penalties.append(
                    {
                        "participant_id": participant_id,
                        "turn_id": entry["turn_id"],
                        "round": entry["round"],
                        "points": penalty,
                    }
                )
            if round_hot_dice is not None:
                hot_dice_count += round_hot_dice
            hot_dice_complete = hot_dice_complete and round_hot_dice_complete
        boards[participant_id] = {
            "participant_id": participant_id,
            "total_points": _integer(raw_board.get("total_points"), "zilch_result_invalid_boards"),
            "round_points": _integer(raw_board.get("round_points"), "zilch_result_invalid_boards"),
            "zilch_streak": _integer(raw_board.get("zilch_streak"), "zilch_result_invalid_boards"),
            "rounds": rounds,
        }
    return boards, {
        "highest_banked_round": highest_banked_round,
        "zilch_count": zilch_count,
        "zilch_penalties": penalties,
        "hot_dice_events": hot_dice_count if hot_dice_complete else None,
        "hot_dice_events_complete": hot_dice_complete,
    }


def _final_round_payload(raw: object, participant_ids: list[str]) -> dict | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ZilchResultValidationError("zilch_result_invalid_final_round")
    triggered_by = _required_text(raw.get("triggered_by"), "zilch_result_invalid_final_round")
    if triggered_by not in participant_ids:
        raise ZilchResultValidationError("zilch_result_invalid_final_round")
    pending = raw.get("pending_player_ids")
    if not isinstance(pending, list) or any(str(value) not in participant_ids for value in pending):
        raise ZilchResultValidationError("zilch_result_invalid_final_round")
    return {
        "triggered_by": triggered_by,
        "target_score": _integer(raw.get("target_score"), "zilch_result_invalid_final_round", minimum=1),
        "pending_player_ids": [str(value) for value in pending],
    }


def _outcome_payload(raw: object, participant_ids: list[str], boards: dict[str, dict], target_score: int) -> dict:
    if not isinstance(raw, dict) or raw.get("status") != "completed":
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    if _integer(raw.get("target_score"), "zilch_result_invalid_outcome", minimum=1) != target_score:
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    raw_totals = raw.get("totals")
    if not isinstance(raw_totals, dict) or set(map(str, raw_totals)) != set(participant_ids):
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    totals = {
        participant_id: _integer(raw_totals.get(participant_id), "zilch_result_invalid_outcome")
        for participant_id in participant_ids
    }
    if any(totals[participant_id] != boards[participant_id]["total_points"] for participant_id in participant_ids):
        raise ZilchResultValidationError("zilch_result_board_total_mismatch")
    winner_ids = raw.get("winner_ids")
    if not isinstance(winner_ids, list) or any(str(value) not in participant_ids for value in winner_ids):
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    cleaned_winners = [str(value) for value in winner_ids]
    if len(set(cleaned_winners)) != len(cleaned_winners) or not cleaned_winners:
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    highest = max(totals.values())
    expected_winners = [participant_id for participant_id in participant_ids if totals[participant_id] == highest]
    if cleaned_winners != expected_winners:
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    tied = bool(raw.get("tied"))
    winner_id = raw.get("winner_id")
    if tied != (len(expected_winners) > 1):
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    if (winner_id is None) != tied or (winner_id is not None and str(winner_id) != expected_winners[0]):
        raise ZilchResultValidationError("zilch_result_invalid_outcome")
    return {
        "status": "completed",
        "target_score": target_score,
        "totals": totals,
        "winner_ids": expected_winners,
        "winner_id": None if tied else expected_winners[0],
        "tied": tied,
    }


def build_zilch_result_payload(game: dict) -> dict:
    """Build one immutable v1 result from a fully authoritative terminal state.

    This intentionally does *not* invoke the forgiving live-state hydrator.
    If an old preview state lacks a field that cannot be known (notably an end
    timestamp), recovery leaves it active and reports a precise failure.
    """
    try:
        if game_type_from_state(game) != ZILCH_GAME_TYPE:
            raise ZilchResultValidationError("zilch_result_wrong_game_type")
    except ValueError as exc:
        raise ZilchResultValidationError("zilch_result_wrong_game_type") from exc
    if not game.get("_finished") or game.get("_aborted"):
        raise ZilchResultValidationError("zilch_result_not_terminal")
    if game.get("_zilch_ruleset") != ZILCH_RULESET_VERSION:
        raise ZilchResultValidationError("zilch_result_unknown_ruleset")
    game_id = _required_text(game.get("_id"), "zilch_result_missing_game_id", limit=64)
    game_name = str(game.get("_name") or "")[:160]
    started_at = _timestamp(game.get("_started_at"), "zilch_result_missing_started_at")
    finished_at = _timestamp(game.get("_finished_at"), "zilch_result_missing_finished_at")
    if finished_at < started_at:
        raise ZilchResultValidationError("zilch_result_invalid_duration")
    participants, participant_ids = _participant_payloads(game)
    target_score = _integer(game.get("_target_score"), "zilch_result_invalid_target", minimum=1)
    if target_score != ZILCH_TARGET_SCORE:
        raise ZilchResultValidationError("zilch_result_unknown_target")
    play_mode = _required_text(game.get("_play_mode"), "zilch_result_invalid_mode", limit=24)
    mode = _required_text(game.get("_mode"), "zilch_result_invalid_mode", limit=16)
    start_roll = _start_roll_payload(game.get("_zilch_start_roll"), participant_ids)
    boards, metrics = _board_payloads(game, participant_ids)
    final_round = _final_round_payload(game.get("_zilch_final_round"), participant_ids)
    outcome = _outcome_payload(game.get("_zilch_outcome"), participant_ids, boards, target_score)
    if final_round is not None:
        # A consumed full reply leaves no pending player.  Anything else is a
        # premature terminal state rather than a historic completed game.
        if final_round["pending_player_ids"]:
            raise ZilchResultValidationError("zilch_result_incomplete_final_round")
        if outcome["winner_ids"] and final_round["triggered_by"] not in participant_ids:
            raise ZilchResultValidationError("zilch_result_invalid_final_round")
    return {
        "schema_version": ZILCH_RESULT_SCHEMA_VERSION,
        "payload_kind": ZILCH_RESULT_PAYLOAD_KIND,
        "game_type": ZILCH_GAME_TYPE,
        "game_id": game_id,
        "game_name": game_name,
        "ruleset": ZILCH_RULESET_VERSION,
        "play_mode": play_mode,
        "mode": mode,
        "target_score": target_score,
        "started_at": _timestamp_payload(started_at),
        "finished_at": _timestamp_payload(finished_at),
        "duration_seconds": int((finished_at - started_at).total_seconds()),
        "participants": participants,
        "participant_order": participant_ids,
        "start_roll": start_roll,
        "boards": boards,
        "totals": outcome["totals"],
        "final_round": final_round,
        "outcome": outcome,
        "metrics": metrics,
    }


def _result_participants(payload: dict) -> list[dict]:
    return [
        {
            "position": participant["position"],
            "player_key": participant["player_key"],
            "display_name": participant["display_name"],
            "team": None,
            "points": int(payload["totals"][participant["participant_id"]]),
            "user_id": participant.get("user_id"),
        }
        for participant in payload["participants"]
    ]


def _write_response(result: CompletedGameWriteResult, *, payload: dict | None = None) -> dict:
    response = {
        "result_persisted": result.succeeded,
        "result_id": result.game_id if result.succeeded else None,
        "result_url": f"/zilch/ergebnis/{result.game_id}" if result.succeeded else None,
        "result_write_status": result.status,
    }
    if result.reason:
        response["persistence_error"] = result.reason
    if payload is not None:
        response["result_schema_version"] = payload["schema_version"]
    return response


def finalize_zilch_result(game: dict) -> dict:
    """Idempotently persist one Zilch terminal state, then remove it actively."""
    try:
        payload = build_zilch_result_payload(game)
    except ZilchResultValidationError as exc:
        # Preserve the terminal ActiveGame row.  Startup recovery can retry a
        # later compatible build, but must never manufacture missing history.
        logger.warning("Retaining terminal Zilch game %s: %s", game.get("_id"), exc.code)
        return {
            "result_persisted": False,
            "result_id": None,
            "result_write_status": "failed",
            "persistence_error": exc.code,
        }
    result = persist_completed_game_result(
        game_id=payload["game_id"],
        game_name=payload["game_name"],
        game_type=ZILCH_GAME_TYPE,
        mode=payload["mode"],
        hardcore=False,
        finished_at=_timestamp(payload["finished_at"], "zilch_result_invalid_finished_at"),
        snapshot=payload,
        participants=_result_participants(payload),
    )
    response = _write_response(result, payload=payload)
    if not result.succeeded:
        logger.error(
            "Could not persist terminal Zilch game %s: %s",
            payload["game_id"],
            result.reason or result.status,
        )
        return response
    # This state may still be in memory long enough to deliver the terminal
    # socket snapshot.  The marker prevents that final broadcast from creating
    # a new ActiveGame record after the confirmed deletion.
    game["_zilch_result"] = {
        "game_id": payload["game_id"],
        "schema_version": ZILCH_RESULT_SCHEMA_VERSION,
        "result_url": response["result_url"],
    }
    game["_completion_persisted"] = True
    delete_active_game(payload["game_id"])
    return response


def _validate_stored_payload(payload: dict) -> None:
    """Reject a damaged historic payload before exposing it to a projection.

    The builder validates a live terminal state before it is written, but a
    database row can still be damaged by an operator, a future migration, or a
    failed manual repair.  Stored Zilch reports are read-only; failing closed
    is safer than making a browser reconstruct an incomplete result.
    """
    if (
        payload.get("payload_kind") != ZILCH_RESULT_PAYLOAD_KIND
        or payload.get("schema_version") != ZILCH_RESULT_SCHEMA_VERSION
        or payload.get("game_type") != ZILCH_GAME_TYPE
    ):
        raise ZilchResultValidationError("zilch_result_unknown_payload_schema")
    _required_text(payload.get("game_id"), "zilch_result_missing_game_id", limit=64)
    if payload.get("ruleset") != ZILCH_RULESET_VERSION:
        raise ZilchResultValidationError("zilch_result_unknown_ruleset")
    started_at = _timestamp(payload.get("started_at"), "zilch_result_missing_started_at")
    finished_at = _timestamp(payload.get("finished_at"), "zilch_result_missing_finished_at")
    duration_seconds = _integer(payload.get("duration_seconds"), "zilch_result_invalid_duration")
    if finished_at < started_at or duration_seconds != int((finished_at - started_at).total_seconds()):
        raise ZilchResultValidationError("zilch_result_invalid_duration")
    target_score = _integer(payload.get("target_score"), "zilch_result_invalid_target", minimum=1)
    if target_score != ZILCH_TARGET_SCORE:
        raise ZilchResultValidationError("zilch_result_unknown_target")
    _required_text(payload.get("play_mode"), "zilch_result_invalid_mode", limit=24)
    _required_text(payload.get("mode"), "zilch_result_invalid_mode", limit=16)

    raw_participants = payload.get("participants")
    if not isinstance(raw_participants, list) or not 1 <= len(raw_participants) <= 2:
        raise ZilchResultValidationError("zilch_result_invalid_participants")
    participant_ids: list[str] = []
    for position, participant in enumerate(raw_participants):
        if not isinstance(participant, dict):
            raise ZilchResultValidationError("zilch_result_invalid_participants")
        if _integer(participant.get("position"), "zilch_result_invalid_participants") != position:
            raise ZilchResultValidationError("zilch_result_invalid_participants")
        participant_id = _required_text(
            participant.get("participant_id"),
            "zilch_result_invalid_participant_id",
            limit=64,
        )
        if participant_id in participant_ids:
            raise ZilchResultValidationError("zilch_result_duplicate_participant")
        _required_text(participant.get("player_key"), "zilch_result_invalid_participant_id", limit=64)
        _required_text(participant.get("display_name"), "zilch_result_invalid_participant_name", limit=64)
        participant_type = participant.get("participant_type")
        if participant_type not in {"human", "cpu"}:
            raise ZilchResultValidationError("zilch_result_invalid_participant_type")
        user_id = _optional_user_id(participant.get("user_id"))
        cpu_strategy = participant.get("cpu_strategy")
        if cpu_strategy is not None and not isinstance(cpu_strategy, str):
            raise ZilchResultValidationError("zilch_result_invalid_cpu_strategy")
        if participant_type == "human" and cpu_strategy is not None:
            raise ZilchResultValidationError("zilch_result_invalid_cpu_strategy")
        if participant_type == "cpu" and user_id is not None:
            raise ZilchResultValidationError("zilch_result_invalid_cpu_user")
        participant_ids.append(participant_id)
    if [str(value) for value in payload.get("participant_order", [])] != participant_ids:
        raise ZilchResultValidationError("zilch_result_invalid_participants")

    raw_start_roll = payload.get("start_roll")
    if not isinstance(raw_start_roll, dict):
        raise ZilchResultValidationError("zilch_result_invalid_start_roll")
    _start_roll_payload(
        {
            "phase": "resolved",
            "player_ids": participant_ids,
            "winner_id": raw_start_roll.get("winner_id"),
            "tied": False,
            "attempts": raw_start_roll.get("attempts"),
        },
        participant_ids,
    )

    raw_boards = payload.get("boards")
    if not isinstance(raw_boards, dict) or set(raw_boards) != set(participant_ids):
        raise ZilchResultValidationError("zilch_result_invalid_boards")
    boards: dict[str, dict] = {}
    for participant_id in participant_ids:
        board = raw_boards.get(participant_id)
        if not isinstance(board, dict) or str(board.get("participant_id") or "") != participant_id:
            raise ZilchResultValidationError("zilch_result_invalid_boards")
        total_points = _integer(board.get("total_points"), "zilch_result_invalid_boards")
        _integer(board.get("round_points"), "zilch_result_invalid_boards")
        _integer(board.get("zilch_streak"), "zilch_result_invalid_boards")
        rounds = board.get("rounds")
        if not isinstance(rounds, list):
            raise ZilchResultValidationError("zilch_result_invalid_boards")
        for round_entry in rounds:
            _round_payload(round_entry, participant_id=participant_id)
        boards[participant_id] = {"total_points": total_points}

    final_round = _final_round_payload(payload.get("final_round"), participant_ids)
    if final_round is not None and final_round["pending_player_ids"]:
        raise ZilchResultValidationError("zilch_result_incomplete_final_round")
    outcome = _outcome_payload(payload.get("outcome"), participant_ids, boards, target_score)
    if payload.get("totals") != outcome["totals"]:
        raise ZilchResultValidationError("zilch_result_invalid_outcome")

    metrics = payload.get("metrics")
    if not isinstance(metrics, dict):
        raise ZilchResultValidationError("zilch_result_invalid_metrics")
    _integer(metrics.get("highest_banked_round"), "zilch_result_invalid_metrics")
    _integer(metrics.get("zilch_count"), "zilch_result_invalid_metrics")
    penalties = metrics.get("zilch_penalties")
    if not isinstance(penalties, list):
        raise ZilchResultValidationError("zilch_result_invalid_metrics")
    for penalty in penalties:
        if not isinstance(penalty, dict) or str(penalty.get("participant_id") or "") not in participant_ids:
            raise ZilchResultValidationError("zilch_result_invalid_metrics")
        _integer(penalty.get("turn_id"), "zilch_result_invalid_metrics", minimum=1)
        _integer(penalty.get("round"), "zilch_result_invalid_metrics", minimum=1)
        _integer(penalty.get("points"), "zilch_result_invalid_metrics")
    hot_dice_events = metrics.get("hot_dice_events")
    if hot_dice_events is not None:
        _integer(hot_dice_events, "zilch_result_invalid_metrics")
    if type(metrics.get("hot_dice_events_complete")) is not bool:
        raise ZilchResultValidationError("zilch_result_invalid_metrics")
def _stored_payload(row: CompletedGame) -> dict | None:
    if row.game_type != ZILCH_GAME_TYPE:
        return None
    try:
        payload = json.loads(row.snapshot_json)
    except (TypeError, json.JSONDecodeError):
        logger.error("Stored Zilch result %s has malformed JSON", row.game_id)
        return None
    if not isinstance(payload, dict) or str(payload.get("game_id") or "") != row.game_id:
        logger.error("Stored Zilch result %s has malformed payload identity", row.game_id)
        return None
    try:
        _validate_stored_payload(payload)
    except ZilchResultValidationError as exc:
        logger.error("Stored Zilch result %s is unavailable: %s", row.game_id, exc.code)
        return None
    return payload


def load_zilch_result(game_id: str) -> dict | None:
    """Load one known-version Zilch payload without performing HTTP auth."""
    if not database_schema_ready():
        return None
    with session_scope() as db:
        row = db.scalar(
            select(CompletedGame).where(
                CompletedGame.game_id == str(game_id),
                CompletedGame.game_type == ZILCH_GAME_TYPE,
            )
        )
        return _stored_payload(row) if row is not None else None


def list_zilch_results_for_user(user_id: int, *, limit: int = 30) -> list[dict]:
    """List only a preview user's own Zilch records, newest first."""
    if not database_schema_ready():
        return []
    clean_limit = max(1, min(int(limit), 100))
    with session_scope() as db:
        rows = db.scalars(
            select(CompletedGame)
            .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
            .where(
                CompletedGame.game_type == ZILCH_GAME_TYPE,
                GameParticipant.user_id == int(user_id),
            )
            .order_by(CompletedGame.finished_at.desc(), CompletedGame.id.desc())
            .limit(clean_limit)
        ).all()
        payloads = [_stored_payload(row) for row in rows]
    summaries: list[dict] = []
    for payload in payloads:
        if payload is None:
            continue
        summaries.append(
            {
                "game_id": payload["game_id"],
                "game_name": payload["game_name"],
                "finished_at": payload["finished_at"],
                "participants": payload["participants"],
                "totals": payload["totals"],
                "outcome": payload["outcome"],
                "result_url": f"/zilch/ergebnis/{payload['game_id']}",
            }
        )
    return summaries
