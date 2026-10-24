"""Exact offline cross-check of the DP against real trusted gameplay commands.

Every dice/hold template is reached with legal roll/hold transitions. Synthetic
banked totals supply the DP's score-gap inputs; no account, database or live
registry is used. All 923 weighted roll multisets for 1..6 free dice are checked
in nine profile/gap cells, plus 77 rolls from the actual two witness paths.
This checks transition equivalence and accounting, not match strength.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
from collections import Counter
from copy import deepcopy
from fractions import Fraction
from pathlib import Path

from app.zilch_cpu_strategy import choose_zilch_cpu_decision
from app.zilch_engine import ZilchRuleError, apply_zilch_streak, bank_allowed, options_for_turn
from app.zilch_gameplay import apply_zilch_bank_points, apply_zilch_roll_dice, apply_zilch_select_hold
from app.zilch_state import current_zilch_turn
from scripts.zilch_continuation_matches import actual_context, opening_game, table_values
from scripts.zilch_continuation_probe import GAPS, PROFILES, kernel, strategy_context, weighted_rolls


def roll_values(game: dict, values: tuple[int, ...]):
    turn = current_zilch_turn(game)
    if len(values) != len(turn.available_indices):
        raise ValueError("Fixture roll does not cover exactly the free dice")
    iterator = iter(values)
    return apply_zilch_roll_dice(
        game, turn.player_id, turn_id=turn.turn_id, version=turn.version,
        randint_fn=lambda _low, _high: next(iterator),
    )


def select_points(game: dict, points: int):
    turn = current_zilch_turn(game)
    option = next(option for option in options_for_turn(turn) if option.points == points)
    return apply_zilch_select_hold(
        game, turn.player_id, turn_id=turn.turn_id, version=turn.version,
        roll_id=turn.roll_id, option_id=option.option_id,
    )


def witness_game() -> dict:
    game = opening_game(731)
    roll_values(game, (1, 1, 2, 3, 4, 6))
    select_points(game, 200)
    roll_values(game, (1, 5, 2, 3))
    return game


def legal_templates() -> tuple[dict[int, dict], dict[str, dict]]:
    hot = opening_game(732)
    roll_values(hot, (3, 3, 3, 3, 3, 3))
    select_points(hot, 2_400)
    templates = {6: hot}
    for remaining, dice, points in (
        (5, (1, 2, 2, 3, 4, 6), 100),
        (4, (1, 5, 2, 2, 3, 4), 150),
        (3, (1, 1, 1, 2, 3, 4), 1_000),
        (2, (1, 1, 1, 5, 2, 3), 1_050),
        (1, (1, 1, 1, 5, 5, 2), 1_100),
    ):
        game = deepcopy(hot)
        roll_values(game, dice)
        select_points(game, points)
        if len(current_zilch_turn(game).available_indices) != remaining:
            raise AssertionError("A legal fixture did not reach its expected free-dice count")
        templates[remaining] = game
    witness = witness_game()
    paths = {}
    for label, points in (("keep_one", 100), ("greedy", 150)):
        paths[label] = deepcopy(witness)
        select_points(paths[label], points)
    return templates, paths


def accounting_inputs(game: dict, own: int, opponent: int, streak: int) -> None:
    actor = current_zilch_turn(game).player_id
    other = "p1" if actor == "p0" else "p0"
    for seat, total in ((actor, own), (other, opponent)):
        game["_total_points"][seat] = total
        game["_zilch_boards"][seat]["total_points"] = total
    game["_zilch_zilch_streaks"][actor] = streak
    game["_zilch_boards"][actor]["zilch_streak"] = streak


def gameplay_outcome(template: dict, dice: tuple[int, ...], profile: str, gap: int,
                     checks: Counter, *, own_total: int = 2_000):
    game = deepcopy(template)
    accounting_inputs(game, own_total, own_total + gap, 2)
    before = current_zilch_turn(game)
    actor = before.player_id
    rolled = roll_values(game, dice)
    if rolled.event["type"] == "zilch":
        expected_total, expected_streak, _nominal = apply_zilch_streak(own_total, 2)
        if (game["_total_points"][actor], game["_zilch_zilch_streaks"][actor]) != (expected_total, expected_streak):
            raise AssertionError("Real whole-turn loss/streak differs from one authoritative series loss")
        checks["loss_and_streak"] += 1
        return 0, 0, False
    turn = current_zilch_turn(game)
    decision = choose_zilch_cpu_decision(actual_context(game, turn, profile))
    if decision.action != "select_hold":
        raise AssertionError("A scoring gameplay roll did not require a hold")
    apply_zilch_select_hold(game, actor, turn_id=turn.turn_id, version=turn.version,
                            roll_id=turn.roll_id, option_id=decision.option_id)
    after = current_zilch_turn(game)
    outcome = after.round_points - before.round_points, len(after.available_indices), after.confirmation_required
    actual = actual_context(game, after, profile)
    model = strategy_context(after, profile, gap, with_options=False)
    if own_total == 2_000 and actual != model:
        raise AssertionError("Real score/profile/gap/bank facts do not match the DP context")
    next_decision = choose_zilch_cpu_decision(actual)
    command = {"turn_id": after.turn_id, "version": after.version}
    if not bank_allowed(after)[0]:
        if next_decision.action != "roll":
            raise AssertionError("Baseline must continue a non-bankable real turn")
        try:
            apply_zilch_bank_points(game, actor, **command)
        except ZilchRuleError:
            if game["_total_points"][actor] != own_total or current_zilch_turn(game).version != after.version:
                raise AssertionError("Rejected bank mutated real accounting or turn version")
        else:
            raise AssertionError("Gameplay bank accepted an unconfirmed/subminimum hold")
        checks["bank_rejections"] += 1
    else:
        # Even if the personality elects another roll, bank eligibility is
        # independently exercised through the real command on this disposable fixture.
        if next_decision.action not in {"roll", "bank"}:
            raise AssertionError("Unexpected baseline continuation after a committed hold")
        result = apply_zilch_bank_points(game, actor, **command)
        if (result.event["points"] != after.round_points
                or game["_total_points"][actor] != own_total + after.round_points
                or game["_zilch_zilch_streaks"][actor] != 0):
            raise AssertionError("Real bank/gross/total/streak accounting residual")
        checks[f"bank_allowed_policy_{next_decision.action}"] += 1
    return outcome


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", type=Path, required=True)
    parser.add_argument("--max-seconds", type=float, default=60)
    args = parser.parse_args()
    if not math.isfinite(args.max_seconds) or not 0 < args.max_seconds <= 60:
        parser.error("Use a positive time budget of at most 60 seconds")
    table_values(args.table)
    started = time.monotonic()

    def check():
        if time.monotonic() - started >= args.max_seconds:
            raise TimeoutError("Real-gameplay kernel-check budget exhausted")

    templates, witness_paths = legal_templates()
    checks = Counter()
    groups = 0
    complete = True
    try:
        for profile in PROFILES:
            for gap in GAPS.values():
                for template in (*templates.values(), *witness_paths.values()):
                    available = len(current_zilch_turn(template).available_indices)
                    expected = {(row.points, row.remaining, row.confirmation): row.probability
                                for row in kernel(available, profile, gap, check)}
                    observed = Counter()
                    for canonical, weight in weighted_rolls(available):
                        check()
                        dice = tuple(canonical.dice[index] for index in canonical.available_indices)
                        observed[gameplay_outcome(template, dice, profile, gap, checks)] += weight
                        checks["completed_roll_cases"] += 1
                    probabilities = {outcome: Fraction(weight, 6 ** available) for outcome, weight in observed.items()}
                    if probabilities != expected:
                        raise AssertionError("Real gameplay weighted kernel differs from exact DP")
                    groups += 1
        # Explicit integration edge: nominal 500 loss must clamp at 250 once.
        if gameplay_outcome(templates[2], (2, 3), "normal", 0, checks, own_total=250) != (0, 0, False):
            raise AssertionError("The explicit clamped-loss case did not bust")
        checks["clamped_loss_case"] += 1
    except TimeoutError:
        complete = False
    root = Path(__file__).resolve().parents[1]
    sources = ("app/zilch_engine.py", "app/zilch_cpu_strategy.py", "app/zilch_gameplay.py", "app/zilch_state.py",
               "scripts/zilch_continuation_probe.py", "scripts/zilch_continuation_matches.py",
               "scripts/zilch_continuation_gameplay_check.py")
    output = {"experiment": "zilch-exact-real-gameplay-kernel-check-v1", "enabled": False,
              "complete": complete, "groups": groups, "expected_groups": 72,
              "elapsed_seconds": time.monotonic() - started, "checks": dict(checks),
              "equivalence_passed": complete and groups == 72,
              "table_sha256": hashlib.sha256(args.table.read_bytes()).hexdigest(),
              "sources": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in sources}}
    print(json.dumps(output, indent=2))
    return 0 if complete else 2


if __name__ == "__main__":
    raise SystemExit(main())
