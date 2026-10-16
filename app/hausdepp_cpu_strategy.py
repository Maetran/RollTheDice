"""A small Hausdepp opponent using only its player-safe projection.

The policy never receives deck order, other hands, or the authoritative state.
It plays low matching groups first and conserves tens while ordinary moves
remain available.  With no playable hand card it gambles before collecting a
large packet; after the deck empties it must collect instead.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Mapping

from .hausdepp_engine import HAUSDEPP_RANKS, card_rank


def choose_cpu_action(projection: Mapping[str, Any]) -> dict[str, Any] | None:
    """Return one command for the normal authoritative action validator."""
    if projection.get("phase") not in {"playing", "peeking"}:
        return None
    actions = projection.get("available_actions", [])
    if "peek" in actions:
        return {"action": "peek", "version": projection["version"]}
    if "draw" in actions:
        return {"action": "draw", "version": projection["version"]}
    groups: dict[str, list[str]] = defaultdict(list)
    for card in projection.get("playable_cards", []):
        groups[card_rank(card)].append(card)
    move: dict[str, Any] = {"version": projection["version"]}
    if "afterthrow" in actions and groups:
        rank = next(rank for rank in HAUSDEPP_RANKS if rank in groups)
        return {**move, "action": "afterthrow", "cards": sorted(groups[rank])}
    if "play" in actions and groups:
        rank = next(rank for rank in HAUSDEPP_RANKS if rank in groups)
        # When the deck is empty, a ten grants another play.  Spend it first
        # if every remaining non-ten card is one common rank: finish now.
        hand = projection.get("hand", [])
        non_ten_ranks = {card_rank(card) for card in hand if card_rank(card) != "10"}
        if not projection.get("deck_count") and "10" in groups and len(non_ten_ranks) <= 1:
            rank = "10"
        return {**move, "action": "play", "cards": sorted(groups[rank])}
    if "gamble" in actions:
        return {**move, "action": "gamble"}
    if "pickup" in actions:
        return {**move, "action": "pickup"}
    return None
