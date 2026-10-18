"""Initial-deal conservation and validation; no runtime game/profile fixtures."""

from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError

from app.watten_cards import (
    WATTEN_NORMAL_RANKS,
    WATTEN_SUITS,
    WELI,
    DealtCards,
    WattenCardError,
    card_rank,
    card_suit,
    deal_cards,
    make_deck,
    validate_card,
    validate_player_count,
    validate_seat,
)


class WattenCardsTestCase(unittest.TestCase):
    def test_exact_owner_deck_reuses_artwork_ids_without_other_sixes(self):
        deck = make_deck()
        expected = {f"{suit}-{rank}" for suit in WATTEN_SUITS for rank in ("7", "8", "9", "10", "U", "O", "K", "A")}
        self.assertIsInstance(deck, tuple)
        self.assertEqual(len(deck), 33)
        self.assertEqual(set(deck), expected | {"bells-6"})
        self.assertEqual(WATTEN_NORMAL_RANKS, ("7", "8", "9", "10", "U", "O", "K", "A"))
        self.assertEqual(card_suit(WELI), "bells")
        self.assertEqual(card_rank(WELI), "6")

    def test_every_invalid_artwork_or_noncanonical_card_id_is_rejected(self):
        for card in ("hearts-6", "leaves-6", "acorns-6", "bells-06", "bells-weli", "HEARTS-K",
                     "hearts-k", "hearts-1", " hearts-A", "hearts-A ", "hearts-A/", "", None, 10, [], {}):
            with self.subTest(card=card):
                for validator in (validate_card, card_rank, card_suit):
                    with self.assertRaisesRegex(WattenCardError, "watten_invalid_card"):
                        validator(card)

    def test_counts_and_seats_reject_bool_float_negative_and_out_of_range_values(self):
        for count in (True, False, 2.0, 0, 1, 5, "4", None):
            with self.subTest(count=count), self.assertRaises(WattenCardError):
                validate_player_count(count)
        for seat in (True, False, 1.0, -1, 4, "1", None):
            with self.subTest(seat=seat), self.assertRaises(WattenCardError):
                validate_seat(seat, 4)

    def test_explicit_schedules_deal_five_to_every_seat_without_changing_inputs(self):
        for count in (2, 3, 4):
            # Both are explicit test schedules, not an approved physical packet rule.
            for schedule in (list(range(count)) * 5, [seat for seat in range(count) for _ in range(5)]):
                for offset in (0, 7, 32):
                    with self.subTest(count=count, schedule=schedule, offset=offset):
                        original = list(make_deck())
                        deck = original[offset:] + original[:offset]
                        before, recipients = list(deck), list(schedule)
                        deal = deal_cards(deck, player_count=count, recipient_order=schedule)
                        self.assertEqual(deck, before)
                        self.assertEqual(schedule, recipients)
                        self.assertEqual(len(deal.hands), count)
                        self.assertTrue(all(len(hand) == 5 for hand in deal.hands))
                        for seat in range(count):
                            self.assertEqual(deal.hands[seat], tuple(before[i] for i, target in enumerate(schedule) if target == seat))
                        self.assertEqual(deal.stock, tuple(before[count * 5:]))
                        all_cards = tuple(card for hand in deal.hands for card in hand) + deal.stock
                        self.assertEqual(len(all_cards), 33)
                        self.assertEqual(set(all_cards), set(make_deck()))
                        self.assertEqual(deal.bottom_cards, tuple(hand[-1] for hand in deal.hands))

    def test_bottom_selection_survives_presentation_sorting_and_original_list_changes(self):
        cards = list(reversed(make_deck()))
        deal = deal_cards(cards, player_count=4, recipient_order=list(range(4)) * 5)
        bottom = deal.bottom_cards
        views = tuple(tuple(sorted(hand)) for hand in deal.hands)
        self.assertNotEqual(views, deal.hands)
        cards.reverse()
        self.assertEqual(deal.bottom_cards, bottom)
        with self.assertRaises(FrozenInstanceError):
            deal.bottom_cards = ()
        with self.assertRaises(TypeError):
            deal.hands[0][0] = "hearts-A"

    def test_direct_initial_deal_constructor_defensively_freezes_every_container(self):
        initial = deal_cards(make_deck(), player_count=2, recipient_order=[0, 1] * 5)
        hands, stock, bottom = [list(hand) for hand in initial.hands], list(initial.stock), list(initial.bottom_cards)
        deal = DealtCards(hands, stock, bottom)
        hands[0].clear()
        stock.clear()
        bottom.clear()
        self.assertEqual(deal, initial)

    def test_missing_duplicate_extra_invalid_and_nonsequence_decks_are_rejected(self):
        deck = list(make_deck())
        invalid = (deck[:-1], deck + [WELI], [deck[0]] + deck[:-1], ["hearts-6"] + deck[1:],
                   None, "bells-6", set(deck))
        for cards in invalid:
            with self.subTest(cards=cards), self.assertRaises(WattenCardError):
                deal_cards(cards, player_count=2, recipient_order=[0, 1] * 5)

    def test_missing_unequal_or_invalid_recipient_schedule_is_rejected(self):
        for schedule in ([0, 1] * 4, [0] * 10, [0, 1] * 5 + [0], [True, 1] * 5,
                         [0, 2] * 5, "0101010101", None):
            with self.subTest(schedule=schedule), self.assertRaises(WattenCardError):
                deal_cards(make_deck(), player_count=2, recipient_order=schedule)

    def test_initial_deal_rejects_invented_bottom_card_or_lost_duplicate_cards(self):
        initial = deal_cards(make_deck(), player_count=2, recipient_order=[0, 1] * 5)
        for hands, stock, bottom in (
            (initial.hands, initial.stock, tuple(reversed(initial.bottom_cards))),
            (initial.hands, initial.stock[:-1], initial.bottom_cards),
            (initial.hands, (initial.hands[0][0],) + initial.stock[1:], initial.bottom_cards),
            ((initial.hands[0][:-1], initial.hands[1]), initial.stock, initial.bottom_cards),
        ):
            with self.subTest(hands=hands, stock=stock, bottom=bottom), self.assertRaises(WattenCardError):
                DealtCards(hands, stock, bottom)
