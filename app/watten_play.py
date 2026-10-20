"""Pure, immutable Watten card and trick transitions after a completed call.

Owner decisions: docs/WATTEN_OWNER_DECISIONS.md (18 October 2026). Only
officially informed seats must follow trump: every seat in open play, exactly
the dealer and the clockwise successor in blind Ladinisch. Inferred knowledge
never adds a duty. An ordinary trump or the Rechter as first trick card
triggers it; a critical card never does, even on a printed trump suit or a
would-be Rechter. A bound player holding ordinary trump may play trump, the
Rechter, a critical card or an ordinary strike that takes the current trick.
Trump, Rechter and critical cards need not win; protected cards are never
forced. A later critical overtrick keeps a triggered duty. The third trick won
by a party ends the deal at once; points stay in watten_bidding.

No inspection phases, commands, projections or persistence live here. A
PlayState holds every hidden hand and the secret call: never serialize it to
a participant or a CPU. Allowlist projections follow separately.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Final

from .watten_bidding import (
    BidState,
    DealParties,
    DealProgress,
    WattenBiddingError,
    finish_deal_from_trusted_engine,
    require_gameplay_allowed,
)
from .watten_cards import DealtCards
from .watten_rules import (
    WELI_STRIKE,
    CardKind,
    ComparisonRules,
    WattenCall,
    card_kind,
    ladinisch_call,
    round_roles,
    trick_winner,
)

TRICKS_TO_WIN: Final = 3
_DUTY_LEADS: Final = frozenset({CardKind.TRUMP, CardKind.RECHTER})


class WattenPlayError(ValueError):
    """A stable rejection reason; the previous immutable state stays valid."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


@dataclass(frozen=True, slots=True)
class PlayProfile:
    """Confirmed play profiles only; Guter/Schlechter are not representable.

    Two players are always open, three are open with a normal call, and blind
    play requires four players with Ladinisch determination.
    """

    player_count: int
    determination: str
    blind: bool
    critical: bool

    def __post_init__(self) -> None:
        if type(self.player_count) is not int or self.player_count not in {2, 3, 4}:
            raise WattenPlayError("watten_invalid_profile")
        if not isinstance(self.determination, str) or self.determination not in {"normal", "ladinisch"}:
            raise WattenPlayError("watten_invalid_profile")
        if type(self.blind) is not bool or type(self.critical) is not bool:
            raise WattenPlayError("watten_invalid_profile")
        if self.player_count == 3 and self.determination != "normal":
            raise WattenPlayError("watten_three_player_requires_normal")
        if self.blind and (self.player_count != 4 or self.determination != "ladinisch"):
            raise WattenPlayError("watten_blind_requires_four_player_ladinisch")


def official_knower_seats(profile: PlayProfile, dealer: int) -> frozenset[int]:
    """Card seat indices that officially know strike and trump, hence follow trump."""
    if not isinstance(profile, PlayProfile):
        raise WattenPlayError("watten_invalid_profile")
    roles = round_roles(profile.player_count, dealer, determination=profile.determination)
    if profile.blind:
        return frozenset((roles.dealer, roles.clockwise_next))
    return frozenset(range(profile.player_count))


def _allowed_cards(hand: tuple[str, ...], trick: tuple[str, ...], *, bound: bool,
                   rules: ComparisonRules) -> tuple[str, ...]:
    if not trick or not bound or card_kind(trick[0], rules) not in _DUTY_LEADS:
        return hand
    if not any(card_kind(card, rules) == CardKind.TRUMP for card in hand):
        return hand
    # A plain strike substitutes for following trump only by actually taking
    # this trick. Trump, Rechter and critical cards have no overtrumping duty.
    return tuple(card for card in hand if (kind := card_kind(card, rules)) != CardKind.NORMAL
                 and (kind != CardKind.STRIKE or trick_winner((*trick, card), rules=rules) == len(trick)))


@dataclass(frozen=True, slots=True)
class CompletedTrick:
    """Cards in play order; leader and winner are card seat indices, not IDs."""

    leader: int
    cards: tuple[str, ...]
    winner: int


@dataclass(frozen=True, slots=True, repr=False)
class PlayState:
    """Server-internal card play, derived and checked by replaying ``plays``.

    Hand index i of ``deal`` belongs to participant ``parties.seats[i]``: both
    describe the same clockwise ring. ``party_tricks`` follows the index order
    of ``parties.parties``. Reconstructing from persisted plays rejects every
    history this module would not have accepted step by step.
    """

    deal_id: str
    deal: DealtCards
    parties: DealParties
    profile: PlayProfile
    call: WattenCall
    plays: tuple[str, ...] = ()
    forced_opening: tuple[tuple[int, str], ...] = ()
    hands: tuple[tuple[str, ...], ...] = field(init=False)
    tricks: tuple[CompletedTrick, ...] = field(init=False)
    trick_leader: int = field(init=False)
    trick_cards: tuple[str, ...] = field(init=False)
    party_tricks: tuple[int, int] = field(init=False)
    winning_party: int | None = field(init=False)

    def __post_init__(self) -> None:
        if type(self.deal_id) is not str or not self.deal_id.strip():
            raise WattenPlayError("watten_invalid_play_state")
        if (not isinstance(self.deal, DealtCards) or not isinstance(self.parties, DealParties)
                or not isinstance(self.profile, PlayProfile) or not isinstance(self.call, WattenCall)):
            raise WattenPlayError("watten_invalid_play_state")
        count = self.profile.player_count
        if not len(self.deal.hands) == len(self.parties.seats) == count:
            raise WattenPlayError("watten_player_count_mismatch")
        if self.profile.determination == "ladinisch":
            if self.call != ladinisch_call(self.deal, dealer=self.dealer_seat):
                raise WattenPlayError("watten_call_mismatch")
        elif self.profile.critical and self.call.strike_rank == WELI_STRIKE:
            # Chosen Tiroler critical profile; a Ladinisch-forced Weli strike stays allowed.
            raise WattenPlayError("watten_free_weli_strike_with_critical")
        if type(self.plays) is not tuple or not all(type(card) is str for card in self.plays):
            raise WattenPlayError("watten_invalid_play_history")
        if (type(self.forced_opening) is not tuple or (self.forced_opening and (
                count != 4 or not self.profile.blind
                or self.forced_opening != tuple((seat, self.deal.bottom_cards[seat]) for seat in range(count)
                                                if seat not in self.knower_seats)))):
            raise WattenPlayError("watten_invalid_forced_opening")
        rules, knowers = self.rules, self.knower_seats
        hands = [list(hand) for hand in self.deal.hands]
        leader = round_roles(count, self.dealer_seat, determination=self.profile.determination).first_player
        trick: list[str] = []
        tricks: list[CompletedTrick] = []
        won = [0, 0]
        winning_party = None
        for card in self.plays:
            seat = (leader + len(trick)) % count
            forced = dict(self.forced_opening).get(seat) if not tricks else None
            if winning_party is not None or card not in _allowed_cards(
                    tuple(hands[seat]), tuple(trick), bound=seat in knowers, rules=rules) or (forced and card != forced):
                raise WattenPlayError("watten_invalid_play_history")
            hands[seat].remove(card)
            trick.append(card)
            if len(trick) == count:
                winner = (leader + trick_winner(trick, rules=rules)) % count
                tricks.append(CompletedTrick(leader, tuple(trick), winner))
                party = self.parties.party_of(self.parties.seats[winner])
                won[party] += 1
                if won[party] == TRICKS_TO_WIN:
                    winning_party = party
                leader, trick = winner, []
        object.__setattr__(self, "hands", tuple(tuple(hand) for hand in hands))
        object.__setattr__(self, "tricks", tuple(tricks))
        object.__setattr__(self, "trick_leader", leader)
        object.__setattr__(self, "trick_cards", tuple(trick))
        object.__setattr__(self, "party_tricks", (won[0], won[1]))
        object.__setattr__(self, "winning_party", winning_party)

    def __repr__(self) -> str:
        # Keep hidden hands and the secret call out of logs and diagnostics.
        return f"PlayState(deal_id={self.deal_id!r}, cards_played={len(self.plays)}, ended={self.ended})"

    @property
    def dealer_seat(self) -> int:
        return self.parties.seats.index(self.parties.dealer_id)

    @property
    def rules(self) -> ComparisonRules:
        return ComparisonRules(self.call, critical=self.profile.critical)

    @property
    def knower_seats(self) -> frozenset[int]:
        return official_knower_seats(self.profile, self.dealer_seat)

    @property
    def ended(self) -> bool:
        return self.winning_party is not None

    @property
    def current_seat(self) -> int | None:
        if self.ended:
            return None
        return (self.trick_leader + len(self.trick_cards)) % self.profile.player_count

    @property
    def current_player_id(self) -> str | None:
        seat = self.current_seat
        return None if seat is None else self.parties.seats[seat]


def start_play(deal_id: str, deal: DealtCards, parties: DealParties, profile: PlayProfile, *,
               call: WattenCall | None = None, forced_opening: tuple[tuple[int, str], ...] = ()) -> PlayState:
    """Open card play after the completed call, with no card played yet.

    A normal call is the completed announcement. Ladinisch derives the call
    from the frozen original bottom cards; a supplied call must match it.
    """
    if (not isinstance(deal, DealtCards) or not isinstance(parties, DealParties)
            or not isinstance(profile, PlayProfile)):
        raise WattenPlayError("watten_invalid_play_state")
    if not len(deal.hands) == len(parties.seats) == profile.player_count:
        raise WattenPlayError("watten_player_count_mismatch")
    if profile.determination == "ladinisch":
        derived = ladinisch_call(deal, dealer=parties.seats.index(parties.dealer_id))
        if call is not None and call != derived:
            raise WattenPlayError("watten_call_mismatch")
        call = derived
    elif call is None:
        raise WattenPlayError("watten_call_required")
    return PlayState(deal_id, deal, parties, profile, call, forced_opening=forced_opening)


def _require_bid_context(state: PlayState, bid_state: BidState) -> None:
    if not isinstance(state, PlayState):
        raise WattenPlayError("watten_invalid_play_state")
    if not isinstance(bid_state, BidState):
        raise WattenPlayError("watten_invalid_bid_state")
    if bid_state.deal_id != state.deal_id or bid_state.roles != state.parties:
        raise WattenPlayError("watten_bid_state_mismatch")


def legal_cards(state: PlayState, bid_state: BidState, player_id: str) -> tuple[str, ...]:
    """Cards this participant may play now; empty outside their card opportunity.

    The result depends only on the seat's own hand, the public trick and
    knowledge the seat officially holds, so a blind non-inspector receives its
    whole hand. It is still internal data, not a display projection.
    """
    _require_bid_context(state, bid_state)
    if state.ended or bid_state.gameplay_frozen or player_id != state.current_player_id:
        return ()
    seat = state.current_seat
    forced = dict(state.forced_opening).get(seat) if not state.tricks else None
    if forced is not None:
        return (forced,)
    return _allowed_cards(state.hands[seat], state.trick_cards, bound=seat in state.knower_seats, rules=state.rules)


def play_card(state: PlayState, bid_state: BidState, player_id: str, card: str) -> PlayState:
    """Accept one own card on the participant's own turn, or raise unchanged.

    ``player_id`` is the server-authenticated participant, never a card seat
    index or a client claim. An open bid freezes every card action.
    """
    _require_bid_context(state, bid_state)
    if state.ended:
        raise WattenPlayError("watten_deal_finished")
    try:
        require_gameplay_allowed(bid_state)
    except WattenBiddingError as exc:
        raise WattenPlayError(exc.args[0]) from exc
    if player_id != state.current_player_id:
        raise WattenPlayError("watten_not_your_turn")
    if not isinstance(card, str) or card not in state.hands[state.current_seat]:
        raise WattenPlayError("watten_card_not_in_hand")
    if card not in legal_cards(state, bid_state, player_id):
        raise WattenPlayError("watten_trump_required")
    return replace(state, plays=(*state.plays, card))


def deal_progress(state: PlayState) -> DealProgress:
    """Engine-confirmed turn, card count and end for watten_bidding."""
    if not isinstance(state, PlayState):
        raise WattenPlayError("watten_invalid_play_state")
    return DealProgress(state.current_player_id, len(state.plays), state.ended)


def finish_deal(state: PlayState, bid_state: BidState) -> BidState:
    """Hand the trusted third-trick result once to the existing score transition."""
    _require_bid_context(state, bid_state)
    if not state.ended:
        raise WattenPlayError("watten_deal_not_finished")
    try:
        return finish_deal_from_trusted_engine(bid_state, state.winning_party, deal_progress(state))
    except WattenBiddingError as exc:
        raise WattenPlayError(exc.args[0]) from exc
