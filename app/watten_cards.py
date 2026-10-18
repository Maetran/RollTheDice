"""Validated, immutable Watten cards and initial deals, without runtime state.

The owner's 33-card basis uses the existing Hausdepp artwork IDs, but its own
rank order. Deck index zero is the next card to deal. A caller must supply the
recipient schedule: neither a packet order nor a shuffle is invented here.
Original bottom cards are captured before any presentation sorting.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final

WATTEN_SUITS: Final = ("hearts", "bells", "leaves", "acorns")
WATTEN_NORMAL_RANKS: Final = ("7", "8", "9", "10", "U", "O", "K", "A")
WELI: Final = "bells-6"
CARDS_PER_HAND: Final = 5
_DECK: Final = tuple(f"{suit}-{rank}" for suit in WATTEN_SUITS for rank in WATTEN_NORMAL_RANKS) + (WELI,)
_CARD_SET: Final = frozenset(_DECK)


class WattenCardError(ValueError):
    """A stable validation reason; no player or transport state is changed."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def validate_card(card: str) -> str:
    if not isinstance(card, str) or card not in _CARD_SET:
        raise WattenCardError("watten_invalid_card")
    return card


def card_rank(card: str) -> str:
    """Return the printed rank; Weli has printed rank 6, not a second six."""
    return validate_card(card).rsplit("-", 1)[1]


def card_suit(card: str) -> str:
    """Return the printed suit; Weli's effective trump suit is a rule concern."""
    return validate_card(card).rsplit("-", 1)[0]


def make_deck() -> tuple[str, ...]:
    return _DECK


def validate_player_count(player_count: int) -> int:
    if type(player_count) is not int or player_count not in {2, 3, 4}:
        raise WattenCardError("watten_invalid_player_count")
    return player_count


def validate_seat(seat: int, player_count: int) -> int:
    validate_player_count(player_count)
    if type(seat) is not int or not 0 <= seat < player_count:
        raise WattenCardError("watten_invalid_seat")
    return seat


def _card_sequence(cards: Sequence[str]) -> tuple[str, ...]:
    if isinstance(cards, (str, bytes)) or not isinstance(cards, Sequence):
        raise WattenCardError("watten_invalid_card_sequence")
    return tuple(validate_card(card) for card in cards)


@dataclass(frozen=True, slots=True)
class DealtCards:
    """An initial deal, not mutable hands or an authorization projection.

    Seat indices describe a caller-owned clockwise seat order. The whole deal
    includes hidden hands and stock; never send it to a participant or a CPU.
    """

    hands: tuple[tuple[str, ...], ...]
    stock: tuple[str, ...]
    bottom_cards: tuple[str, ...]

    def __post_init__(self) -> None:
        if isinstance(self.hands, (str, bytes)) or not isinstance(self.hands, Sequence):
            raise WattenCardError("watten_invalid_hands")
        hands = tuple(_card_sequence(hand) for hand in self.hands)
        validate_player_count(len(hands))
        if any(len(hand) != CARDS_PER_HAND for hand in hands):
            raise WattenCardError("watten_invalid_hand_size")
        stock = _card_sequence(self.stock)
        bottom_cards = _card_sequence(self.bottom_cards)
        all_cards = tuple(card for hand in hands for card in hand) + stock
        if len(all_cards) != len(_DECK) or frozenset(all_cards) != _CARD_SET:
            raise WattenCardError("watten_invalid_deck")
        if bottom_cards != tuple(hand[-1] for hand in hands):
            raise WattenCardError("watten_invalid_bottom_cards")
        # Defensively freeze caller-owned lists as well as the declared tuples.
        object.__setattr__(self, "hands", hands)
        object.__setattr__(self, "stock", stock)
        object.__setattr__(self, "bottom_cards", bottom_cards)


def deal_cards(
    deck: Sequence[str], *, player_count: int, recipient_order: Sequence[int],
) -> DealtCards:
    """Consume a full preordered deck according to an explicit deal schedule.

    Each schedule entry appends the next card from deck index zero to that
    seat's ordered hand (top first, original bottom last). The caller owns
    packet/stacking policy. Every seat must occur exactly five times. Inputs
    remain untouched, and stock retains its order. No random roles or teams.
    """
    validate_player_count(player_count)
    cards = _card_sequence(deck)
    if len(cards) != len(_DECK) or frozenset(cards) != _CARD_SET:
        raise WattenCardError("watten_invalid_deck")
    if isinstance(recipient_order, (str, bytes)) or not isinstance(recipient_order, Sequence):
        raise WattenCardError("watten_invalid_deal_schedule")
    recipients = tuple(recipient_order)
    if len(recipients) != player_count * CARDS_PER_HAND:
        raise WattenCardError("watten_invalid_deal_schedule")
    for seat in recipients:
        validate_seat(seat, player_count)
    if any(recipients.count(seat) != CARDS_PER_HAND for seat in range(player_count)):
        raise WattenCardError("watten_invalid_deal_schedule")
    hands: list[list[str]] = [[] for _ in range(player_count)]
    for card, seat in zip(cards, recipients):
        hands[seat].append(card)
    immutable_hands = tuple(tuple(hand) for hand in hands)
    return DealtCards(
        hands=immutable_hands,
        stock=cards[len(recipients):],
        bottom_cards=tuple(hand[-1] for hand in immutable_hands),
    )
