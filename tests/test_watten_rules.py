"""Pure comparison fixtures prove no legal moves, full game or profile release."""

from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError
from itertools import combinations

from app.watten_cards import WATTEN_NORMAL_RANKS, WATTEN_SUITS, WELI, deal_cards, make_deck
from app.watten_rules import (
    CRITICAL_CARDS,
    WELI_STRIKE,
    CardKind,
    ComparisonRules,
    WattenCall,
    WattenRuleError,
    WattenRuleUnready,
    card_kind,
    card_strength,
    effective_suit,
    is_protected_card,
    ladinisch_call,
    ladinisch_reveal_events,
    round_roles,
    trick_winner,
)


def deal_with_bottoms(bottom_cards):
    """Choose a test-only allocation explicitly; do not choose a product deal."""
    remainder = [card for card in make_deck() if card not in bottom_cards]
    deck = []
    for bottom in bottom_cards:
        deck.extend(remainder[:4])
        del remainder[:4]
        deck.append(bottom)
    deck.extend(remainder)
    count = len(bottom_cards)
    return deal_cards(deck, player_count=count, recipient_order=[seat for seat in range(count) for _ in range(5)])


class WattenRolesAndCallsTestCase(unittest.TestCase):
    def test_only_canonical_confirmed_strike_and_suit_values_are_accepted(self):
        for rank in (*WATTEN_NORMAL_RANKS, WELI_STRIKE):
            for suit in WATTEN_SUITS:
                self.assertEqual(WattenCall(rank, suit).strike_rank, rank)
        for rank, suit in (("6", "bells"), ("weli", "other"), ("ace", "hearts"), ([], "hearts"), ("K", [])):
            with self.subTest(rank=rank, suit=suit), self.assertRaises(WattenRuleError):
                WattenCall(rank, suit)

    def test_normal_roles_rotate_clockwise_for_all_player_counts_and_dealers(self):
        for count in (2, 3, 4):
            for dealer in range(count):
                with self.subTest(count=count, dealer=dealer):
                    roles = round_roles(count, dealer, determination="normal")
                    next_seat = (dealer + 1) % count
                    self.assertEqual(roles.dealer, dealer)
                    self.assertEqual(roles.clockwise_next, next_seat)
                    self.assertEqual(roles.first_player, next_seat)
                    self.assertEqual(roles.next_dealer, next_seat)
                    self.assertEqual(roles.strike_announcer, next_seat)
                    self.assertEqual(roles.suit_announcer, next_seat if count == 3 else dealer)
                    self.assertEqual(roles.solo_seat, next_seat if count == 3 else None)
        dealer, dealers = 0, []
        for _ in range(4):
            dealers.append(dealer)
            dealer = round_roles(4, dealer, determination="normal").next_dealer
        self.assertEqual(dealers, [0, 1, 2, 3])

    def test_ladinisch_uses_original_dealer_suit_and_clockwise_successor_strike(self):
        for count, bottoms in ((2, ["bells-K", "hearts-K"]),
                               (4, ["bells-K", "hearts-K", "leaves-8", "acorns-A"])):
            deal = deal_with_bottoms(bottoms)
            for dealer in range(count):
                with self.subTest(count=count, dealer=dealer):
                    call = ladinisch_call(deal, dealer=dealer)
                    self.assertEqual(call.trump_suit, bottoms[dealer].split("-")[0])
                    self.assertEqual(call.strike_rank, bottoms[(dealer + 1) % count].split("-")[1])
                    views = [sorted(hand) for hand in deal.hands]
                    self.assertEqual(ladinisch_call(deal, dealer=dealer), call)
                    self.assertNotEqual(tuple(tuple(view) for view in views), deal.hands)

    def test_weli_bottom_means_only_weli_strike_or_printed_bells_suit(self):
        self.assertEqual(ladinisch_call(deal_with_bottoms(["hearts-8", WELI]), dealer=0), WattenCall(WELI_STRIKE, "hearts"))
        self.assertEqual(ladinisch_call(deal_with_bottoms([WELI, "acorns-8"]), dealer=0), WattenCall("8", "bells"))

    def test_three_player_ladinisch_and_invalid_roles_are_explicitly_rejected(self):
        with self.assertRaisesRegex(WattenRuleUnready, "three_player_ladinisch"):
            ladinisch_call(deal_with_bottoms(["hearts-8", "bells-9", "acorns-K"]), dealer=0)
        for count, dealer, determination in ((2, True, "normal"), (3, -1, "normal"),
                                             (4, 4, "normal"), (4, 0, "blind"), (4, 0, [])):
            with self.subTest(count=count, dealer=dealer), self.assertRaises(ValueError):
                round_roles(count, dealer, determination=determination)

    def test_reveal_thanks_only_for_actual_shown_rechter(self):
        deal = deal_with_bottoms(["bells-K", "hearts-K", "leaves-8", "acorns-A"])
        rules = ComparisonRules(ladinisch_call(deal, dealer=0))
        events = ladinisch_reveal_events(deal, dealer=0, rules=rules, blind=True, shown_seats=frozenset((0, 1)))
        self.assertEqual([(event.seat, event.message_key) for event in events], [(0, "watten_thanks")])
        self.assertEqual(ladinisch_reveal_events(deal, dealer=0, rules=rules, blind=True, shown_seats=frozenset((0, 1))), events)
        with self.assertRaises(FrozenInstanceError):
            events[0].seat = 1
        # Merely carrying the Rechter somewhere else does not disclose it.
        hidden_right = deal_with_bottoms(["bells-A", "hearts-K", "leaves-8", "acorns-9"])
        self.assertIn("bells-K", hidden_right.hands[3])
        self.assertNotIn("bells-K", hidden_right.bottom_cards)
        hidden_rules = ComparisonRules(ladinisch_call(hidden_right, dealer=0))
        self.assertEqual(ladinisch_reveal_events(hidden_right, dealer=0, rules=hidden_rules, blind=True, shown_seats=frozenset((0, 1))), ())

    def test_thanks_requires_both_accepted_shows_and_rejects_unrelated_reveal_facts(self):
        deal = deal_with_bottoms(["bells-K", "hearts-K", "leaves-8", "acorns-A"])
        rules = ComparisonRules(ladinisch_call(deal, dealer=0))
        for shown in (frozenset(), frozenset((0,)), frozenset((1,))):
            with self.subTest(shown=shown):
                self.assertEqual(ladinisch_reveal_events(
                    deal, dealer=0, rules=rules, blind=True, shown_seats=shown,
                ), ())
        for shown in ({0, 1}, frozenset((True,)), frozenset((2,)), frozenset((0, 1, 3))):
            with self.subTest(shown=shown), self.assertRaisesRegex(WattenRuleError, "invalid_shown_seats"):
                ladinisch_reveal_events(deal, dealer=0, rules=rules, blind=True, shown_seats=shown)

    def test_weli_strike_shown_by_successor_is_rechter_and_thanks_does_not_reveal_call(self):
        deal = deal_with_bottoms(["hearts-8", WELI, "leaves-A", "acorns-9"])
        rules = ComparisonRules(ladinisch_call(deal, dealer=0))
        events = ladinisch_reveal_events(deal, dealer=0, rules=rules, blind=True, shown_seats=frozenset((0, 1)))
        self.assertEqual(events[0].seat, 1)
        self.assertFalse(hasattr(events[0], "card"))
        self.assertFalse(hasattr(events[0], "call"))
        with self.assertRaisesRegex(WattenRuleError, "reveal_call_mismatch"):
            ladinisch_reveal_events(deal, dealer=0, rules=ComparisonRules(WattenCall("8", "bells")), blind=True, shown_seats=frozenset((0, 1)))

    def test_thanks_is_not_invented_for_open_play_or_unconfirmed_blind_two(self):
        deal = deal_with_bottoms(["bells-K", "hearts-K"])
        rules = ComparisonRules(ladinisch_call(deal, dealer=0))
        self.assertEqual(ladinisch_reveal_events(deal, dealer=0, rules=rules, blind=False, shown_seats=frozenset((0, 1))), ())
        with self.assertRaisesRegex(WattenRuleUnready, "blind_requires_four"):
            ladinisch_reveal_events(deal, dealer=0, rules=rules, blind=True, shown_seats=frozenset((0, 1)))
        with self.assertRaisesRegex(WattenRuleError, "invalid_blind_option"):
            ladinisch_reveal_events(deal, dealer=0, rules=rules, blind=1, shown_seats=frozenset((0, 1)))


class WattenCardComparisonTestCase(unittest.TestCase):
    def test_normal_order_is_ace_king_ober_unter_ten_nine_eight_seven_for_suit_and_trump(self):
        rules = ComparisonRules(WattenCall(WELI_STRIKE, "bells"))
        ascending = ("7", "8", "9", "10", "U", "O", "K", "A")
        for suit in ("hearts", "bells"):
            for low, high in combinations(ascending, 2):
                with self.subTest(suit=suit, low=low, high=high):
                    self.assertEqual(trick_winner([f"{suit}-{low}", f"{suit}-{high}"], rules=rules), 1)
                    self.assertEqual(trick_winner([f"{suit}-{high}", f"{suit}-{low}"], rules=rules), 0)

    def test_rechter_then_equal_strikes_then_trumps_then_led_suit(self):
        rules = ComparisonRules(WattenCall("9", "hearts"))
        cards = ["hearts-9", "bells-9", "hearts-A", WELI, "leaves-A", "acorns-A"]
        powers = [card_strength(card, led_card="leaves-7", rules=rules) for card in cards]
        self.assertEqual(powers, sorted(powers, reverse=True))
        self.assertEqual(card_kind("hearts-9", rules), CardKind.RECHTER)
        self.assertTrue(is_protected_card("hearts-9", rules))
        self.assertFalse(is_protected_card("bells-9", rules))

    def test_first_played_equal_strikes_win_per_w02_without_a_suit_tiebreak(self):
        # W02 Kartenwertigkeit: first played of equally high Linke takes the trick.
        rules = ComparisonRules(WattenCall("9", "hearts"))
        links = ("bells-9", "leaves-9", "acorns-9")
        for first, second in combinations(links, 2):
            self.assertEqual(trick_winner([first, second], rules=rules), 0)
            self.assertEqual(trick_winner([second, first], rules=rules), 0)
            self.assertEqual(trick_winner(["bells-7", first, second], rules=rules), 1)
            self.assertEqual(trick_winner(["bells-7", first, second, "hearts-9"], rules=rules), 3)

    def test_weli_follows_every_called_trump_suit_and_is_lowest_ordinary_trump(self):
        for suit in WATTEN_SUITS:
            with self.subTest(suit=suit):
                rules = ComparisonRules(WattenCall("9", suit))
                self.assertEqual(effective_suit(WELI, rules.call), suit)
                self.assertEqual(card_kind(WELI, rules), CardKind.TRUMP)
                self.assertFalse(is_protected_card(WELI, rules))
                self.assertEqual(trick_winner([WELI, f"{suit}-7"], rules=rules), 1)
                off_suit = next(value for value in WATTEN_SUITS if value != suit)
                self.assertEqual(trick_winner([f"{off_suit}-A", WELI], rules=rules), 1)

    def test_weli_strike_is_sole_protected_rechter_above_every_ordinary_trump(self):
        for suit in WATTEN_SUITS:
            rules = ComparisonRules(WattenCall(WELI_STRIKE, suit))
            self.assertEqual(card_kind(WELI, rules), CardKind.RECHTER)
            self.assertTrue(is_protected_card(WELI, rules))
            self.assertFalse(any(card_kind(card, rules) == CardKind.STRIKE for card in make_deck()))
            for card in make_deck():
                if card != WELI:
                    self.assertEqual(trick_winner([card, WELI], rules=rules), 1)

    def test_optional_critical_order_is_heart_king_weli_acorn_seven_then_rechter(self):
        rules = ComparisonRules(WattenCall("9", "hearts"), critical=True)
        self.assertEqual(CRITICAL_CARDS, ("hearts-K", WELI, "acorns-7"))
        ordered = [*CRITICAL_CARDS, "hearts-9", "bells-9", "hearts-A", "leaves-A"]
        keys = [card_strength(card, led_card="leaves-7", rules=rules) for card in ordered]
        self.assertEqual(keys, sorted(keys, reverse=True))
        for higher, lower in combinations(ordered, 2):
            self.assertEqual(trick_winner([lower, higher], rules=rules), 1)
        for card in CRITICAL_CARDS:
            self.assertEqual(card_kind(card, rules), CardKind.CRITICAL)
            self.assertTrue(is_protected_card(card, rules))

    def test_confirmed_critical_overlap_keeps_precedence_without_replacement_rechter(self):
        for strike, suit, critical in (("K", "hearts", "hearts-K"), ("7", "acorns", "acorns-7"),
                                      *((WELI_STRIKE, suit, WELI) for suit in WATTEN_SUITS)):
            with self.subTest(strike=strike, suit=suit):
                rules = ComparisonRules(WattenCall(strike, suit), critical=True)
                self.assertEqual(card_kind(critical, rules), CardKind.CRITICAL)
                self.assertFalse(any(card_kind(card, rules) == CardKind.RECHTER for card in make_deck()))
                self.assertTrue(is_protected_card(critical, rules))
                for higher, lower in combinations(CRITICAL_CARDS, 2):
                    self.assertEqual(trick_winner([lower, higher], rules=rules), 1)
        # A critical matching the strike rank does not erase an unrelated Right.
        rules = ComparisonRules(WattenCall("K", "bells"), critical=True)
        self.assertEqual(card_kind("hearts-K", rules), CardKind.CRITICAL)
        self.assertEqual(card_kind("bells-K", rules), CardKind.RECHTER)

    def test_weli_bottom_as_blind_critical_strike_has_no_extra_strike_or_rechter(self):
        deal = deal_with_bottoms(["hearts-8", WELI, "leaves-A", "acorns-9"])
        call = ladinisch_call(deal, dealer=0)
        self.assertEqual(call, WattenCall(WELI_STRIKE, "hearts"))
        rules = ComparisonRules(call, critical=True)
        self.assertFalse(any(card_kind(card, rules) in {CardKind.RECHTER, CardKind.STRIKE} for card in make_deck()))
        self.assertEqual(trick_winner(["acorns-7", WELI, "hearts-K"], rules=rules), 2)

    def test_unconfirmed_guter_and_invalid_options_never_get_defaults(self):
        with self.assertRaisesRegex(WattenRuleUnready, "guter_rules_unconfirmed"):
            ComparisonRules(WattenCall("9", "hearts"), guter=True)
        for critical, guter in ((1, False), (False, 0), ("false", False)):
            with self.subTest(critical=critical, guter=guter), self.assertRaises(WattenRuleError):
                ComparisonRules(WattenCall("9", "hearts"), critical=critical, guter=guter)

    def test_off_suit_plain_ace_cannot_take_a_led_suit_seven(self):
        rules = ComparisonRules(WattenCall("9", "hearts"))
        self.assertEqual(trick_winner(["leaves-7", "acorns-A"], rules=rules), 0)
        self.assertEqual(trick_winner(["leaves-7", "acorns-A", "leaves-8"], rules=rules), 2)
        self.assertEqual(trick_winner(["leaves-7", "acorns-A", "hearts-7"], rules=rules), 2)

    def test_partial_trick_order_is_retained_and_invalid_tricks_are_rejected(self):
        rules = ComparisonRules(WattenCall("9", "hearts"))
        played = ["leaves-7", "acorns-A", "leaves-8"]
        before = list(played)
        self.assertEqual(trick_winner(played, rules=rules), 2)
        self.assertEqual(played, before)
        for cards in ([], "leaves-7", None, ["leaves-7"] * 2, list(make_deck())[:5], ["hearts-6"]):
            with self.subTest(cards=cards), self.assertRaises(ValueError):
                trick_winner(cards, rules=rules)
