import unittest

from app import main
from tests.support import GameStateTestCase


def sequence_rng(values):
    rolls = iter(values)

    def _rng(_lo, _hi):
        return next(rolls)

    return _rng


class RollApplicationTestCase(GameStateTestCase):
    def test_apply_roll_replaces_only_unheld_dice_and_increments_once(self):
        g = self.make_game()
        g["_dice"] = [1, 2, 3, 4, 5]
        g["_holds"] = [True, False, True, False, False]

        dice = main.apply_roll(g, randint_fn=sequence_rng([6, 1, 2]))

        self.assertEqual(dice, [1, 6, 3, 1, 2])
        self.assertEqual(g["_rolls_used"], 1)
        self.assertEqual(g["_turn"]["roll_index"], 1)
        self.assertIsNone(g["_turn"]["first4oak_roll"])

    def test_apply_roll_records_first_four_of_a_kind_once(self):
        g = self.make_game()

        main.apply_roll(g, randint_fn=sequence_rng([1, 2, 3, 4, 5]))
        main.apply_roll(g, randint_fn=sequence_rng([2, 2, 2, 2, 5]))
        main.apply_roll(g, randint_fn=sequence_rng([6, 6, 6, 6, 6]))

        self.assertEqual(g["_rolls_used"], 3)
        self.assertEqual(g["_turn"]["roll_index"], 3)
        self.assertEqual(g["_turn"]["first4oak_roll"], 2)

    def test_begin_next_turn_resets_roll_state_and_advances_player(self):
        g = self.make_game(players=[("p1", "A"), ("p2", "B")])
        g["_dice"] = [6, 6, 6, 6, 6]
        g["_holds"] = [True, True, False, False, True]
        g["_rolls_used"] = 2
        g["_announced_row4"] = "poker"
        g["_announced_by"] = "p1"
        g["_announced_board"] = "p1"

        main._begin_next_turn(g, "p1")

        self.assertEqual(g["_dice"], [0, 0, 0, 0, 0])
        self.assertEqual(g["_holds"], [False, False, False, False, False])
        self.assertEqual(g["_rolls_used"], 0)
        self.assertIsNone(g["_announced_row4"])
        self.assertIsNone(g["_announced_by"])
        self.assertIsNone(g["_announced_board"])
        self.assertEqual(g["_turn"], {"player_id": "p2", "roll_index": 0, "first4oak_roll": None})

    def test_roll_cap_is_three_five_on_last_cell_and_one_in_hardcore(self):
        g = self.make_game()
        main._set_roll_cap_for_current_turn(g)
        self.assertEqual(g["_rolls_max"], 3)

        g_last = self.make_game()
        board = g_last["_scoreboards"]["p1"]
        for row in main.WRITABLE_ROWS:
            for col in main.WRITABLE_COLS:
                board[f"{row},{col}"] = 0
        board.pop(f"{main.WRITABLE_ROWS[-1]},ang")
        main._set_roll_cap_for_current_turn(g_last)
        self.assertEqual(g_last["_rolls_max"], 5)

        g_hc = self.make_game(hardcore=True)
        main._set_roll_cap_for_current_turn(g_hc)
        self.assertEqual(g_hc["_rolls_max"], 1)


class WriteGuardTestCase(GameStateTestCase):
    def test_down_and_up_columns_enforce_their_required_order(self):
        g = self.make_game()

        self.assertEqual(main.can_write_now(g, "p1", 0, "down", during_turn_announce=None), (True, ""))
        ok, why = main.can_write_now(g, "p1", 1, "down", during_turn_announce=None)
        self.assertFalse(ok)
        self.assertIn("Zeile 0", why)

        self.assertEqual(main.can_write_now(g, "p1", 15, "up", during_turn_announce=None), (True, ""))
        ok, why = main.can_write_now(g, "p1", 14, "up", during_turn_announce=None)
        self.assertFalse(ok)
        self.assertIn("Zeile 15", why)

        g["_scoreboards"]["p1"]["0,down"] = 2
        self.assertEqual(main.can_write_now(g, "p1", 1, "down", during_turn_announce=None), (True, ""))

    def test_active_announcement_allows_only_matching_ang_cell(self):
        g = self.make_game()
        g["_rolls_used"] = 2

        self.assertEqual(main.can_write_now(g, "p1", 14, "ang", during_turn_announce="poker"), (True, ""))

        ok, why = main.can_write_now(g, "p1", 13, "ang", during_turn_announce="poker")
        self.assertFalse(ok)
        self.assertIn("Angesagt ist poker", why)

        ok, why = main.can_write_now(g, "p1", 14, "free", during_turn_announce="poker")
        self.assertFalse(ok)
        self.assertIn("Nur ❗-Spalte", why)

    def test_hardcore_ang_behaves_like_free_column(self):
        g = self.make_game(hardcore=True)
        g["_rolls_used"] = 1

        self.assertEqual(main.can_write_now(g, "p1", 14, "ang", during_turn_announce=None), (True, ""))
        self.assertEqual(main.can_write_now(g, "p1", 14, "free", during_turn_announce=None), (True, ""))


class PokerStrikeRuleTestCase(unittest.TestCase):
    def test_regular_columns_score_poker_only_on_first_four_kind_roll(self):
        dice = [4, 4, 4, 4, 2]

        self.assertTrue(main.poker_points_allowed(dice, "free", roll_index=1, first4oak_roll=1))
        self.assertFalse(main.poker_points_allowed(dice, "free", roll_index=2, first4oak_roll=1))

    def test_five_of_a_kind_always_scores_as_poker(self):
        dice = [6, 6, 6, 6, 6]

        self.assertTrue(main.poker_points_allowed(dice, "down", roll_index=3, first4oak_roll=1))

    def test_announced_poker_scores_in_ang_after_later_four_kind_roll(self):
        dice = [4, 4, 4, 4, 2]

        self.assertTrue(
            main.poker_points_allowed(
                dice,
                "ang",
                roll_index=2,
                first4oak_roll=1,
                announced_poker=True,
            )
        )

    def test_correction_can_use_remembered_first_four_kind_roll(self):
        dice = [4, 4, 4, 4, 2]

        self.assertFalse(main.poker_points_allowed(dice, "free", roll_index=3, first4oak_roll=1))
        self.assertTrue(
            main.poker_points_allowed(
                dice,
                "free",
                roll_index=3,
                first4oak_roll=1,
                correction=True,
            )
        )
