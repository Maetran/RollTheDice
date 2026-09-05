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
normal            650             Secure solid rounds with measured risk.
aggressive        850             Seek larger rounds without routinely gambling away a playable score.
================  ==============  ==========================================

The base goal is adjusted in a bounded way before it is compared with current
round points: a material trailing score raises it (+150), a material lead
lowers it (-150), one or two available dice lower it (-150), five or six
available dice raise it (+100), and a non-confirmation Hot-Dice state raises
it (+100).  The result is clamped to the house-rule bank minimum (400) and
1,800.  Those adjustments are heuristics only; they never alter scoring,
option validity, RNG, or the confirmed rules.

Quick Holds are selected from the server-provided current options only.  Their
point value dominates selection.  Equal-value choices are then ordered by the
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

_BANK_GOALS: Final[dict[str, int]] = {
    "conservative": 500,
    "normal": 650,
    "aggressive": 850,
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
    # Sorting explicitly by option ID resolves otherwise identical options in
    # a stable manner across processes and recovery attempts.
    return sorted(
        options,
        key=lambda option: (-_hold_priority(option, context=context, strategy=strategy), option.option_id),
    )[0]


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
