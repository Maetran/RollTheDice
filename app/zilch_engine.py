"""Pure scoring and turn primitives for the private Zilch ruleset.

This module deliberately knows nothing about FastAPI, WebSockets, database
models, or ZDWA.  It accepts dice and compact serializable turn data, returns
deterministic scoring options, and uses an injected random-number function for
the only non-deterministic operation.
"""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass, replace
from hashlib import sha256
from itertools import combinations
from typing import Any, Callable, Final, Iterable, Mapping, Sequence

ZILCH_RULESET_VERSION: Final = "zilch-house-v1"
ZILCH_DICE_COUNT: Final = 6
ZILCH_TARGET_SCORE: Final = 10_000
ZILCH_BANK_MINIMUM: Final = 400
ZILCH_THIRD_ROLL_MINIMUM: Final = 300
ZILCH_CONFIRMATION_MINIMUM: Final = 50
ZILCH_ZILCH_STREAK_PENALTY: Final = 500

ZILCH_PHASE_READY_TO_ROLL: Final = "ready_to_roll"
ZILCH_PHASE_AWAITING_HOLD: Final = "awaiting_hold"
ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED: Final = "confirmation_roll_required"

ZilchRandomInt = Callable[[int, int], int]


class ZilchRuleError(ValueError):
    """A rejected domain command with a stable machine-readable reason."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def fair_zilch_randint(lower: int, upper: int) -> int:
    """Return an unbiased die result from the common Zilch RNG source.

    Human and future CPU participants call the same function through the same
    turn primitive.  Tests pass a deterministic replacement instead.
    """
    if lower > upper:
        raise ValueError("invalid_random_range")
    return lower + secrets.randbelow(upper - lower + 1)


def _die_from_rng(randint_fn: ZilchRandomInt) -> int:
    value = randint_fn(1, 6)
    if type(value) is not int or value < 1 or value > 6:
        raise ZilchRuleError("zilch_rng_invalid_result")
    return value


def _normalise_dice(values: Sequence[object], *, allow_unrolled: bool) -> tuple[int, ...]:
    if len(values) != ZILCH_DICE_COUNT:
        raise ZilchRuleError("zilch_invalid_dice")
    result: list[int] = []
    for value in values:
        if type(value) is not int:
            raise ZilchRuleError("zilch_invalid_dice")
        if value == 0 and allow_unrolled:
            result.append(0)
        elif 1 <= value <= 6:
            result.append(value)
        else:
            raise ZilchRuleError("zilch_invalid_dice")
    return tuple(result)


def _normalise_indices(indices: Iterable[object]) -> tuple[int, ...]:
    raw = list(indices)
    if any(type(index) is not int for index in raw):
        raise ZilchRuleError("zilch_invalid_dice_indices")
    try:
        result = tuple(sorted(int(index) for index in raw))
    except (TypeError, ValueError) as exc:
        raise ZilchRuleError("zilch_invalid_dice_indices") from exc
    if len(set(result)) != len(result) or any(index < 0 or index >= ZILCH_DICE_COUNT for index in result):
        raise ZilchRuleError("zilch_invalid_dice_indices")
    return result


def _label_params(**params: int | str) -> dict[str, int | str]:
    return dict(params)


@dataclass(frozen=True)
class ZilchScoringComponent:
    """One independently scoreable group of dice."""

    combination_type: str
    dice_indices: tuple[int, ...]
    dice_values: tuple[int, ...]
    points: int
    label_key: str
    label_params: dict[str, int | str]

    def payload(self) -> dict[str, Any]:
        return {
            "combination_type": self.combination_type,
            "dice_indices": list(self.dice_indices),
            "dice_values": list(self.dice_values),
            "points": self.points,
            "label_key": self.label_key,
            "label_params": dict(self.label_params),
        }

    def identity(self) -> dict[str, Any]:
        return {
            "combination_type": self.combination_type,
            "dice_indices": list(self.dice_indices),
            "points": self.points,
        }


@dataclass(frozen=True)
class ZilchScoringOption:
    """A server-authoritative Quick-Hold choice for one concrete roll."""

    option_id: str
    turn_id: int
    roll_id: int
    combination_type: str
    components: tuple[ZilchScoringComponent, ...]
    dice_indices: tuple[int, ...]
    dice_values: tuple[int, ...]
    points: int
    label_key: str
    label_params: dict[str, int | str]
    all_available_dice: bool
    hot_dice: bool
    free_roll: bool
    requires_confirmation: bool
    confirmation_reasons: tuple[str, ...]
    follow_up_actions: tuple[str, ...]

    def payload(self) -> dict[str, Any]:
        return {
            "id": self.option_id,
            "turn_id": self.turn_id,
            "roll_id": self.roll_id,
            "combination_type": self.combination_type,
            "components": [component.payload() for component in self.components],
            "dice_indices": list(self.dice_indices),
            "dice_values": list(self.dice_values),
            "points": self.points,
            "label_key": self.label_key,
            "label_params": dict(self.label_params),
            "all_available_dice": self.all_available_dice,
            "hot_dice": self.hot_dice,
            "free_roll": self.free_roll,
            "requires_confirmation": self.requires_confirmation,
            "confirmation_reasons": list(self.confirmation_reasons),
            "follow_up_actions": list(self.follow_up_actions),
        }


@dataclass(frozen=True)
class ZilchRollEvaluation:
    """The authoritative result of one dice roll before a hold is selected."""

    dice: tuple[int, ...]
    options: tuple[ZilchScoringOption, ...]
    zilch: bool
    third_roll_threshold_zilch: bool
    max_holdable_points: int


@dataclass(frozen=True)
class ZilchHoldResult:
    """The result of committing one validated scoring option."""

    turn: "ZilchTurn"
    option: ZilchScoringOption
    third_roll_threshold_zilch: bool


@dataclass(frozen=True)
class ZilchStartRoll:
    """Auditable random opening-roll result, including tie re-rolls."""

    player_id: str
    attempts: tuple[dict[str, int], ...]

    def payload(self) -> dict[str, Any]:
        return {
            "winner_id": self.player_id,
            "attempts": [dict(attempt) for attempt in self.attempts],
        }


@dataclass(frozen=True)
class ZilchTurn:
    """Serializable state for exactly one player's current Zilch turn."""

    player_id: str
    turn_id: int
    round_number: int
    version: int
    phase: str
    dice: tuple[int, ...]
    held_indices: tuple[int, ...]
    committed_holds: tuple[dict[str, Any], ...]
    round_points: int
    rolls_used: int
    roll_id: int
    confirmation_reasons: tuple[str, ...]
    last_event: str | None = None

    @property
    def available_indices(self) -> tuple[int, ...]:
        held = set(self.held_indices)
        return tuple(index for index in range(ZILCH_DICE_COUNT) if index not in held)

    @property
    def confirmation_required(self) -> bool:
        return bool(self.confirmation_reasons)

    def payload(self) -> dict[str, Any]:
        return {
            "player_id": self.player_id,
            "turn_id": self.turn_id,
            "round": self.round_number,
            "version": self.version,
            "phase": self.phase,
            "held_indices": list(self.held_indices),
            "committed_holds": [dict(entry) for entry in self.committed_holds],
            "round_points": self.round_points,
            "rolls_used": self.rolls_used,
            "roll_id": self.roll_id,
            "confirmation_reasons": list(self.confirmation_reasons),
            "last_event": self.last_event,
        }


def new_zilch_turn(player_id: str, *, turn_id: int, round_number: int) -> ZilchTurn:
    """Start a fresh turn without rolling client-controlled dice."""
    return ZilchTurn(
        player_id=str(player_id),
        turn_id=int(turn_id),
        round_number=max(1, int(round_number)),
        version=0,
        phase=ZILCH_PHASE_READY_TO_ROLL,
        dice=(0,) * ZILCH_DICE_COUNT,
        held_indices=(),
        committed_holds=(),
        round_points=0,
        rolls_used=0,
        roll_id=0,
        confirmation_reasons=(),
    )


def zilch_turn_from_state(
    turn_data: Mapping[str, Any] | None,
    dice: Sequence[object],
    holds: Sequence[object] | None,
) -> ZilchTurn:
    """Restore a durable turn, accepting the foundation's minimal shape.

    Older preview states only contained ``player_id`` and ``round``.  Missing
    engine fields therefore become a harmless ready-to-roll turn rather than
    making a restart unreadable.
    """
    raw = turn_data if isinstance(turn_data, Mapping) else {}
    player_id = str(raw.get("player_id") or "")
    if not player_id:
        raise ZilchRuleError("zilch_missing_turn_player")
    normalised_dice = _normalise_dice(dice, allow_unrolled=True)
    raw_holds = list(holds or [])
    held_indices = raw.get("held_indices")
    if isinstance(held_indices, list):
        normalised_held = _normalise_indices(held_indices)
    else:
        if len(raw_holds) != ZILCH_DICE_COUNT or any(type(value) is not bool for value in raw_holds):
            normalised_held = ()
        else:
            normalised_held = tuple(index for index, held in enumerate(raw_holds) if held)
    for index in normalised_held:
        if normalised_dice[index] == 0:
            raise ZilchRuleError("zilch_invalid_held_die")
    try:
        committed = raw.get("committed_holds") or []
        if not isinstance(committed, list) or not all(isinstance(entry, Mapping) for entry in committed):
            committed = []
        confirmation = raw.get("confirmation_reasons") or []
        if not isinstance(confirmation, list):
            confirmation = []
        phase = str(raw.get("phase") or ZILCH_PHASE_READY_TO_ROLL)
        if phase not in {
            ZILCH_PHASE_READY_TO_ROLL,
            ZILCH_PHASE_AWAITING_HOLD,
            ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED,
        }:
            phase = ZILCH_PHASE_READY_TO_ROLL
        return ZilchTurn(
            player_id=player_id,
            turn_id=max(1, int(raw.get("turn_id", raw.get("round", 1)) or 1)),
            round_number=max(1, int(raw.get("round", 1) or 1)),
            version=max(0, int(raw.get("version", 0) or 0)),
            phase=phase,
            dice=normalised_dice,
            held_indices=normalised_held,
            committed_holds=tuple(dict(entry) for entry in committed),
            round_points=max(0, int(raw.get("round_points", 0) or 0)),
            rolls_used=max(0, int(raw.get("rolls_used", 0) or 0)),
            roll_id=max(0, int(raw.get("roll_id", raw.get("rolls_used", 0)) or 0)),
            confirmation_reasons=tuple(str(reason) for reason in confirmation if str(reason)),
            last_event=str(raw["last_event"]) if raw.get("last_event") is not None else None,
        )
    except (TypeError, ValueError) as exc:
        raise ZilchRuleError("zilch_invalid_turn_state") from exc


def roll_starting_player(
    player_ids: Sequence[object],
    *,
    randint_fn: ZilchRandomInt | None = None,
) -> ZilchStartRoll:
    """Roll one die per participant until a unique highest result exists."""
    ids = tuple(str(player_id) for player_id in player_ids if str(player_id))
    if not ids or len(ids) > 2 or len(set(ids)) != len(ids):
        raise ZilchRuleError("zilch_invalid_starting_players")
    rng = randint_fn or fair_zilch_randint
    if len(ids) == 1:
        return ZilchStartRoll(player_id=ids[0], attempts=({ids[0]: _die_from_rng(rng)},))

    attempts: list[dict[str, int]] = []
    while True:
        attempt = {player_id: _die_from_rng(rng) for player_id in ids}
        attempts.append(attempt)
        high = max(attempt.values())
        winners = [player_id for player_id, value in attempt.items() if value == high]
        if len(winners) == 1:
            return ZilchStartRoll(player_id=winners[0], attempts=tuple(attempts))


def roll_available_dice(
    dice: Sequence[object],
    held_indices: Iterable[object],
    *,
    randint_fn: ZilchRandomInt | None = None,
) -> tuple[int, ...]:
    """Roll only dice not already committed by the current player."""
    result = list(_normalise_dice(dice, allow_unrolled=True))
    held = set(_normalise_indices(held_indices))
    for index in held:
        if result[index] == 0:
            raise ZilchRuleError("zilch_invalid_held_die")
    rng = randint_fn or fair_zilch_randint
    for index in range(ZILCH_DICE_COUNT):
        if index not in held:
            result[index] = _die_from_rng(rng)
    return tuple(result)


def _single_component(index: int, value: int) -> ZilchScoringComponent:
    if value == 1:
        return ZilchScoringComponent(
            "single_one",
            (index,),
            (value,),
            100,
            "zilch.option.single_one",
            _label_params(count=1, face=1),
        )
    return ZilchScoringComponent(
        "single_five",
        (index,),
        (value,),
        50,
        "zilch.option.single_five",
        _label_params(count=1, face=5),
    )


def _triple_component(indices: tuple[int, ...], value: int) -> ZilchScoringComponent:
    if value == 1:
        return ZilchScoringComponent(
            "three_ones",
            indices,
            (1, 1, 1),
            1_000,
            "zilch.option.three_ones",
            _label_params(count=3, face=1),
        )
    return ZilchScoringComponent(
        "three_of_a_kind",
        indices,
        (value, value, value),
        value * 100,
        "zilch.option.three_of_a_kind",
        _label_params(count=3, face=value),
    )


def _special_components(
    dice: tuple[int, ...],
    available: tuple[int, ...],
    primitive_components: Sequence[ZilchScoringComponent],
) -> list[ZilchScoringComponent]:
    """Return full-six-dice specials; ordinary subsets remain alternatives."""
    if len(available) != ZILCH_DICE_COUNT:
        return []
    values = tuple(dice[index] for index in available)
    if any(value == 0 for value in values):
        return []
    counts = {value: values.count(value) for value in set(values)}
    if tuple(sorted(values)) == (1, 2, 3, 4, 5, 6):
        return [
            ZilchScoringComponent(
                "straight",
                available,
                values,
                2_000,
                "zilch.option.straight",
                _label_params(),
            )
        ]
    if sorted(counts.values()) == [2, 2, 2]:
        return [
            ZilchScoringComponent(
                "three_pairs",
                available,
                values,
                500,
                "zilch.option.three_pairs",
                _label_params(),
            )
        ]
    # "500 for nothing" is intentionally only a full fresh six-die throw
    # without any ordinary scoring component. It is a valid score, not Zilch.
    if not primitive_components:
        return [
            ZilchScoringComponent(
                "nothing_bonus",
                available,
                values,
                500,
                "zilch.option.nothing_bonus",
                _label_params(),
            )
        ]
    return []


def _primitive_components(dice: tuple[int, ...], available: tuple[int, ...]) -> list[ZilchScoringComponent]:
    result: list[ZilchScoringComponent] = []
    positions_by_value: dict[int, list[int]] = {value: [] for value in range(1, 7)}
    for index in available:
        value = dice[index]
        if value in positions_by_value:
            positions_by_value[value].append(index)
    for value in (1, 5):
        for index in positions_by_value[value]:
            result.append(_single_component(index, value))
    for value in range(1, 7):
        for triple in combinations(positions_by_value[value], 3):
            result.append(_triple_component(tuple(triple), value))
    return result


def _component_sets(components: Sequence[ZilchScoringComponent]) -> list[tuple[ZilchScoringComponent, ...]]:
    """Enumerate every non-empty, non-overlapping scoring selection.

    Six dice keep this intentionally direct search small while permitting the
    confirmed freedom to split triples and mix them with individual 1s/5s.
    """
    result: dict[tuple[tuple[str, tuple[int, ...], int], ...], tuple[ZilchScoringComponent, ...]] = {}

    def visit(start: int, chosen: list[ZilchScoringComponent], used: set[int]) -> None:
        if chosen:
            ordered = tuple(sorted(chosen, key=lambda component: (component.combination_type, component.dice_indices, component.points)))
            key = tuple(
                (component.combination_type, component.dice_indices, component.points)
                for component in ordered
            )
            result[key] = ordered
        for position in range(start, len(components)):
            component = components[position]
            indices = set(component.dice_indices)
            if indices & used:
                continue
            visit(position + 1, [*chosen, component], used | indices)

    visit(0, [], set())
    return list(result.values())


def _classification(
    components: tuple[ZilchScoringComponent, ...],
) -> tuple[str, str, dict[str, int | str]]:
    if len(components) == 1:
        component = components[0]
        return component.combination_type, component.label_key, dict(component.label_params)
    if len(components) == 2 and all(component.combination_type in {"three_ones", "three_of_a_kind"} for component in components):
        faces = sorted(component.dice_values[0] for component in components)
        if faces[0] == faces[1]:
            return "double_triple", "zilch.option.double_triple", _label_params(face=faces[0])
        return "two_triples", "zilch.option.two_triples", _label_params(first_face=faces[0], second_face=faces[1])
    return "combined", "zilch.option.combined", _label_params(component_count=len(components))


def _selection_respects_triples(
    dice: tuple[int, ...],
    components: tuple[ZilchScoringComponent, ...],
    selected_indices: tuple[int, ...],
) -> bool:
    """Enforce that a selected triple is scored as a triple, not singles.

    Players may deliberately retain one or two 1s/5s.  Once their selected
    subset itself contains three of one face, Manuel's contract says that
    group counts as a triple; four and five add ordinary leftover singles and
    six are two separate triples.
    """
    if any(component.combination_type in {"straight", "three_pairs", "nothing_bonus"} for component in components):
        return True
    triple_counts: dict[int, int] = {}
    for component in components:
        if component.combination_type not in {"three_ones", "three_of_a_kind"}:
            continue
        face = component.dice_values[0]
        triple_counts[face] = triple_counts.get(face, 0) + 1
    for face in range(1, 7):
        selected_count = sum(dice[index] == face for index in selected_indices)
        expected_triples = selected_count // 3
        if triple_counts.get(face, 0) != expected_triples:
            return False
    return True


def _option_id(
    *,
    turn_id: int,
    roll_id: int,
    components: tuple[ZilchScoringComponent, ...],
) -> str:
    canonical = {
        "ruleset": ZILCH_RULESET_VERSION,
        "turn_id": turn_id,
        "roll_id": roll_id,
        "components": [component.identity() for component in components],
    }
    encoded = json.dumps(canonical, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return f"zilch:{turn_id}:{roll_id}:{sha256(encoded).hexdigest()[:20]}"


def scoring_options_for_roll(
    dice: Sequence[object],
    *,
    held_indices: Iterable[object] = (),
    round_points: int = 0,
    turn_id: int = 0,
    roll_id: int = 0,
) -> tuple[ZilchScoringOption, ...]:
    """Calculate all valid server-side Quick-Hold options for one roll.

    The function returns structured data and deliberately never formats a
    human sentence.  A later browser can choose an option but cannot invent a
    score because the exact same calculation is repeated during validation.
    """
    normalised_dice = _normalise_dice(dice, allow_unrolled=True)
    held = _normalise_indices(held_indices)
    available = tuple(index for index in range(ZILCH_DICE_COUNT) if index not in set(held))
    if not available or any(normalised_dice[index] == 0 for index in available):
        return ()
    primitive = _primitive_components(normalised_dice, available)
    components = [*primitive, *_special_components(normalised_dice, available, primitive)]
    options: list[ZilchScoringOption] = []
    all_indices = set(range(ZILCH_DICE_COUNT))
    for selected_components in _component_sets(components):
        selected_indices = tuple(sorted(index for component in selected_components for index in component.dice_indices))
        if not _selection_respects_triples(normalised_dice, selected_components, selected_indices):
            continue
        selected_set = set(selected_indices)
        all_available = selected_set == set(available)
        hot_dice = set(held) | selected_set == all_indices
        reasons: list[str] = []
        if hot_dice:
            reasons.append("hot_dice")
        if any(component.combination_type == "three_ones" for component in selected_components):
            reasons.append("three_ones")
        requires_confirmation = bool(reasons)
        points = sum(component.points for component in selected_components)
        combination_type, label_key, label_params = _classification(selected_components)
        next_points = max(0, int(round_points)) + points
        if requires_confirmation:
            follow_up = ("zilch_roll_dice",)
        elif next_points >= ZILCH_BANK_MINIMUM:
            follow_up = ("zilch_roll_dice", "zilch_bank_points")
        else:
            follow_up = ("zilch_roll_dice",)
        options.append(
            ZilchScoringOption(
                option_id=_option_id(turn_id=int(turn_id), roll_id=int(roll_id), components=selected_components),
                turn_id=int(turn_id),
                roll_id=int(roll_id),
                combination_type=combination_type,
                components=selected_components,
                dice_indices=selected_indices,
                dice_values=tuple(normalised_dice[index] for index in selected_indices),
                points=points,
                label_key=label_key,
                label_params=label_params,
                all_available_dice=all_available,
                hot_dice=hot_dice,
                free_roll=hot_dice,
                requires_confirmation=requires_confirmation,
                confirmation_reasons=tuple(reasons),
                follow_up_actions=follow_up,
            )
        )
    # Several equally valued dice can form the same visible selection through
    # different internal triple partitions (for example 4×5 as triple +
    # single). Keep one deterministic representative without hiding genuinely
    # different choices such as 3×1 as a triple versus three single ones.
    unique_options: dict[tuple[Any, ...], ZilchScoringOption] = {}
    for option in options:
        semantic_components = tuple(
            sorted((component.combination_type, component.points) for component in option.components)
        )
        key = (option.dice_indices, option.points, option.combination_type, semantic_components)
        existing = unique_options.get(key)
        if existing is None or option.option_id < existing.option_id:
            unique_options[key] = option
    options = list(unique_options.values())
    options.sort(
        key=lambda option: (
            -option.points,
            option.combination_type,
            option.dice_indices,
            option.option_id,
        )
    )
    return tuple(options)


def evaluate_zilch_roll(
    dice: Sequence[object],
    *,
    held_indices: Iterable[object] = (),
    round_points: int = 0,
    rolls_used: int = 0,
    turn_id: int = 0,
    roll_id: int = 0,
) -> ZilchRollEvaluation:
    """Evaluate a rolled state, including the confirmed third-roll guard."""
    normalised_dice = _normalise_dice(dice, allow_unrolled=True)
    options = scoring_options_for_roll(
        normalised_dice,
        held_indices=held_indices,
        round_points=round_points,
        turn_id=turn_id,
        roll_id=roll_id,
    )
    maximum = max((option.points for option in options), default=0)
    threshold_zilch = bool(
        options
        and int(rolls_used) >= 3
        and max(0, int(round_points)) + maximum < ZILCH_THIRD_ROLL_MINIMUM
    )
    return ZilchRollEvaluation(
        dice=normalised_dice,
        options=options,
        zilch=not options,
        third_roll_threshold_zilch=threshold_zilch,
        max_holdable_points=maximum,
    )


def roll_zilch_turn(
    turn: ZilchTurn,
    *,
    randint_fn: ZilchRandomInt | None = None,
) -> tuple[ZilchTurn, ZilchRollEvaluation]:
    """Apply one server-authoritative roll to an eligible turn."""
    if turn.phase not in {ZILCH_PHASE_READY_TO_ROLL, ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED}:
        raise ZilchRuleError("zilch_roll_not_allowed")
    rolled_dice = roll_available_dice(turn.dice, turn.held_indices, randint_fn=randint_fn)
    next_turn = replace(
        turn,
        dice=rolled_dice,
        version=turn.version + 1,
        phase=ZILCH_PHASE_AWAITING_HOLD,
        rolls_used=turn.rolls_used + 1,
        roll_id=turn.roll_id + 1,
        last_event="roll",
    )
    evaluation = evaluate_zilch_roll(
        next_turn.dice,
        held_indices=next_turn.held_indices,
        round_points=next_turn.round_points,
        rolls_used=next_turn.rolls_used,
        turn_id=next_turn.turn_id,
        roll_id=next_turn.roll_id,
    )
    return next_turn, evaluation


def options_for_turn(turn: ZilchTurn) -> tuple[ZilchScoringOption, ...]:
    """Return current options only while the player must commit a hold."""
    if turn.phase != ZILCH_PHASE_AWAITING_HOLD:
        return ()
    options = scoring_options_for_roll(
        turn.dice,
        held_indices=turn.held_indices,
        round_points=turn.round_points,
        turn_id=turn.turn_id,
        roll_id=turn.roll_id,
    )
    # At the third throw, an option that still leaves the turn below 300 is
    # not a legal continuation choice. If none can reach the threshold, the
    # roll transition itself has already produced Zilch.
    if turn.rolls_used >= 3 and turn.round_points < ZILCH_THIRD_ROLL_MINIMUM:
        return tuple(
            option
            for option in options
            if turn.round_points + option.points >= ZILCH_THIRD_ROLL_MINIMUM
        )
    return options


def select_zilch_option(turn: ZilchTurn, option_id: object) -> ZilchHoldResult:
    """Recompute and commit exactly one current Quick-Hold option."""
    if turn.phase != ZILCH_PHASE_AWAITING_HOLD:
        raise ZilchRuleError("zilch_hold_not_allowed")
    option_key = str(option_id or "")
    option = next((candidate for candidate in options_for_turn(turn) if candidate.option_id == option_key), None)
    if option is None:
        raise ZilchRuleError("zilch_stale_or_invalid_option")

    held = tuple(sorted(set(turn.held_indices) | set(option.dice_indices)))
    committed = (*turn.committed_holds, option.payload())
    new_points = turn.round_points + option.points
    # An already-pending confirmation is fulfilled by this newly committed
    # score (every valid option is at least 50), but another special hold may
    # immediately create the next confirmation requirement.
    new_reasons = option.confirmation_reasons
    hot_dice = option.hot_dice
    next_turn = replace(
        turn,
        dice=(0,) * ZILCH_DICE_COUNT if hot_dice else turn.dice,
        held_indices=() if hot_dice else held,
        committed_holds=committed,
        round_points=new_points,
        version=turn.version + 1,
        phase=(ZILCH_PHASE_CONFIRMATION_ROLL_REQUIRED if new_reasons else ZILCH_PHASE_READY_TO_ROLL),
        confirmation_reasons=new_reasons,
        last_event="hot_dice" if hot_dice else "hold",
    )
    return ZilchHoldResult(
        turn=next_turn,
        option=option,
        third_roll_threshold_zilch=(
            next_turn.rolls_used >= 3 and next_turn.round_points < ZILCH_THIRD_ROLL_MINIMUM
        ),
    )


def bank_allowed(turn: ZilchTurn) -> tuple[bool, str | None]:
    """Return the precise rule reason why the current round can be banked."""
    if turn.phase == ZILCH_PHASE_AWAITING_HOLD:
        return False, "zilch_hold_required"
    if turn.confirmation_required:
        return False, "zilch_confirmation_required"
    if turn.phase != ZILCH_PHASE_READY_TO_ROLL:
        return False, "zilch_bank_not_allowed"
    if turn.round_points < ZILCH_BANK_MINIMUM:
        return False, "zilch_bank_minimum_not_reached"
    return True, None


def apply_zilch_streak(total_points: int, prior_streak: int) -> tuple[int, int, int]:
    """Apply the confirmed third-consecutive-Zilch penalty without negatives.

    The confirmed contract specifies the transition to a third consecutive
    Zilch.  Later cadence after a fourth and subsequent consecutive Zilch is
    intentionally not invented here; only that transition applies the -500.
    """
    total = max(0, int(total_points))
    streak = max(0, int(prior_streak)) + 1
    penalty = ZILCH_ZILCH_STREAK_PENALTY if streak == 3 else 0
    return max(0, total - penalty), streak, penalty
