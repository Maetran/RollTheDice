"""Bounded offline heldout matches for the approved 200-point/four-dice witness.

No factory, database, socket, or production policy is modified. Both sides use
legal authoritative options and real trusted gameplay roll/hold/bank commands.
The candidate only substitutes a 100-point hold in the narrowly approved case;
all other decisions and every opponent decision retain the baseline.

Run explicitly with ``python -m scripts.zilch_continuation_matches --table PATH``.
The fixed 180-pair contract is not accepted from a shorter/unfinished run.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import sys
import time
from collections import Counter
from dataclasses import replace
from fractions import Fraction
from pathlib import Path
from typing import Callable

from app.zilch_cpu_strategy import choose_zilch_cpu_decision
from app.zilch_engine import bank_allowed, options_for_turn
from app.zilch_gameplay import apply_zilch_bank_points, apply_zilch_roll_dice, apply_zilch_select_hold
from app.zilch_state import (
    current_zilch_turn,
    new_zilch_participant,
    record_zilch_start_roll,
    start_zilch_game,
)
from scripts.zilch_continuation_probe import PROFILES, VALIDATION_CONTRACT, Value, strategy_context

HOLDOUT_SEED_START = 0x5A11C000
EXPECTED_VERIFICATION = {"kernel_probability_mass": "exactly one", "affine_system_residuals": "exactly zero"}
APPROVED_CELLS = frozenset({
    ("conservative", "leading"), ("conservative", "level"), ("conservative", "trailing"),
    ("normal", "leading"), ("normal", "level"), ("aggressive", "leading"),
})


def gap_label(gap: int) -> str:
    return "trailing" if gap >= 1_200 else "leading" if gap <= -1_200 else "level"


def table_values(path: Path) -> dict[tuple[str, str], tuple[Value, Value]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    root = Path(__file__).resolve().parents[1]
    if data.get("verification") != EXPECTED_VERIFICATION:
        raise ValueError("Use the verified exact output with probability-mass and affine-residual checks")
    if data.get("validation_contract") != VALIDATION_CONTRACT:
        raise ValueError("The evidence contract changed after the table was produced")
    for name in ("app/zilch_engine.py", "app/zilch_cpu_strategy.py", "scripts/zilch_continuation_probe.py"):
        if data["sources"].get(name) != hashlib.sha256((root / name).read_bytes()).hexdigest():
            raise ValueError(f"Table no longer matches authoritative source: {name}")
    rows = {}
    for row in data["decisions"]:
        if (row["keep_one"]["points"], row["keep_one"]["dice"],
                row["greedy"]["points"], row["greedy"]["dice"]) != (300, 3, 350, 2):
            raise ValueError("Unexpected continuation state")
        rows[(row["strategy"], row["gap"])] = tuple(
            Value(Fraction(row[key]["gross_bank"]["exact"]), Fraction(row[key]["whole_turn_bust"]["exact"]))
            for key in ("keep_one", "greedy")
        )
        if any(value.gross_bank < 0 or not 0 <= value.bust_probability <= 1
               for value in rows[(row["strategy"], row["gap"])]):
            raise ValueError("Damaged continuation value")
    if set(rows) != {(profile, label) for profile in PROFILES for label in ("leading", "level", "trailing")}:
        raise ValueError("Expected exactly nine comparisons / eighteen state values")
    dominant = {key for key, (alternative, baseline) in rows.items()
                if alternative.gross_bank - baseline.gross_bank >= 5
                and alternative.bust_probability < baseline.bust_probability}
    if dominant != APPROVED_CELLS:
        raise ValueError("Exact table no longer supports precisely the six reviewed dominant cells")
    return rows


def opening_game(seed: int) -> dict:
    """Inert domain fixture: intentionally avoid new_zilch_game's persistence."""
    players = [{"id": seat, "name": seat, "user_id": None} for seat in ("p0", "p1")]
    game = {
        "_id": f"offline-{seed}", "_game_type": "zilch", "_mode": "2", "_play_mode": "multiplayer",
        "_expected": 2, "_expected_connections": 2, "_players": players,
        "_participants": [new_zilch_participant(
            player["id"], player["name"], participant_type="human", connection_player_id=player["id"]
        ) for player in players],
        "_started": False, "_finished": False, "_aborted": False, "_turn": None,
        "_target_score": 10_000,
    }
    start_zilch_game(game)
    # Reproducible offline comparison only; never live dice or credentials.
    rng = random.Random(f"zilch-heldout:{seed}:opening")  # nosec B311
    while game["_zilch_start_roll"]["phase"] != "resolved":
        for seat in ("p0", "p1"):
            record_zilch_start_roll(game, seat, rng.randint(1, 6))
    return game


def witness_option(turn, context) -> str | None:
    """Recognize the exact approved real roll, before looking up its value."""
    available = [turn.dice[index] for index in turn.available_indices]
    if (turn.round_points != 200 or turn.rolls_used != 2 or len(available) != 4
            or turn.confirmation_required or context.final_round
            or context.target_score - context.own_total < 1_800
            or available.count(1) != 1 or available.count(5) != 1):
        return None
    options = options_for_turn(turn)
    if {(option.points, len(option.dice_indices), option.requires_confirmation) for option in options} != {
        (50, 1, False), (100, 1, False), (150, 2, False),
    }:
        return None
    return next(option.option_id for option in options if option.points == 100 and option.dice_values == (1,))


def accepted_witness(turn, context, values: tuple[Value, Value]) -> str | None:
    """Return an existing option ID only; never inspect future random values."""
    option_id = witness_option(turn, context)
    if option_id is None:
        return None
    alternative, baseline = values
    threshold = VALIDATION_CONTRACT["minimum_exact_net_gain_points"]
    if (alternative.gross_bank - baseline.gross_bank < threshold
            or alternative.bust_probability >= baseline.bust_probability):
        return None
    return option_id


def actual_context(game: dict, turn, profile: str):
    actor = turn.player_id
    other = "p1" if actor == "p0" else "p0"
    own, opponent = (game["_total_points"][seat] for seat in (actor, other))
    final = game.get("_zilch_final_round")
    final_reply = isinstance(final, dict) and actor in final.get("pending_player_ids", [])
    target = game.get("_target_score", 10_000)
    return replace(
        strategy_context(turn, profile, 0), own_total=own, opponent_total=opponent, target_score=target,
        final_round=final_reply, needed_to_beat=max(target, opponent) if final_reply else None,
    )


def match(seed: int, profiles: tuple[str, str], candidate: str, upgraded: bool,
          values: dict[tuple[str, str], tuple[Value, Value]], check: Callable[[], None]) -> dict:
    game = opening_game(seed)
    counts: Counter[str] = Counter()
    ledger = {seat: {"gross": 0, "loss": 0} for seat in ("p0", "p1")}
    own_turns = {seat: 0 for seat in ledger}
    previous_turn_id = None
    for _step in range(100_000):
        check()
        if game["_finished"]:
            break
        turn = current_zilch_turn(game)
        actor = turn.player_id
        other = "p1" if actor == "p0" else "p0"
        if turn.turn_id != previous_turn_id:
            own_turns[actor] += 1
            previous_turn_id = turn.turn_id
        own = game["_total_points"][actor]
        opponent = game["_total_points"][other]
        final = game.get("_zilch_final_round")
        profile = profiles[int(actor[-1])]
        context = actual_context(game, turn, profile)
        decision = choose_zilch_cpu_decision(context)
        option_id = decision.option_id
        if decision.action == "select_hold" and actor == candidate and not isinstance(final, dict):
            key = profile, gap_label(opponent - own)
            if witness_option(turn, context) is not None:
                counts["scope_witnesses"] += 1
                counts[f"scope:{key[0]}:{key[1]}"] += 1
            chosen = accepted_witness(turn, context, values[key])
            if chosen is not None:
                counts["eligible_witnesses"] += 1
                counts[f"eligible:{key[0]}:{key[1]}"] += 1
                if upgraded:
                    baseline_option = next(option for option in options_for_turn(turn) if option.option_id == option_id)
                    if baseline_option.points != 150:
                        raise AssertionError("The witness no longer matches the approved greedy baseline")
                    option_id = chosen
                    counts["overrides"] += 1
        command = {"turn_id": turn.turn_id, "version": turn.version}
        before = game["_total_points"][actor]
        if decision.action == "select_hold":
            transition = apply_zilch_select_hold(
                game, actor, **command, roll_id=turn.roll_id, option_id=option_id,
            )
        elif decision.action == "roll":
            # New independent stream for each seat/own turn/roll. Consuming an
            # extra die cannot shift another seat, later turn, or later roll.
            # Reproducible offline comparison only; never live dice or credentials.
            rng = random.Random(f"zilch-heldout:{seed}:{actor}:{own_turns[actor]}:{turn.rolls_used + 1}")  # nosec B311
            transition = apply_zilch_roll_dice(game, actor, **command, randint_fn=rng.randint)
            counts["rolls"] += 1
        else:
            if not bank_allowed(turn)[0]:
                raise AssertionError("The policy tried to bank an ineligible turn")
            transition = apply_zilch_bank_points(game, actor, **command)
            counts["verified_bank_actions"] += 1
        after = game["_total_points"][actor]
        if transition.event["type"] == "bank":
            points = transition.event["points"]
            if after - before != points:
                raise AssertionError("Real bank transition does not match its recorded points")
            ledger[actor]["gross"] += points
        elif transition.event["type"] == "zilch":
            ledger[actor]["loss"] += before - after
        for seat in ledger:
            if game["_total_points"][seat] != ledger[seat]["gross"] - ledger[seat]["loss"]:
                raise AssertionError("Nonzero full-match bank/loss ledger residual")
    if not game["_finished"]:
        raise RuntimeError("Unexpected full-match action limit; no acceptance")
    totals = game["_total_points"]
    outcome = game["_zilch_outcome"]
    if outcome["status"] != "completed" or outcome["totals"] != totals:
        raise AssertionError("Terminal outcome disagrees with authoritative totals")
    other = "p1" if candidate == "p0" else "p0"
    score = 0.5 if totals[candidate] == totals[other] else float(totals[candidate] > totals[other])
    return {"score": score, "totals": totals, "counts": dict(counts), "ledger": ledger}


def harm_sign_p_value(benefits: int, harms: int) -> float:
    """Descriptive one-sided sign check; this small sample is underpowered."""
    if benefits < 0 or harms < 0:
        raise ValueError("Invalid paired signs")
    different = benefits + harms
    if not different:
        return 1.0
    return float(Fraction(sum(math.comb(different, index) for index in range(harms, different + 1)), 2 ** different))


def balanced_design() -> tuple[tuple[int, tuple[str, str], str], ...]:
    rows = []
    for _repeat in range(VALIDATION_CONTRACT["whole_match_pairs_per_profile_opponent_seat"]):
        for own in PROFILES:
            for opponent in PROFILES:
                for candidate in ("p0", "p1"):
                    profiles = (own, opponent) if candidate == "p0" else (opponent, own)
                    rows.append((HOLDOUT_SEED_START + len(rows), profiles, candidate))
    return tuple(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--table", type=Path, required=True)
    parser.add_argument("--pairs", type=int, default=VALIDATION_CONTRACT["whole_match_holdout_pairs"])
    parser.add_argument("--max-seconds", type=float, default=60)
    args = parser.parse_args()
    if not 1 <= args.pairs <= 180 or not math.isfinite(args.max_seconds) or not 0 < args.max_seconds <= 60:
        parser.error("Use 1..180 pairs and a positive time budget of at most 60 seconds")
    values = table_values(args.table)
    started = time.monotonic()
    deadline = started + args.max_seconds

    def check() -> None:
        if time.monotonic() >= deadline:
            raise TimeoutError("Heldout match budget exhausted")

    rows = []
    complete = True
    for seed, profiles, candidate in balanced_design()[:args.pairs]:
        try:
            baseline = match(seed, profiles, candidate, False, values, check)
            tactical = match(seed, profiles, candidate, True, values, check)
        except TimeoutError:
            complete = False
            break
        if not tactical["counts"].get("overrides", 0):
            if baseline["totals"] != tactical["totals"] or baseline["score"] != tactical["score"]:
                raise AssertionError("Counterfactual totals changed without a policy override")
        rows.append({"seed": seed, "profiles": profiles, "candidate": candidate,
                     "baseline": baseline, "tactical": tactical,
                     "difference": tactical["score"] - baseline["score"]})
    harms = sum(row["difference"] < 0 for row in rows)
    benefits = sum(row["difference"] > 0 for row in rows)
    sign_p = harm_sign_p_value(benefits, harms)
    strata = Counter((tuple(row["profiles"]), row["candidate"]) for row in rows)
    engineering_passed = (complete and len(rows) == 180 and len(strata) == 18
                          and all(count == 10 for count in strata.values())
                          and sum(row["tactical"]["counts"].get("overrides", 0) for row in rows) > 0)
    root = Path(__file__).resolve().parents[1]
    sources = ("app/zilch_engine.py", "app/zilch_cpu_strategy.py", "app/zilch_gameplay.py", "app/zilch_state.py",
               "scripts/zilch_continuation_probe.py", "scripts/zilch_continuation_matches.py")
    output = {
        "experiment": "zilch-mandatory-continuation-heldout-v1", "enabled": False,
        "complete": complete, "completed_pairs": len(rows), "requested_pairs": args.pairs,
        "elapsed_seconds": time.monotonic() - started, "python": sys.version,
        "contract": VALIDATION_CONTRACT, "harms": harms, "benefits": benefits,
        "equal_pairs": len(rows) - benefits - harms,
        "engineering_gate_passed": engineering_passed,
        "sign_check": {"one_sided_p_harms_greater_than_benefits": sign_p,
                       "gross_harm_signal": sign_p < 0.05, "underpowered": True,
                       "strength_or_noninferiority_claim": False},
        "observed_mean_score_difference": sum(row["difference"] for row in rows) / len(rows) if rows else None,
        "overrides": sum(row["tactical"]["counts"].get("overrides", 0) for row in rows),
        "coverage": [{"profiles": profiles, "candidate": candidate, "pairs": count}
                     for (profiles, candidate), count in sorted(strata.items())],
        "verification": "real gameplay bank/roll/hold; zero per-action gross/loss/total residuals",
        "table_sha256": hashlib.sha256(args.table.read_bytes()).hexdigest(),
        "sources": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in sources},
        "pairs": rows,
    }
    print(json.dumps(output, indent=2))
    return 0 if complete else 2


if __name__ == "__main__":
    raise SystemExit(main())
