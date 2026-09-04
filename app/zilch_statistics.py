"""Private, typed Zilch statistics and leaderboard projections.

This module is intentionally separate from the established ZDWA statistics
and legacy JSON leaderboard code.  Its only source of truth is a durable
``CompletedGame`` whose explicit ``game_type`` is ``zilch`` and whose result
payload passes the Zilch result validator.  It has no FastAPI, browser, live
game, scorecard, or achievement dependencies.

The current preview data set is deliberately calculated on read.  That keeps
deletion/tombstone behaviour naturally correct: a removed CompletedGame is no
longer a source row, so no second aggregate store has to be invalidated.
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Final, Iterable

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from .database import database_schema_ready, session_scope
from .game_types import ZILCH_GAME_TYPE
from .models import CompletedGame, GameParticipant
from .zilch_cpu_strategy import ZILCH_CPU_STRATEGIES
from .zilch_results import validate_stored_zilch_result_payload
from .zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
)

logger = logging.getLogger(__name__)

ZILCH_STATISTICS_RESPONSE_VERSION: Final = 1
ZILCH_LEADERBOARD_MAX_LIMIT: Final = 100
# The source of a correct all-time aggregation is necessarily the complete
# typed result history.  Read it in bounded database pages so a growing
# private history never becomes one unbounded ORM result set.  The projection
# still only retains the compact, validated values needed for aggregation.
ZILCH_STATISTICS_SOURCE_PAGE_SIZE: Final = 250
ZILCH_LEADERBOARD_SOLO_SPRINT: Final = "solo_sprint"
ZILCH_LEADERBOARD_MULTIPLAYER_WINS: Final = "multiplayer_wins"
ZILCH_LEADERBOARD_CPU_WINS: Final = "cpu_wins"
ZILCH_LEADERBOARD_CATEGORIES: Final[frozenset[str]] = frozenset(
    {
        ZILCH_LEADERBOARD_SOLO_SPRINT,
        ZILCH_LEADERBOARD_MULTIPLAYER_WINS,
        ZILCH_LEADERBOARD_CPU_WINS,
    }
)


class ZilchStatisticsInputError(ValueError):
    """A route supplied an unsupported private statistics query."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class _PlayerResult:
    """One validated human seat from one durable Zilch result."""

    game_id: str
    finished_at: datetime
    payload: dict[str, Any]
    participant: dict[str, Any]
    board: dict[str, Any]
    user_id: int
    display_name: str
    user_is_active: bool

    @property
    def play_mode(self) -> str:
        return str(self.payload["play_mode"])

    @property
    def participant_id(self) -> str:
        return str(self.participant["participant_id"])

    @property
    def final_score(self) -> int:
        return int(self.payload["totals"][self.participant_id])

    @property
    def duration_seconds(self) -> int:
        return int(self.payload["duration_seconds"])


def _strict_positive_int(value: object, code: str) -> int:
    if type(value) is not int or value < 1:
        raise ZilchStatisticsInputError(code)
    return value


def _strict_nonnegative_int(value: object, code: str) -> int:
    if type(value) is not int or value < 0:
        raise ZilchStatisticsInputError(code)
    return value


def _as_utc(value: object) -> datetime:
    """Use a durable timestamp as a deterministic final ordering key."""
    if isinstance(value, datetime):
        parsed = value
    else:
        text = str(value or "")
        parsed = datetime.fromisoformat(text[:-1] + "+00:00" if text.endswith("Z") else text)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _timestamp_text(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _round_two(value: float | None) -> float | None:
    return round(value, 2) if value is not None else None


def _average(values: Iterable[int]) -> float | None:
    materialized = list(values)
    return _round_two(sum(materialized) / len(materialized)) if materialized else None


def _safe_payload(row: CompletedGame) -> dict[str, Any] | None:
    """Decode and validate one typed Zilch row without surfacing raw data."""
    try:
        decoded = json.loads(row.snapshot_json)
    except (TypeError, json.JSONDecodeError):
        logger.warning("Skipping malformed Zilch result %s in statistics", row.game_id)
        return None
    payload = validate_stored_zilch_result_payload(decoded, expected_game_id=row.game_id)
    if payload is None:
        logger.warning("Skipping unavailable Zilch result %s in statistics", row.game_id)
        return None
    return payload


def _human_player_results(rows: Iterable[CompletedGame]) -> list[_PlayerResult]:
    """Project only DB-linked human seats from known Zilch result payloads.

    A participant's database user link is the authority for account-facing
    statistics.  The payload supplies immutable historic game facts, but a
    CPU or a hand-edited payload can never manufacture an account rank.
    """
    output: list[_PlayerResult] = []
    for row in rows:
        payload = _safe_payload(row)
        if payload is None:
            continue
        participants = payload.get("participants")
        boards = payload.get("boards")
        if not isinstance(participants, list) or not isinstance(boards, dict):
            # The validator currently guarantees this.  Keep the projection
            # defensive so a future parser change cannot make a page fail.
            logger.warning("Skipping incomplete Zilch result %s in statistics", row.game_id)
            continue
        payload_by_key = {
            str(item.get("player_key") or ""): item
            for item in participants
            if isinstance(item, dict) and str(item.get("player_key") or "")
        }
        try:
            finished_at = _as_utc(row.finished_at)
        except (TypeError, ValueError):
            logger.warning("Skipping Zilch result %s with invalid finished timestamp", row.game_id)
            continue
        for linked_participant in row.participants:
            if linked_participant.user_id is None:
                continue
            player = payload_by_key.get(str(linked_participant.player_key))
            if not isinstance(player, dict) or player.get("participant_type") != "human":
                continue
            participant_id = str(player.get("participant_id") or "")
            board = boards.get(participant_id)
            if not participant_id or not isinstance(board, dict):
                logger.warning("Skipping mismatched Zilch participant in result %s", row.game_id)
                continue
            user = linked_participant.user
            display_name = str(
                user.username if user is not None and str(user.username or "").strip() else player.get("display_name") or ""
            ).strip()
            if not display_name:
                display_name = "Player"
            output.append(
                _PlayerResult(
                    game_id=str(row.game_id),
                    finished_at=finished_at,
                    payload=payload,
                    participant=player,
                    board=board,
                    user_id=int(linked_participant.user_id),
                    display_name=display_name[:64],
                    user_is_active=bool(user is not None and user.is_active),
                )
            )
    return output


def _load_player_results(*, user_id: int | None = None) -> list[_PlayerResult]:
    """Load private typed Zilch history, filtering in SQL before JSON work."""
    if not database_schema_ready():
        return []
    last_finished_at: datetime | None = None
    last_row_id = 0
    projected: list[_PlayerResult] = []
    with session_scope() as db:
        while True:
            page_cursor = ()
            if last_finished_at is not None:
                page_cursor = (
                    or_(
                        CompletedGame.finished_at > last_finished_at,
                        and_(
                            CompletedGame.finished_at == last_finished_at,
                            CompletedGame.id > last_row_id,
                        ),
                    ),
                )
            statement = (
                select(CompletedGame)
                .options(selectinload(CompletedGame.participants).selectinload(GameParticipant.user))
                .where(
                    CompletedGame.game_type == ZILCH_GAME_TYPE,
                    *page_cursor,
                )
                .order_by(CompletedGame.finished_at.asc(), CompletedGame.id.asc())
                .limit(ZILCH_STATISTICS_SOURCE_PAGE_SIZE)
            )
            if user_id is not None:
                # EXISTS keeps exactly one durable game row before LIMIT even
                # if a historic game happens to contain the same account in
                # two human seats.  A join would make ``unique()`` shrink a
                # full page and could skip later results at the cursor.
                statement = statement.where(
                    CompletedGame.participants.any(GameParticipant.user_id == user_id)
                )
            rows = list(db.scalars(statement).all())
            if not rows:
                break
            # Relationships are eagerly loaded above; copying makes accidental
            # later session/lazy-load coupling impossible for these projections.
            projected.extend(_human_player_results(rows))
            last_finished_at = rows[-1].finished_at
            last_row_id = int(rows[-1].id)
    # The SQL membership filter above chooses games that include this account,
    # while the
    # eager participant projection intentionally retains every seat for the
    # general leaderboard loader.  Keep a personal query scoped to the caller
    # after that shared projection so an opponent can never appear in their
    # private totals.
    if user_id is not None:
        return [record for record in projected if record.user_id == user_id]
    return projected


def _banked_round_values(record: _PlayerResult) -> list[int]:
    rounds = record.board.get("rounds")
    if not isinstance(rounds, list):
        return []
    return [
        int(entry["points"])
        for entry in rounds
        if isinstance(entry, dict) and entry.get("event") == "bank" and type(entry.get("points")) is int
    ]


def _zilch_count(record: _PlayerResult) -> int:
    rounds = record.board.get("rounds")
    if not isinstance(rounds, list):
        return 0
    return sum(1 for entry in rounds if isinstance(entry, dict) and entry.get("event") == "zilch")


def _zilch_penalty(record: _PlayerResult) -> int:
    rounds = record.board.get("rounds")
    if not isinstance(rounds, list):
        return 0
    return sum(
        int(entry["penalty"])
        for entry in rounds
        if isinstance(entry, dict) and entry.get("event") == "zilch" and type(entry.get("penalty")) is int
    )


def _hot_dice_count(record: _PlayerResult) -> int | None:
    """Return a player's complete count, or unknown for old incomplete rounds.

    Schema v1 deliberately preserves an incomplete Hot-Dice count as ``None``
    when old zilch rounds did not record their held dice.  Treating that as
    zero would make an older player look less successful, so the entire
    record is unknown for this metric instead.
    """
    rounds = record.board.get("rounds")
    if not isinstance(rounds, list):
        return None
    count = 0
    for entry in rounds:
        if not isinstance(entry, dict):
            return None
        holds = entry.get("committed_holds")
        if not isinstance(holds, list):
            return None
        count += sum(1 for hold in holds if isinstance(hold, dict) and bool(hold.get("hot_dice")))
    return count


def _active_duration(record: _PlayerResult) -> int | None:
    if record.play_mode != "solo":
        return None
    metrics = record.payload.get("metrics")
    if not isinstance(metrics, dict) or type(metrics.get("active_duration_seconds")) is not int:
        return None
    return int(metrics["active_duration_seconds"])


def _solo_metrics(record: _PlayerResult) -> dict[str, int] | None:
    """Return only metrics comparable under the approved Solo Sprint v1."""
    payload = record.payload
    if payload.get("play_mode") != "solo":
        return None
    objective = payload.get("objective")
    outcome = payload.get("outcome")
    metrics = payload.get("metrics")
    if (
        not isinstance(objective, dict)
        or objective.get("id") != ZILCH_SOLO_SPRINT_OBJECTIVE_ID
        or objective.get("version") != ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION
        or not isinstance(outcome, dict)
        or not isinstance(metrics, dict)
    ):
        return None
    wanted = {
        "turns": metrics.get("turns"),
        "rolls": metrics.get("rolls"),
        "zilchs": metrics.get("zilch_count"),
        "active_duration_seconds": metrics.get("active_duration_seconds"),
        "highest_banked_round": metrics.get("highest_banked_round"),
    }
    if any(type(value) is not int or value < 0 for value in wanted.values()):
        return None
    return {key: int(value) for key, value in wanted.items()}


def _match_outcome(record: _PlayerResult) -> str | None:
    """Return ``win``, ``loss`` or ``tie`` for one validated match seat."""
    outcome = record.payload.get("outcome")
    if not isinstance(outcome, dict):
        return None
    if bool(outcome.get("tied")):
        return "tie"
    winner_id = outcome.get("winner_id")
    if not isinstance(winner_id, str) or not winner_id:
        return None
    return "win" if winner_id == record.participant_id else "loss"


def _is_human_match(record: _PlayerResult) -> bool:
    participants = record.payload.get("participants")
    return (
        record.play_mode == "multiplayer"
        and isinstance(participants, list)
        and len(participants) == 2
        and all(isinstance(item, dict) and item.get("participant_type") == "human" for item in participants)
    )


def _cpu_strategy_for(record: _PlayerResult) -> str | None:
    if record.play_mode != "cpu":
        return None
    participants = record.payload.get("participants")
    if not isinstance(participants, list):
        return None
    cpu = [item for item in participants if isinstance(item, dict) and item.get("participant_type") == "cpu"]
    human = [item for item in participants if isinstance(item, dict) and item.get("participant_type") == "human"]
    if len(cpu) != 1 or len(human) != 1:
        return None
    strategy = cpu[0].get("cpu_strategy")
    return str(strategy) if isinstance(strategy, str) and strategy in ZILCH_CPU_STRATEGIES else None


def _new_common_bucket() -> dict[str, Any]:
    return {
        "games": 0,
        "wins": 0,
        "losses": 0,
        "ties": 0,
        "final_scores": [],
        "banked_rounds": [],
        "zilchs": 0,
        "hot_dice_values": [],
        "hot_dice_complete": True,
        "durations": [],
    }


def _add_to_common_bucket(bucket: dict[str, Any], record: _PlayerResult, *, outcome: str | None = None) -> None:
    bucket["games"] += 1
    bucket["final_scores"].append(record.final_score)
    bucket["banked_rounds"].extend(_banked_round_values(record))
    bucket["zilchs"] += _zilch_count(record)
    hot_dice = _hot_dice_count(record)
    if hot_dice is None:
        bucket["hot_dice_complete"] = False
    else:
        bucket["hot_dice_values"].append(hot_dice)
    bucket["durations"].append(record.duration_seconds)
    if outcome == "win":
        bucket["wins"] += 1
    elif outcome == "loss":
        bucket["losses"] += 1
    elif outcome == "tie":
        bucket["ties"] += 1


def _common_bucket_projection(bucket: dict[str, Any]) -> dict[str, Any]:
    banked_rounds = list(bucket["banked_rounds"])
    final_scores = list(bucket["final_scores"])
    games = int(bucket["games"])
    wins = int(bucket["wins"])
    losses = int(bucket["losses"])
    decisive_games = wins + losses
    hot_dice_complete = bool(bucket["hot_dice_complete"])
    return {
        "games": games,
        "wins": wins,
        "losses": losses,
        "ties": int(bucket["ties"]),
        # A draw is neither a win nor a loss.  Keep it visible but exclude it
        # from the rate's denominator, and expose null when no game decided.
        "win_rate": _round_two(wins / decisive_games) if decisive_games else None,
        "average_final_score": _average(final_scores),
        "highest_final_score": max(final_scores, default=0),
        "banked_points": sum(banked_rounds),
        "banked_rounds": len(banked_rounds),
        "highest_banked_round": max(banked_rounds, default=0),
        "average_banked_round": _average(banked_rounds),
        "zilchs": int(bucket["zilchs"]),
        "hot_dice_events": sum(bucket["hot_dice_values"]) if hot_dice_complete else None,
        "hot_dice_events_complete": hot_dice_complete,
        "average_duration_seconds": _average(bucket["durations"]),
    }


def _empty_solo_projection() -> dict[str, Any]:
    return {
        "runs": 0,
        "completed": 0,
        "abandoned": 0,
        "completion_rate": None,
        "best_run": None,
        "lowest_turns": None,
        "lowest_rolls": None,
        "lowest_zilchs": None,
        "shortest_active_duration_seconds": None,
        "highest_banked_round": 0,
        "average_banked_round": None,
        "average_turns_completed": None,
        "average_rolls_completed": None,
        "hot_dice_events": 0,
        "hot_dice_events_complete": True,
    }


def _solo_projection(records: Iterable[_PlayerResult]) -> dict[str, Any]:
    all_records: list[tuple[_PlayerResult, dict[str, int]]] = []
    for record in records:
        metrics = _solo_metrics(record)
        if metrics is None:
            continue
        all_records.append((record, metrics))
    if not all_records:
        return _empty_solo_projection()
    completed: list[tuple[_PlayerResult, dict[str, int]]] = []
    abandoned = 0
    banked_rounds: list[int] = []
    hot_dice_values: list[int] = []
    hot_dice_complete = True
    for record, metrics in all_records:
        if record.payload["outcome"].get("status") == "completed":
            completed.append((record, metrics))
        else:
            abandoned += 1
        banked_rounds.extend(_banked_round_values(record))
        hot_dice = _hot_dice_count(record)
        if hot_dice is None:
            hot_dice_complete = False
        else:
            hot_dice_values.append(hot_dice)
    best: tuple[_PlayerResult, dict[str, int]] | None = None
    if completed:
        best = min(
            completed,
            key=lambda item: (
                item[1]["turns"],
                item[1]["rolls"],
                item[1]["zilchs"],
                item[1]["active_duration_seconds"],
                item[0].finished_at,
                item[0].game_id,
            ),
        )
    best_payload = (
        {
            "turns": best[1]["turns"],
            "rolls": best[1]["rolls"],
            "zilchs": best[1]["zilchs"],
            "active_duration_seconds": best[1]["active_duration_seconds"],
            "finished_at": _timestamp_text(best[0].finished_at),
        }
        if best is not None
        else None
    )
    return {
        "runs": len(all_records),
        "completed": len(completed),
        "abandoned": abandoned,
        "completion_rate": _round_two(len(completed) / len(all_records)) if all_records else None,
        "best_run": best_payload,
        "lowest_turns": min((metrics["turns"] for _record, metrics in completed), default=None),
        "lowest_rolls": min((metrics["rolls"] for _record, metrics in completed), default=None),
        "lowest_zilchs": min((metrics["zilchs"] for _record, metrics in completed), default=None),
        "shortest_active_duration_seconds": min(
            (metrics["active_duration_seconds"] for _record, metrics in completed), default=None
        ),
        "highest_banked_round": max(banked_rounds, default=0),
        "average_banked_round": _average(banked_rounds),
        "average_turns_completed": _average(metrics["turns"] for _record, metrics in completed),
        "average_rolls_completed": _average(metrics["rolls"] for _record, metrics in completed),
        "hot_dice_events": sum(hot_dice_values) if hot_dice_complete else None,
        "hot_dice_events_complete": hot_dice_complete,
    }


def _overview_projection(records: Iterable[_PlayerResult]) -> dict[str, Any]:
    materialized = list(records)
    rounds = [round_points for record in materialized for round_points in _banked_round_values(record)]
    hot_dice_values: list[int] = []
    hot_dice_complete = True
    active_durations: list[int] = []
    by_mode = {"multiplayer": 0, "cpu": 0, "solo": 0}
    for record in materialized:
        if record.play_mode in by_mode:
            by_mode[record.play_mode] += 1
        hot_dice = _hot_dice_count(record)
        if hot_dice is None:
            hot_dice_complete = False
        else:
            hot_dice_values.append(hot_dice)
        active_duration = _active_duration(record)
        if active_duration is not None:
            active_durations.append(active_duration)
    return {
        "completed_records": len(materialized),
        "games_by_mode": by_mode,
        "banked_points": sum(rounds),
        "banked_rounds": len(rounds),
        "highest_banked_round": max(rounds, default=0),
        "average_banked_round": _average(rounds),
        "zilchs": sum(_zilch_count(record) for record in materialized),
        "zilch_penalties": sum(_zilch_penalty(record) for record in materialized),
        "hot_dice_events": sum(hot_dice_values) if hot_dice_complete else None,
        "hot_dice_events_complete": hot_dice_complete,
        # Competitive v1 duration is elapsed wall time; solo v2 additionally
        # persists active duration.  Expose both rather than falsely merging
        # pause-aware and wall-clock measurements into one number.
        "duration_seconds": sum(record.duration_seconds for record in materialized),
        "active_duration_seconds": sum(active_durations) if active_durations else None,
        "active_duration_runs": len(active_durations),
    }


def get_zilch_personal_statistics(user_id: int) -> dict[str, Any]:
    """Return one account's private, mode-separated typed Zilch statistics."""
    clean_user_id = _strict_positive_int(user_id, "zilch_statistics_invalid_user")
    records = _load_player_results(user_id=clean_user_id)
    multiplayer = _new_common_bucket()
    cpu_overall = _new_common_bucket()
    cpu_by_strategy = {strategy: _new_common_bucket() for strategy in sorted(ZILCH_CPU_STRATEGIES)}
    for record in records:
        if _is_human_match(record):
            _add_to_common_bucket(multiplayer, record, outcome=_match_outcome(record))
            continue
        strategy = _cpu_strategy_for(record)
        if strategy is not None:
            outcome = _match_outcome(record)
            _add_to_common_bucket(cpu_overall, record, outcome=outcome)
            _add_to_common_bucket(cpu_by_strategy[strategy], record, outcome=outcome)
    return {
        "version": ZILCH_STATISTICS_RESPONSE_VERSION,
        "overview": _overview_projection(records),
        "multiplayer": _common_bucket_projection(multiplayer),
        "cpu": {
            "overall": _common_bucket_projection(cpu_overall),
            "by_strategy": {
                strategy: _common_bucket_projection(cpu_by_strategy[strategy])
                for strategy in sorted(ZILCH_CPU_STRATEGIES)
            },
        },
        "solo": _solo_projection(records),
    }


def list_zilch_leaderboard_categories() -> list[dict[str, Any]]:
    """Return safe metadata for the only currently implemented categories."""
    return [
        {
            "id": ZILCH_LEADERBOARD_SOLO_SPRINT,
            "ranking": "competition",
            "requires_strategy": False,
            "objective": {
                "id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
                "version": ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
            },
            "sorting": {
                "direction": "ascending",
                "keys": ["turns", "rolls", "zilchs", "active_duration_seconds", "finished_at"],
            },
        },
        {
            "id": ZILCH_LEADERBOARD_MULTIPLAYER_WINS,
            "ranking": "competition",
            "requires_strategy": False,
            "sorting": _match_sorting_metadata(),
        },
        {
            "id": ZILCH_LEADERBOARD_CPU_WINS,
            "ranking": "competition",
            "requires_strategy": True,
            "strategies": sorted(ZILCH_CPU_STRATEGIES),
            "sorting": _match_sorting_metadata(),
        },
    ]


def _match_sorting_metadata() -> dict[str, Any]:
    """Describe the explicit non-Solo order without leaking implementation."""
    return {
        "primary": "wins",
        "direction": "descending",
        "keys": ["wins", "losses", "ties", "highest_final_score", "highest_banked_round"],
        "directions": {
            "wins": "descending",
            "losses": "ascending",
            "ties": "descending",
            "highest_final_score": "descending",
            "highest_banked_round": "descending",
        },
        "stable_final_tie_break": "finished_at",
    }


def validate_zilch_leaderboard_query(
    category: object,
    *,
    strategy: object | None = None,
    offset: object = 0,
    limit: object = ZILCH_LEADERBOARD_MAX_LIMIT,
) -> tuple[str, str | None, int, int]:
    """Validate public leaderboard inputs before a route performs any read."""
    if not isinstance(category, str) or category not in ZILCH_LEADERBOARD_CATEGORIES:
        raise ZilchStatisticsInputError("zilch_statistics_invalid_leaderboard_category")
    clean_offset = _strict_nonnegative_int(offset, "zilch_statistics_invalid_offset")
    clean_limit = _strict_positive_int(limit, "zilch_statistics_invalid_limit")
    if clean_limit > ZILCH_LEADERBOARD_MAX_LIMIT:
        clean_limit = ZILCH_LEADERBOARD_MAX_LIMIT
    if category == ZILCH_LEADERBOARD_CPU_WINS:
        if not isinstance(strategy, str) or strategy not in ZILCH_CPU_STRATEGIES:
            raise ZilchStatisticsInputError("zilch_statistics_invalid_cpu_strategy")
        return category, strategy, clean_offset, clean_limit
    if strategy not in {None, ""}:
        raise ZilchStatisticsInputError("zilch_statistics_invalid_strategy")
    return category, None, clean_offset, clean_limit


def _active_records_by_user(records: Iterable[_PlayerResult]) -> dict[int, list[_PlayerResult]]:
    grouped: dict[int, list[_PlayerResult]] = defaultdict(list)
    for record in records:
        if record.user_is_active:
            grouped[record.user_id].append(record)
    return grouped


def _rank_entries(
    items: list[tuple[tuple[Any, ...], tuple[Any, ...], dict[str, Any]]],
    *,
    offset: int,
    limit: int,
    current_user_id: int | None,
) -> tuple[list[dict[str, Any]], dict[str, Any] | None, int]:
    """Sort deterministically and assign competition ranks.

    The first tuple is the actual performance value used for shared ranks;
    the second adds only stable presentation ordering.  Thus two equal
    performances receive e.g. 1, 2, 2, 4 even when their display names differ.
    """
    ordered = sorted(items, key=lambda item: item[1])
    entries: list[dict[str, Any]] = []
    own_entry: dict[str, Any] | None = None
    previous_performance: tuple[Any, ...] | None = None
    rank = 0
    for index, (performance, _order, entry) in enumerate(ordered, start=1):
        if performance != previous_performance:
            rank = index
            previous_performance = performance
        projected = {**entry, "rank": rank, "is_current_user": entry["user_id"] == current_user_id}
        if projected["is_current_user"]:
            own_entry = projected
        entries.append(projected)
    return entries[offset : offset + limit], own_entry, len(entries)


def _leaderboard_solo(records_by_user: dict[int, list[_PlayerResult]]) -> list[tuple[tuple[Any, ...], tuple[Any, ...], dict[str, Any]]]:
    entries: list[tuple[tuple[Any, ...], tuple[Any, ...], dict[str, Any]]] = []
    for user_id, records in records_by_user.items():
        eligible: list[tuple[_PlayerResult, dict[str, int]]] = []
        for record in records:
            metrics = _solo_metrics(record)
            if metrics is None or record.payload.get("outcome", {}).get("status") != "completed":
                continue
            eligible.append((record, metrics))
        if not eligible:
            continue
        best_record, best_metrics = min(
            eligible,
            key=lambda item: (
                item[1]["turns"],
                item[1]["rolls"],
                item[1]["zilchs"],
                item[1]["active_duration_seconds"],
                item[0].finished_at,
                item[0].game_id,
            ),
        )
        performance = (
            best_metrics["turns"],
            best_metrics["rolls"],
            best_metrics["zilchs"],
            best_metrics["active_duration_seconds"],
            best_record.finished_at,
        )
        entry = {
            "user_id": user_id,
            "display_name": best_record.display_name,
            "primary_value": best_metrics["turns"],
            "values": {
                "turns": best_metrics["turns"],
                "rolls": best_metrics["rolls"],
                "zilchs": best_metrics["zilchs"],
                "active_duration_seconds": best_metrics["active_duration_seconds"],
                "finished_at": _timestamp_text(best_record.finished_at),
                "highest_banked_round": best_metrics["highest_banked_round"],
            },
            "tie_breaks": {
                "rolls": best_metrics["rolls"],
                "zilchs": best_metrics["zilchs"],
                "active_duration_seconds": best_metrics["active_duration_seconds"],
                "finished_at": _timestamp_text(best_record.finished_at),
            },
            "games": len(eligible),
        }
        entries.append((performance, (*performance, best_record.game_id, user_id), entry))
    return entries


def _leaderboard_match(
    records_by_user: dict[int, list[_PlayerResult]],
    *,
    cpu_strategy: str | None,
) -> list[tuple[tuple[Any, ...], tuple[Any, ...], dict[str, Any]]]:
    entries: list[tuple[tuple[Any, ...], tuple[Any, ...], dict[str, Any]]] = []
    for user_id, records in records_by_user.items():
        bucket = _new_common_bucket()
        matching_finished: list[datetime] = []
        for record in records:
            if cpu_strategy is None:
                if not _is_human_match(record):
                    continue
            elif _cpu_strategy_for(record) != cpu_strategy:
                continue
            outcome = _match_outcome(record)
            if outcome is None:
                # A valid terminal match must have a typed outcome.  Do not
                # invent a loss from a damaged future payload projection.
                continue
            _add_to_common_bucket(bucket, record, outcome=outcome)
            matching_finished.append(record.finished_at)
        values = _common_bucket_projection(bucket)
        if not values["games"]:
            continue
        # Wins are the stated primary rank.  The remaining transparent
        # performance values settle otherwise equal records deterministically;
        # oldest completion only orders a complete performance tie.
        performance = (
            -values["wins"],
            values["losses"],
            -values["ties"],
            -values["highest_final_score"],
            -values["highest_banked_round"],
        )
        earliest = min(matching_finished)
        entry = {
            "user_id": user_id,
            "display_name": next(record.display_name for record in records if record.user_id == user_id),
            "primary_value": values["wins"],
            "values": {
                "wins": values["wins"],
                "games": values["games"],
                "losses": values["losses"],
                "ties": values["ties"],
                "win_rate": values["win_rate"],
                "highest_final_score": values["highest_final_score"],
                "highest_banked_round": values["highest_banked_round"],
            },
            "tie_breaks": {
                "losses": values["losses"],
                "ties": values["ties"],
                "highest_final_score": values["highest_final_score"],
                "highest_banked_round": values["highest_banked_round"],
            },
            "games": values["games"],
        }
        entries.append((performance, (*performance, earliest, user_id), entry))
    return entries


def get_zilch_leaderboard(
    category: str,
    *,
    strategy: str | None = None,
    offset: int = 0,
    limit: int = ZILCH_LEADERBOARD_MAX_LIMIT,
    current_user_id: int | None = None,
) -> dict[str, Any]:
    """Return a paginated private Zilch leaderboard without raw payloads.

    Only currently active accounts become ranking rows.  Historic results for
    deleted/inactive accounts remain readable through their authorized private
    result view, but no longer disclose a leaderboard identity.
    """
    clean_category, clean_strategy, clean_offset, clean_limit = validate_zilch_leaderboard_query(
        category,
        strategy=strategy,
        offset=offset,
        limit=limit,
    )
    clean_current_user_id: int | None
    if current_user_id is None:
        clean_current_user_id = None
    else:
        clean_current_user_id = _strict_positive_int(current_user_id, "zilch_statistics_invalid_user")
    records_by_user = _active_records_by_user(_load_player_results())
    if clean_category == ZILCH_LEADERBOARD_SOLO_SPRINT:
        items = _leaderboard_solo(records_by_user)
        sorting = {
            "direction": "ascending",
            "keys": ["turns", "rolls", "zilchs", "active_duration_seconds", "finished_at"],
        }
        objective: dict[str, Any] | None = {
            "id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
            "version": ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
        }
    elif clean_category == ZILCH_LEADERBOARD_MULTIPLAYER_WINS:
        items = _leaderboard_match(records_by_user, cpu_strategy=None)
        sorting = {
            "direction": "descending",
            "keys": ["wins", "losses", "ties", "highest_final_score", "highest_banked_round"],
        }
        objective = None
    elif clean_category == ZILCH_LEADERBOARD_CPU_WINS:
        if clean_strategy not in ZILCH_CPU_STRATEGIES:
            raise ZilchStatisticsInputError("zilch_statistics_invalid_cpu_strategy")
        items = _leaderboard_match(records_by_user, cpu_strategy=clean_strategy)
        sorting = {
            "direction": "descending",
            "keys": ["wins", "losses", "ties", "highest_final_score", "highest_banked_round"],
        }
        objective = None
    else:
        raise ZilchStatisticsInputError("zilch_statistics_invalid_leaderboard_category")
    entries, own_entry, total = _rank_entries(
        items,
        offset=clean_offset,
        limit=clean_limit,
        current_user_id=clean_current_user_id,
    )
    response: dict[str, Any] = {
        "version": ZILCH_STATISTICS_RESPONSE_VERSION,
        "category": clean_category,
        "strategy": clean_strategy,
        "ranking": "competition",
        "sorting": sorting,
        "offset": clean_offset,
        "limit": clean_limit,
        "total": total,
        "entries": entries,
        "own_entry": own_entry,
    }
    if objective is not None:
        response["objective"] = objective
    return response
