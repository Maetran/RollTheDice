"""Pure confirmed card comparisons and announcement roles; no playable profile.

Owner decisions: docs/WATTEN_OWNER_DECISIONS.md (18 October 2026). Equal ordinary
strikes retain the first played card; otherwise ordinary cards follow the led
suit, following source W02's card-value section:
https://www.tiroler-wattergemeinschaft.at/ladinisch-watten/ . W02's optional
Guter, bidding and trump-duty profile are not imported.

These functions do not decide trump duties, legal moves, hidden projections,
bidding, last-trick timing or a round/game winner. Unresolved card-order
combinations fail explicitly and cannot silently become a runtime profile.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Final

from .watten_cards import (
    WATTEN_NORMAL_RANKS,
    WATTEN_SUITS,
    WELI,
    DealtCards,
    card_rank,
    card_suit,
    validate_card,
    validate_seat,
)

WELI_STRIKE: Final = "weli"
CRITICAL_CARDS: Final = ("hearts-K", WELI, "acorns-7")
_NORMAL_POWER: Final = {rank: index for index, rank in enumerate(WATTEN_NORMAL_RANKS)}


class WattenRuleError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class WattenRuleUnready(WattenRuleError):
    """A real pending owner decision, rather than an invented rule default."""


@dataclass(frozen=True, slots=True)
class WattenCall:
    strike_rank: str
    trump_suit: str

    def __post_init__(self) -> None:
        if not isinstance(self.strike_rank, str) or self.strike_rank not in (*WATTEN_NORMAL_RANKS, WELI_STRIKE):
            raise WattenRuleError("watten_invalid_strike")
        if not isinstance(self.trump_suit, str) or self.trump_suit not in WATTEN_SUITS:
            raise WattenRuleError("watten_invalid_trump_suit")


@dataclass(frozen=True, slots=True)
class ComparisonRules:
    """Card-order inputs only: successful construction does not approve a game.

    Guter is unready. Confirmed critical cards keep their critical precedence
    even when they match a strike or the would-be Rechter; there is no invented
    replacement Rechter. This includes a Weli strike derived in blind Ladinisch.
    Comparing a call does not authorize freely announcing it or decide duties.
    """

    call: WattenCall
    critical: bool = False
    guter: bool = False

    def __post_init__(self) -> None:
        if not isinstance(self.call, WattenCall):
            raise WattenRuleError("watten_invalid_call")
        if type(self.critical) is not bool or type(self.guter) is not bool:
            raise WattenRuleError("watten_invalid_card_options")
        if self.guter:
            raise WattenRuleUnready("watten_guter_rules_unconfirmed")


@dataclass(frozen=True, slots=True)
class RoundRoles:
    dealer: int
    clockwise_next: int
    strike_announcer: int
    suit_announcer: int
    first_player: int
    next_dealer: int
    solo_seat: int | None


def round_roles(player_count: int, dealer: int, *, determination: str) -> RoundRoles:
    """Return confirmed roles in an explicitly clockwise seat ring.

    This is neither a team assignment nor a knowledge/inspection permission.
    Three-player normal play has one solo announcing both values. Ladinisch is
    confirmed for two and four players only; the third player is not guessed.
    """
    validate_seat(dealer, player_count)
    if not isinstance(determination, str) or determination not in {"normal", "ladinisch"}:
        raise WattenRuleError("watten_invalid_determination")
    if player_count == 3 and determination == "ladinisch":
        raise WattenRuleUnready("watten_three_player_ladinisch_unconfirmed")
    next_seat = (dealer + 1) % player_count
    return RoundRoles(
        dealer=dealer,
        clockwise_next=next_seat,
        strike_announcer=next_seat,
        suit_announcer=next_seat if player_count == 3 else dealer,
        first_player=next_seat,
        next_dealer=next_seat,
        solo_seat=next_seat if player_count == 3 else None,
    )


def ladinisch_call(deal: DealtCards, *, dealer: int) -> WattenCall:
    """Use frozen original bottom cards, never a subsequently sorted hand view."""
    if not isinstance(deal, DealtCards):
        raise WattenRuleError("watten_invalid_deal")
    roles = round_roles(len(deal.hands), dealer, determination="ladinisch")
    strike_card = deal.bottom_cards[roles.strike_announcer]
    suit_card = deal.bottom_cards[roles.suit_announcer]
    return WattenCall(
        strike_rank=WELI_STRIKE if strike_card == WELI else card_rank(strike_card),
        trump_suit=card_suit(suit_card),
    )


class CardKind(StrEnum):
    CRITICAL = "critical"
    RECHTER = "rechter"
    STRIKE = "strike"
    TRUMP = "trump"
    NORMAL = "normal"


def card_kind(card: str, rules: ComparisonRules) -> CardKind:
    validate_card(card)
    if not isinstance(rules, ComparisonRules):
        raise WattenRuleError("watten_invalid_comparison_rules")
    if rules.critical and card in CRITICAL_CARDS:
        return CardKind.CRITICAL
    if rules.call.strike_rank == WELI_STRIKE:
        if card == WELI:
            return CardKind.RECHTER
    elif card_rank(card) == rules.call.strike_rank:
        return CardKind.RECHTER if card_suit(card) == rules.call.trump_suit else CardKind.STRIKE
    if card == WELI or card_suit(card) == rules.call.trump_suit:
        return CardKind.TRUMP
    return CardKind.NORMAL


def effective_suit(card: str, call: WattenCall) -> str:
    validate_card(card)
    if not isinstance(call, WattenCall):
        raise WattenRuleError("watten_invalid_call")
    return call.trump_suit if card == WELI else card_suit(card)


def is_protected_card(card: str, rules: ComparisonRules) -> bool:
    """Identify confirmed exceptions, without implementing an unresolved duty."""
    return card_kind(card, rules) in {CardKind.CRITICAL, CardKind.RECHTER}


@dataclass(frozen=True, slots=True)
class LadinischRevealEvent:
    """Owner-approved public bubble, with no card or secret-call payload.

    The runtime must associate this fact with its round/opportunity and persist
    delivery once. Calling a pure derivation twice does not authorize re-peeking.
    """

    seat: int
    message_key: str = "watten_thanks"


def ladinisch_reveal_events(
    deal: DealtCards, *, dealer: int, rules: ComparisonRules, blind: bool,
) -> tuple[LadinischRevealEvent, ...]:
    """In blind Ladinisch emit thanks only for an actual shown Rechter.

    A Rechter elsewhere in a private hand cannot cause this public event. This
    is derived from the owner's explicit reveal exception, not general permission
    to disclose bottom cards, hidden hands, strike or trump.
    """
    call = ladinisch_call(deal, dealer=dealer)
    if not isinstance(rules, ComparisonRules) or rules.call != call:
        raise WattenRuleError("watten_reveal_call_mismatch")
    if type(blind) is not bool:
        raise WattenRuleError("watten_invalid_blind_option")
    if not blind:
        return ()
    if len(deal.hands) != 4:
        raise WattenRuleUnready("watten_blind_requires_four_players")
    roles = round_roles(len(deal.hands), dealer, determination="ladinisch")
    return tuple(
        LadinischRevealEvent(seat=seat)
        for seat in (roles.dealer, roles.clockwise_next)
        if card_kind(deal.bottom_cards[seat], rules) == CardKind.RECHTER
    )


def card_strength(card: str, *, led_card: str, rules: ComparisonRules) -> tuple[int, int]:
    """Contextual comparison key, never a legal-move or blind-player hint."""
    validate_card(led_card)
    kind = card_kind(card, rules)
    if kind == CardKind.CRITICAL:
        return 4, len(CRITICAL_CARDS) - CRITICAL_CARDS.index(card)
    if kind == CardKind.RECHTER:
        return 3, 0
    if kind == CardKind.STRIKE:
        return 2, 0
    if kind == CardKind.TRUMP:
        return 1, -1 if card == WELI else _NORMAL_POWER[card_rank(card)]
    if effective_suit(card, rules.call) == effective_suit(led_card, rules.call):
        return 0, _NORMAL_POWER[card_rank(card)]
    return -1, 0


def trick_winner(cards: Sequence[str], *, rules: ComparisonRules) -> int:
    """Winning index in a nonempty, ordered partial/full trick of at most four.

    Input order is play order. Strictly greater keys replace the incumbent, so
    equal ordinary strikes preserve W02's first-played winner. No round-end or
    legal-play conclusion is made, even when the caller supplies four cards.
    """
    if isinstance(cards, (str, bytes)) or not isinstance(cards, Sequence) or not 1 <= len(cards) <= 4:
        raise WattenRuleError("watten_invalid_trick")
    played = tuple(validate_card(card) for card in cards)
    if len(set(played)) != len(played):
        raise WattenRuleError("watten_duplicate_trick_card")
    return max(range(len(played)), key=lambda index: card_strength(played[index], led_card=played[0], rules=rules))
