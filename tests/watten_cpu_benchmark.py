"""Standalone synthetic deal benchmark; deliberately not a pytest test module.

Run with ``python -m tests.watten_cpu_benchmark`` from the repository root.
The harness owns synthetic engine state. Production decide() receives only its
own personal DTO and memory, never an engine, real call, stock or foreign hand.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import subprocess
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter

from app.watten_cards import deal_cards, make_deck
from app.watten_cpu import CpuBudget, CpuProposal, CpuWait, decide
from app.watten_cpu_memory import new_memory, observe
from app.watten_engine import EngineActor, EngineCommand, EngineRecipe, SeatBinding, apply_command, start_match
from app.watten_play import PlayProfile, legal_cards
from app.watten_views import cpu_view

ROOT = Path(__file__).resolve().parents[1]
SCHEDULE_VERSION = "watten-benchmark-sha256-v1"
SOURCE_PATHS = (
    "app/watten_cpu.py", "app/watten_cpu_memory.py", "app/watten_engine.py", "app/watten_cards.py",
    "app/watten_play.py", "app/watten_rules.py", "app/watten_bidding.py", "app/watten_views.py",
    "tests/watten_cpu_benchmark.py",
)
# Every confirmed profile, with critical cards both off and on. Comfort options
# remain off, including the persistent call reference and optional trick history.
PROFILES = tuple(PlayProfile(count, determination, blind, critical)
                 for count, determination, blind in (
                     (2, "normal", False), (2, "ladinisch", False), (3, "normal", False),
                     (4, "normal", False), (4, "ladinisch", False), (4, "ladinisch", True))
                 for critical in (False, True))


class BenchmarkError(RuntimeError):
    """A failed/incomplete case is reported and makes the process exit nonzero."""


def profile_id(profile: PlayProfile) -> str:
    return (f"{profile.player_count}-{profile.determination}-{'blind' if profile.blind else 'open'}"
            f"-critical-{'on' if profile.critical else 'off'}")


def card_schedule(seed: int, count: int):
    # Hash sorting, rather than a library RNG/shuffle, fixes the schedule across
    # Python versions. Dealer and controller assignment do not enter this key.
    deck = sorted(make_deck(), key=lambda card: (
        hashlib.sha256(f"{SCHEDULE_VERSION}:{seed}:{card}".encode("ascii")).digest(), card))
    order = tuple(seat for _ in range(5) for seat in range(count))
    dealt = deal_cards(deck, player_count=count, recipient_order=order)
    return dealt, hashlib.sha256("\n".join(deck).encode("ascii")).hexdigest()


def recipe_for(profile: PlayProfile) -> EngineRecipe:
    players = tuple("ABCD"[:profile.player_count])
    return EngineRecipe(profile, tuple(SeatBinding(player, None) for player in players),
                        (("A", "C"), ("B", "D")) if profile.player_count == 4 else None)


def baseline(view: dict, legal_options: tuple[str, ...]) -> CpuProposal | CpuWait:
    """Fixed 7/Hearts call; first remaining legal card; never bid, always hold.

    The oracle supplies legality only. No card is ranked using hidden state.
    Partner feedback is deliberately absent from this named simple baseline.
    """
    player = view["viewer"]["player_id"]

    def proposal(kind, value=None):
        return CpuProposal(player, view["deal_id"], view["opportunity"], view["phase"], kind, value)

    actions = view["actions"]
    if "announce_strike" in actions:
        return proposal("announce_strike", "7")
    if "announce_colour" in actions:
        return proposal("announce_colour", "hearts")
    for kind in ("show_ready", "inspection_ack"):
        if kind in actions:
            return proposal(kind)
    if "respond_hold" in actions:
        return proposal("respond", "hold")
    if "play_card" in actions:
        if not legal_options:
            raise BenchmarkError("baseline_has_no_legal_card")
        return proposal("play_card", legal_options[0])
    return CpuWait(view["deal_id"], view["opportunity"], view["phase"], "baseline_waiting")


@dataclass
class Measurements:
    latency_ms: dict[str, list[float]] = field(default_factory=lambda: {
        "all_calls": [], "proposals": [], "card_or_bid": [], "waits": [], "errors": []})
    accepted: Counter = field(default_factory=Counter)
    max_steps: int = 0

    def policy(self, view, memory, seed, budget):
        started = perf_counter()
        try:
            turn = decide(view, memory, seed=seed, budget=budget)
        except Exception:
            elapsed = (perf_counter() - started) * 1000
            self.latency_ms["all_calls"].append(elapsed)
            self.latency_ms["errors"].append(elapsed)
            raise
        elapsed = (perf_counter() - started) * 1000
        self.latency_ms["all_calls"].append(elapsed)
        self.latency_ms["proposals" if isinstance(turn.decision, CpuProposal) else "waits"].append(elapsed)
        if isinstance(turn.decision, CpuProposal) and turn.decision.kind in {"play_card", "bid"}:
            self.latency_ms["card_or_bid"].append(elapsed)
        return turn


def _latency(values: list[float]) -> dict:
    ordered = sorted(values)
    if not ordered:
        return {"n": 0, "p50": None, "p95": None, "max": None}
    return {"n": len(ordered), "p50": round(ordered[math.ceil(len(ordered) * .5) - 1], 4),
            "p95": round(ordered[math.ceil(len(ordered) * .95) - 1], 4), "max": round(ordered[-1], 4)}


def _measurements(measured: Measurements) -> dict:
    return {"accepted_commands": dict(sorted(measured.accepted.items())),
            "accepted_command_count": sum(measured.accepted.values()), "max_steps_observed": measured.max_steps,
            "policy_latency_ms": {key: _latency(values) for key, values in measured.latency_ms.items()}}


def run_deal(profile, seed, dealer, policy_party, deal, max_steps, budget, measured):
    name = f"bench-{profile_id(profile)}-{seed}-{dealer}"
    recipe = recipe_for(profile)
    state = start_match(recipe, name, deal, first_dealer=recipe.seats[dealer])
    policy_players = frozenset(state.parties.parties[policy_party])
    memories = {player: new_memory(player) for player in recipe.seats}

    def observe_all(events=()):
        for player in recipe.seats:
            memories[player] = observe(memories[player], cpu_view(state, player_id=player), events)

    observe_all()
    bids = False
    for steps in range(max_steps + 1):
        if state.phase in {"deal_complete", "match_complete"}:
            result = state.bid_state.result
            return {"status": "complete", "policy_won": result.winning_party == policy_party,
                    "awarded_stake_points": result.points, "had_bid": bids, "reason": result.reason,
                    "accepted_commands": steps}
        if steps == max_steps:
            raise BenchmarkError("max_steps_exceeded")
        acting = []
        for player in recipe.seats:
            view = cpu_view(state, player_id=player)
            if player in policy_players:
                turn = measured.policy(view, memories[player], seed, budget)
                # Retain this seat's inspection before applying any closing ACK.
                memories[player] = turn.memory
                decision = turn.decision
            else:
                options = legal_cards(state.play, state.bid_state, player) if "play_card" in view["actions"] else ()
                decision = baseline(view, options)
            if isinstance(decision, CpuProposal):
                acting.append((player, decision))
            elif not isinstance(decision, CpuWait):
                raise BenchmarkError("unsupported_decision")
        if not acting:
            raise BenchmarkError("no_acting_proposal")
        # Advice is delivered privately before a simultaneous primary decision;
        # the next loop recomputes proposals from the resulting own DTOs.
        player, decision = min(acting, key=lambda item: item[1].kind != "partner_feedback")
        transition = apply_command(state, EngineActor(player, None), EngineCommand(**decision.command_fields()))
        if transition.replayed:
            raise BenchmarkError("unexpected_replayed_command")
        state = transition.state
        measured.accepted[f"{'policy' if player in policy_players else 'baseline'}:{decision.kind}"] += 1
        measured.max_steps = max(measured.max_steps, steps + 1)
        bids = bids or decision.kind == "bid"
        events = tuple((transition.ack.deal_id, *event) for event in transition.public_events)
        observe_all(events)
    raise BenchmarkError("unreachable_step_loop")


def _revision() -> str | None:
    git = shutil.which("git")
    if not git:
        return None
    # Fixed, read-only local Git metadata; no shell or user-supplied command.
    result = subprocess.run([git, "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def _environment() -> dict:
    return {"python": sys.version, "implementation": platform.python_implementation(),
            "platform": platform.platform(), "machine": platform.machine(), "processor": platform.processor(),
            "logical_cpu_count": os.cpu_count(), "executable": sys.executable, "git_commit": _revision(),
            "source_sha256": {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCE_PATHS}}


def benchmark(seeds: tuple[int, ...], max_steps: int) -> dict:
    budget = CpuBudget()  # The actual production default, never FAST/CpuBudget(6/8).
    started = datetime.now(timezone.utc)
    measured_all = Measurements()
    reports, failures = [], []
    for profile in PROFILES:
        measured = Measurements()
        rows = {}
        outcomes = []
        for seed in seeds:
            deal, fingerprint = card_schedule(seed, profile.player_count)
            for dealer in range(profile.player_count):
                for policy_party in (0, 1):
                    role = ("pair" if policy_party == 0 else "solo") if profile.player_count == 3 else (
                        "head_to_head" if profile.player_count == 2 else "team")
                    row = rows.setdefault(role, Counter(dict.fromkeys((
                        "scheduled_deals", "completed_deals", "failed_deals", "policy_won_deals", "baseline_won_deals",
                        "policy_awarded_stake_points", "baseline_awarded_stake_points", "bid_deals",
                        "policy_points_from_bid_deals", "baseline_points_from_bid_deals"), 0)))
                    row["scheduled_deals"] += 1
                    case = {"seed": seed, "dealer_seat": dealer, "policy_party": policy_party,
                            "policy_role": role, "deck_sha256": fingerprint}
                    try:
                        outcome = run_deal(profile, seed, dealer, policy_party, deal, max_steps, budget, measured)
                    except Exception as exc:
                        row["failed_deals"] += 1
                        outcome = {"status": "failed", "error_type": type(exc).__name__, "error": str(exc)}
                        failures.append({"profile": profile_id(profile), **case, **outcome})
                    else:
                        row["completed_deals"] += 1
                        winner = "policy" if outcome["policy_won"] else "baseline"
                        row[f"{winner}_won_deals"] += 1
                        row[f"{winner}_awarded_stake_points"] += outcome["awarded_stake_points"]
                        if outcome["had_bid"]:
                            row["bid_deals"] += 1
                            row[f"{winner}_points_from_bid_deals"] += outcome["awarded_stake_points"]
                    outcomes.append({**case, **outcome})
        reports.append({"profile_id": profile_id(profile), "profile": asdict(profile),
                        "comparison_rows": {key: dict(value) for key, value in rows.items()},
                        **_measurements(measured), "outcomes": outcomes})
        measured_all.accepted.update(measured.accepted)
        measured_all.max_steps = max(measured_all.max_steps, measured.max_steps)
        for key, values in measured.latency_ms.items():
            measured_all.latency_ms[key].extend(values)
    return {"benchmark_schema": 1, "status": "failed" if failures else "complete",
            "started_at": started.isoformat(), "finished_at": datetime.now(timezone.utc).isoformat(),
            "environment": _environment(), "budget": asdict(budget), "seeds": list(seeds),
            "max_steps_per_deal": max_steps, "schedule_version": SCHEDULE_VERSION,
            "options": {"target_points": 11, "show_rechter": False, "trick_history": False, "partner_hand": False},
            "baseline": "fixed_7_hearts_first_remaining_legal_never_bid_always_hold_no_advice",
            "scoring_unit": "one deal winner and one awarded stake per party, never per-person score sum",
            "interpretation": "Synthetic opening deals only; paired outcomes are dependent. A small sample is not a strength claim.",
            "totals": _measurements(measured_all), "profiles": reports, "failures": failures}


def _bounded_integer(minimum, maximum):
    def parse(value):
        try:
            number = int(value)
        except ValueError as exc:
            raise argparse.ArgumentTypeError("expected an integer") from exc
        if not minimum <= number <= maximum:
            raise argparse.ArgumentTypeError(f"expected {minimum}..{maximum}")
        return number
    return parse


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=_bounded_integer(1, 64), default=8, help="seed count per profile (default: 8)")
    parser.add_argument("--seed-start", type=_bounded_integer(0, 2**31 - 65), default=0)
    parser.add_argument("--max-steps", type=_bounded_integer(32, 512), default=240)
    parser.add_argument("--output", type=Path, help="JSON destination; stdout if omitted")
    args = parser.parse_args()
    report = benchmark(tuple(range(args.seed_start, args.seed_start + args.seeds)), args.max_steps)
    text = json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if args.output:
        args.output.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return int(bool(report["failures"]))


if __name__ == "__main__":
    raise SystemExit(main())
