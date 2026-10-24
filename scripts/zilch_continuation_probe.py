"""Offline evidence for one Zilch hold choice; never imported by the live CPU.

Run explicitly as ``python -m scripts.zilch_continuation_probe``. Nothing is
calculated at import time and no database, live game, or application RNG is used.
The only candidate is the legal second-roll witness: 200 points, four free
dice showing 1, 5, 2, 3; hold 100 leaving three versus 150 leaving two.

All subsequent decisions use the unchanged baseline. Points already reach 300,
so the third-roll minimum cannot remove any later scoring hold. Weighted dice
multisets are evaluated by the real engine. Above the baseline's maximum bank
goal, ordinary states bank; confirmation states have affine gross-bank value
``a * points + b``. A small linear system accounts for repeated confirmations
and Hot Dice without truncating them or treating them as immediately bankable.

Gross bank and eventual whole-turn bust probability are separate outputs.
Subtract the actual engine series loss ONCE, outside that gross expectation.
This experiment neither enables a policy nor establishes match strength.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from collections import defaultdict
from dataclasses import dataclass, replace
from fractions import Fraction
from functools import lru_cache
from itertools import combinations_with_replacement
from pathlib import Path
from typing import Callable

from app.zilch_cpu_strategy import (
    _MAX_DYNAMIC_BANK_GOAL,
    CpuQuickHoldOption,
    CpuStrategyContext,
    choose_zilch_cpu_decision,
)
from app.zilch_engine import (
    ZILCH_PHASE_AWAITING_HOLD,
    ZilchTurn,
    apply_zilch_streak,
    bank_allowed,
    new_zilch_turn,
    options_for_turn,
    roll_zilch_turn,
    select_zilch_option,
)

GAPS = {"leading": -1_200, "level": 0, "trailing": 1_200}
PROFILES = ("conservative", "normal", "aggressive")
VALIDATION_CONTRACT = {
    "method_version": 2,
    "minimum_exact_net_gain_points": 5,
    "net_gain_must_clear_threshold_at_penalty_endpoints": [0, 500],
    "whole_match_holdout_pairs": 180,
    "whole_match_pairs_per_profile_opponent_seat": 10,
    "whole_match_score": "win=1, draw=0.5, loss=0",
    "whole_match_sampling": "fixed heldout seeds; balanced own/opponent profiles and seat",
    "whole_match_sign_check": "one-sided exact sign test for harms > benefits; alpha=0.05; explicitly underpowered",
    "whole_match_engineering_gate": "complete; zero crashes or ledger residuals; overrides > 0; no-override pairs identical",
    "whole_match_strength_claim": "none; no noninferiority or win-rate claim",
    "whole_match_rng": "independent per-seat/per-turn streams; no shared cursor coupling",
    "gameplay_equivalence": "exact weighted real-gameplay kernel mapping and actual bank/loss reconciliation",
    "whole_match_not_implemented_or_run_by_this_probe": True,
}


@dataclass(frozen=True)
class Outcome:
    points: int
    remaining: int
    confirmation: bool
    probability: Fraction


@dataclass(frozen=True)
class Value:
    gross_bank: Fraction
    bust_probability: Fraction

    def net(self, own_total: int, prior_streak: int) -> Fraction:
        """Use the real clamped loss, not the nominal 500 penalty field."""
        total_after_bust, _streak, _nominal = apply_zilch_streak(own_total, prior_streak)
        loss = own_total - total_after_bust
        return self.gross_bank - loss * self.bust_probability


def strategy_context(
    turn: ZilchTurn, strategy: str, gap: int, *, with_options: bool = True
) -> CpuStrategyContext:
    options = options_for_turn(turn) if with_options else ()
    allowed, _reason = bank_allowed(turn)
    return CpuStrategyContext(
        strategy=strategy, own_total=2_000, opponent_total=2_000 + gap,
        target_score=10_000, round_points=turn.round_points,
        available_dice_count=len(turn.available_indices),
        confirmation_required=turn.confirmation_required,
        hot_dice=turn.last_event == "hot_dice", final_round=False,
        needed_to_beat=None,
        quick_holds=tuple(CpuQuickHoldOption(
            option_id=option.option_id, combination_type=option.combination_type,
            points=option.points, dice_indices=option.dice_indices,
            all_available_dice=option.all_available_dice,
            hot_dice=option.hot_dice, free_roll=option.free_roll,
        ) for option in options),
        can_roll=turn.phase in {"ready_to_roll", "confirmation_roll_required"},
        can_bank=allowed,
    )


def witness_turn() -> ZilchTurn:
    """Reach the approved choice through legal rolls and irreversible holds."""
    values = iter((1, 1, 2, 3, 4, 6, 1, 5, 2, 3))

    def rng(_low: int, _high: int) -> int:
        return next(values)

    first, _evaluation = roll_zilch_turn(new_zilch_turn("cpu", turn_id=1, round_number=1), randint_fn=rng)
    two_ones = next(option for option in options_for_turn(first)
                    if option.points == 200 and option.dice_values == (1, 1))
    held = select_zilch_option(first, two_ones.option_id).turn
    second, _evaluation = roll_zilch_turn(held, randint_fn=rng)
    return second


def witness_states() -> dict[str, ZilchTurn]:
    """Build both candidates from the same authoritative second roll."""
    second = witness_turn()
    candidates = {100: "keep_one", 150: "greedy"}
    return {candidates[option.points]: select_zilch_option(second, option.option_id).turn
            for option in options_for_turn(second) if option.points in candidates}


@lru_cache(maxsize=6)
def weighted_rolls(available: int) -> tuple[tuple[ZilchTurn, int], ...]:
    """At most 462 multisets; weights cover all equiprobable ordered rolls."""
    rows = []
    for dice in combinations_with_replacement(range(1, 7), available):
        weight = math.factorial(available)
        for face in range(1, 7):
            weight //= math.factorial(dice.count(face))
        turn = replace(
            new_zilch_turn("cpu", turn_id=1, round_number=1),
            dice=(6,) * (6 - available) + dice,
            held_indices=tuple(range(6 - available)), round_points=300,
            rolls_used=3, roll_id=3, phase=ZILCH_PHASE_AWAITING_HOLD,
        )
        rows.append((turn, weight))
    return tuple(rows)


def kernel(available: int, strategy: str, gap: int, check: Callable[[], None]) -> tuple[Outcome, ...]:
    counts: dict[tuple[int, int, bool], int] = defaultdict(int)
    for turn, weight in weighted_rolls(available):
        check()
        context = strategy_context(turn, strategy, gap)
        if not context.quick_holds:
            counts[(0, 0, False)] += weight
            continue
        decision = choose_zilch_cpu_decision(context)
        result = select_zilch_option(turn, decision.option_id).turn
        counts[(result.round_points - 300, len(result.available_indices), result.confirmation_required)] += weight
    return tuple(Outcome(points, remaining, confirmation, Fraction(count, 6 ** available))
                 for (points, remaining, confirmation), count in sorted(counts.items()))


def solve(matrix: list[list[Fraction]], rhs: list[Fraction]) -> tuple[Fraction, ...]:
    """Small exact linear solve, with no numerical or scientific dependency."""
    rows = [list(row) + [value] for row, value in zip(matrix, rhs, strict=True)]
    for column in range(len(rows)):
        pivot = next(index for index in range(column, len(rows)) if rows[index][column])
        rows[column], rows[pivot] = rows[pivot], rows[column]
        factor = rows[column][column]
        rows[column] = [value / factor for value in rows[column]]
        for index in range(len(rows)):
            if index == column:
                continue
            factor = rows[index][column]
            rows[index] = [value - factor * source
                           for value, source in zip(rows[index], rows[column], strict=True)]
    return tuple(row[-1] for row in rows)


def affine_tail(kernels: tuple[tuple[Outcome, ...], ...]) -> tuple[tuple[Fraction, ...], tuple[Fraction, ...]]:
    """Whole remaining confirmation chain: bank chance a and score offset b."""
    count = len(kernels)
    if any(sum((row.probability for row in outcomes), Fraction(0)) != 1 for outcomes in kernels):
        raise ArithmeticError("Kernel probability mass is not exactly one")
    matrix = [[Fraction(int(row == column)) for column in range(count)] for row in range(count)]
    bank_chance = [Fraction(0) for _ in range(count)]
    for index, outcomes in enumerate(kernels):
        for outcome in outcomes:
            if not outcome.points:
                continue
            if outcome.confirmation:
                matrix[index][outcome.remaining - 1] -= outcome.probability
            else:
                bank_chance[index] += outcome.probability
    a = solve(matrix, bank_chance)
    offsets = [sum((outcome.probability * outcome.points
                    * (a[outcome.remaining - 1] if outcome.confirmation else 1)
                    for outcome in outcomes if outcome.points), Fraction(0)) for outcomes in kernels]
    b = solve(matrix, offsets)
    for coefficients, expected in ((a, bank_chance), (b, offsets)):
        if any(sum((entry * coefficient for entry, coefficient in zip(row, coefficients, strict=True)), Fraction(0))
               != value for row, value in zip(matrix, expected, strict=True)):
            raise ArithmeticError("Nonzero affine-system residual")
    if any(not 0 <= chance <= 1 for chance in a):
        raise ArithmeticError("Invalid terminal bank probability")
    return a, b


def exact_values(strategy: str, gap: int, check: Callable[[], None]) -> tuple[Value, Value]:
    kernels = tuple(kernel(available, strategy, gap, check) for available in range(1, 7))
    a, b = affine_tail(kernels)

    @lru_cache(maxsize=None)
    def value(points: int, available: int, confirmation: bool) -> Value:
        check()
        if points >= _MAX_DYNAMIC_BANK_GOAL:
            return (Value(a[available - 1] * points + b[available - 1], 1 - a[available - 1])
                    if confirmation else Value(Fraction(points), Fraction(0)))
        turn = replace(
            new_zilch_turn("cpu", turn_id=1, round_number=1), round_points=points,
            held_indices=tuple(range(6 - available)), rolls_used=3,
            confirmation_reasons=("offline-confirmation",) if confirmation else (),
            phase="confirmation_roll_required" if confirmation else "ready_to_roll",
        )
        decision = choose_zilch_cpu_decision(strategy_context(turn, strategy, gap, with_options=False))
        if decision.action == "bank":
            return Value(Fraction(points), Fraction(0))
        gross, bust = Fraction(0), Fraction(0)
        for outcome in kernels[available - 1]:
            if not outcome.points:
                bust += outcome.probability
                continue
            following = value(points + outcome.points, outcome.remaining, outcome.confirmation)
            gross += outcome.probability * following.gross_bank
            bust += outcome.probability * following.bust_probability
        if gross < 0 or not 0 <= bust <= 1:
            raise ArithmeticError("Invalid remaining-turn value")
        return Value(gross, bust)

    return value(300, 3, False), value(350, 2, False)


def fraction_output(value: Fraction) -> dict[str, str | float]:
    return {"exact": str(value), "decimal": float(value)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-seconds", type=float, default=30)
    args = parser.parse_args()
    if not math.isfinite(args.max_seconds) or not 0 < args.max_seconds <= 120:
        parser.error("max-seconds must be positive and at most 120")
    deadline = time.monotonic() + args.max_seconds

    def check() -> None:
        if time.monotonic() > deadline:
            raise TimeoutError("Exact probe budget exhausted; no model is approved or enabled")

    witness = witness_states()
    if {(turn.round_points, len(turn.available_indices), turn.confirmation_required)
            for turn in witness.values()} != {(300, 3, False), (350, 2, False)}:
        raise RuntimeError("The approved witness no longer has the expected legal states")
    root = Path(__file__).resolve().parents[1]
    rows = []
    for strategy in PROFILES:
        for label, gap in GAPS.items():
            alternative, baseline = exact_values(strategy, gap, check)
            rows.append({
                "strategy": strategy, "gap": label,
                "keep_one": {"points": 300, "dice": 3,
                             "gross_bank": fraction_output(alternative.gross_bank),
                             "whole_turn_bust": fraction_output(alternative.bust_probability)},
                "greedy": {"points": 350, "dice": 2,
                           "gross_bank": fraction_output(baseline.gross_bank),
                           "whole_turn_bust": fraction_output(baseline.bust_probability)},
                "net_gain_no_penalty": fraction_output(alternative.net(2_000, 0) - baseline.net(2_000, 0)),
                "net_gain_full_penalty": fraction_output(alternative.net(2_000, 2) - baseline.net(2_000, 2)),
            })
    output = {"experiment": "zilch-mandatory-continuation-witness-v1", "enabled": False,
              "method": "exact weighted multisets; baseline to terminal bank/bust; affine confirmation tail",
              "max_bank_goal": _MAX_DYNAMIC_BANK_GOAL,
              "validation_contract": VALIDATION_CONTRACT,
              "verification": {"kernel_probability_mass": "exactly one", "affine_system_residuals": "exactly zero"},
              "sources": {name: hashlib.sha256((root / name).read_bytes()).hexdigest()
                          for name in ("app/zilch_engine.py", "app/zilch_cpu_strategy.py",
                                       "scripts/zilch_continuation_probe.py")},
              "decisions": rows}
    print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
