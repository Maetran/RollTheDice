"""Tactical Hausdepp decisions from the same limited view as a human seat.

The policy considers its hand, the visible pile, public hand sizes and stock
count. After stock depletion it can remember observed public packet purchases.
Unknown hands, stock order, private peeks and achievement evidence are never used.
"""

from __future__ import annotations

from collections import Counter, defaultdict, deque
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Mapping

from .hausdepp_cpu_knowledge import PublicKnowledge
from .hausdepp_engine import HAUSDEPP_RANKS, card_rank

_VALUES = {rank: index for index, rank in enumerate(HAUSDEPP_RANKS)}


def _wild_quartets(projection: Mapping[str, Any]) -> bool:
    return projection.get("four_of_a_kind_as_ten") is True


def _position(projection: Mapping[str, Any]) -> tuple:
    return (tuple(sorted(projection.get("hand", []))), tuple(projection.get("discard", [])),
            int(projection.get("deck_count", 0)), tuple(projection.get("available_actions", [])),
            tuple((player.get("id"), player.get("hand_count"), bool(player.get("finished")))
                  for player in projection.get("players", [])),
            _wild_quartets(projection),
            tuple(sorted(tuple(sorted(group)) for group in projection.get("playable_groups") or [])))


def _group_only_quartets(projection: Mapping[str, Any]) -> dict[str, list[str]]:
    """Offered quartets whose rank is too low for a single card (rank -> cards).

    Uses only the viewer's own projection: the public rule, own hand and the
    server-offered ``playable_groups``.
    """
    if not _wild_quartets(projection) or "play" not in projection.get("available_actions", []):
        return {}
    hand, single = set(projection.get("hand", [])), set(projection.get("playable_cards", []))
    result: dict[str, list[str]] = {}
    for group in projection.get("playable_groups") or []:
        if (len(group) == 4 and len(set(group)) == 4 and set(group) <= hand and not set(group) <= single
                and len({card_rank(card) for card in group}) == 1):
            result[card_rank(group[0])] = sorted(group)
    return result


def _command_key(command: Mapping[str, Any]) -> tuple:
    return command.get("action"), tuple(sorted(command.get("cards", [])))


@dataclass
class CpuMemory:
    """Bounded own decisions and public empty-stock packet observations.

    Recognising a failed repeating plan requires no knowledge of opposing
    hands. Public knowledge comes only from this seat's personal DTOs. This
    transient memory resets on disconnect, a new round or restart.
    """

    _recent: deque = field(default_factory=lambda: deque(maxlen=48))
    public: PublicKnowledge = field(default_factory=PublicKnowledge)

    def visits(self, projection: Mapping[str, Any], command: Mapping[str, Any] | None = None) -> int:
        position = _position(projection)
        return sum(old == position and (command is None or action == _command_key(command))
                   for old, action in self._recent)

    def remember(self, projection: Mapping[str, Any], accepted_command: Mapping[str, Any]) -> None:
        if accepted_command.get("action") in {"play", "afterthrow", "gamble", "pickup"}:
            self._recent.append((_position(projection), _command_key(accepted_command)))


def _finish_move(hand: list[str], discard: list[str], *, wild_quartets: bool = False) -> str | None:
    """Find a guaranteed finish through our own consecutive clearances.

    A normal placement ends the search because the opponent then has a turn.
    No unknown opposing hands or unknown draw cards are simulated. With the
    table rule, a complete quartet in hand clears over any floor.
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
            quartet = wild_quartets and count == 4
            if not count or rank < floor and not quartet:
                continue
            rest = tuple(0 if index == rank else value for index, value in enumerate(remaining))
            if not any(rest):
                candidate = (rank,)
            elif rank == _VALUES["10"] or quartet or count + (streak if floor == rank else 0) == 4:
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


# Card worth while the stock still refills hands. A ten clears and keeps the
# turn, an ace beats every ordinary rank; low cards are mostly ballast.
_WORTH = {"6": -1.0, "7": -0.8, "8": -0.5, "9": -0.2, "U": 0.2, "O": 0.6, "K": 1.2, "A": 2.0, "10": 3.0}
_REFILL_WORTH = sum(_WORTH.values()) / len(_WORTH)


def _burden(stock: int) -> float:
    """What one extra hand card costs: little early, a lot without stock."""
    return 0.45 if stock > 12 else 0.8 if stock > 0 else 1.7


def _set_bonus(counts: Counter, added: Counter) -> float:
    """Pairs, triples and especially quartets are worth more than their cards."""
    bonus = 0.0
    for rank, extra in added.items():
        before, after = counts[rank], counts[rank] + extra
        if rank == "10":
            continue
        if after >= 4 > before:
            bonus += 2.5  # a quartet clears the pile and keeps the turn
        elif after == 3 > before:
            bonus += 0.9
        elif after == 2 > before:
            bonus += 0.3
    return bonus


def _pickup_score(hand: list[str], cards: list[str], stock: int) -> float:
    counts = Counter(card_rank(card) for card in hand)
    added = Counter(card_rank(card) for card in cards)
    return (sum(_WORTH[card_rank(card)] for card in cards) + _set_bonus(counts, added)
            - _burden(stock) * len(cards))


def _play_score(hand: list[str], cards: list[str], stock: int, *, clears: bool) -> float:
    """Value of spending these cards: lost worth, plus shedding and refills."""
    score = -sum(_WORTH[card_rank(card)] for card in cards) + _burden(stock) * len(cards)
    refills = max(0, 3 - (len(hand) - len(cards))) if stock else 0
    score += min(refills, stock) * (_REFILL_WORTH - _burden(stock))
    if clears:
        score += _burden(stock)  # the kept turn sheds another card at once
    return score


def _bargain(hand: list[str], discard: list[str], stock: int, active: int, cards: list[str], *,
             top: str | None, streak: int) -> bool:
    """Whether "buying" the packet beats spending these cards on it."""
    if not stock or not cards:
        return False
    rank = card_rank(cards[0])
    clears = rank == "10" or len(cards) + (streak if rank == top else 0) >= 4
    # Heads-up races punish extra cards: there, refuse to burn a ten on a tiny
    # packet while plenty of stock remains, and weigh an ace on top just like
    # at a larger table. Paired heads-up deals lose about 4% less often this
    # way than when every ace-topped packet is cleared.
    duel_ten = active == 2 and rank == "10" and len(discard) <= 2 and stock > 12
    duel_ace = active == 2 and top == "A"
    return (active > 2 or duel_ten or duel_ace) and (
        _pickup_score(hand, discard, stock) > _play_score(hand, cards, stock, clears=clears) + 0.25)


def _pickup_beats_gamble(hand: list[str], discard: list[str], stock: int) -> bool:
    """Without a legal card, a good packet beats a gamble that may add it anyway."""
    success, ten = _gamble_odds(hand, discard)
    gamble_score = (success * (_burden(stock) + ten) + (1 - success)
                    * (_pickup_score(hand, discard, stock) + _REFILL_WORTH - _burden(stock)))
    return _pickup_score(hand, discard, stock) > gamble_score


# Holding back high cards: one Ober, King or Ace forces the next player to
# answer it (with an equal or higher card, a ten, or by taking the packet)
# while the rest of the group waits in reserve for the next answer. Paired
# deals against throwing the whole group lost 13–22% less often at every
# table size, with or without stock; holding back lower ranks did not help.
_HOLD_RANKS = frozenset({"O", "K", "A"})


def _holds(rank: str, count: int, *, top: str | None, streak: int) -> bool:
    """Whether to keep part of a high group rather than playing all of it now."""
    return rank in _HOLD_RANKS and count + (streak if rank == top else 0) < 4  # four still clear at once


def _top_run(discard: list[str]) -> tuple[str | None, int]:
    top = card_rank(discard[-1]) if discard else None
    streak = 0
    for card in reversed(discard):
        if card_rank(card) != top:
            break
        streak += 1
    return top, streak


def _active(projection: Mapping[str, Any]) -> int:
    return sum(not player.get("finished") for player in projection.get("players", []))


def table_tip(projection: Mapping[str, Any]) -> dict[str, str] | None:
    """A short hint for a newer person, from the same view and values a computer uses."""
    actions = projection.get("available_actions", [])
    stock = int(projection.get("deck_count", 0))
    if projection.get("phase") != "playing" or "pickup" not in actions or not stock:
        return None
    hand, discard = list(projection.get("hand", [])), list(projection.get("discard", []))
    groups: dict[str, list[str]] = defaultdict(list)
    for card in projection.get("playable_cards", []):
        groups[card_rank(card)].append(card)
    top, streak = _top_run(discard)
    active = _active(projection)
    counts, added = Counter(card_rank(card) for card in hand), Counter(card_rank(card) for card in discard)
    quartet = next((rank for rank in HAUSDEPP_RANKS[:-1] if counts[rank] and counts[rank] < 4 <= counts[rank] + added[rank]),
                   None)
    ordinary = [rank for rank in HAUSDEPP_RANKS[:-1] if rank in groups]
    if projection.get("playable_groups") and "play" in actions:
        return None  # a quartet is on offer; no pickup or gamble hint
    if "play" in actions and groups:
        cards = sorted(groups[ordinary[0]]) if ordinary else sorted(groups["10"])[:1]
        if _bargain(hand, discard, stock, active, cards, top=top, streak=streak):
            if quartet:
                return {"key": "tipQuartet", "rank": quartet}
            if not ordinary:
                return {"key": "tipBuyAce"} if [card_rank(card) for card in discard] == ["A"] else {"key": "tipBuyPacket"}
    elif not groups and "gamble" in actions and _pickup_beats_gamble(hand, discard, stock):
        return {"key": "tipPickupNotGamble"}
    return None


def slip_chance(skill: float) -> float:
    """How often a computer misjudges: a little always, clearly more when gentle."""
    return 0.05 + (1 - max(0.0, min(1.0, skill))) * 0.55


def _known_pair_block(projection: Mapping[str, Any], memory: CpuMemory | None) -> str | None:
    """Only the proven three-card versus known-pair pattern, with an empty table.

    low < pair < block < reserve forces a pickup and then finishes over every
    legal reply. Giving away a blocker without the higher reserve is unsafe.
    """
    players = projection.get("players", [])
    active = [player for player in players if not player.get("finished") and not player.get("withdrawn")]
    hand = list(projection.get("hand", []))
    viewer = projection.get("viewer_id")
    if (memory is None or projection.get("phase") != "playing" or projection.get("deck_count") != 0
            or projection.get("discard") or projection.get("afterthrow") or projection.get("withdrawn_ids")
            or projection.get("current_player_id") != viewer or "play" not in projection.get("available_actions", [])
            or len(active) != 2 or any(player.get("withdrawn") for player in players)
            or any(player.get("finished") and player.get("hand_count") != 0 for player in players)
            or len(hand) != 3 or len({card_rank(card) for card in hand}) != 3
            or any(card_rank(card) == "10" for card in hand)):
        return None
    opponent = next((player["id"] for player in active if player["id"] != viewer), None)
    known = memory.public.exact_hand(projection, opponent)
    if (known is None or len(known) != 2 or card_rank(known[0]) != card_rank(known[1])
            or card_rank(known[0]) == "10"):
        return None
    low, block, reserve = sorted(hand, key=lambda card: _VALUES[card_rank(card)])
    if (_VALUES[card_rank(low)] < _VALUES[card_rank(known[0])] < _VALUES[card_rank(block)]
            < _VALUES[card_rank(reserve)] and block in projection.get("playable_cards", [])):
        return block
    return None


def choose_cpu_action(projection: Mapping[str, Any], *, memory: CpuMemory | None = None,
                      skill: float = 1.0, rng: Any = None) -> dict[str, Any] | None:
    """Choose a legal command; only the authoritative engine applies it.

    With an ``rng``, the computer occasionally makes human-sized misjudgements
    (a higher card than needed, a missed bargain or follow-up, a gamble instead
    of a pickup); lower ``skill`` makes them more frequent. Mandatory refills,
    cutting and guaranteed finishes are never misplayed.
    """
    slip = slip_chance(skill) if rng is not None else 0.0

    def slipped(weight: float = 1.0) -> bool:
        return bool(slip) and rng.random() < slip * weight

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
    quartets = _group_only_quartets(projection)
    stock = int(projection.get("deck_count", 0))
    top, streak = _top_run(discard)
    # Now and then a computer throws a whole high group at once anyway; gentle
    # computers do so far more often.
    hold = not slipped(2.0)

    def high_part(rank: str, cards: list[str]) -> list[str]:
        return cards[:1] if hold and len(cards) > 1 and _holds(rank, len(cards), top=top, streak=streak) else cards

    if "afterthrow" in actions and groups:
        rank = next(rank for rank in HAUSDEPP_RANKS if rank in groups)
        afterthrow = {**move, "action": "afterthrow", "cards": sorted(groups[rank])}
        if not stock and len(groups[rank]) == len(hand):
            return afterthrow  # a guaranteed finish is never missed
        if slipped(0.5):
            return None  # did not notice the matching card in time
        if hold and _holds(rank, len(groups[rank]), top=top, streak=streak):
            return None  # the high reserve stays in hand for the next answer
        return afterthrow
    if not stock and "play" in actions:
        finish = _finish_move(hand, discard, wild_quartets=bool(quartets) or _wild_quartets(projection))
        if finish is not None and finish in quartets:
            return {**move, "action": "play", "cards": quartets[finish]}
        if finish is not None and finish in groups:
            return {**move, "action": "play", "cards": sorted(groups[finish])}

    block = _known_pair_block(projection, memory)
    if block is not None and not slipped():
        return {**move, "action": "play", "cards": [block]}

    counts = Counter(card_rank(card) for card in hand)

    # Completing four grants another turn without spending a ten. Take that
    # free reduction before comparing ordinary moves of different ranks.
    if "play" in actions:
        for rank in HAUSDEPP_RANKS[:-1]:
            if groups.get(rank) and len(groups[rank]) + (streak if rank == top else 0) == 4:
                return {**move, "action": "play", "cards": sorted(groups[rank])}
        # Likewise a table-rule quartet over a higher pile: four cards gone, turn kept.
        if quartets:
            return {**move, "action": "play", "cards": next(iter(quartets.values()))}
    ordinary = [rank for rank in HAUSDEPP_RANKS[:-1] if rank in groups]
    choices = []
    if "play" in actions:
        for rank in [*ordinary, *(["10"] if "10" in groups else [])]:
            cards = sorted(groups.get(rank, []))
            # One ten clears just as well as several, and one high card asks
            # as much of the next player as a group. Save the others unless
            # playing the whole group is part of a guaranteed finish above.
            cards = cards[:1] if rank == "10" else high_part(rank, cards)
            choices.append({**move, "action": "play", "cards": cards})

    preferred = choices[0] if choices else None
    if len(ordinary) > 1 and slipped(1.0 if stock else 0.6):
        # A plausible misjudgement: the next higher rank instead of the lowest.
        preferred = {**move, "action": "play", "cards": high_part(ordinary[1], sorted(groups[ordinary[1]]))}
    active = _active(projection)
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
        pickup = {**move, "action": "pickup"}
        choices.append(pickup)
        # Experienced tables rarely see an obvious purchase missed; the other
        # human-sized misjudgements keep their usual rate.
        if (preferred and preferred.get("action") == "play" and not slipped(0.3 if skill >= 0.9 else 1.0)
                and _bargain(hand, discard, stock, active, preferred["cards"], top=top, streak=streak)):
            # "Buy" a small valuable packet rather than burning a ten or an ace
            # on it, especially when it completes a set of our own.
            preferred = pickup
        elif (preferred and preferred.get("action") == "gamble" and not groups and not slipped()
              and _pickup_beats_gamble(hand, discard, stock)):
            preferred = pickup
    if not choices:
        return None
    preferred = preferred or choices[-1]
    if memory and memory.visits(projection):
        # A proven repeating position needs another legal plan, not an
        # intentionally inaccurate move or knowledge of the opposing hand.
        return min(choices, key=lambda choice: (memory.visits(projection, choice), choice != preferred))
    return preferred
