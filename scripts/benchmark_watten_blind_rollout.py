"""Compare blind rollout models using the same production decision harness.

The legacy model is kept here only as a measurement baseline. Both variants
otherwise run the current policy, including the same public rank preference.
All cards are synthetic and the policy sees only its normal personal view.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import app.watten_cpu as policy
from tests import watten_cpu_benchmark as benchmark


def _legacy_simulated_card(model, seat, hands, trick, ctx):
    """The previous rollout used this hypothetical world's model for all seats."""
    forced = dict(ctx.snap.bloedeln_cards).get(seat)
    if forced is not None and forced in hands[seat]:
        return forced
    cards = [card for _, card in trick]
    legal = model.allowed(hands[seat], cards, seat in ctx.knowers)
    cheapest = min(legal, key=model.order.__getitem__)
    if not trick:
        others = [card for other in range(ctx.count) if other != seat for card in hands[other]]
        bosses = [card for card in legal if all(model.strength(other, card) <= model.base[card] for other in others)]
        return min(bosses, key=model.order.__getitem__) if bosses else cheapest
    led, best_index = cards[0], model.winner(cards)
    if ctx.parties[trick[best_index][0]] == ctx.parties[seat]:
        return cheapest
    best = model.strength(cards[best_index], led)
    later = ((trick[0][0] + offset) % ctx.count for offset in range(len(trick) + 1, ctx.count))
    threats = [card for other in later if ctx.parties[other] != ctx.parties[seat] for card in hands[other]]
    safe = [card for card in legal if model.strength(card, led) > best
            and all(model.strength(threat, led) <= model.strength(card, led) for threat in threats)]
    return min(safe, key=model.order.__getitem__) if safe else cheapest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rollout", required=True, choices=("legacy", "blind"))
    parser.add_argument("--completed-games", required=True, type=int)
    parser.add_argument("--seeds", default=64, type=int)
    parser.add_argument("--seed-start", default=22000, type=int)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if not 1 <= args.seeds <= 64 or args.completed_games < 0 or not 0 <= args.seed_start <= 2**31 - 65:
        parser.error("invalid number of seeds, seed start or completed games")
    if not hasattr(policy, "_blind_rollout_card"):
        parser.error("apply the frozen experimental patch in an isolated checkout before running this comparison")
    old_rollout, old_profiles = policy._simulated_card, benchmark.PROFILES
    try:
        if args.rollout == "legacy":
            policy._simulated_card = _legacy_simulated_card
        benchmark.PROFILES = tuple(profile for profile in old_profiles if profile.blind)
        result = benchmark.benchmark(tuple(range(args.seed_start, args.seed_start + args.seeds)),
                                     240, args.completed_games)
    finally:
        policy._simulated_card, benchmark.PROFILES = old_rollout, old_profiles
    result["blind_rollout_variant"] = args.rollout
    result["blind_rollout_wrapper_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    return int(result["status"] != "complete")


if __name__ == "__main__":
    raise SystemExit(main())
