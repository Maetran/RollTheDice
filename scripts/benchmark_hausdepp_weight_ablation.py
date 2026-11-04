"""Reproduce a paired 0.8-versus-0.5 mixed-tail six-player ablation.

The old policy is reconstructed in memory from the local, trusted source. Both
branches observe the same state; frozen opponents play the continuations.
"""

import argparse
import copy
import hashlib
import importlib.util
import json
import sys
from collections import Counter
from pathlib import Path
from random import Random

from app import hausdepp_cpu_strategy as original
from scripts.benchmark_hausdepp_multiseat_scenarios import fixture, hashes
from scripts.benchmark_hausdepp_suspicions import _continuation


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--skill", type=float, required=True)
    p.add_argument("--seeds", type=int, default=40)
    args = p.parse_args()
    source = Path(original.__file__).read_text()
    old = """            confidence *= 0.5 if hint is None else 0.8\n"""
    new = """            confidence *= 0.8\n"""
    if source.count(old) != 1:
        raise RuntimeError("Expected final weight expression not found exactly once")
    variant = source.replace(old, new)
    spec = importlib.util.spec_from_loader("app._cpu_weight_experiment", loader=None)
    modified = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = modified
    exec(compile(variant, original.__file__, "exec"), modified.__dict__)  # nosec B102
    initial = hashes()
    results = []
    for middle in ("8", "O", "10"):
        for world in ("weak", "hidden_ace", "hidden_ten"):
            for hint in (True, False):
                total = Counter()
                for seed in range(3400000, 3400000 + args.seeds):
                    state, memories, view = fixture(6, seed, world, hint=hint, middle=middle)
                    actions = []
                    for policy in (modified, original):
                        random = Random(f"{seed}:p0:{state['version']}")  # nosec B311
                        actions.append(
                            policy.choose_cpu_action(
                                view, memory=copy.deepcopy(memories["p0"]), skill=args.skill, rng=random
                            )
                        )
                    for policy, action in zip(("current", "reduced"), actions):
                        total[policy + "_ace"] += int(action.get("cards") == ["hearts-A"])
                    if actions[0] == actions[1]:
                        continue
                    total["different"] += 1
                    rng = Random(f"continuation:{seed}")  # nosec B311
                    rr = [
                        _continuation(state, memories, "p0", move, args.skill, "frozen", seed, rng.getstate())
                        for move in actions
                    ]
                    if any(r["stall"] for r in rr):
                        total["stalls"] += 1
                        continue
                    a, b = rr
                    total["reduced_better"] += int(b["placement"] < a["placement"])
                    total["reduced_worse"] += int(b["placement"] > a["placement"])
                    total["current_placement"] += a["placement"]
                    total["reduced_placement"] += b["placement"]
                    total["current_next_hand"] += a["next_hand"]
                    total["reduced_next_hand"] += b["next_hand"]
                    total["current_opponent_pickups"] += a.get("opponent_pickup_before_next", 0)
                    total["reduced_opponent_pickups"] += b.get("opponent_pickup_before_next", 0)
                results.append({"middle": middle, "world": world, "hint": hint, **total})
    if hashes() != initial:
        raise RuntimeError("Sources changed during simulation; discard this run")
    print(
        json.dumps(
            {
                "skill": args.skill,
                "seeds": args.seeds,
                "seed_base": 3400000,
                "source_sha256": initial,
                "variant_sha256": hashlib.sha256(variant.encode()).hexdigest(),
                "runner_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                "results": results,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
