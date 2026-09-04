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
from .zilch_cpu_strategy import ZilchCpuStrategyError, validate_zilch_cpu_strategy
from .zilch_engine import ZILCH_RULESET_VERSION, ZILCH_TARGET_SCORE
from .zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    ZILCH_SOLO_SPRINT_TARGET_SCORE,
    ZilchSoloObjectiveError,
    zilch_solo_objective_state_from_payload,
)

logger = logging.getLogger(__name__)

# Keep the existing competitive payload frozen at v1.  Persisted Human-vs-
# Human and Human-vs-CPU records must remain readable after solo arrives;
# solo therefore gets its own explicitly typed v2 projection rather than
# changing the old result contract in place.
ZILCH_RESULT_SCHEMA_VERSION = 1
ZILCH_RESULT_PAYLOAD_KIND = "zilch_result"
ZILCH_SOLO_RESULT_SCHEMA_VERSION = 2
ZILCH_SOLO_RESULT_PAYLOAD_KIND = "zilch_solo_result"


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
        if participant_type == "cpu":
            if user_id is not None:
                raise ZilchResultValidationError("zilch_result_invalid_cpu_user")
            if raw.get("connection_player_id") is not None:
                raise ZilchResultValidationError("zilch_result_invalid_cpu_connection")
            try:
                cpu_strategy = validate_zilch_cpu_strategy(cpu_strategy)
            except ZilchCpuStrategyError as exc:
                raise ZilchResultValidationError("zilch_result_invalid_cpu_strategy") from exc
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
    raw_player_ids = raw.get("player_ids")
    if not isinstance(raw_player_ids, list) or [str(value) for value in raw_player_ids] != participant_ids:
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


def _validate_board_round_totals(boards: dict[str, dict]) -> None:
    """Ensure the durable round history agrees with every board total.

    Statistics intentionally derive per-player banked points and round counts
    from the authoritative history.  A JSON row that changes an individual
    round while leaving its board total untouched is therefore damaged, even
    when its coarse top-level metrics still happen to look plausible.
    """
    for board in boards.values():
        running_total = 0
        rounds = board.get("rounds")
        if not isinstance(rounds, list):
            raise ZilchResultValidationError("zilch_result_invalid_boards")
        for round_entry in rounds:
            if not isinstance(round_entry, dict):
                raise ZilchResultValidationError("zilch_result_invalid_round")
            if round_entry.get("event") == "bank":
                running_total += _integer(round_entry.get("points"), "zilch_result_invalid_round")
            elif round_entry.get("event") == "zilch":
                # The stored penalty is a positive deduction.  Engine state
                # clamps the affected board at zero after that deduction.
                running_total = max(
                    0,
                    running_total - _integer(round_entry.get("penalty"), "zilch_result_invalid_round"),
                )
            else:
                raise ZilchResultValidationError("zilch_result_invalid_round")
            if _integer(round_entry.get("total_after"), "zilch_result_invalid_round") != running_total:
                raise ZilchResultValidationError("zilch_result_board_total_mismatch")
        if _integer(board.get("total_points"), "zilch_result_invalid_boards") != running_total:
            raise ZilchResultValidationError("zilch_result_board_total_mismatch")


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


def _solo_outcome_payload(raw: object, *, total_points: int, target_score: int) -> dict:
    """Project the non-competitive terminal outcome of one solo run.

    A solo objective is not a disguised one-player match.  In particular, it
    has no winner, tie, opponent, final reply, or opening-roll meaning.  Do
    not accept those fields even as optional historic baggage: a terminal
    active state with them belongs to a different lifecycle and should remain
    available for diagnosis rather than be persisted under the wrong type.
    """
    if not isinstance(raw, dict):
        raise ZilchResultValidationError("zilch_result_invalid_solo_outcome")
    forbidden = {"winner_id", "winner_ids", "tied", "final_round", "opponent_id"}
    if forbidden.intersection(raw):
        raise ZilchResultValidationError("zilch_result_invalid_solo_outcome")
    status = raw.get("status")
    if status not in {"completed", "abandoned"}:
        raise ZilchResultValidationError("zilch_result_invalid_solo_outcome")
    if status == "completed" and total_points < target_score:
        raise ZilchResultValidationError("zilch_result_invalid_solo_outcome")
    # Reaching the approved objective ends the run immediately.  An
    # ``abandoned`` run must therefore not manufacture an alternate success
    # outcome after the objective was already achieved.
    if status == "abandoned" and total_points >= target_score:
        raise ZilchResultValidationError("zilch_result_invalid_solo_outcome")
    return {"status": status, "objective_completed": status == "completed"}


def _solo_objective_payload(
    raw: object,
    *,
    outcome_status: str,
    total_points: int,
    duration_seconds: int,
    allow_result_ranking: bool = False,
) -> tuple[dict, dict]:
    """Sanitize the approved v1 sprint objective and its authoritative metrics.

    The active state deliberately stores the objective envelope separately
    from the turn engine.  Result persistence reads that one serialized
    source of truth; it does not derive a challenge score from browser data
    or infer an objective merely from ``mode == '1'``.
    """
    if not isinstance(raw, dict):
        raise ZilchResultValidationError("zilch_result_invalid_solo_objective")
    ranking = raw.get("ranking")
    has_ranking = "ranking" in raw
    expected_ranking = {
        "primary": "turns",
        "tie_breakers": ["rolls", "zilchs", "active_duration_seconds"],
    }
    if has_ranking and (not allow_result_ranking or ranking != expected_ranking):
        raise ZilchResultValidationError("zilch_result_invalid_solo_objective")
    objective_state_payload = {key: value for key, value in raw.items() if key != "ranking"}
    # Keep the result boundary coupled to the pure objective contract rather
    # than accepting free-form client or recovered-state parameters.  Its
    # parser also rejects unknown fields, incomplete metrics, and impossible
    # objective completion before a historic row can be written.
    try:
        objective_state = zilch_solo_objective_state_from_payload(objective_state_payload)
        canonical_objective_state = objective_state.payload()
    except (TypeError, ValueError, ZilchSoloObjectiveError) as exc:
        raise ZilchResultValidationError("zilch_result_invalid_solo_objective") from exc
    if objective_state_payload != canonical_objective_state:
        raise ZilchResultValidationError("zilch_result_invalid_solo_objective")
    objective_id = _required_text(
        canonical_objective_state.get("id"), "zilch_result_invalid_solo_objective", limit=80
    )
    objective_version = _integer(
        canonical_objective_state.get("version"), "zilch_result_invalid_solo_objective", minimum=1
    )
    parameters = canonical_objective_state.get("parameters")
    if (
        objective_id != ZILCH_SOLO_SPRINT_OBJECTIVE_ID
        or objective_version != ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION
        or parameters != {}
    ):
        raise ZilchResultValidationError("zilch_result_invalid_solo_objective")

    raw_progress = canonical_objective_state["progress"]
    progress = {
        "target_score": _integer(
            raw_progress.get("target_score"), "zilch_result_invalid_solo_progress", minimum=1
        ),
        "total_points": _integer(raw_progress.get("total_points"), "zilch_result_invalid_solo_progress"),
        "turns": _integer(raw_progress.get("turns"), "zilch_result_invalid_solo_progress"),
        "rolls": _integer(raw_progress.get("rolls"), "zilch_result_invalid_solo_progress"),
        "zilchs": _integer(raw_progress.get("zilchs"), "zilch_result_invalid_solo_progress"),
        "hot_dice_events": _integer(
            raw_progress.get("hot_dice_events"), "zilch_result_invalid_solo_progress"
        ),
        "highest_banked_round": _integer(
            raw_progress.get("highest_banked_round"), "zilch_result_invalid_solo_progress"
        ),
        "active_duration_seconds": _integer(
            raw_progress.get("active_duration_seconds"), "zilch_result_invalid_solo_progress"
        ),
    }
    if progress["target_score"] != ZILCH_SOLO_SPRINT_TARGET_SCORE:
        raise ZilchResultValidationError("zilch_result_invalid_solo_progress")
    if progress["total_points"] != total_points:
        raise ZilchResultValidationError("zilch_result_invalid_solo_progress")
    if progress["active_duration_seconds"] > duration_seconds:
        raise ZilchResultValidationError("zilch_result_invalid_solo_progress")
    if raw.get("outcome") != outcome_status:
        raise ZilchResultValidationError("zilch_result_invalid_solo_objective")
    return (
        {
            "id": objective_id,
            "version": objective_version,
            "parameters": {},
            "progress": progress,
            "outcome": outcome_status,
            # Stable, explicit future ranking order.  It is recorded for
            # historic interpretation only; Part 7 creates no leaderboard.
            "ranking": expected_ranking,
        },
        progress,
    )


def _solo_metrics_payload(
    raw: object,
    *,
    progress: dict,
    history_metrics: dict,
    board: dict,
    total_points: int,
    target_score: int,
    outcome_status: str,
) -> dict:
    """Cross-check the serialised solo progress against authoritative boards.

    ``_zilch_solo_metrics`` is intentionally a convenience projection, not a
    second source of truth.  Requiring it to agree with the objective and
    completed round history catches malformed recovery JSON without making
    result reads depend on a browser-side calculation.
    """
    if not isinstance(raw, dict):
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    hot_dice_value = raw.get("hot_dice_events", raw.get("hot_dice"))
    if "hot_dice_events" in raw and "hot_dice" in raw and raw["hot_dice_events"] != raw["hot_dice"]:
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    metrics = {
        "turns": _integer(raw.get("turns"), "zilch_result_invalid_solo_metrics"),
        "rolls": _integer(raw.get("rolls"), "zilch_result_invalid_solo_metrics"),
        "zilchs": _integer(raw.get("zilchs"), "zilch_result_invalid_solo_metrics"),
        "hot_dice_events": _integer(hot_dice_value, "zilch_result_invalid_solo_metrics"),
        "highest_banked_round": _integer(
            raw.get("highest_banked_round"), "zilch_result_invalid_solo_metrics"
        ),
        "active_duration_seconds": _integer(
            raw.get("active_duration_seconds"), "zilch_result_invalid_solo_metrics"
        ),
        "remaining_points": _integer(raw.get("remaining_points"), "zilch_result_invalid_solo_metrics"),
    }
    for key in (
        "turns",
        "rolls",
        "zilchs",
        "hot_dice_events",
        "highest_banked_round",
        "active_duration_seconds",
    ):
        if metrics[key] != progress[key]:
            raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    if metrics["remaining_points"] != max(0, target_score - total_points):
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    if not history_metrics.get("hot_dice_events_complete"):
        raise ZilchResultValidationError("zilch_result_incomplete_solo_round_history")
    if metrics["zilchs"] != history_metrics["zilch_count"]:
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    if metrics["hot_dice_events"] != history_metrics["hot_dice_events"]:
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    if metrics["highest_banked_round"] != history_metrics["highest_banked_round"]:
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    rounds = board.get("rounds") if isinstance(board, dict) else None
    if not isinstance(rounds, list):
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    completed_turns = len(rounds)
    if outcome_status == "completed":
        if metrics["turns"] != completed_turns:
            raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    elif metrics["turns"] not in {completed_turns, completed_turns + 1}:
        # An abandon can happen before or during one unfinished local turn;
        # it cannot legitimately skip an arbitrary number of board entries.
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    completed_rolls = sum(_integer(round_entry.get("rolls_used"), "zilch_result_invalid_round") for round_entry in rounds)
    if metrics["rolls"] < completed_rolls:
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    return {
        "turns": metrics["turns"],
        "rolls": metrics["rolls"],
        "zilch_count": metrics["zilchs"],
        "hot_dice_events": metrics["hot_dice_events"],
        "hot_dice_events_complete": True,
        "highest_banked_round": metrics["highest_banked_round"],
        "active_duration_seconds": metrics["active_duration_seconds"],
        "remaining_points": metrics["remaining_points"],
        "zilch_penalties": history_metrics["zilch_penalties"],
    }


def _build_zilch_solo_result_payload(game: dict) -> dict:
    """Build the distinct v2 payload for the approved 10,000-point sprint."""
    try:
        if game_type_from_state(game) != ZILCH_GAME_TYPE:
            raise ZilchResultValidationError("zilch_result_wrong_game_type")
    except ValueError as exc:
        raise ZilchResultValidationError("zilch_result_wrong_game_type") from exc
    if not game.get("_finished") or game.get("_aborted"):
        raise ZilchResultValidationError("zilch_result_not_terminal")
    if game.get("_zilch_ruleset") != ZILCH_RULESET_VERSION:
        raise ZilchResultValidationError("zilch_result_unknown_ruleset")
    if game.get("_play_mode") != "solo" or game.get("_mode") != "1":
        raise ZilchResultValidationError("zilch_result_invalid_solo_mode")
    if game.get("_zilch_start_roll") is not None or game.get("_zilch_final_round") is not None:
        raise ZilchResultValidationError("zilch_result_invalid_solo_lifecycle")
    game_id = _required_text(game.get("_id"), "zilch_result_missing_game_id", limit=64)
    game_name = str(game.get("_name") or "")[:160]
    started_at = _timestamp(game.get("_started_at"), "zilch_result_missing_started_at")
    finished_at = _timestamp(game.get("_finished_at"), "zilch_result_missing_finished_at")
    if finished_at < started_at:
        raise ZilchResultValidationError("zilch_result_invalid_duration")
    duration_seconds = int((finished_at - started_at).total_seconds())
    target_score = _integer(game.get("_target_score"), "zilch_result_invalid_target", minimum=1)
    if target_score != ZILCH_TARGET_SCORE or target_score != ZILCH_SOLO_SPRINT_TARGET_SCORE:
        raise ZilchResultValidationError("zilch_result_unknown_target")
    participants, participant_ids = _participant_payloads(game)
    if len(participants) != 1 or participants[0]["participant_type"] != "human":
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")
    boards, history_metrics = _board_payloads(game, participant_ids)
    _validate_board_round_totals(boards)
    participant_id = participant_ids[0]
    board = boards[participant_id]
    total_points = board["total_points"]
    raw_totals = game.get("_total_points")
    if not isinstance(raw_totals, dict) or set(map(str, raw_totals)) != {participant_id}:
        raise ZilchResultValidationError("zilch_result_invalid_solo_totals")
    if _integer(raw_totals.get(participant_id), "zilch_result_invalid_solo_totals") != total_points:
        raise ZilchResultValidationError("zilch_result_board_total_mismatch")
    outcome = _solo_outcome_payload(game.get("_zilch_outcome"), total_points=total_points, target_score=target_score)
    objective, progress = _solo_objective_payload(
        game.get("_zilch_solo_objective"),
        outcome_status=outcome["status"],
        total_points=total_points,
        duration_seconds=duration_seconds,
    )
    metrics = _solo_metrics_payload(
        game.get("_zilch_solo_metrics"),
        progress=progress,
        history_metrics=history_metrics,
        board=board,
        total_points=total_points,
        target_score=target_score,
        outcome_status=outcome["status"],
    )
    return {
        "schema_version": ZILCH_SOLO_RESULT_SCHEMA_VERSION,
        "payload_kind": ZILCH_SOLO_RESULT_PAYLOAD_KIND,
        "game_type": ZILCH_GAME_TYPE,
        "game_id": game_id,
        "game_name": game_name,
        "ruleset": ZILCH_RULESET_VERSION,
        "play_mode": "solo",
        "mode": "1",
        "target_score": target_score,
        "started_at": _timestamp_payload(started_at),
        "finished_at": _timestamp_payload(finished_at),
        "duration_seconds": duration_seconds,
        "participants": participants,
        "participant_order": participant_ids,
        "boards": boards,
        "totals": {participant_id: total_points},
        "objective": objective,
        "outcome": outcome,
        "metrics": metrics,
    }


def _build_competitive_zilch_result_payload(game: dict) -> dict:
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
    if mode != "2":
        raise ZilchResultValidationError("zilch_result_invalid_mode")
    if play_mode == "multiplayer":
        if len(participants) != 2 or any(participant["participant_type"] != "human" for participant in participants):
            raise ZilchResultValidationError("zilch_result_invalid_multiplayer_participants")
    elif play_mode == "cpu":
        participant_types = [participant["participant_type"] for participant in participants]
        if participant_types.count("human") != 1 or participant_types.count("cpu") != 1:
            raise ZilchResultValidationError("zilch_result_invalid_cpu_participants")
    else:
        raise ZilchResultValidationError("zilch_result_invalid_mode")
    start_roll = _start_roll_payload(game.get("_zilch_start_roll"), participant_ids)
    boards, metrics = _board_payloads(game, participant_ids)
    _validate_board_round_totals(boards)
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


def build_zilch_result_payload(game: dict) -> dict:
    """Build the typed historic projection selected by the durable play mode.

    The dispatch is intentionally at the persistence boundary.  Gameplay
    remains free of result/database concerns and established multiplayer/CPU
    records keep their exact v1 format.
    """
    if game.get("_play_mode") == "solo":
        return _build_zilch_solo_result_payload(game)
    return _build_competitive_zilch_result_payload(game)


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
    """Persist one terminal Zilch result and register its private awards.

    Result persistence stays the first durable boundary.  A transient award
    failure must never lose that result, but it keeps this terminal active
    state recoverable until the explicit evaluation work item succeeds.
    """
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
        "schema_version": payload["schema_version"],
        "result_url": response["result_url"],
    }
    try:
        # Keep this import local: result-only tools and migrations do not need
        # to load the independent achievement persistence model eagerly.
        # The service evaluates only the validated, already stored result and
        # never places a user's private awards in a shared game snapshot.
        from .zilch_achievements import (  # pylint: disable=import-outside-toplevel
            ZilchAchievementError,
            ZilchAchievementSyncError,
            register_zilch_result_for_achievements,
        )

        registration = register_zilch_result_for_achievements(payload["game_id"])
    except (ZilchAchievementSyncError, ZilchAchievementError) as exc:
        logger.exception(
            "Retaining terminal Zilch game %s until achievement evaluation recovers: %s",
            payload["game_id"],
            exc.code,
        )
        # The result itself is already idempotently stored.  Startup recovery
        # retries this finalizer, which can only finish registration/evaluation
        # and cannot duplicate the completed game.
        response["achievement_sync_pending"] = True
        response["achievement_sync_error"] = exc.code
        return response
    response["achievement_sync_pending"] = bool(registration.pending)
    if registration.pending:
        # Preserve the same recovery contract if evaluation becomes async.
        return response
    game["_completion_persisted"] = True
    delete_active_game(payload["game_id"])
    return response


def _validate_v1_stored_payload(payload: dict) -> None:
    """Validate the frozen Human-vs-Human/CPU v1 result contract.

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
    play_mode = _required_text(payload.get("play_mode"), "zilch_result_invalid_mode", limit=24)
    if _required_text(payload.get("mode"), "zilch_result_invalid_mode", limit=16) != "2":
        raise ZilchResultValidationError("zilch_result_invalid_mode")

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
        if participant_type == "cpu":
            if user_id is not None:
                raise ZilchResultValidationError("zilch_result_invalid_cpu_user")
            try:
                validate_zilch_cpu_strategy(cpu_strategy)
            except ZilchCpuStrategyError as exc:
                raise ZilchResultValidationError("zilch_result_invalid_cpu_strategy") from exc
        participant_ids.append(participant_id)
    # Stored payloads are untrusted historic data.  Keep the same CPU-seat
    # invariant as the live result builder so a damaged row can neither make
    # a CPU look like a human game nor expose an impossible CPU composition.
    participant_types = [participant.get("participant_type") for participant in raw_participants]
    if play_mode == "multiplayer":
        if len(raw_participants) != 2 or any(participant_type != "human" for participant_type in participant_types):
            raise ZilchResultValidationError("zilch_result_invalid_multiplayer_participants")
    elif play_mode == "cpu":
        if participant_types.count("human") != 1 or participant_types.count("cpu") != 1:
            raise ZilchResultValidationError("zilch_result_invalid_cpu_participants")
    else:
        raise ZilchResultValidationError("zilch_result_invalid_mode")
    raw_participant_order = payload.get("participant_order")
    if not isinstance(raw_participant_order, list) or [str(value) for value in raw_participant_order] != participant_ids:
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
    boards, history_metrics = _board_payloads({"_zilch_boards": raw_boards}, participant_ids)
    _validate_board_round_totals(boards)

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
    # A valid JSON record is not necessarily authoritative.  Keep the stored
    # summary tied to the detailed board history before a reader (notably the
    # statistics service) can aggregate it.  This also preserves the v1
    # contract where missing holds make Hot Dice explicitly unknown rather
    # than a fabricated zero.
    for key in ("highest_banked_round", "zilch_count", "zilch_penalties"):
        if metrics.get(key) != history_metrics[key]:
            raise ZilchResultValidationError("zilch_result_metrics_mismatch")
    if history_metrics["hot_dice_events_complete"] and (
        metrics.get("hot_dice_events") != history_metrics["hot_dice_events"]
        or metrics.get("hot_dice_events_complete") is not True
    ):
        raise ZilchResultValidationError("zilch_result_metrics_mismatch")


def _validate_solo_participant_payload(raw: object) -> tuple[dict, str]:
    """Validate the one durable human seat a solo result may expose."""
    if not isinstance(raw, dict):
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")
    if _integer(raw.get("position"), "zilch_result_invalid_solo_participants") != 0:
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")
    participant_id = _required_text(raw.get("participant_id"), "zilch_result_invalid_participant_id", limit=64)
    if _required_text(raw.get("player_key"), "zilch_result_invalid_participant_id", limit=64) != participant_id:
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")
    _required_text(raw.get("display_name"), "zilch_result_invalid_participant_name", limit=64)
    _required_text(raw.get("username"), "zilch_result_invalid_participant_name", limit=64)
    if raw.get("participant_type") != "human" or raw.get("cpu_strategy") is not None:
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")
    if raw.get("connection_player_id") is not None:
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")
    _optional_user_id(raw.get("user_id"))
    return raw, participant_id


def _validate_v2_solo_stored_payload(payload: dict) -> None:
    """Validate the typed v2 solo report without applying v1 match rules."""
    if (
        payload.get("payload_kind") != ZILCH_SOLO_RESULT_PAYLOAD_KIND
        or payload.get("schema_version") != ZILCH_SOLO_RESULT_SCHEMA_VERSION
        or payload.get("game_type") != ZILCH_GAME_TYPE
    ):
        raise ZilchResultValidationError("zilch_result_unknown_payload_schema")
    if "start_roll" in payload or "final_round" in payload:
        raise ZilchResultValidationError("zilch_result_invalid_solo_lifecycle")
    _required_text(payload.get("game_id"), "zilch_result_missing_game_id", limit=64)
    if payload.get("ruleset") != ZILCH_RULESET_VERSION:
        raise ZilchResultValidationError("zilch_result_unknown_ruleset")
    if payload.get("play_mode") != "solo" or payload.get("mode") != "1":
        raise ZilchResultValidationError("zilch_result_invalid_solo_mode")
    started_at = _timestamp(payload.get("started_at"), "zilch_result_missing_started_at")
    finished_at = _timestamp(payload.get("finished_at"), "zilch_result_missing_finished_at")
    duration_seconds = _integer(payload.get("duration_seconds"), "zilch_result_invalid_duration")
    if finished_at < started_at or duration_seconds != int((finished_at - started_at).total_seconds()):
        raise ZilchResultValidationError("zilch_result_invalid_duration")
    target_score = _integer(payload.get("target_score"), "zilch_result_invalid_target", minimum=1)
    if target_score != ZILCH_TARGET_SCORE or target_score != ZILCH_SOLO_SPRINT_TARGET_SCORE:
        raise ZilchResultValidationError("zilch_result_unknown_target")

    participants = payload.get("participants")
    if not isinstance(participants, list) or len(participants) != 1:
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")
    _participant, participant_id = _validate_solo_participant_payload(participants[0])
    if payload.get("participant_order") != [participant_id]:
        raise ZilchResultValidationError("zilch_result_invalid_solo_participants")

    raw_boards = payload.get("boards")
    if not isinstance(raw_boards, dict) or set(raw_boards) != {participant_id}:
        raise ZilchResultValidationError("zilch_result_invalid_boards")
    boards, history_metrics = _board_payloads({"_zilch_boards": raw_boards}, [participant_id])
    _validate_board_round_totals(boards)
    board = boards[participant_id]
    total_points = board["total_points"]
    expected_totals = {participant_id: total_points}
    if payload.get("totals") != expected_totals:
        raise ZilchResultValidationError("zilch_result_invalid_solo_totals")

    outcome = _solo_outcome_payload(payload.get("outcome"), total_points=total_points, target_score=target_score)
    if payload.get("outcome") != outcome:
        raise ZilchResultValidationError("zilch_result_invalid_solo_outcome")
    objective, progress = _solo_objective_payload(
        payload.get("objective"),
        outcome_status=outcome["status"],
        total_points=total_points,
        duration_seconds=duration_seconds,
        allow_result_ranking=True,
    )
    if payload.get("objective") != objective:
        raise ZilchResultValidationError("zilch_result_invalid_solo_objective")
    raw_metrics = payload.get("metrics")
    if not isinstance(raw_metrics, dict):
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")
    projected_live_metrics = {
        "turns": raw_metrics.get("turns"),
        "rolls": raw_metrics.get("rolls"),
        "zilchs": raw_metrics.get("zilch_count"),
        "hot_dice_events": raw_metrics.get("hot_dice_events"),
        "highest_banked_round": raw_metrics.get("highest_banked_round"),
        "active_duration_seconds": raw_metrics.get("active_duration_seconds"),
        "remaining_points": raw_metrics.get("remaining_points"),
    }
    metrics = _solo_metrics_payload(
        projected_live_metrics,
        progress=progress,
        history_metrics=history_metrics,
        board=board,
        total_points=total_points,
        target_score=target_score,
        outcome_status=outcome["status"],
    )
    if raw_metrics != metrics:
        raise ZilchResultValidationError("zilch_result_invalid_solo_metrics")


def _validate_stored_payload(payload: dict) -> None:
    """Fail closed by dispatching only the two known historic payload types."""
    if not isinstance(payload, dict):
        raise ZilchResultValidationError("zilch_result_unknown_payload_schema")
    kind = payload.get("payload_kind")
    version = payload.get("schema_version")
    if kind == ZILCH_RESULT_PAYLOAD_KIND and version == ZILCH_RESULT_SCHEMA_VERSION:
        _validate_v1_stored_payload(payload)
        return
    if kind == ZILCH_SOLO_RESULT_PAYLOAD_KIND and version == ZILCH_SOLO_RESULT_SCHEMA_VERSION:
        _validate_v2_solo_stored_payload(payload)
        return
    raise ZilchResultValidationError("zilch_result_unknown_payload_schema")


def validate_stored_zilch_result_payload(
    payload: object,
    *,
    expected_game_id: str | None = None,
) -> dict | None:
    """Return one known, valid historic Zilch payload or ``None``.

    Result consumers such as the private history, statistics and future
    read-only projections all need the same fail-closed schema boundary.  It
    deliberately exposes *validated data only* rather than the private
    validator details: unknown versions, malformed JSON decoded by a caller,
    and a mismatching durable game ID are unavailable rather than partially
    interpreted.

    The helper does not log by itself because callers can attach useful row or
    request context without leaking the damaged payload to a client.
    """
    if not isinstance(payload, dict):
        return None
    if expected_game_id is not None and str(payload.get("game_id") or "") != str(expected_game_id):
        return None
    try:
        _validate_stored_payload(payload)
    except (KeyError, TypeError, ValueError, ZilchResultValidationError):
        return None
    return payload


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
    except (KeyError, TypeError, ValueError, ZilchResultValidationError) as exc:
        code = exc.code if isinstance(exc, ZilchResultValidationError) else "zilch_result_invalid_payload"
        logger.error("Stored Zilch result %s is unavailable: %s", row.game_id, code)
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


def _browser_result_payload(payload: dict) -> dict:
    """Remove relational account IDs from a validated browser projection."""
    return {
        **payload,
        "participants": [
            {key: value for key, value in participant.items() if key != "user_id"}
            for participant in payload["participants"]
        ],
    }


def load_zilch_result_for_user(game_id: str, user_id: int) -> dict | None:
    """Load one result only when the requesting account participated in it.

    Public-beta access grants use of Zilch, not access to another account's
    full roll history. The relational participant row is the authorization
    source; a guessed ID and an orphaned legacy row therefore remain opaque.
    """
    if not database_schema_ready():
        return None
    with session_scope() as db:
        row = db.scalar(
            select(CompletedGame)
            .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
            .where(
                CompletedGame.game_id == str(game_id),
                CompletedGame.game_type == ZILCH_GAME_TYPE,
                GameParticipant.user_id == int(user_id),
            )
        )
        payload = _stored_payload(row) if row is not None else None
    return _browser_result_payload(payload) if payload is not None else None


def list_zilch_results_for_user(user_id: int, *, limit: int = 30) -> list[dict]:
    """List only an account's own Zilch records, newest first."""
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
        summary = {
            "game_id": payload["game_id"],
            "game_name": payload["game_name"],
            "finished_at": payload["finished_at"],
            "play_mode": payload["play_mode"],
            "participants": _browser_result_payload(payload)["participants"],
            "totals": payload["totals"],
            "outcome": payload["outcome"],
            "result_url": f"/zilch/ergebnis/{payload['game_id']}",
        }
        if payload["play_mode"] == "solo":
            # The lobby needs compact, server-built objective information; it
            # must not recalculate ranking metrics from the round history.
            summary["objective"] = payload["objective"]
            summary["metrics"] = payload["metrics"]
        summaries.append(summary)
    return summaries
