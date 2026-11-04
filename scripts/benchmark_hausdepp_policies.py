"""Paired real-engine comparison with the frozen 4.14.1 Hausdepp policy.

Run from the repository root, for example::

    python -m scripts.benchmark_hausdepp_policies --skill 1 --players 2 --deals 100

The reference plays every seat in the baseline. In the comparison, each seat
in turn uses the current policy against the reference on the same shuffled deal.
All seats use their own observed personal projections and seeded decisions.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from random import Random

from app.hausdepp_cpu_strategy import CpuMemory, choose_cpu_action
from app.hausdepp_engine import apply_action, new_round, project_state
from tests import hausdepp_cpu_policy_4141 as frozen


def game(count: int, seed: int, seat: str, skill: float, *, current: bool) -> tuple[str, int]:
    # Fixed seeds reproduce game deals and misjudgements, not credentials or live games.
    random = Random(seed)  # nosec B311
    state = new_round([f"p{index}" for index in range(count)], dealer_index=count - 1, rng=random)
    policies = {player["id"]: ((choose_cpu_action, CpuMemory()) if current and player["id"] == seat
                               else (frozen.choose_cpu_action, frozen.CpuMemory())) for player in state["players"]}
    for turn in range(3000):
        if state["phase"] == "finished":
            return state["loser_id"], turn
        actor = (next(iter(state["pending_refills"]), None)
                 or (state.get("afterthrow") or {}).get("player_id") or state["current_player_id"])

        def choose(player_id: str) -> tuple[dict, dict | None]:
            view = project_state(state, player_id)
            policy, memory = policies[player_id]
            decision_rng = Random(f"{seed}:{player_id}:{state['version']}")  # nosec B311
            return view, policy(view, memory=memory, skill=skill, rng=decision_rng)

        view, move = choose(actor)
        if move is None:
            actor = state["current_player_id"]
            view, move = choose(actor)
        if move is None:
            raise RuntimeError("No legal continuation in Hausdepp simulation")
        before = state
        state = apply_action(state, actor, **move, rng=random)
        policies[actor][1].remember(view, move)
        if state["phase"] != "finished":
            for player_id, (_, memory) in policies.items():
                memory.public.observe(project_state(before, player_id), project_state(state, player_id))
    return "stall", 3000


def benchmark(count: int, deals: int, skill: float, seed_base: int) -> dict:
    totals: Counter = Counter()
    for offset in range(deals):
        seed = seed_base + count * 10000 + offset
        # With the frozen policy on every seat, the baseline outcome is the
        # same for each seat rotation; play it once and pair it with each seat.
        old, old_turns = game(count, seed, "p0", skill, current=False)
        for index in range(count):
            seat = f"p{index}"
            new, new_turns = game(count, seed, seat, skill, current=True)
            old_loss, new_loss = old == seat, new == seat
            totals.update(seat_deals=1, frozen_losses=int(old_loss), current_losses=int(new_loss),
                          lost_only_with_frozen=int(old_loss and not new_loss),
                          lost_only_with_current=int(new_loss and not old_loss),
                          frozen_stalls=int(old == "stall"), current_stalls=int(new == "stall"),
                          frozen_actions=old_turns, current_actions=new_turns)
    return {"players": count, "skill": skill, "deals": deals, "seed_base": seed_base, **totals}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=int, default=2, choices=range(2, 7))
    parser.add_argument("--deals", type=int, default=100)
    parser.add_argument("--skill", type=float, default=1.0)
    parser.add_argument("--seed-base", type=int, default=1300000)
    args = parser.parse_args()
    if args.deals < 1 or not 0 <= args.skill <= 1:
        parser.error("deals must be positive and skill must be between 0 and 1")
    print(json.dumps(benchmark(args.players, args.deals, args.skill, args.seed_base), sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
