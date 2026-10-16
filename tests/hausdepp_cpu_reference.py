"""Frozen pre-tactical CPU for achievement calibration and policy comparisons."""

from collections import defaultdict

from app.hausdepp_engine import HAUSDEPP_RANKS, card_rank


def choose_reference_action(projection):
    if projection.get("phase") not in {"playing", "peeking"}:
        return None
    actions = projection.get("available_actions", [])
    move = {"version": projection["version"]}
    for action in ("peek", "draw"):
        if action in actions:
            return {**move, "action": action}
    groups = defaultdict(list)
    for card in projection.get("playable_cards", []):
        groups[card_rank(card)].append(card)
    if "afterthrow" in actions and groups:
        rank = next(rank for rank in HAUSDEPP_RANKS if rank in groups)
        return {**move, "action": "afterthrow", "cards": sorted(groups[rank])}
    if "play" in actions and groups:
        rank = next(rank for rank in HAUSDEPP_RANKS if rank in groups)
        ordinary = {card_rank(card) for card in projection.get("hand", []) if card_rank(card) != "10"}
        if not projection.get("deck_count") and "10" in groups and len(ordinary) <= 1:
            rank = "10"
        return {**move, "action": "play", "cards": sorted(groups[rank])}
    for action in ("gamble", "pickup"):
        if action in actions:
            return {**move, "action": action}
    return None
