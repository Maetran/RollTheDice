"""Reproduce the strong-opponent blind-rollout experiment, not production play.

Use a clean copy of the tested source. The checked-in patch reconstructs the
exact experimental CPU and is never imported by the game.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

from app import watten_cpu as production_cpu
from app.watten_cpu_memory import new_memory, observe
from app.watten_engine import EngineActor, EngineCommand, apply_command, start_match
from app.watten_play import PlayProfile, legal_cards
from app.watten_rules import card_rank, card_strength, trick_winner
from app.watten_views import cpu_view
from tests.watten_cpu_benchmark import card_schedule, recipe_for

ROOT = Path(__file__).resolve().parents[1]
EXPERIMENT = ROOT / "experiments/watten_blind_rollout/efc38c71.patch"
PRODUCTION_HASH = "f2d3f793f722d7aa691d308250306f706d17bb66364aed15e63411edbd0f3511"
EXPERIMENT_HASH = "efc38c719ec084b4e135d621ef01053af0ba43f6fd459a941e13770757bb446d"
REFERENCE_HASH = "6bb216ff3864c46ad3de4f2a7b837589b072f917b0096a8acbfb3fd9298a22e7"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def run_deal(profile, seed, dealer, party, version, st):
    mine = MODS[version]
    recipe = recipe_for(profile)
    deal, _ = card_schedule(seed, 4)
    state = start_match(recipe, f"w-{seed}-{dealer}", deal, first_dealer=recipe.seats[dealer])
    policy = frozenset(state.parties.parties[party])
    mem = {p: new_memory(p) for p in recipe.seats}
    for p in recipe.seats:
        mem[p] = observe(mem[p], cpu_view(state, player_id=p), ())
    for _ in range(400):
        if state.phase in {"deal_complete", "match_complete"}:
            r = state.bid_state.result
            return int(r.winning_party == party), (r.points if r.winning_party == party else -r.points)
        acting = []
        for p in recipe.seats:
            mod = mine if p in policy else base_cpu
            turn = mod.decide(cpu_view(state, player_id=p), mem[p], seed=seed * 7 + dealer, budget=mod.CpuBudget())
            mem[p] = turn.memory
            if type(turn.decision).__name__ == "CpuProposal":
                acting.append((p, turn.decision))
        p, d = min(acting, key=lambda item: item[1].kind != "partner_feedback")
        if p in policy and d.kind == "bid":
            st["bids"] += 1
        if p in policy and d.kind == "play_card" and state.play is not None:
            play, seat = state.play, recipe.seats.index(p)
            cards = list(play.trick_cards)
            if seat not in play.knower_seats and cards and card_rank(d.value) in {card_rank(c) for c in cards}:
                st["repeats"] += 1
            if cards:
                hand = legal_cards(play, state.bid_state, p)
                if len(hand) > 1 and all(trick_winner([*cards, c], rules=play.rules) != len(cards) for c in hand):
                    st["hopeless"] += 1
                    def key(c):
                        return card_strength(c, led_card=cards[0], rules=play.rules)
                    if key(d.value) != min(key(c) for c in hand):
                        st["hopeless_waste"] += 1
        t = apply_command(state, EngineActor(p, None), EngineCommand(**d.command_fields()))
        state = t.state
        ev = tuple((t.ack.deal_id, *e) for e in t.public_events)
        for q in recipe.seats:
            mem[q] = observe(mem[q], cpu_view(state, player_id=q), ev)
    raise RuntimeError("stall")



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", required=True, choices=("rankonly", "final"))
    parser.add_argument("--critical", required=True, type=int, choices=(0, 1))
    parser.add_argument("--seed-start", type=int, default=2000)
    parser.add_argument("--seeds", type=int, default=100)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.seeds < 1 or args.seed_start < 0:
        parser.error("seeds must be positive and seed-start nonnegative")
    source = (ROOT / "app/watten_cpu.py").read_bytes()
    if _sha(source) != PRODUCTION_HASH:
        raise RuntimeError("Production source differs from the frozen experiment baseline")
    # The original comparison used the reference engine and support modules.
    for path in sorted((ROOT / "app").glob("watten*.py")) + [ROOT / "tests/watten_cpu_benchmark.py"]:
        if path.name == "watten_cpu.py":
            continue
        rel = path.relative_to(ROOT).as_posix()
        old = subprocess.run(["git", "show", f"f89354f7:{rel}"], cwd=ROOT, check=True, capture_output=True).stdout
        if old != path.read_bytes():
            raise RuntimeError(f"Reference support file changed: {rel}")
    reference = subprocess.run(["git", "show", "f89354f7:app/watten_cpu.py"],
                               cwd=ROOT, check=True, capture_output=True).stdout
    if _sha(reference) != REFERENCE_HASH:
        raise RuntimeError("Unexpected reference CPU")
    with tempfile.TemporaryDirectory(prefix="watten-blind-experiment-") as directory:
        path = Path(directory) / "app/watten_cpu.py"
        path.parent.mkdir()
        path.write_bytes(source)
        subprocess.run(["patch", "-p0", "-i", str(EXPERIMENT)], cwd=directory,
                       check=True, capture_output=True)
        if _sha(path.read_bytes()) != EXPERIMENT_HASH:
            raise RuntimeError("Unexpected reconstructed experimental CPU")
        basepath = Path(directory) / "reference.py"
        basepath.write_bytes(reference)
        global base_cpu, MODS
        base_cpu = _load("app._watten_reference_experiment", basepath)
        candidate = _load("app._watten_candidate_experiment", path)
        if args.mode == "rankonly":
            candidate._simulated_card = production_cpu._simulated_card
        MODS = {"base": base_cpu, "efc3": candidate}
        profile = PlayProfile(4, "ladinisch", True, bool(args.critical))
        rows = []
        for seed in range(args.seed_start, args.seed_start + args.seeds):
            total = Counter()
            for dealer in range(4):
                for party in (0, 1):
                    outcomes = {}
                    for variant in ("base", "efc3"):
                        stats = Counter()
                        outcomes[variant] = run_deal(profile, seed, dealer, party, variant, stats)
                        total[variant + "_wins"] += outcomes[variant][0]
                        total[variant + "_points"] += outcomes[variant][1]
                        for key, value in stats.items():
                            total[variant + "_" + key] += value
                    total["efc3_only_won"] += int(outcomes["efc3"][0] and not outcomes["base"][0])
                    total["efc3_only_lost"] += int(outcomes["base"][0] and not outcomes["efc3"][0])
                    total["pairs"] += 1
            rows.append({"seed": seed, **total})
        report = {"mode": args.mode, "critical": bool(args.critical), "start": args.seed_start,
                  "n": args.seeds, "rows": rows}
        args.output.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
