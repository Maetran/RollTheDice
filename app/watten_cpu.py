"""Bounded, reproducible tactical Watten CPU policy over one seat's permitted knowledge.

``decide`` consumes exactly the CPU's own personal DTO, its server-private
``CpuMemory``, the deal-bound public one-time call events of the producing
transition and an explicit integer seed. It returns the updated memory and one
EngineCommand-compatible proposal bound to the current deal, phase and
opportunity, or an explicit wait. Persist the returned memory before submitting
the proposal: an inspection acknowledgement closes the window just consumed.

Unknown cards and, without a received call, the call itself are sampled afresh
as hypothetical worlds consistent with public plays and trick winners, public
Danke, permitted partner cards and remembered own inspection cards. No engine,
room or view selector is imported, so real hidden hands, stock and secret calls
are unavailable by construction. Official trump duty follows the seat's role
only; an inferred call never binds a blind non-inspector. There is no duty to
win, and the Rechter or critical cards are never forced. A card that surely
cannot take the current trick is only ever spent as the cheapest such card, and
a stake that already decides the match is never raised. Guter/Schlechter,
difficulty modes, think delays and scheduling are deliberately absent.

Budget per decision: at most ``CpuBudget.samples`` (<= MAX_SAMPLES) accepted
worlds from at most ``samples * ATTEMPTS_PER_SAMPLE`` draws; each candidate
card (<= 5) is rolled out once per world to the end of the deal (<= 20 card
plays). Nothing runs in the background or touches the network.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final

from .watten_cards import WATTEN_SUITS, WELI, card_rank, make_deck
from .watten_cpu_memory import STRIKES, CpuMemory, SeatSnapshot, call_from_bottoms, read_personal_view, remember
from .watten_play import TRICKS_TO_WIN, official_knower_seats
from .watten_rules import (
    WELI_STRIKE,
    CardKind,
    ComparisonRules,
    WattenCall,
    card_kind,
    card_strength,
    effective_suit,
    round_roles,
)

# Typical Tyrolean first names; the runtime picks one not used by a human at the table.
WATTEN_CPU_NAMES: Final = ("Hansl", "Seppl", "Toni", "Lois", "Hias", "Vroni", "Moidl", "Resi", "Burgi", "Lenz",
                           "Fredl", "Kathi")
DEFAULT_SAMPLES: Final = 24
MAX_SAMPLES: Final = 64
ATTEMPTS_PER_SAMPLE: Final = 8
COMMAND_KINDS: Final = frozenset({"announce_strike", "announce_colour", "show_ready", "inspection_ack", "play_card",
                                  "bid", "respond", "partner_feedback"})
_RESPONSE_ACTIONS: Final = frozenset({"respond_hold", "respond_go", "respond_counter"})
_RESPONSES: Final = frozenset({"hold", "go", "counter"})
_FEEDBACK: Final = frozenset({"good", "bad", "unsure"})
_DECK: Final = make_deck()
_DUTY_LEADS: Final = frozenset({CardKind.TRUMP, CardKind.RECHTER})

# Fixed stake heuristics, not difficulty modes. An opposing bid signals strength
# the uniform sample cannot see; a raised opponent goes at most half the time.
OPPONENT_FOLD: Final = 0.5
BID_MIN_WIN: Final = 0.62
BID_MARGIN: Final = 0.02
COUNTER_MARGIN: Final = 0.03
BID_SIGNAL: Final = 0.85
FEEDBACK_SHIFT: Final = 0.1
GOOD_FEEDBACK: Final = 0.6
BAD_FEEDBACK: Final = 0.4
# Match equity: each later deal is won evenly and usually worth two points.
_STAKE_WEIGHTS: Final = ((2, 0.6), (3, 0.3), (4, 0.1))
_EQUITY_LIMIT: Final = 48
_CRITICAL_SCORE: Final = {"hearts-K": 12.0, WELI: 11.0, "acorns-7": 10.0}
_KIND_SCORE: Final = {CardKind.RECHTER: 9.0, CardKind.STRIKE: 6.0}
_NORMAL_SCORE: Final = {"A": 1.0, "K": 0.5}
_MASK: Final = (1 << 64) - 1


class WattenCpuError(ValueError):
    """A stable fail-closed policy rejection; no proposal is produced."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def available_cpu_names(reserved: Iterable[str] = ()) -> tuple[str, ...]:
    """Stable CPU names minus every name already used by a human at this table."""
    taken = {name.strip().casefold() for name in reserved if isinstance(name, str)}
    return tuple(name for name in WATTEN_CPU_NAMES if name.casefold() not in taken)


@dataclass(frozen=True, slots=True)
class CpuBudget:
    samples: int = DEFAULT_SAMPLES

    def __post_init__(self) -> None:
        if type(self.samples) is not int or not 1 <= self.samples <= MAX_SAMPLES:
            raise WattenCpuError("watten_cpu_invalid_budget")


@dataclass(frozen=True, slots=True, repr=False)
class CpuProposal:
    """Fields of exactly one EngineCommand for this CPU's bound seat.

    ``kind``/``value`` use command encoding (``respond`` + ``hold``), never
    view action names (``respond_hold``). The deterministic command ID makes a
    retried identical proposal replay its cached ACK instead of acting twice.
    """

    player_id: str
    deal_id: str
    opportunity: int
    phase: str
    kind: str
    value: str | None = None
    private_opportunity: int | None = None

    def __post_init__(self) -> None:
        if type(self.kind) is not str or self.kind not in COMMAND_KINDS:
            raise WattenCpuError("watten_cpu_invalid_proposal")
        if (self.kind == "partner_feedback") != (self.private_opportunity is not None):
            raise WattenCpuError("watten_cpu_invalid_proposal")
        if (self.kind == "respond") != (self.value in _RESPONSES) or (
                self.kind == "partner_feedback" and self.value not in _FEEDBACK):
            raise WattenCpuError("watten_cpu_invalid_proposal")

    @property
    def command_id(self) -> str:
        material = ["watten-cpu", self.player_id, self.deal_id, self.opportunity, self.phase, self.kind,
                    self.private_opportunity]
        encoded = json.dumps(material, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        return "cpu-" + hashlib.sha256(encoded).hexdigest()[:40]

    def command_fields(self) -> dict:
        """Keyword arguments for ``EngineCommand``; the actor stays the bound CPU seat."""
        return {"command_id": self.command_id, "deal_id": self.deal_id, "opportunity": self.opportunity,
                "phase": self.phase, "kind": self.kind, "value": self.value,
                "private_opportunity": self.private_opportunity}

    def __repr__(self) -> str:
        return f"CpuProposal(kind={self.kind!r}, opportunity={self.opportunity})"


@dataclass(frozen=True, slots=True)
class CpuWait:
    deal_id: str
    opportunity: int
    phase: str
    reason: str


@dataclass(frozen=True, slots=True, repr=False)
class CpuTurn:
    memory: CpuMemory
    decision: CpuProposal | CpuWait

    def __repr__(self) -> str:
        return f"CpuTurn(decision={self.decision!r})"


def _equity_table(limit: int) -> tuple[tuple[float, ...], ...]:
    table = [[0.0] * (limit + 1) for _ in range(limit + 1)]
    for ours in range(limit + 1):
        for theirs in range(limit + 1):
            if ours == 0:
                table[ours][theirs] = 1.0
            elif theirs:
                table[ours][theirs] = sum(weight * 0.5 * (table[max(0, ours - points)][theirs]
                                                          + table[ours][max(0, theirs - points)])
                                          for points, weight in _STAKE_WEIGHTS)
    return tuple(map(tuple, table))


_EQUITY: Final = _equity_table(_EQUITY_LIMIT)


def _equity(ours: int, theirs: int) -> float:
    """Chance to win the match when we still need ``ours`` and they ``theirs`` points."""
    if ours <= 0:
        return 1.0
    if theirs <= 0:
        return 0.0
    return _EQUITY[min(ours, _EQUITY_LIMIT)][min(theirs, _EQUITY_LIMIT)]


def _stake_value(ours: int, theirs: int, win: float, stake: int) -> float:
    return win * _equity(ours - stake, theirs) + (1 - win) * _equity(ours, theirs - stake)


class _Stream:
    """SplitMix64 seeded by SHA-256: reproducible across Python versions, not for secrets."""

    __slots__ = ("_state",)

    def __init__(self, material: list) -> None:
        encoded = json.dumps(material, separators=(",", ":"), ensure_ascii=True).encode("ascii")
        self._state = int.from_bytes(hashlib.sha256(encoded).digest()[:8], "big")

    def _next(self) -> int:
        self._state = (self._state + 0x9E3779B97F4A7C15) & _MASK
        value = self._state
        value = ((value ^ (value >> 30)) * 0xBF58476D1CE4E5B9) & _MASK
        value = ((value ^ (value >> 27)) * 0x94D049BB133111EB) & _MASK
        return value ^ (value >> 31)

    def below(self, bound: int) -> int:
        limit = (1 << 64) - ((1 << 64) % bound)
        while True:
            value = self._next()
            if value < limit:
                return value % bound

    def shuffle(self, items: list) -> None:
        for index in range(len(items) - 1, 0, -1):
            other = self.below(index + 1)
            items[index], items[other] = items[other], items[index]


class _Model:
    """Precomputed comparison keys of one hypothetical call, checked against watten_rules."""

    __slots__ = ("call", "kind", "base", "suit", "order")

    def __init__(self, call: WattenCall, critical: bool) -> None:
        rules = ComparisonRules(call, critical=critical)
        self.call = call
        self.kind = {card: card_kind(card, rules) for card in _DECK}
        # Only an ordinary card off the led suit depends on the lead; see strength().
        self.base = {card: card_strength(card, led_card=card, rules=rules) for card in _DECK}
        self.suit = {card: effective_suit(card, call) for card in _DECK}
        self.order = {card: index for index, card in enumerate(sorted(_DECK, key=lambda card: (self.base[card], card)))}

    def strength(self, card: str, led: str) -> tuple[int, int]:
        if self.kind[card] is CardKind.NORMAL and self.suit[card] != self.suit[led]:
            return -1, 0
        return self.base[card]

    def winner(self, cards: list[str]) -> int:
        best, key = 0, self.base[cards[0]]
        for index in range(1, len(cards)):
            candidate = self.strength(cards[index], cards[0])
            if candidate > key:
                best, key = index, candidate
        return best

    def allowed(self, hand, trick_cards: list[str], bound: bool):
        # Same confirmed duty as watten_play: strike, Rechter and critical stay alternatives.
        if not trick_cards or not bound or self.kind[trick_cards[0]] not in _DUTY_LEADS:
            return hand
        if not any(self.kind[card] is CardKind.TRUMP for card in hand):
            return hand
        return [card for card in hand if self.kind[card] is not CardKind.NORMAL]


class _Context:
    """Everything a decision may use: one parsed own DTO and this seat's memory."""

    def __init__(self, snap: SeatSnapshot, memory: CpuMemory) -> None:
        self.snap, self.memory = snap, memory
        profile = snap.profile
        self.count, self.critical, self.seat = profile.player_count, profile.critical, snap.seat
        self.parties = snap.seat_parties
        self.my_party = self.parties[self.seat]
        self.knowers = official_knower_seats(profile, snap.dealer_seat)
        self.roles = round_roles(self.count, snap.dealer_seat, determination=profile.determination)
        self.hand = snap.hand or ()
        self.known = {self.seat: self.hand}
        if snap.partner_cards is not None:
            self.known[snap.partner_seat] = snap.partner_cards
        self.tricks: dict[int, dict[int, tuple[int, str]]] = {}
        self.played_by: dict[int, list[tuple[int, str]]] = {seat: [] for seat in range(self.count)}
        self.played_seat: dict[str, int] = {}
        for trick, position, seat, card in memory.plays:
            self.tricks.setdefault(trick, {})[position] = (seat, card)
            self.played_by[seat].append((trick, card))
            self.played_seat[card] = seat
        self.seen = set(self.hand) | set(snap.partner_cards or ()) | set(self.played_seat)
        self.winners = dict(memory.winners)
        for trick, positions in self.tricks.items():
            if trick and trick - 1 not in self.winners:
                position, (seat, _) = min(positions.items())
                self.winners[trick - 1] = (seat - position) % self.count
        self.trick = list(snap.current_trick)
        self.leader = snap.current_trick[0][0] if snap.current_trick else snap.card_turn
        self._models: dict[tuple[str, str], _Model] = {}

    def model(self, strike: str, suit: str) -> _Model:
        key = (strike, suit)
        if key not in self._models:
            self._models[key] = _Model(WattenCall(strike, suit), self.critical)
        return self._models[key]


def _origin_candidates(ctx: _Context, origin: int) -> list[str]:
    """Cards that could have been this seat's original bottom, from permitted facts only."""
    if origin in ctx.known:
        return [card for card in _DECK if card in ctx.known[origin] or ctx.played_seat.get(card) == origin]
    return [card for card in _DECK
            if not any(card in cards for cards in ctx.known.values()) and ctx.played_seat.get(card, origin) == origin]


def _consistent(ctx: _Context, model: _Model) -> bool:
    """Public trick winners and bound seats' visible discards must fit the hypothesis."""
    for trick, positions in ctx.tricks.items():
        if len(positions) == ctx.count and trick in ctx.winners:
            ordered = [positions[position] for position in range(ctx.count)]
            if ordered[model.winner([card for _, card in ordered])][0] != ctx.winners[trick]:
                return False
        lead = positions.get(0)
        if lead is None or model.kind[lead[1]] not in _DUTY_LEADS:
            continue
        for position, (seat, card) in positions.items():
            if position == 0 or seat not in ctx.knowers or model.kind[card] is not CardKind.NORMAL:
                continue
            later = [held for played_trick, held in ctx.played_by[seat] if played_trick > trick]
            later.extend(ctx.known.get(seat, ()))
            if any(model.kind[held] is CardKind.TRUMP for held in later):
                return False
    return True


def _options(ctx: _Context) -> list[tuple[_Model, str | None, str | None]]:
    """Call hypotheses with their implied original bottoms; one entry once a call is received."""
    memory, profile = ctx.memory, ctx.snap.profile
    if memory.strike is not None and memory.suit is not None:
        return [(ctx.model(memory.strike, memory.suit), None, None)]
    checked: dict[tuple[str, str], bool] = {}

    def plausible(strike: str, suit: str) -> bool:
        if (memory.strike or strike) != strike or (memory.suit or suit) != suit:
            return False
        if (strike, suit) not in checked:
            checked[strike, suit] = _consistent(ctx, ctx.model(strike, suit))
        return checked[strike, suit]

    options = []
    if profile.determination == "ladinisch":
        striker, colourer = ctx.roles.strike_announcer, ctx.roles.suit_announcer
        thanks = set(memory.thanks)
        colour_cards = _origin_candidates(ctx, colourer)
        for strike_card in _origin_candidates(ctx, striker):
            for colour_card in colour_cards:
                if strike_card == colour_card:
                    continue
                call = call_from_bottoms(strike_card, colour_card)
                if not plausible(*call):
                    continue
                model = ctx.model(*call)
                # Public Danke follows exactly the shown cards; in blind play its absence counts too.
                if profile.blind and ((striker in thanks) != (model.kind[strike_card] is CardKind.RECHTER)
                                      or (colourer in thanks) != (model.kind[colour_card] is CardKind.RECHTER)):
                    continue
                options.append((model, strike_card, colour_card))
    else:
        for strike in STRIKES:
            if strike == WELI_STRIKE and profile.critical:
                continue
            options.extend((ctx.model(strike, suit), None, None) for suit in WATTEN_SUITS if plausible(strike, suit))
    if not options:
        raise WattenCpuError("watten_cpu_inconsistent_knowledge")
    return options


def _own_legal(ctx: _Context, options: list) -> tuple[str, ...]:
    if ctx.seat not in ctx.knowers:
        return ctx.hand
    trick_cards = [card for _, card in ctx.trick]
    models = {model.call: model for model, _, _ in options}.values()
    allowed = [set(model.allowed(ctx.hand, trick_cards, True)) for model in models]
    # A bound seat that lacks a received call plays only cards legal under every hypothesis.
    legal = tuple(card for card in ctx.hand if all(card in cards for cards in allowed))
    if not legal:
        raise WattenCpuError("watten_cpu_call_unknown")
    return legal


def _sample(ctx: _Context, option: tuple, stream: _Stream) -> tuple[_Model, tuple[tuple[str, ...], ...]] | None:
    model, strike_card, colour_card = option
    fixed: dict[int, set[str]] = {seat: set() for seat in range(ctx.count) if seat not in ctx.known}
    origins = (ctx.roles.strike_announcer, ctx.roles.suit_announcer)
    for cards in (ctx.memory.inspected, (strike_card, colour_card)):
        for card, origin in zip(cards or (), origins):
            if card is not None and origin in fixed and card not in ctx.seen:
                fixed[origin].add(card)
    placed = set().union(*fixed.values())
    pool = [card for card in _DECK if card not in ctx.seen and card not in placed]
    stream.shuffle(pool)
    hands: list[tuple[str, ...]] = [() for _ in range(ctx.count)]
    for seat, cards in ctx.known.items():
        hands[seat] = tuple(cards)
    start = 0
    for seat in sorted(fixed):
        need = ctx.snap.card_counts[seat] - len(fixed[seat])
        if need < 0 or start + need > len(pool):
            return None
        hands[seat] = (*sorted(fixed[seat]), *pool[start:start + need])
        start += need
    for trick, positions in ctx.tricks.items():
        lead = positions.get(0)
        if lead is None or model.kind[lead[1]] not in _DUTY_LEADS:
            continue
        for position, (seat, card) in positions.items():
            if position and seat in fixed and seat in ctx.knowers and model.kind[card] is CardKind.NORMAL:
                held = [*hands[seat], *(later for played, later in ctx.played_by[seat] if played > trick)]
                if any(model.kind[item] is CardKind.TRUMP for item in held):
                    return None
    return model, tuple(hands)


def _worlds(ctx: _Context, options: list, stream: _Stream, samples: int) -> list:
    worlds = []
    for _ in range(samples * ATTEMPTS_PER_SAMPLE):
        if len(worlds) == samples:
            break
        world = _sample(ctx, options[stream.below(len(options))], stream)
        if world is not None:
            worlds.append(world)
    return worlds


def _simulated_card(model: _Model, seat: int, hands: list[list[str]], trick: list[tuple[int, str]],
                    ctx: _Context) -> str:
    """Simple sensible play for every seat inside one hypothetical world."""
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


def _rollout(ctx: _Context, world: tuple, first: str | None) -> int:
    model, start = world
    hands = [list(hand) for hand in start]
    trick, leader, won = list(ctx.trick), ctx.leader, list(ctx.snap.party_tricks)
    while True:
        seat = (leader + len(trick)) % ctx.count
        if first is not None and seat == ctx.seat:
            card, first = first, None
        elif not hands[seat]:
            return 0
        else:
            card = _simulated_card(model, seat, hands, trick, ctx)
        hands[seat].remove(card)
        trick.append((seat, card))
        if len(trick) == ctx.count:
            winner = trick[model.winner([played for _, played in trick])][0]
            party = ctx.parties[winner]
            won[party] += 1
            if won[party] >= TRICKS_TO_WIN:
                return int(party == ctx.my_party)
            leader, trick = winner, []


def _win_chance(ctx: _Context, stream: _Stream, budget: CpuBudget) -> float:
    worlds = _worlds(ctx, _options(ctx), stream, budget.samples)
    if not worlds:
        return 0.5
    return sum(_rollout(ctx, world, None) for world in worlds) / len(worlds)


def _needs(ctx: _Context) -> tuple[int, int]:
    snap = ctx.snap
    mine = next(points for members, points in snap.scores if snap.player_id in members)
    rivals = {snap.players[seat] for seat in range(ctx.count) if ctx.parties[seat] != ctx.my_party}
    theirs = max(points for members, points in snap.scores if rivals & set(members))
    return snap.target_points - mine, snap.target_points - theirs


def _response(ctx: _Context, win: float) -> str:
    """Score-aware hold/go/counter for the designated decider; gestrichen never matters here."""
    ours, theirs = _needs(ctx)
    accepted, offered = ctx.snap.accepted_stake, ctx.snap.pending[1]
    shift = {"good": FEEDBACK_SHIFT, "bad": -FEEDBACK_SHIFT}.get(ctx.snap.partner_feedback, 0.0)
    win = min(1.0, max(0.0, win * BID_SIGNAL + shift))
    go = _equity(ours, theirs - accepted)
    hold = _stake_value(ours, theirs, win, offered)
    counter = _raise_value(ours, theirs, win, offered)
    choice, value = ("go", go) if go > hold else ("hold", hold)
    if offered >= max(ours, theirs):
        return choice
    return "counter" if counter > value + COUNTER_MARGIN else choice


def _raise_value(ours: int, theirs: int, win: float, accepted: int) -> float:
    # Opponents fold more often the stronger we are; a weak raise is simply held.
    # An opponent's fold would award us the locked stake. Once it wins our
    # match, a fictitious fold bonus must not reward unlimited counterbids.
    fold = OPPONENT_FOLD * win if accepted < ours else 0.0
    return fold * _equity(ours - accepted, theirs) + (1 - fold) * _stake_value(ours, theirs, win, accepted + 1)


def _should_bid(ctx: _Context, win: float) -> bool:
    if win < BID_MIN_WIN:
        return False
    ours, theirs = _needs(ctx)
    stake = ctx.snap.accepted_stake
    return _raise_value(ours, theirs, win, stake) > _stake_value(ours, theirs, win, stake) + BID_MARGIN


def _hand_score(hand: tuple[str, ...], model: _Model) -> float:
    total = 0.0
    for card in hand:
        kind = model.kind[card]
        if kind is CardKind.CRITICAL:
            total += _CRITICAL_SCORE[card]
        elif kind in _KIND_SCORE:
            total += _KIND_SCORE[kind]
        elif kind is CardKind.TRUMP:
            total += 3.0 + model.base[card][1] / 8
        else:
            total += _NORMAL_SCORE.get(card_rank(card), 0.0)
    return total


def _visible_hand(ctx: _Context) -> tuple[str, ...]:
    if ctx.snap.hand is None:
        raise WattenCpuError("watten_cpu_hand_hidden")
    return ctx.snap.hand


def _choose_strike(ctx: _Context) -> str:
    hand = _visible_hand(ctx)
    strikes = [strike for strike in STRIKES if not (strike == WELI_STRIKE and ctx.critical)]
    if ctx.roles.suit_announcer == ctx.seat:
        # Three-player solo names both; the colour step recomputes the same first maximum.
        calls = [(strike, suit) for strike in strikes for suit in WATTEN_SUITS]
        return max(calls, key=lambda call: _hand_score(hand, ctx.model(*call)))[0]
    return max(strikes, key=lambda strike: sum(_hand_score(hand, ctx.model(strike, suit)) for suit in WATTEN_SUITS))


def _choose_colour(ctx: _Context) -> str:
    hand, strike = _visible_hand(ctx), ctx.memory.strike
    if strike is None:
        raise WattenCpuError("watten_cpu_strike_unknown")
    return max(WATTEN_SUITS, key=lambda suit: _hand_score(hand, ctx.model(strike, suit)))


def _conserve_hopeless(ctx: _Context, legal: tuple[str, ...], options: list) -> tuple[str, ...]:
    """Keep strength when no legal card can beat the already public winner.

    Certainty uses every call consistent with permitted observations, including
    hypotheses not drawn in a small rollout sample. Hidden real cards play no role.
    """
    if not ctx.trick or len(legal) < 2:
        return legal
    models = tuple(dict.fromkeys(model for model, *_ in options))
    cards = [card for _, card in ctx.trick]
    for model in models:
        strongest = model.strength(cards[model.winner(cards)], cards[0])
        if any(model.strength(card, cards[0]) > strongest for card in legal):
            return legal
    cheapest = min(legal, key=lambda card: (sum(model.order[card] for model in models), card))
    return (cheapest,)


def _choose(ctx: _Context, seed: int, budget: CpuBudget) -> CpuProposal | CpuWait:
    snap, actions = ctx.snap, ctx.snap.actions

    def propose(kind: str, value: str | None = None, private: int | None = None) -> CpuProposal:
        return CpuProposal(snap.player_id, snap.deal_id, snap.opportunity, snap.phase, kind, value, private)

    if snap.finished:
        return CpuWait(snap.deal_id, snap.opportunity, snap.phase, "watten_cpu_deal_finished")
    if "announce_strike" in actions:
        return propose("announce_strike", _choose_strike(ctx))
    if "announce_colour" in actions:
        return propose("announce_colour", _choose_colour(ctx))
    if "show_ready" in actions:
        return propose("show_ready")
    if "inspection_ack" in actions:
        if ctx.memory.inspected is None:
            raise WattenCpuError("watten_cpu_inspection_not_consumed")
        return propose("inspection_ack")
    stream = _Stream(["watten-cpu-v1", seed, snap.player_id, snap.deal_id, snap.opportunity, snap.phase])
    if snap.phase == "bid_response":
        # A pending bid blocks every card; only the designated decider answers.
        if _RESPONSE_ACTIONS & set(actions):
            return propose("respond", _response(ctx, _win_chance(ctx, stream, budget)))
        decider = snap.players.index(snap.pending[2])
        if "partner_feedback" in actions and decider == snap.partner_seat:
            value = _feedback(_win_chance(ctx, stream, budget))
            if value != snap.own_feedback:
                return propose("partner_feedback", value, snap.feedback_opportunity)
    elif "play_card" in actions:
        options = _options(ctx)
        legal = _conserve_hopeless(ctx, _own_legal(ctx, options), options)
        may_bid = "bid" in actions
        if len(legal) == 1 and not may_bid:
            return propose("play_card", legal[0])
        worlds = _worlds(ctx, options, stream, budget.samples)
        models = [world[0] for world in worlds] or [option[0] for option in options]
        scores = {card: (sum(_rollout(ctx, world, card) for world in worlds) / len(worlds) if worlds else 0.5)
                  for card in legal}
        best = max(scores.values())
        # Ties conserve strength: the cheapest card across the sampled hypotheses.
        card = min((card for card in legal if scores[card] == best),
                   key=lambda card: (sum(model.order[card] for model in models), card))
        if may_bid and worlds and _should_bid(ctx, best):
            return propose("bid")
        return propose("play_card", card)
    return CpuWait(snap.deal_id, snap.opportunity, snap.phase, "watten_cpu_waiting")


def _feedback(win: float) -> str:
    return "good" if win >= GOOD_FEEDBACK else "bad" if win <= BAD_FEEDBACK else "unsure"


def _prepare(view: object, memory: CpuMemory, events: tuple) -> _Context:
    if not isinstance(memory, CpuMemory):
        raise WattenCpuError("watten_cpu_invalid_memory")
    snap = read_personal_view(view, player_id=memory.player_id)
    return _Context(snap, remember(memory, snap, events))


def decide(view: object, memory: CpuMemory, *, seed: int, events: tuple = (),
           budget: CpuBudget = CpuBudget()) -> CpuTurn:
    """One bounded decision from the CPU's own DTO; identical inputs give identical output."""
    if type(seed) is not int or not isinstance(budget, CpuBudget):
        raise WattenCpuError("watten_cpu_invalid_seed")
    ctx = _prepare(view, memory, events)
    return CpuTurn(ctx.memory, _choose(ctx, seed, budget))


def call_hypotheses(view: object, memory: CpuMemory) -> tuple[tuple[str, str], ...]:
    """Server-private diagnostic: calls still consistent with this seat's knowledge."""
    ctx = _prepare(view, memory, ())
    return tuple(sorted({(model.call.strike_rank, model.call.trump_suit) for model, _, _ in _options(ctx)}))


def own_legal_cards(view: object, memory: CpuMemory) -> tuple[str, ...]:
    """Cards this seat can prove legal now from its own knowledge; empty off its card turn."""
    ctx = _prepare(view, memory, ())
    if ctx.snap.phase != "play" or "play_card" not in ctx.snap.actions:
        return ()
    return _own_legal(ctx, _options(ctx))
