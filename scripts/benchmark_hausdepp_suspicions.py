"""Compare the current Hausdepp CPU with f89354f7 on paired real-engine deals.

Opponents use the frozen policy, a simple reference, or the frozen policy
with reproducible voluntary pickups on 15%/40% of opportunities. The latter
are stress tests, not estimates of how often people bluff. All CPU memories
observe only their own projections. Actual private cards are inspected solely
after decisions to score whether a chosen block really prevents a reply.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from copy import deepcopy
from pathlib import Path
from random import Random

from app import hausdepp_cpu_strategy as current
from app.hausdepp_engine import apply_action, new_round, project_state
from tests import hausdepp_cpu_strategy_f89354f7 as frozen
from tests.hausdepp_cpu_reference import choose_reference_action

OPPONENTS = ("frozen", "simple", "voluntary15", "voluntary40")
BASELINE = "f89354f74397b7c4e2c042d428b6484bb40b99de"
ROOT = Path(__file__).resolve().parents[1]
SOURCE_PATHS = ("app/hausdepp_cpu_strategy.py", "app/hausdepp_cpu_knowledge.py",
                "app/hausdepp_cpu_endgame.py", "app/hausdepp_engine.py", "app/hausdepp_achievement_evidence.py",
                "scripts/benchmark_hausdepp_suspicions.py",
                "tests/hausdepp_cpu_strategy_f89354f7.py", "tests/hausdepp_cpu_knowledge_f89354f7.py",
                "tests/hausdepp_cpu_endgame_f89354f7.py", "tests/hausdepp_cpu_reference.py")


def source_hashes() -> dict[str, str]:
    return {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in SOURCE_PATHS}


def voluntary_pickup(view: dict, profile: str, seed: int, actor: str) -> bool:
    """Choose a reproducible voluntary pickup without reading another hand."""
    threshold = {"voluntary15": 15, "voluntary40": 40}.get(profile, 0)
    actions = view.get("available_actions", ())
    if not threshold or view.get("deck_count") or not {"play", "pickup"} <= set(actions):
        return False
    token = f"pickup:{seed}:{actor}:{view['version']}".encode()
    return int.from_bytes(hashlib.sha256(token).digest()[:8], "big") % 100 < threshold


def _hint(view: dict, memory, actor: str):
    players = view.get("players", ())
    own = next((i for i, player in enumerate(players) if player.get("id") == actor), None)
    if own is None or not hasattr(memory.public, "pickup_hint"):
        return None
    next_player = next((players[(own + offset) % len(players)] for offset in range(1, len(players))
                        if not players[(own + offset) % len(players)].get("finished")
                        and not players[(own + offset) % len(players)].get("withdrawn")), None)
    return None if next_player is None else memory.public.pickup_hint(view, next_player["id"])


def _frozen_memories(memories: dict) -> dict:
    """Copy only the baseline policy's permitted memories, never hidden cards."""
    result = {}
    for player, memory in memories.items():
        saved = frozen.CpuMemory()
        saved._recent = deepcopy(memory._recent)
        for name in ("_position", "_known", "_burned", "_burn_version"):
            setattr(saved.public, name, deepcopy(getattr(memory.public, name)))
        result[player] = saved
    return result


def _continuation(state: dict, memories: dict, seat: str, initial: dict, skill: float,
                  profile: str, seed: int, rng_state) -> dict:
    """Follow one candidate through its next regular turn and the round result.

    Both branches use the frozen policy after their different first moves. The
    branch starts from the same engine state, permitted memories and RNG state;
    private engine data is used only for post-decision measurements.
    """
    rng = Random(0)  # nosec B311 -- restored deterministic simulation state
    rng.setstate(rng_state)
    memories = _frozen_memories(memories)
    actor, move = seat, initial
    first = True
    next_hand = None
    before_next = Counter()
    for _ in range(3000):
        player = next(player for player in state["players"] if player["id"] == seat)
        if next_hand is None and player["finished"]:
            next_hand = 0
            before_next["finished_before_next"] = 1
        if state["phase"] == "finished":
            rank = (state["finished_order"].index(seat) + 1
                    if seat in state["finished_order"] else len(state["players"]))
            return {"next_hand": len(player["hand"]) if next_hand is None else next_hand,
                    "placement": rank, "stall": 0, **before_next}
        if not first:
            actor = (next(iter(state["pending_refills"]), None)
                     or (state.get("afterthrow") or {}).get("player_id") or state["current_player_id"])

            def choose(player_id: str):
                view = project_state(state, player_id)
                if player_id != seat and voluntary_pickup(view, profile, seed, player_id):
                    return view, {"action": "pickup", "version": view["version"]}
                if player_id != seat and profile == "simple":
                    return view, choose_reference_action(view)
                decision_rng = Random(f"{seed}:{player_id}:{state['version']}")  # nosec B311
                return view, frozen.choose_cpu_action(view, memory=memories[player_id], skill=skill,
                                                       rng=decision_rng)

            view, move = choose(actor)
            if move is None:
                actor = state["current_player_id"]
                view, move = choose(actor)
            if move is None:
                raise RuntimeError("No legal continuation in counterfactual simulation")
            if next_hand is None and actor == seat and state["current_player_id"] == seat:
                next_hand = len(view["hand"])
                before_next["reached_next_turn"] = 1
        else:
            view = project_state(state, seat)
        if next_hand is None and actor != seat:
            before_next[f"opponent_{move['action']}_before_next"] += 1
        before = state
        state = apply_action(state, actor, **move, rng=rng)
        if next_hand is None and actor != seat and (state.get("last_event") or {}).get("burn_reason"):
            before_next["opponent_clears_before_next"] += 1
        memories[actor].remember(view, move)
        if state["phase"] != "finished":
            for player_id, memory in memories.items():
                memory.public.observe(project_state(before, player_id), project_state(state, player_id))
        first = False
    return {"next_hand": -1, "placement": -1, "stall": 1, **before_next}


def game(count: int, seed: int, seat: str, skill: float, profile: str, *, use_current: bool,
         restart_on_empty_stock: bool = False) -> dict:
    """One deal; private state is never passed to either policy."""
    # Deterministic randomness is solely for synthetic games.
    rng = Random(seed)  # nosec B311
    state = new_round([f"p{i}" for i in range(count)], dealer_index=count - 1, rng=rng)
    policy = current if use_current else frozen
    memories = {p["id"]: (policy.CpuMemory() if p["id"] == seat else frozen.CpuMemory())
                for p in state["players"]}
    observed = Counter()
    compared = False
    for turn in range(3000):
        if state["phase"] == "finished":
            placement = (state["finished_order"].index(seat) + 1
                         if seat in state["finished_order"] else count)
            return {"loss": int(state["loser_id"] == seat), "placement": placement,
                    "stall": 0, "actions": turn, **observed}
        actor = (next(iter(state["pending_refills"]), None)
                 or (state.get("afterthrow") or {}).get("player_id") or state["current_player_id"])

        def choose(player: str):
            view = project_state(state, player)
            if player != seat and voluntary_pickup(view, profile, seed, player):
                return view, {"action": "pickup", "version": view["version"]}
            if player != seat and profile == "simple":
                return view, choose_reference_action(view)
            selected_policy = policy if player == seat else frozen
            # Each policy receives the same per-position seed, independently of the opponent's bluff coin.
            decision_rng = Random(f"{seed}:{player}:{state['version']}")  # nosec B311
            return view, selected_policy.choose_cpu_action(view, memory=memories[player], skill=skill,
                                                           rng=decision_rng)

        view, move = choose(actor)
        if move is None:
            actor = state["current_player_id"]
            view, move = choose(actor)
        if move is None:
            raise RuntimeError("No legal continuation in Hausdepp simulation")
        hint = _hint(view, memories[actor], actor) if actor == seat else None
        active_count = sum(not player.get("finished") and not player.get("withdrawn")
                           for player in view.get("players", ()))
        if hint is not None:
            observed["hint_decisions"] += 1
            observed[f"hint_active_{active_count}"] += 1
        candidates = []
        if actor == seat and use_current:
            for source, name in (("hinted", "_suspected_pickup_finish"),
                                 ("unhinted", "_unhinted_endgame_finish")):
                helper = getattr(current, name, None)
                suspect = None if helper is None else helper(view, memories[actor])
                if suspect is not None:
                    cards, _confidence = suspect
                    candidates.append((source, cards))
                    observed[f"{source}_candidate_active_{active_count}"] += 1
                    if source == "hinted":
                        observed["candidate_decisions"] += 1
                        observed[f"candidate_active_{active_count}"] += 1
        if actor != seat and move["action"] == "pickup" and not view.get("deck_count"):
            kind = "voluntary" if "play" in view.get("available_actions", ()) else "forced"
            observed[f"opponent_{kind}_pickups"] += 1
        matching = [(source, cards) for source, cards in candidates if move["action"] == "play"
                    and sorted(move.get("cards", ())) == sorted(cards)]
        if matching and not compared and active_count >= 4:
            # Re-evaluate the same public position under the frozen strategy.
            # This only copies permitted memory; the full engine state is used
            # after both choices to simulate and score their consequences.
            frozen_memories = _frozen_memories(memories)
            baseline_rng = Random(f"{seed}:{seat}:{state['version']}")  # nosec B311
            alternative = frozen.choose_cpu_action(view, memory=frozen_memories[seat], skill=skill, rng=baseline_rng)
            if alternative is not None and (alternative.get("action"), sorted(alternative.get("cards", ()))) != (
                    move.get("action"), sorted(move.get("cards", ()))):
                paired = [_continuation(state, memories, seat, action, skill, profile, seed, rng.getstate())
                          for action in (alternative, move)]
                compared = True
                key = f"counterfactual_active_{active_count}"
                observed[key] += 1
                if any(result["stall"] for result in paired):
                    observed[f"{key}_stalls"] += 1
                else:
                    old, new = paired
                    observed[f"{key}_baseline_next_hand"] += old["next_hand"]
                    observed[f"{key}_candidate_next_hand"] += new["next_hand"]
                    observed[f"{key}_baseline_placement"] += old["placement"]
                    observed[f"{key}_candidate_placement"] += new["placement"]
                    for metric in ("finished_before_next", "reached_next_turn", "opponent_pickup_before_next",
                                   "opponent_play_before_next", "opponent_clears_before_next"):
                        observed[f"{key}_baseline_{metric}"] += old.get(metric, 0)
                        observed[f"{key}_candidate_{metric}"] += new.get(metric, 0)
                    observed[f"{key}_less_next_hand"] += int(new["next_hand"] < old["next_hand"])
                    observed[f"{key}_more_next_hand"] += int(new["next_hand"] > old["next_hand"])
                    observed[f"{key}_better_placement"] += int(new["placement"] < old["placement"])
                    observed[f"{key}_worse_placement"] += int(new["placement"] > old["placement"])
        before = state
        state = apply_action(state, actor, **move, rng=rng)
        for source, _candidate in matching:
            # This is a matching selected move, not proof that this helper's
            # preference caused it: another tactic can pick the same cards.
            observed[f"{source}_matches_active_{active_count}"] += 1
            if source == "hinted":
                observed["candidate_matches"] += 1
                observed[f"candidate_matches_active_{active_count}"] += 1
            # This diagnostic uses the simulator's authoritative state after
            # selection; its result is never sent to the policy or its memory.
            if state["phase"] == "playing" and state.get("current_player_id") != seat:
                opponent = state["current_player_id"]
                after = project_state(state, opponent)
                if "play" in after.get("available_actions", ()):
                    observed[f"{source}_answerable_active_{active_count}"] += 1
                    if source == "hinted":
                        observed["candidate_answerable"] += 1
                        observed[f"candidate_answerable_active_{active_count}"] += 1
                elif "pickup" in after.get("available_actions", ()):
                    observed[f"{source}_pickup_active_{active_count}"] += 1
                    if source == "hinted":
                        observed["candidate_forces_pickup"] += 1
                        observed[f"candidate_forces_pickup_active_{active_count}"] += 1
        memories[actor].remember(view, move)
        if (restart_on_empty_stock and state["phase"] != "finished" and before["deck"]
                and not state["deck"]):
            # A server restart discards each independent seat's memory after
            # the last stock card; later events are observed normally.
            memories = {p["id"]: (policy.CpuMemory() if p["id"] == seat else frozen.CpuMemory())
                        for p in state["players"]}
            observed["resets"] += 1
        elif state["phase"] != "finished":
            for player, memory in memories.items():
                memory.public.observe(project_state(before, player), project_state(state, player))
    return {"loss": 0, "stall": 1, "actions": 3000, **observed}


def benchmark(count: int, deals: int, skill: float, seed_base: int, profile: str, *,
              restart_on_empty_stock: bool = False) -> dict:
    initial_sources = source_hashes()
    totals = Counter()
    for offset in range(deals):
        seed = seed_base + count * 10000 + offset
        for index in range(count):
            seat = f"p{index}"
            old = game(count, seed, seat, skill, profile, use_current=False,
                       restart_on_empty_stock=restart_on_empty_stock)
            new = game(count, seed, seat, skill, profile, use_current=True,
                       restart_on_empty_stock=restart_on_empty_stock)
            totals.update(seat_deals=1, frozen_losses=old["loss"], current_losses=new["loss"],
                          lost_only_with_frozen=int(old["loss"] and not new["loss"]),
                          lost_only_with_current=int(new["loss"] and not old["loss"]),
                          frozen_stalls=old["stall"], current_stalls=new["stall"])
            if not old["stall"] and not new["stall"]:
                totals.update(frozen_placement_sum=old["placement"], current_placement_sum=new["placement"],
                              frozen_only_better_placement=int(old["placement"] < new["placement"]),
                              current_only_better_placement=int(new["placement"] < old["placement"]))
                totals[f"frozen_place_{old['placement']}"] += 1
                totals[f"current_place_{new['placement']}"] += 1
            for key, value in new.items():
                if key not in {"loss", "stall", "placement"}:
                    totals[f"current_{key}"] += value
    if source_hashes() != initial_sources:
        raise RuntimeError("Source changed during simulation; discard this run and repeat it")
    result = {"players": count, "deals": deals, "skill": skill, "seed_base": seed_base,
              "opponent": profile, "baseline_commit": BASELINE, "source_sha256": initial_sources, **totals}
    if restart_on_empty_stock:
        result["memory_mode"] = "restart_on_empty_stock"
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=int, choices=range(2, 7), default=2)
    parser.add_argument("--deals", type=int, default=100)
    parser.add_argument("--skill", type=float, default=1.0)
    parser.add_argument("--seed-base", type=int, default=2500000)
    parser.add_argument("--opponent", choices=OPPONENTS, default="frozen")
    parser.add_argument("--restart-on-empty-stock", action="store_true",
                        help="reset every seat's memory just after the last stock card")
    args = parser.parse_args()
    if args.deals < 1 or not 0 <= args.skill <= 1:
        parser.error("deals must be positive and skill must be between 0 and 1")
    print(json.dumps(benchmark(args.players, args.deals, args.skill, args.seed_base, args.opponent,
                               restart_on_empty_stock=args.restart_on_empty_stock),
                     sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
