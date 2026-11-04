"""Paired synthetic endgames with 3–5 opponents and the same public views.

The fixture deals a 6/8/ace hand, an observed Unter pickup, and legal plays by
the intervening players. Three hidden worlds keep the next opponent's hand weak,
or replace one card by an ace or a ten. Only the simulator knows that choice;
CPU views, public counts, and the observed event history are identical.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path
from random import Random

from app import hausdepp_cpu_strategy as current
from app.hausdepp_engine import apply_action, make_deck, project_state
from scripts.benchmark_hausdepp_suspicions import _continuation, _frozen_memories, source_hashes
from tests import hausdepp_cpu_strategy_f89354f7 as frozen
from tests.test_hausdepp_engine import scenario

ROOT = Path(__file__).resolve().parents[1]
WORLDS = ("weak", "hidden_ace", "hidden_ten")


def hashes():
    result = source_hashes()
    for name in ("scripts/benchmark_hausdepp_multiseat_scenarios.py", "tests/test_hausdepp_engine.py"):
        result[name] = hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
    return result


def fixture(count: int, seed: int, world: str, *, hint: bool, middle: str = "8"):
    """Build physical card states; the CPU never receives the chosen world."""
    own = ["hearts-6", f"hearts-{middle}", "hearts-A"]
    packet = "hearts-U"
    first = ["acorns-7", "acorns-8", "acorns-9"]
    high = {"weak": first[2], "hidden_ace": "acorns-A", "hidden_ten": "acorns-10"}[world]
    # Keep a low card playable at the CPU's turn. At five seats its 6 can
    # complete four and clear the pile, a useful safe-play counterexample.
    lead = ["bells-6", "leaves-6", "acorns-6", "bells-7"][:count - 2]
    reserved = {*own, packet, *first, "acorns-A", "acorns-10", *lead}
    pool = [card for card in make_deck() if card not in reserved]
    # Fixed seeds generate synthetic deals, not live games.
    rng = Random(seed)  # nosec B311
    rng.shuffle(pool)
    others = [[card, *pool[index * 3:index * 3 + 3]] for index, card in enumerate(lead)]
    state = scenario([own, [*first[:2], high], *others], discard=[packet], current="p1")
    memories = {f"p{i}": current.CpuMemory() if i == 0 else frozen.CpuMemory() for i in range(count)}
    for actor, action, cards in [("p1", "pickup", None),
                                 *((f"p{index + 2}", "play", [card]) for index, card in enumerate(lead))]:
        before = state
        state = apply_action(state, actor, action, cards=cards, version=state["version"])
        for player, memory in memories.items():
            memory.public.observe(project_state(before, player), project_state(state, player))
        if actor == "p1" and not hint:
            # The CPU missed the pickup during a transient disconnect; later
            # actions remain observable. Other seats keep their own memories.
            memories["p0"] = current.CpuMemory()
    view = project_state(state, "p0")
    assert state["current_player_id"] == "p0" and len([p for p in state["players"] if not p["finished"]]) == count
    assert memories["p0"].public.exact_hand(view, "p1") is None
    return state, memories, view


def benchmark(count: int, seeds: int, skill: float, world: str, hint: bool, seed_base: int,
              middle: str = "8") -> dict:
    initial_hashes = hashes()
    totals = Counter()
    for seed in range(seed_base, seed_base + seeds):
        state, memories, view = fixture(count, seed, world, hint=hint, middle=middle)
        old_memory = _frozen_memories(memories)["p0"]
        old_rng = Random(f"{seed}:p0:{state['version']}")  # nosec B311
        new_rng = Random(f"{seed}:p0:{state['version']}")  # nosec B311
        old = frozen.choose_cpu_action(view, memory=old_memory, skill=skill, rng=old_rng)
        new = current.choose_cpu_action(view, memory=memories["p0"], skill=skill, rng=new_rng)
        if old is None or new is None:
            raise RuntimeError("CPU had no decision in the synthetic endgame")
        totals["old_ace_leads"] += int(old.get("cards") == ["hearts-A"])
        totals["new_ace_leads"] += int(new.get("cards") == ["hearts-A"])
        totals["different_first_move"] += int((old.get("action"), old.get("cards"))
                                               != (new.get("action"), new.get("cards")))
        # Both continuations use the same actual world and restored RNG state.
        # The frozen strategy handles all subsequent decisions in both legs.
        rng = Random(f"continuation:{seed}")  # nosec B311
        results = [_continuation(state, memories, "p0", move, skill, "frozen", seed, rng.getstate())
                   for move in (old, new)]
        totals["stalls"] += sum(result["stall"] for result in results)
        if any(result["stall"] for result in results):
            continue
        before, after = results
        for key in ("next_hand", "placement", "finished_before_next", "reached_next_turn",
                    "opponent_pickup_before_next", "opponent_play_before_next", "opponent_clears_before_next"):
            totals[f"old_{key}"] += before.get(key, 0)
            totals[f"new_{key}"] += after.get(key, 0)
        totals["new_less_next_hand"] += int(after["next_hand"] < before["next_hand"])
        totals["new_more_next_hand"] += int(after["next_hand"] > before["next_hand"])
        totals["new_better_placement"] += int(after["placement"] < before["placement"])
        totals["new_worse_placement"] += int(after["placement"] > before["placement"])
    if hashes() != initial_hashes:
        raise RuntimeError("Source changed during simulation; discard this run and repeat it")
    return {"players": count, "seeds": seeds, "seed_base": seed_base, "skill": skill,
            "world": world, "hint_observed": hint, "middle_rank": middle,
            "source_sha256": initial_hashes, **totals}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=int, choices=(4, 5, 6), default=6)
    parser.add_argument("--seeds", type=int, default=100)
    parser.add_argument("--seed-base", type=int, default=3100000)
    parser.add_argument("--skill", type=float, default=1.0)
    parser.add_argument("--world", choices=WORLDS, default="weak")
    parser.add_argument("--middle", choices=("8", "O"), default="8")
    parser.add_argument("--without-hint", action="store_true")
    args = parser.parse_args()
    if args.seeds < 1 or not 0 <= args.skill <= 1:
        parser.error("seeds must be positive and skill must be between 0 and 1")
    print(json.dumps(benchmark(args.players, args.seeds, args.skill, args.world, not args.without_hint,
                               args.seed_base, args.middle), sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
