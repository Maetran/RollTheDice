"""Pure, deterministic decision policies for a Zilch CPU participant.

The module deliberately has no dependency on FastAPI, WebSockets, persistence,
live-state mutation, or random-number generation.  A runner supplies only the
authoritative state already exposed by the Zilch engine and executes the
returned command through the same domain actions used for a human turn.

``needed_to_beat`` is an *absolute final total*, not an additional number of
round points.  It is normally ``None``.  During a final reply the live adapter
sets it to the smallest total that avoids a known loss (for example ``10_250``
when the opponent has 10,250 points, because a tie is valid).  The policy will
not knowingly bank a losing final reply while another roll is legal.

The deliberately small product parameters are public and deterministic:

================  ==============  ==========================================
Strategy          Base bank goal  Intent
================  ==============  ==========================================
conservative      500             Prefer a safe eligible bank.
normal            600             Secure solid rounds with measured risk.
aggressive        700             Seek larger rounds without routinely gambling away a playable score.
================  ==============  ==========================================

The base goal is adjusted in a bounded way before it is compared with current
round points: a material trailing score raises it (+150), a material lead
lowers it (-150), one or two available dice lower it (-150), five or six
available dice raise it (+100), and a non-confirmation Hot-Dice state raises
it (+100).  The result is clamped to the house-rule bank minimum (400) and
1,800.  Those adjustments are heuristics only; they never alter scoring,
option validity, RNG, or the confirmed rules.

Quick Holds are selected from the server-provided current options only.  Their
point value normally dominates selection. The versioned continuation policy
may retain only the 1 in the narrowly verified second-roll 200/4 state. Its
six profile/gap cells have higher expected bank and lower whole-turn bust risk;
there is no claim about match win rate. Equal-value choices are ordered by the
strategy's risk preference and finally by ``option_id``.  Therefore the policy
does not invent combinations or use random tie breaking.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final, Literal, cast

from .zilch_engine import ZILCH_BANK_MINIMUM

ZilchCpuStrategy = Literal["conservative", "normal", "aggressive"]
CpuDecisionAction = Literal["select_hold", "roll", "bank"]

ZILCH_CPU_STRATEGIES: Final[frozenset[str]] = frozenset(
    {"conservative", "normal", "aggressive"}
)
ZILCH_CPU_BASELINE_POLICY: Final = "baseline-v1"
ZILCH_CPU_CONTINUATION_POLICY: Final = "mandatory-continuation-v1"
ZILCH_CPU_EXPERIENCE_THRESHOLD: Final = 10
# Proven offline against the unchanged baseline, not calculated in live play.
_CONTINUATION_CELLS: Final = frozenset({
    ("conservative", "leading"), ("conservative", "level"), ("conservative", "trailing"),
    ("normal", "leading"), ("normal", "level"), ("aggressive", "leading"),
})

_BANK_GOALS: Final[dict[str, int]] = {
    "conservative": 500,
    "normal": 600,
    "aggressive": 700,
}
_MAX_DYNAMIC_BANK_GOAL: Final = 1_800
_MATERIAL_SCORE_GAP: Final = 1_200


class ZilchCpuStrategyError(ValueError):
    """A malformed CPU strategy input has no safe domain decision."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def validate_zilch_cpu_strategy(value: object) -> ZilchCpuStrategy:
    """Return a canonical CPU strategy or reject an unknown value.

    The function intentionally accepts no aliases.  Creation code must not
    turn arbitrary client text into a silently different CPU difficulty.
    """
    if not isinstance(value, str) or value not in ZILCH_CPU_STRATEGIES:
        raise ZilchCpuStrategyError("zilch_invalid_cpu_strategy")
    return cast(ZilchCpuStrategy, value)


@dataclass(frozen=True)
class CpuQuickHoldOption:
    """The minimal authoritative part of a currently valid Quick Hold.

    It mirrors the engine's current option projection but deliberately does
    not recompute a score or inspect dice values.  The live runner must still
    validate ``option_id`` against the current turn immediately before it
    applies the decision.
    """

    option_id: str
    combination_type: str
    points: int
    dice_indices: tuple[int, ...]
    all_available_dice: bool
    hot_dice: bool
    free_roll: bool
    requires_confirmation: bool = False
    dice_values: tuple[int, ...] = ()


@dataclass(frozen=True)
class CpuStrategyContext:
    """Authoritative, read-only facts used by one CPU decision.

    ``quick_holds`` must contain only options calculated for the current roll.
    Invalid entries are ignored defensively; an unknown strategy or malformed
    core state is rejected instead of yielding a speculative action.
    """

    strategy: str
    own_total: int
    opponent_total: int
    target_score: int
    round_points: int
    available_dice_count: int
    confirmation_required: bool
    hot_dice: bool
    final_round: bool
    needed_to_beat: int | None
    quick_holds: tuple[CpuQuickHoldOption, ...]
    can_roll: bool
    can_bank: bool
    policy: str = ZILCH_CPU_BASELINE_POLICY
    rolls_used: int = 0
    available_dice: tuple[tuple[int, int], ...] = ()


@dataclass(frozen=True)
class CpuDecision:
    """A deterministic action for the caller to validate and execute."""

    action: CpuDecisionAction
    option_id: str | None
    reason_key: str
    reason_params: dict[str, int | str | bool]


def _is_strict_int(value: object) -> bool:
    return type(value) is int


def _validate_context(context: CpuStrategyContext) -> ZilchCpuStrategy:
    strategy = validate_zilch_cpu_strategy(context.strategy)
    integer_values = {
        "own_total": context.own_total,
        "opponent_total": context.opponent_total,
        "target_score": context.target_score,
        "round_points": context.round_points,
        "available_dice_count": context.available_dice_count,
    }
    if any(not _is_strict_int(value) or value < 0 for value in integer_values.values()):
        raise ZilchCpuStrategyError("zilch_cpu_invalid_strategy_context")
    if context.target_score < 1 or context.available_dice_count > 6:
        raise ZilchCpuStrategyError("zilch_cpu_invalid_strategy_context")
    if context.needed_to_beat is not None and (
        not _is_strict_int(context.needed_to_beat) or context.needed_to_beat < 0
    ):
        raise ZilchCpuStrategyError("zilch_cpu_invalid_strategy_context")
    if any(
        type(value) is not bool
        for value in (
            context.confirmation_required,
            context.hot_dice,
            context.final_round,
            context.can_roll,
            context.can_bank,
        )
    ):
        raise ZilchCpuStrategyError("zilch_cpu_invalid_strategy_context")
    return strategy


def _valid_options(context: CpuStrategyContext) -> tuple[CpuQuickHoldOption, ...]:
    """Filter malformed caller data so it can never become a CPU selection."""
    valid: list[CpuQuickHoldOption] = []
    for option in context.quick_holds:
        if not isinstance(option, CpuQuickHoldOption):
            continue
        if not isinstance(option.option_id, str) or not option.option_id:
            continue
        if not isinstance(option.combination_type, str) or not option.combination_type:
            continue
        if not _is_strict_int(option.points) or option.points <= 0:
            continue
        if not option.dice_indices or len(option.dice_indices) > context.available_dice_count:
            continue
        if (
            any(not _is_strict_int(index) or index < 0 or index > 5 for index in option.dice_indices)
            or len(set(option.dice_indices)) != len(option.dice_indices)
        ):
            continue
        if any(type(flag) is not bool for flag in (option.all_available_dice, option.hot_dice, option.free_roll)):
            continue
        valid.append(option)
    return tuple(valid)


def _score_gap(context: CpuStrategyContext) -> int:
    """Positive when the CPU trails, negative when it leads."""
    return context.opponent_total - context.own_total


def _hold_priority(
    option: CpuQuickHoldOption,
    *,
    context: CpuStrategyContext,
    strategy: ZilchCpuStrategy,
) -> int:
    """Score only a server-provided option; the highest priority is chosen."""
    available_after = context.available_dice_count - len(option.dice_indices)
    # Points dominate by design.  Risk preferences only decide nearby choices
    # and never change the authoritative option score.
    priority = option.points * 10_000
    trailing = _score_gap(context) >= _MATERIAL_SCORE_GAP
    leading = _score_gap(context) <= -_MATERIAL_SCORE_GAP
    if strategy == "conservative":
        # Leaving more dice available makes a next roll less brittle.  Avoid
        # voluntarily introducing a confirmation rule when value is tied.
        priority += available_after * 160
        priority -= 90 if option.hot_dice else 0
        priority -= 60 if option.free_roll else 0
        priority += 40 if leading else 0
    elif strategy == "normal":
        priority += available_after * 80
        priority += 180 if option.hot_dice else 0
        priority += 80 if option.all_available_dice else 0
        priority += 80 if trailing and option.free_roll else 0
    else:
        # The aggressive profile deliberately values an all-dice/free-roll
        # opportunity and is more willing to leave fewer dice for a big turn.
        priority -= available_after * 55
        priority += 620 if option.hot_dice else 0
        priority += 250 if option.all_available_dice else 0
        priority += 180 if option.free_roll else 0
        priority += 250 if trailing and (option.hot_dice or option.free_roll) else 0
        priority -= 80 if leading else 0
    return priority


def _choose_hold(
    options: tuple[CpuQuickHoldOption, ...],
    *,
    context: CpuStrategyContext,
    strategy: ZilchCpuStrategy,
) -> CpuQuickHoldOption:
    continuation = _continuation_hold(options, context=context, strategy=strategy)
    if continuation is not None:
        return continuation
    # Sorting explicitly by option ID resolves otherwise identical options in
    # a stable manner across processes and recovery attempts.
    return sorted(
        options,
        key=lambda option: (-_hold_priority(option, context=context, strategy=strategy), option.option_id),
    )[0]


def _continuation_hold(
    options: tuple[CpuQuickHoldOption, ...], *, context: CpuStrategyContext, strategy: ZilchCpuStrategy,
) -> CpuQuickHoldOption | None:
    """Recognize one verified real roll; unsupported or mismatched facts fall back."""
    if (context.policy != ZILCH_CPU_CONTINUATION_POLICY
            or type(context.rolls_used) is not int or context.rolls_used != 2
            or context.round_points != 200 or context.available_dice_count != 4
            or context.confirmation_required or context.hot_dice or context.final_round
            or context.needed_to_beat is not None or context.can_roll or context.can_bank
            or context.target_score - context.own_total < 1_800
            or len(options) != 3 or len(context.quick_holds) != 3
            or not isinstance(context.available_dice, tuple) or len(context.available_dice) != 4):
        return None
    dice = {}
    for entry in context.available_dice:
        if (not isinstance(entry, tuple) or len(entry) != 2
                or not all(type(value) is int for value in entry)
                or not 0 <= entry[0] <= 5 or not 1 <= entry[1] <= 6 or entry[0] in dice):
            return None
        dice[entry[0]] = entry[1]
    values = list(dice.values())
    if values.count(1) != 1 or values.count(5) != 1:
        return None
    gap = _score_gap(context)
    position = "trailing" if gap >= _MATERIAL_SCORE_GAP else "leading" if gap <= -_MATERIAL_SCORE_GAP else "level"
    if (strategy, position) not in _CONTINUATION_CELLS:
        return None
    one = next(index for index, value in dice.items() if value == 1)
    five = next(index for index, value in dice.items() if value == 5)
    expected = {
        (100, (one,), "single_one"),
        (50, (five,), "single_five"),
        (150, tuple(sorted((one, five))), "combined"),
    }
    if any(not isinstance(option.dice_indices, tuple) or not isinstance(option.dice_values, tuple)
           or any(type(value) is not int for value in option.dice_values)
           for option in options):
        return None
    if {(option.points, option.dice_indices, option.combination_type) for option in options} != expected:
        return None
    if len({option.option_id for option in options}) != 3:
        return None
    for option in options:
        if (option.all_available_dice or option.hot_dice or option.free_roll
                or option.requires_confirmation is not False
                or option.dice_values != tuple(dice[index] for index in option.dice_indices)):
            return None
    return next(option for option in options if option.points == 100)


def _bank_goal(context: CpuStrategyContext, strategy: ZilchCpuStrategy) -> int:
    """Return the documented dynamic threshold, always within legal bounds."""
    goal = _BANK_GOALS[strategy]
    gap = _score_gap(context)
    if gap >= _MATERIAL_SCORE_GAP:
        goal += 150
    elif gap <= -_MATERIAL_SCORE_GAP:
        goal -= 150
    if context.available_dice_count <= 2:
        goal -= 150
    elif context.available_dice_count >= 5:
        goal += 100
    if context.hot_dice and not context.confirmation_required:
        goal += 100
    return max(ZILCH_BANK_MINIMUM, min(_MAX_DYNAMIC_BANK_GOAL, goal))


def _winning_total(context: CpuStrategyContext) -> int:
    if context.final_round and context.needed_to_beat is not None:
        return max(context.target_score, context.needed_to_beat)
    return context.target_score


def _roll_decision(context: CpuStrategyContext, *, reason_key: str, **params: int | str | bool) -> CpuDecision:
    if not context.can_roll:
        raise ZilchCpuStrategyError("zilch_cpu_no_legal_action")
    return CpuDecision(action="roll", option_id=None, reason_key=reason_key, reason_params=dict(params))


def choose_zilch_cpu_decision(context: CpuStrategyContext) -> CpuDecision:
    """Choose one legal-looking CPU action from authoritative state only.

    The caller is still required to revalidate this decision against the
    current live turn/version before mutation.  This separation makes stale
    runner work harmless and keeps the policy deterministic and pure.
    """
    strategy = _validate_context(context)
    options = _valid_options(context)
    if options:
        option = _choose_hold(options, context=context, strategy=strategy)
        return CpuDecision(
            action="select_hold",
            option_id=option.option_id,
            reason_key="zilch.cpu.reason.hold_scoring_option",
            reason_params={
                "strategy": strategy,
                "points": option.points,
                "available_dice_after": context.available_dice_count - len(option.dice_indices),
                "hot_dice": option.hot_dice,
            },
        )

    # A special hold or Hot Dice cannot be banked until another positive roll
    # fulfills the confirmed house rule.  This takes precedence over any
    # otherwise eligible bank threshold.
    if context.confirmation_required:
        return _roll_decision(
            context,
            reason_key="zilch.cpu.reason.confirmation_required",
            strategy=strategy,
        )

    projected_total = context.own_total + context.round_points
    winning_total = _winning_total(context)
    if context.can_bank and projected_total >= winning_total:
        return CpuDecision(
            action="bank",
            option_id=None,
            reason_key=(
                "zilch.cpu.reason.final_round_target_reached"
                if context.final_round
                else "zilch.cpu.reason.target_reached"
            ),
            reason_params={"strategy": strategy, "total": projected_total, "required_total": winning_total},
        )

    # A final reply below the known target is a guaranteed loss.  Continue if
    # the same current turn is still allowed to roll; otherwise bank is the
    # only legal fallback and the engine remains authoritative.
    if context.final_round and projected_total < winning_total and context.can_roll:
        return _roll_decision(
            context,
            reason_key="zilch.cpu.reason.final_round_chase",
            strategy=strategy,
            total=projected_total,
            required_total=winning_total,
        )

    if context.can_bank:
        goal = _bank_goal(context, strategy)
        if context.round_points >= goal:
            return CpuDecision(
                action="bank",
                option_id=None,
                reason_key="zilch.cpu.reason.bank_goal_reached",
                reason_params={"strategy": strategy, "points": context.round_points, "bank_goal": goal},
            )
        if not context.can_roll:
            return CpuDecision(
                action="bank",
                option_id=None,
                reason_key="zilch.cpu.reason.no_roll_available",
                reason_params={"strategy": strategy, "points": context.round_points},
            )

    return _roll_decision(
        context,
        reason_key="zilch.cpu.reason.risk_for_more_points",
        strategy=strategy,
        points=context.round_points,
        bank_goal=_bank_goal(context, strategy),
    )
