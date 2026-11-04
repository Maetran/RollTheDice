"""Exact two-player Hausdepp endgame over publicly counted cards.

Once the stock is empty and only two hands remain, every card is either in
our hand, on the visible pile, publicly burned or in the single opposing
hand. A person who counted the burned cards therefore knows that hand. This
module receives only that counted hand (never the engine state) and searches
for a move that empties our hand first against every legal reply.

Only ranks matter. The search asks "can we force a win within ``d`` card
actions?" for growing ``d`` (iterative deepening). That bounded question has
one exact answer per position, independent of search order or repetitions,
and the returned moves are always the fastest forced wins. When every later
decision follows a newly proven win, its remaining worst-case depth decreases;
fallback decisions and human-sized misjudgements do not have that guarantee.
Depth and node count are bounded; when one runs out the result is ``None`` and
the ordinary heuristic plays on. There is deliberately no clock: a counted
position gives the same result after a cache eviction or under load. The node
limit bounds work rather than elapsed time; execution is synchronous and its
duration varies with hardware and load.

Every rule choice is open to the opponent: voluntary pickups, any number of
equal cards, the optional quartet rule and the extra turn after a ten or four
of a kind. Afterthrows are a race: an opposing afterthrow may arrive before our
reply or not at all, and our own afterthrow may always be pre-empted, so it is
never relied upon. A reported win therefore holds against every legal reply
and timing. An empty result only means that no win was proven within the
depth limit; it is never a proof that the position is lost.
"""

from __future__ import annotations

from collections import Counter
from functools import lru_cache

from .hausdepp_engine import HAUSDEPP_RANKS, card_rank

_INDEX = {rank: index for index, rank in enumerate(HAUSDEPP_RANKS)}
_TEN = _INDEX["10"]
NODE_BUDGET = 8_000
# Card actions (plays, pickups, opposing afterthrows) looked ahead at most.
# One action uses about three Python frames: far below the recursion limit.
MAX_DEPTH = 40


class _Budget(Exception):
    pass


def _counts(cards) -> tuple[int, ...]:
    counter = Counter(_INDEX[card_rank(card)] for card in cards)
    return tuple(counter[index] for index in range(len(HAUSDEPP_RANKS)))


def _pile_counts(pile: tuple[int, ...]) -> tuple[int, ...]:
    counter = Counter(pile)
    return tuple(counter[index] for index in range(len(HAUSDEPP_RANKS)))


def _add(hand: tuple[int, ...], pile: tuple[int, ...]) -> tuple[int, ...]:
    return tuple(a + b for a, b in zip(hand, _pile_counts(pile)))


def _burns(pile: tuple[int, ...]) -> bool:
    return bool(pile) and (pile[-1] == _TEN or len(pile) >= 4 and len(set(pile[-4:])) == 1)


def _take(hand: tuple[int, ...], rank: int, count: int) -> tuple[int, ...]:
    return hand[:rank] + (hand[rank] - count,) + hand[rank + 1:]


def _plays(hand: tuple[int, ...], pile: tuple[int, ...], wild: bool):
    top = pile[-1] if pile else -1
    for rank, held in enumerate(hand):
        for count in range(1, held + 1):
            if rank >= top or wild and count == 4:
                yield rank, count


class _Search:
    """``mine``/``theirs`` answer: do we surely win within ``depth`` card actions?"""

    def __init__(self, wild: bool, budget: int) -> None:
        # A win proven within d actions also holds for every larger depth; a
        # failure within d also for every smaller one.
        self.wild, self.budget, self.won, self.failed = wild, budget, {}, {}

    def _known(self, key, depth: int) -> bool | None:
        if self.won.get(key, depth + 1) <= depth:
            return True
        if self.failed.get(key, -1) >= depth:
            return False
        self.budget -= 1
        if self.budget < 0:
            raise _Budget
        return None

    def _store(self, key, depth: int, result: bool) -> bool:
        if result:
            self.won[key] = min(depth, self.won.get(key, depth))
        else:
            self.failed[key] = max(depth, self.failed.get(key, depth))
        return result

    def placed(self, me, opp, pile, rank, count, depth, *, mine: bool) -> bool:
        """After ``count`` cards of ``rank`` landed on ``pile``; ``depth`` already spent."""
        pile = pile + (rank,) * count
        if mine and not any(me):
            return True
        if not mine and not any(opp):
            return False
        if _burns(pile):
            # A cleared pile keeps the turn for the same player.
            return self.mine(me, opp, (), None, depth) if mine else self.theirs(me, opp, (), depth)
        if mine:
            # Our own afterthrow may be pre-empted, so it is never relied on.
            return self.theirs(me, opp, pile, depth)
        return self.mine(me, opp, pile, rank, depth)

    def mine(self, me, opp, pile, threat, depth) -> bool:
        """Our turn; ``threat`` is the opponent's still open afterthrow rank."""
        if depth <= 0:
            return False
        key = (0, me, opp, pile, threat)
        known = self._known(key, depth)
        if known is not None:
            return known
        result = any(self.placed(_take(me, rank, count), opp, pile, rank, count, depth - 1, mine=True)
                     for rank, count in _plays(me, pile, self.wild))
        if not result and pile:
            result = self.theirs(_add(me, pile), opp, (), depth - 1)
        if result and threat is not None:
            # The opponent may add any matching cards before we act.
            result = all(self.placed(me, _take(opp, threat, count), pile, threat, count, depth - 1, mine=False)
                         for count in range(1, opp[threat] + 1))
        return self._store(key, depth, result)

    def theirs(self, me, opp, pile, depth) -> bool:
        if depth <= 0:
            return False
        key = (1, me, opp, pile, None)
        known = self._known(key, depth)
        if known is not None:
            return known
        result = all(self.placed(me, _take(opp, rank, count), pile, rank, count, depth - 1, mine=False)
                     for rank, count in _plays(opp, pile, self.wild))
        if result and pile:
            result = self.mine(me, _add(opp, pile), (), None, depth - 1)
        return self._store(key, depth, result)


def _fastest(options, wild: bool, budget: int, apply) -> tuple | None:
    search = _Search(wild, budget)
    try:
        for depth in range(1, MAX_DEPTH + 1):
            found = tuple(option for option in options if apply(search, option, depth - 1))
            if found:
                return found
    except (_Budget, RecursionError):
        return None
    return ()


@lru_cache(maxsize=512)
def _winning(me, opp, pile, wild: bool, budget: int) -> tuple[tuple[int, int] | None, ...] | None:
    def apply(search: _Search, play, depth: int) -> bool:
        if play is None:  # take the pile; the opponent moves next
            return search.theirs(_add(me, pile), opp, (), depth)
        return search.placed(_take(me, *play), opp, pile, *play, depth, mine=True)

    return _fastest((*_plays(me, pile, wild), *((None,) if pile else ())), wild, budget, apply)


@lru_cache(maxsize=512)
def _afterthrow_wins(me, opp, pile, rank: int, wild: bool, budget: int) -> tuple[int, ...] | None:
    return _fastest(tuple(range(1, me[rank] + 1)), wild, budget, lambda search, count, depth: search.placed(
        _take(me, rank, count), opp, pile, rank, count, depth, mine=True))


def winning_plays(hand, opponent, discard, *, wild: bool = False,
                  budget: int = NODE_BUDGET) -> list[tuple[str, int]] | None:
    """The fastest moves from our turn that win against all replies.

    Each move is ``(rank, count)`` for a play or ``("pickup", 0)``. ``None``
    means a budget ran out. An empty list only means that no forced win was
    proven within ``MAX_DEPTH`` card actions, never that none exists.
    """
    result = _winning(_counts(hand), _counts(opponent), tuple(_INDEX[card_rank(card)] for card in discard),
                      bool(wild), int(budget))
    return None if result is None else [("pickup", 0) if move is None else (HAUSDEPP_RANKS[move[0]], move[1])
                                         for move in result]


def winning_afterthrows(hand, opponent, discard, rank: str, *, wild: bool = False,
                        budget: int = NODE_BUDGET) -> list[int] | None:
    """Counts of matching cards whose immediate afterthrow is a fastest forced win."""
    result = _afterthrow_wins(_counts(hand), _counts(opponent), tuple(_INDEX[card_rank(card)] for card in discard),
                              _INDEX[rank], bool(wild), int(budget))
    return None if result is None else list(result)
