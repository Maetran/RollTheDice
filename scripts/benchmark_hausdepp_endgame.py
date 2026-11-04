"""Reproduce the earlier two-rank-only Hausdepp comparison.

Run from the repository root with ``python -m scripts.benchmark_hausdepp_endgame``.
Every seat gets its own public observation after each accepted playing transition;
only the designated seat receives the known-pickup tactic in paired games. The
later general endgame solver is explicitly disabled to reproduce that earlier
experiment; use benchmark_hausdepp_policies for the complete current policy.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from random import Random

from app import hausdepp_cpu_strategy as strategy
from app.hausdepp_engine import apply_action, new_round, project_state
from tests.hausdepp_cpu_reference import choose_reference_action


def game(seed: int, seat: str, skill: float, opponent: str, *, new_tactic: bool = True) -> dict:
    """Play a two-seat game using the real engine and one memory per seat."""
    # Seeded randomness is solely for reproducible simulations, not live games.
    random = Random(seed)  # nosec B311
    state = new_round(["p0", "p1"], dealer_index=1, rng=random)
    memories = {player["id"]: strategy.CpuMemory() for player in state["players"]}
    original = strategy._known_pickup_finish
    original_solver = strategy._counted_endgame
    strategy._counted_endgame = lambda *_: None
    eligible_evaluations = 0
    try:
        for _ in range(3000):
            if state["phase"] == "finished":
                return {"loss": state["loser_id"] == seat, "eligible_evaluations": eligible_evaluations,
                        "stall": False}
            actor = (next(iter(state["pending_refills"]), None)
                     or (state.get("afterthrow") or {}).get("player_id") or state["current_player_id"])

            def choose(player_id: str) -> tuple[dict, dict | None]:
                nonlocal eligible_evaluations
                view = project_state(state, player_id)
                if player_id != seat and opponent == "simple":
                    return view, choose_reference_action(view)
                active = new_tactic and (opponent != "paired" or player_id == seat)
                if active and original(view, memories[player_id]) is not None:
                    # Count suitable views, before the policy may prioritise a
                    # different finish or miss this tactic through a slip.
                    eligible_evaluations += 1
                strategy._known_pickup_finish = original if active else lambda *_: None
                level = skill if player_id == seat or opponent == "paired" else 1.0
                decision_rng = Random(f"{seed}:{player_id}:{state['version']}")  # nosec B311
                return view, strategy.choose_cpu_action(view, memory=memories[player_id], skill=level, rng=decision_rng)

            view, move = choose(actor)
            if move is None:
                actor = state["current_player_id"]
                view, move = choose(actor)
            if move is None:
                raise RuntimeError("No legal continuation in Hausdepp simulation")
            before = state
            state = apply_action(state, actor, **move, rng=random)
            memories[actor].remember(view, move)
            if state["phase"] == "playing":
                for player_id, memory in memories.items():
                    memory.public.observe(project_state(before, player_id), project_state(state, player_id))
        return {"loss": False, "eligible_evaluations": eligible_evaluations, "stall": True}
    finally:
        strategy._known_pickup_finish = original
        strategy._counted_endgame = original_solver


def paired(deals: int, skill: float, seed_base: int) -> dict:
    totals: Counter = Counter()
    for offset in range(deals):
        seed = seed_base + offset
        for index in range(2):
            seat = f"p{index}"
            old = game(seed, seat, skill, "paired", new_tactic=False)
            new = game(seed, seat, skill, "paired")
            totals.update(games=1, old_losses=int(old["loss"]), new_losses=int(new["loss"]),
                          eligible_evaluations=new["eligible_evaluations"], old_stalls=int(old["stall"]),
                          new_stalls=int(new["stall"]))
    return {"comparison": "paired", "skill": skill, "deals": deals, **totals}


def profiles(deals: int, skill: float, opponent: str, seed_base: int) -> dict:
    totals: Counter = Counter()
    for offset in range(deals):
        for index in range(2):
            result = game(seed_base + offset, f"p{index}", skill, opponent)
            totals.update(games=1, losses=int(result["loss"]), stalls=int(result["stall"]))
    return {"comparison": opponent, "skill": skill, "deals": deals, **totals}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paired-deals", type=int, default=1500)
    parser.add_argument("--profile-deals", type=int, default=500)
    args = parser.parse_args()
    for skill in (1.0, 0.55):
        print(json.dumps(paired(args.paired_deals, skill, 849100), sort_keys=True), flush=True)
    for opponent in ("simple", "expert"):
        for skill in (0.55, 1.0):
            print(json.dumps(profiles(args.profile_deals, skill, opponent, 910000), sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
