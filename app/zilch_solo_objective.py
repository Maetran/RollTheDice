"""Pure, versioned challenge progress for private Zilch solo games.

The live-state adapter is responsible for clocks, pause accounting and for
calling these functions *after* the authoritative Zilch engine has accepted
an action.  This module deliberately does not import FastAPI, WebSockets,
persistence, live game state, RNG, or the scoring engine.  It only records
already-authoritative facts in a deterministic, JSON-serializable form.

The first public challenge is intentionally parameter-free.  A browser may
ask to create it by its stable id and version, but it cannot supply a target,
turn limit, ranking threshold or any other gameplay-affecting parameter.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Final, Literal, Mapping

ZILCH_SOLO_SPRINT_OBJECTIVE_ID: Final = "reach_10000_fewest_turns"
ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION: Final = 1
ZILCH_SOLO_SPRINT_TARGET_SCORE: Final = 10_000

# More descriptive aliases keep future objective registry call sites readable
# without creating a second source of truth for the first challenge.
ZILCH_SOLO_OBJECTIVE_REACH_10000_FEWEST_TURNS: Final = ZILCH_SOLO_SPRINT_OBJECTIVE_ID
ZILCH_SOLO_OBJECTIVE_VERSION: Final = ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION
ZILCH_SOLO_OBJECTIVE_TARGET_SCORE: Final = ZILCH_SOLO_SPRINT_TARGET_SCORE

ZilchSoloOutcome = Literal["completed", "abandoned"]


class ZilchSoloObjectiveError(ValueError):
    """A malformed objective configuration or impossible progress event."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _strict_non_negative_int(value: object, code: str) -> int:
    if type(value) is not int or value < 0:
        raise ZilchSoloObjectiveError(code)
    return value


def _strict_positive_int(value: object, code: str) -> int:
    if type(value) is not int or value < 1:
        raise ZilchSoloObjectiveError(code)
    return value


def _no_parameters(value: object) -> None:
    """Accept only an omitted or truly empty configuration mapping.

    ``None`` means that an API caller omitted the optional field.  It is
    canonicalized to ``{}``; any non-empty mapping (or another data type) is
    rejected instead of being silently ignored.
    """

    if value is None:
        return
    if not isinstance(value, Mapping) or bool(value):
        raise ZilchSoloObjectiveError("zilch_solo_objective_parameters_not_allowed")


@dataclass(frozen=True)
class ZilchSoloObjectiveDefinition:
    """Static, localizable metadata for one versioned solo objective."""

    objective_id: str
    version: int
    target_score: int
    name_key: str
    description_key: str
    primary_metric: str
    tie_break_metrics: tuple[str, ...]
    allows_abandon: bool

    def payload(self) -> dict[str, Any]:
        """Return public metadata without exposing mutable configuration."""

        return {
            "id": self.objective_id,
            "version": self.version,
            "parameters": {},
            "target_score": self.target_score,
            "name_key": self.name_key,
            "description_key": self.description_key,
            "primary_metric": self.primary_metric,
            "tie_break_metrics": list(self.tie_break_metrics),
            "allows_abandon": self.allows_abandon,
        }


_SPRINT_DEFINITION: Final = ZilchSoloObjectiveDefinition(
    objective_id=ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    version=ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    target_score=ZILCH_SOLO_SPRINT_TARGET_SCORE,
    name_key="zilch.solo_objective.reach_10000_fewest_turns.name",
    description_key="zilch.solo_objective.reach_10000_fewest_turns.description",
    primary_metric="turns",
    tie_break_metrics=("rolls", "zilchs", "active_duration_seconds"),
    allows_abandon=True,
)


def validate_zilch_solo_objective_definition(
    objective_id: object,
    version: object,
    parameters: object = None,
) -> ZilchSoloObjectiveDefinition:
    """Validate the one supported fixed objective and return its definition.

    This is the creation boundary: callers must pass the exact stable id and
    version.  No aliases, target overrides, or arbitrary parameters are
    accepted, so the challenge cannot be modified by a browser request.
    """

    if not isinstance(objective_id, str) or objective_id != ZILCH_SOLO_SPRINT_OBJECTIVE_ID:
        raise ZilchSoloObjectiveError("zilch_solo_objective_unknown")
    if type(version) is not int or version != ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION:
        raise ZilchSoloObjectiveError("zilch_solo_objective_unknown_version")
    _no_parameters(parameters)
    return _SPRINT_DEFINITION


def canonicalize_zilch_solo_objective_definition(raw: object) -> dict[str, Any]:
    """Return the canonical persistent definition shape for untrusted input.

    The helper intentionally accepts only definition fields, not live progress
    or outcome.  Result persistence can use it to reject a malformed or
    future unknown objective without duplicating the allowed id/version.
    """

    if not isinstance(raw, Mapping):
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_definition")
    unknown = set(raw) - {"id", "version", "parameters"}
    if unknown:
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_definition")
    definition = validate_zilch_solo_objective_definition(
        raw.get("id"), raw.get("version"), raw.get("parameters")
    )
    return {
        "id": definition.objective_id,
        "version": definition.version,
        "parameters": {},
    }


@dataclass(frozen=True)
class ZilchSoloObjectiveState:
    """Mutable-through-replacement progress for one authoritative solo run.

    The state is intentionally flat in Python for easy, pure event handling;
    :meth:`payload` exposes the stable nested wire/persistence representation.
    ``total_points`` is copied from the authoritative board after a bank or
    Zilch penalty.  This module never evaluates dice or calculates a score.
    """

    objective_id: str
    objective_version: int
    total_points: int = 0
    turns: int = 0
    rolls: int = 0
    zilchs: int = 0
    hot_dice_events: int = 0
    highest_banked_round: int = 0
    active_duration_seconds: int = 0
    outcome: ZilchSoloOutcome | None = None

    @property
    def definition(self) -> ZilchSoloObjectiveDefinition:
        return validate_zilch_solo_objective_definition(self.objective_id, self.objective_version, {})

    @property
    def is_terminal(self) -> bool:
        return self.outcome is not None

    @property
    def is_completed(self) -> bool:
        return self.outcome == "completed"

    @property
    def remaining_points(self) -> int:
        return max(0, self.definition.target_score - self.total_points)

    def progress_payload(self) -> dict[str, int]:
        """Return the serializable, authoritative objective progress facts."""

        definition = self.definition
        _validate_state_values(self, definition)
        return {
            "target_score": definition.target_score,
            "total_points": self.total_points,
            "turns": self.turns,
            "rolls": self.rolls,
            "zilchs": self.zilchs,
            "hot_dice_events": self.hot_dice_events,
            "highest_banked_round": self.highest_banked_round,
            "active_duration_seconds": self.active_duration_seconds,
        }

    def payload(self) -> dict[str, Any]:
        """Return one JSON-safe versioned objective snapshot."""

        return {
            "id": self.objective_id,
            "version": self.objective_version,
            "parameters": {},
            "progress": self.progress_payload(),
            "outcome": self.outcome,
        }

    def ranking_key(self) -> tuple[int, int, int, int]:
        """Return the approved ascending ranking tuple for a completed run."""

        if not self.is_completed:
            raise ZilchSoloObjectiveError("zilch_solo_objective_not_completed")
        return (self.turns, self.rolls, self.zilchs, self.active_duration_seconds)


def _validate_state_values(
    state: ZilchSoloObjectiveState,
    definition: ZilchSoloObjectiveDefinition | None = None,
) -> ZilchSoloObjectiveDefinition:
    definition = definition or validate_zilch_solo_objective_definition(
        state.objective_id, state.objective_version, {}
    )
    for name in (
        "total_points",
        "turns",
        "rolls",
        "zilchs",
        "hot_dice_events",
        "highest_banked_round",
        "active_duration_seconds",
    ):
        _strict_non_negative_int(getattr(state, name), "zilch_solo_objective_invalid_progress")
    if state.outcome not in (None, "completed", "abandoned"):
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_outcome")
    if state.outcome == "completed" and state.total_points < definition.target_score:
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_outcome")
    if state.outcome is None and state.total_points >= definition.target_score:
        raise ZilchSoloObjectiveError("zilch_solo_objective_completion_missing")
    return definition


def new_zilch_solo_objective_state(
    *,
    objective_id: object = ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    version: object = ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    parameters: object = None,
) -> ZilchSoloObjectiveState:
    """Create zeroed progress for the only approved Solo objective."""

    definition = validate_zilch_solo_objective_definition(objective_id, version, parameters)
    return ZilchSoloObjectiveState(
        objective_id=definition.objective_id,
        objective_version=definition.version,
    )


def zilch_solo_objective_state_from_payload(raw: object) -> ZilchSoloObjectiveState:
    """Restore and validate a persisted objective snapshot without defaults."""

    if not isinstance(raw, Mapping):
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_state")
    expected_keys = {"id", "version", "parameters", "progress", "outcome"}
    if set(raw) != expected_keys:
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_state")
    definition = validate_zilch_solo_objective_definition(raw.get("id"), raw.get("version"), raw.get("parameters"))
    progress = raw.get("progress")
    if not isinstance(progress, Mapping):
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_progress")
    expected_progress_keys = {
        "target_score",
        "total_points",
        "turns",
        "rolls",
        "zilchs",
        "hot_dice_events",
        "highest_banked_round",
        "active_duration_seconds",
    }
    if set(progress) != expected_progress_keys or progress.get("target_score") != definition.target_score:
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_progress")
    outcome = raw.get("outcome")
    state = ZilchSoloObjectiveState(
        objective_id=definition.objective_id,
        objective_version=definition.version,
        total_points=_strict_non_negative_int(progress.get("total_points"), "zilch_solo_objective_invalid_progress"),
        turns=_strict_non_negative_int(progress.get("turns"), "zilch_solo_objective_invalid_progress"),
        rolls=_strict_non_negative_int(progress.get("rolls"), "zilch_solo_objective_invalid_progress"),
        zilchs=_strict_non_negative_int(progress.get("zilchs"), "zilch_solo_objective_invalid_progress"),
        hot_dice_events=_strict_non_negative_int(
            progress.get("hot_dice_events"), "zilch_solo_objective_invalid_progress"
        ),
        highest_banked_round=_strict_non_negative_int(
            progress.get("highest_banked_round"), "zilch_solo_objective_invalid_progress"
        ),
        active_duration_seconds=_strict_non_negative_int(
            progress.get("active_duration_seconds"), "zilch_solo_objective_invalid_progress"
        ),
        outcome=outcome if outcome in (None, "completed", "abandoned") else None,
    )
    if outcome != state.outcome:
        raise ZilchSoloObjectiveError("zilch_solo_objective_invalid_outcome")
    _validate_state_values(state, definition)
    return state


def _require_active(state: ZilchSoloObjectiveState) -> ZilchSoloObjectiveDefinition:
    definition = _validate_state_values(state)
    if state.is_terminal:
        raise ZilchSoloObjectiveError("zilch_solo_objective_finished")
    return definition


def record_solo_objective_turn_started(state: ZilchSoloObjectiveState, *, turn_id: object) -> ZilchSoloObjectiveState:
    """Observe one new authoritative normal turn (including the first turn)."""

    _require_active(state)
    _strict_positive_int(turn_id, "zilch_solo_objective_invalid_turn")
    return replace(state, turns=state.turns + 1)


def record_solo_objective_roll(
    state: ZilchSoloObjectiveState,
    *,
    turn_id: object,
    roll_id: object,
) -> ZilchSoloObjectiveState:
    """Observe one accepted server-side dice roll; no dice are inspected."""

    _require_active(state)
    _strict_positive_int(turn_id, "zilch_solo_objective_invalid_turn")
    _strict_positive_int(roll_id, "zilch_solo_objective_invalid_roll")
    return replace(state, rolls=state.rolls + 1)


def record_solo_objective_hot_dice(
    state: ZilchSoloObjectiveState,
    *,
    turn_id: object,
    roll_id: object,
) -> ZilchSoloObjectiveState:
    """Observe one accepted Hot-Dice hold from the authoritative engine."""

    _require_active(state)
    _strict_positive_int(turn_id, "zilch_solo_objective_invalid_turn")
    _strict_positive_int(roll_id, "zilch_solo_objective_invalid_roll")
    return replace(state, hot_dice_events=state.hot_dice_events + 1)


def record_solo_objective_bank(
    state: ZilchSoloObjectiveState,
    *,
    turn_id: object,
    banked_points: object,
    total_points_after: object,
) -> ZilchSoloObjectiveState:
    """Observe a legal bank copied from the authoritative board.

    The arithmetic check is an integrity check over engine output, not a
    scoring calculation: the engine has already decided whether a bank is
    legal and what its points are.
    """

    definition = _require_active(state)
    _strict_positive_int(turn_id, "zilch_solo_objective_invalid_turn")
    points = _strict_positive_int(banked_points, "zilch_solo_objective_invalid_bank")
    total = _strict_non_negative_int(total_points_after, "zilch_solo_objective_invalid_total")
    if total != state.total_points + points:
        raise ZilchSoloObjectiveError("zilch_solo_objective_bank_total_mismatch")
    return replace(
        state,
        total_points=total,
        highest_banked_round=max(state.highest_banked_round, points),
        outcome="completed" if total >= definition.target_score else None,
    )


def record_solo_objective_zilch(
    state: ZilchSoloObjectiveState,
    *,
    turn_id: object,
    total_points_after: object,
    penalty_points: object = 0,
) -> ZilchSoloObjectiveState:
    """Observe an authoritative Zilch and its already-applied score penalty."""

    _require_active(state)
    _strict_positive_int(turn_id, "zilch_solo_objective_invalid_turn")
    penalty = _strict_non_negative_int(penalty_points, "zilch_solo_objective_invalid_penalty")
    total = _strict_non_negative_int(total_points_after, "zilch_solo_objective_invalid_total")
    if total != max(0, state.total_points - penalty):
        raise ZilchSoloObjectiveError("zilch_solo_objective_zilch_total_mismatch")
    return replace(state, total_points=total, zilchs=state.zilchs + 1)


def record_solo_objective_active_duration(
    state: ZilchSoloObjectiveState,
    active_duration_seconds: object,
) -> ZilchSoloObjectiveState:
    """Copy monotonic active play time calculated outside this pure module.

    The caller owns timestamps and pause intervals.  A terminal run may still
    receive its final duration after a successful bank or abandon action.
    """

    _validate_state_values(state)
    duration = _strict_non_negative_int(active_duration_seconds, "zilch_solo_objective_invalid_duration")
    if duration < state.active_duration_seconds:
        raise ZilchSoloObjectiveError("zilch_solo_objective_duration_not_monotonic")
    return replace(state, active_duration_seconds=duration)


def abandon_solo_objective(
    state: ZilchSoloObjectiveState,
    *,
    active_duration_seconds: object | None = None,
) -> ZilchSoloObjectiveState:
    """Finish an active run as an explicit, separately stored abandonment."""

    _require_active(state)
    if active_duration_seconds is not None:
        state = record_solo_objective_active_duration(state, active_duration_seconds)
    return replace(state, outcome="abandoned")
