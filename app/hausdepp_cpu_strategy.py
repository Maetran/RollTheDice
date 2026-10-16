"""Tactical Hausdepp decisions from the same limited view as a human seat.

The policy considers its hand, the visible pile, public hand sizes and stock
count. Gamble odds are estimates over unaccounted-for ranks, never stock order,
opponents' cards, private inspection information or achievement evidence.
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Mapping

from .hausdepp_engine import HAUSDEPP_RANKS, card_rank

_VALUES = {rank: index for index, rank in enumerate(HAUSDEPP_RANKS)}


def _position(projection: Mapping[str, Any]) -> tuple:
    return (tuple(sorted(projection.get("hand", []))), tuple(projection.get("discard", [])),
            int(projection.get("deck_count", 0)), tuple(projection.get("available_actions", [])),
            tuple((player.get("id"), player.get("hand_count"), bool(player.get("finished")))
                  for player in projection.get("players", [])))


def _command_key(command: Mapping[str, Any]) -> tuple:
    return command.get("action"), tuple(sorted(command.get("cards", [])))


@dataclass
class CpuMemory:
    """At most 48 of this seat's accepted, player-visible decisions.

    Recognising a failed repeating plan requires no knowledge of opposing
    hands. This transient memory resets on disconnect, a new round or restart.
    """

    _recent: deque = field(default_factory=lambda: deque(maxlen=48))

    def visits(self, projection: Mapping[str, Any], command: Mapping[str, Any] | None = None) -> int:
        position = _position(projection)
        return sum(old == position and (command is None or action == _command_key(command))
                   for old, action in self._recent)

    def remember(self, projection: Mapping[str, Any], accepted_command: Mapping[str, Any]) -> None:
        if accepted_command.get("action") in {"play", "afterthrow", "gamble", "pickup"}:
            self._recent.append((_position(projection), _command_key(accepted_command)))


def _finish_move(hand: list[str], discard: list[str]) -> str | None:
    """Find a guaranteed finish through our own consecutive clearances.

    A normal placement ends the search because the opponent then has a turn.
    No unknown opposing hands or unknown draw cards are simulated.
    """
    counts = Counter(card_rank(card) for card in hand)
    top = _VALUES[card_rank(discard[-1])] if discard else -1
    run = 0
    for card in reversed(discard):
        if _VALUES[card_rank(card)] != top:
            break
        run += 1

    @lru_cache(maxsize=256)
    def path(remaining: tuple[int, ...], floor: int, streak: int) -> tuple[int, ...] | None:
        best = None
        for rank, count in enumerate(remaining):
            if not count or rank < floor:
                continue
            rest = tuple(0 if index == rank else value for index, value in enumerate(remaining))
            if not any(rest):
                candidate = (rank,)
            elif rank == _VALUES["10"] or count + (streak if floor == rank else 0) == 4:
                continuation = path(rest, -1, 0)
                if continuation is None:
                    continue
                candidate = (rank, *continuation)
            else:
                continue
            if best is None or (len(candidate), candidate) < (len(best), best):
                best = candidate
        return best

    result = path(tuple(counts[rank] for rank in HAUSDEPP_RANKS), top, run)
    return HAUSDEPP_RANKS[result[0]] if result else None


def _next_hand_count(projection: Mapping[str, Any]) -> int | None:
    players = projection.get("players", [])
    viewer = projection.get("viewer_id")
    own_index = next((index for index, player in enumerate(players) if player.get("id") == viewer), None)
    if own_index is None:
        return None
    for offset in range(1, len(players)):
        player = players[(own_index + offset) % len(players)]
        if not player.get("finished"):
            return int(player.get("hand_count", 0))
    return None


def _gamble_odds(hand: list[str], discard: list[str]) -> tuple[float, float]:
    # Burned cards are not exposed by the projection. Deliberately estimate
    # over unknown cards rather than perfectly counting the actual stock.
    known = Counter(card_rank(card) for card in set(hand + discard))
    unseen = {rank: max(0, 4 - known[rank]) for rank in HAUSDEPP_RANKS}
    total = sum(unseen.values())
    floor = _VALUES[card_rank(discard[-1])] if discard else -1
    if not total:
        return 0.0, 0.0
    return (sum(count for rank, count in unseen.items() if _VALUES[rank] >= floor) / total,
            unseen["10"] / total)


def choose_cpu_action(projection: Mapping[str, Any], *, memory: CpuMemory | None = None) -> dict[str, Any] | None:
    """Choose a legal command; only the authoritative engine applies it."""
    if projection.get("phase") not in {"playing", "peeking"}:
        return None
    actions = projection.get("available_actions", [])
    move: dict[str, Any] = {"version": projection["version"]}
    if "peek" in actions:
        return {**move, "action": "peek"}
    if "draw" in actions:
        # Refill promptly, preserve FIFO and inspect the resulting hand before
        # deciding on a still-open additional-card opportunity.
        return {**move, "action": "draw"}
    hand = list(projection.get("hand", []))
    discard = list(projection.get("discard", []))
    groups: dict[str, list[str]] = defaultdict(list)
    for card in projection.get("playable_cards", []):
        groups[card_rank(card)].append(card)
    if "afterthrow" in actions and groups:
        rank = next(rank for rank in HAUSDEPP_RANKS if rank in groups)
        return {**move, "action": "afterthrow", "cards": sorted(groups[rank])}
    stock = int(projection.get("deck_count", 0))
    if not stock and "play" in actions:
        finish = _finish_move(hand, discard)
        if finish is not None and finish in groups:
            return {**move, "action": "play", "cards": sorted(groups[finish])}

    counts = Counter(card_rank(card) for card in hand)
    top = card_rank(discard[-1]) if discard else None
    streak = 0
    for card in reversed(discard):
        if card_rank(card) != top:
            break
        streak += 1

    # Completing four grants another turn without spending a ten. Take that
    # free reduction before comparing ordinary moves of different ranks.
    if "play" in actions:
        for rank in HAUSDEPP_RANKS[:-1]:
            if groups.get(rank) and len(groups[rank]) + (streak if rank == top else 0) == 4:
                return {**move, "action": "play", "cards": sorted(groups[rank])}
    ordinary = [rank for rank in HAUSDEPP_RANKS[:-1] if rank in groups]
    choices = []
    if "play" in actions:
        for rank in [*ordinary, *(["10"] if "10" in groups else [])]:
            cards = sorted(groups.get(rank, []))
            # One ten clears just as well as several. Save the others unless
            # playing the whole group is part of a guaranteed finish above.
            if rank == "10":
                cards = cards[:1]
            choices.append({**move, "action": "play", "cards": cards})

    preferred = choices[0] if choices else None
    active = sum(not player.get("finished") for player in projection.get("players", []))
    if (not stock and active == 2 and _next_hand_count(projection) == 1
            and len(set(counts) - {"10"}) <= 2 and ordinary):
        # In the final duel, block a one-card opponent when forcing a pickup
        # gives us a genuine finish next turn. Do not blindly exchange high
        # cards while still holding several unrelated low ranks.
        preferred = {**move, "action": "play", "cards": sorted(groups[ordinary[-1]])}

    if "gamble" in actions:
        success, ten = _gamble_odds(hand, discard)
        gamble = {**move, "action": "gamble"}
        choices.append(gamble)
        # Keep a small strong hand for the finish when enough stock remains.
        # Near depletion, actually reducing our hand takes priority.
        if (preferred is None or stock > 6 and len(hand) <= 3
                and min((_VALUES[rank] for rank in counts), default=0) >= _VALUES["K"] and success >= 0.6):
            preferred = gamble
        if preferred is gamble and "pickup" in actions and not groups and stock <= 3:
            gamble_cost = (1 - success) * (len(discard) + 1.7) - success * 0.65 - ten * 0.9
            if gamble_cost > len(discard):
                preferred = {**move, "action": "pickup"}
    if "pickup" in actions:
        choices.append({**move, "action": "pickup"})
    if not choices:
        return None
    preferred = preferred or choices[-1]
    if memory and memory.visits(projection):
        # A proven repeating position needs another legal plan, not an
        # intentionally inaccurate move or knowledge of the opposing hand.
        return min(choices, key=lambda choice: (memory.visits(projection, choice), choice != preferred))
    return preferred
