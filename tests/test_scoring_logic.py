import unittest

from app import main
from app.rules import compute_overall, compute_row_subtotals
from tests.support import GameStateTestCase


class FieldScoringTestCase(unittest.TestCase):
    def test_number_fields_sum_matching_faces_and_ignore_zeroes(self):
        dice = [1, 1, 2, 5, 0]

        self.assertEqual(main.score_field_value("1", dice), 2)
        self.assertEqual(main.score_field_value("2", dice), 2)
        self.assertEqual(main.score_field_value("5", dice), 5)
        self.assertEqual(main.score_field_value("6", dice), 0)

    def test_max_and_min_use_sum_of_all_rolled_dice(self):
        dice = [6, 5, 4, 3, 0]

        self.assertEqual(main.score_field_value("max", dice), 18)
        self.assertEqual(main.score_field_value("min", dice), 18)

    def test_kenter_requires_five_different_faces(self):
        self.assertEqual(main.score_field_value("kenter", [1, 2, 3, 4, 6]), 35)
        self.assertEqual(main.score_field_value("kenter", [1, 2, 3, 4, 4]), 0)

    def test_full_house_counts_three_plus_two_or_five_of_a_kind(self):
        self.assertEqual(main.score_field_value("full", [2, 2, 2, 5, 5]), 46)
        self.assertEqual(main.score_field_value("full", [6, 6, 6, 6, 6]), 58)
        self.assertEqual(main.score_field_value("full", [4, 4, 4, 4, 1]), 0)

    def test_poker_and_sixty_values(self):
        self.assertEqual(main.score_field_value("poker", [4, 4, 4, 4, 2]), 66)
        self.assertEqual(main.score_field_value("poker", [6, 6, 6, 6, 6]), 74)
        self.assertEqual(main.score_field_value("poker", [1, 1, 1, 2, 2]), 0)
        self.assertEqual(main.score_field_value("60", [6, 6, 6, 6, 6]), 90)
        self.assertEqual(main.score_field_value("60", [6, 6, 6, 6, 1]), 0)


class TotalsCalculationTestCase(GameStateTestCase):
    def test_row_subtotals_apply_normal_bonus_and_diff(self):
        row = {
            "1": 3,
            "2": 6,
            "3": 9,
            "4": 12,
            "5": 15,
            "6": 18,
            "max": 28,
            "min": 8,
            "kenter": 35,
            "full": 58,
            "poker": 74,
            "60": 90,
        }

        totals = compute_row_subtotals(row)

        self.assertEqual(totals["sum_top"], 63)
        self.assertEqual(totals["bonus_top"], 30)
        self.assertEqual(totals["total_top"], 93)
        self.assertEqual(totals["sum_maxmin"], 60)
        self.assertEqual(totals["sum_bottom"], 257)
        self.assertEqual(totals["total_column"], 410)

    def test_row_subtotals_use_hardcore_bonus_threshold(self):
        row = {"1": 4, "2": 6, "3": 6, "4": 8, "5": 10, "6": 6}

        self.assertEqual(compute_row_subtotals(row)["bonus_top"], 0)
        self.assertEqual(compute_row_subtotals(row, hardcore=True)["bonus_top"], 30)

    def test_negative_max_min_diff_is_clamped_to_zero(self):
        row = {"1": 4, "max": 8, "min": 20}

        self.assertEqual(compute_row_subtotals(row)["sum_maxmin"], 0)

    def test_overall_total_sums_all_four_columns(self):
        rows = {
            1: {"1": 3, "max": 28, "min": 8, "kenter": 35},
            2: {"2": 8, "full": 52},
            3: {"poker": 70},
            4: {"60": 85},
        }

        totals = compute_overall(rows)

        self.assertEqual(totals["row1"]["total_column"], 98)
        self.assertEqual(totals["row2"]["total_column"], 60)
        self.assertEqual(totals["row3"]["total_column"], 70)
        self.assertEqual(totals["row4"]["total_column"], 85)
        self.assertEqual(totals["overall"]["overall_total"], 313)

    def test_scoreboard_rows_are_mapped_to_score_columns(self):
        board = {
            "0,down": 3,
            "9,down": 28,
            "10,down": 8,
            "13,free": 52,
            "14,up": 70,
            "15,ang": 85,
            "17,free": 999,
            "not-a-cell": 5,
        }

        rows = main._rows_from_scoreboard(board)

        self.assertEqual(rows[1]["1"], 3)
        self.assertEqual(rows[1]["max"], 28)
        self.assertEqual(rows[1]["min"], 8)
        self.assertEqual(rows[2]["full"], 52)
        self.assertEqual(rows[3]["poker"], 70)
        self.assertEqual(rows[4]["60"], 85)
        self.assertNotIn(999, rows[2].values())


class SuggestionsTestCase(GameStateTestCase):
    def test_poker_suggestion_is_hidden_after_zocking_regular_columns(self):
        g = self.make_game()
        g["_rolls_used"] = 2
        g["_dice"] = [4, 4, 4, 4, 2]
        g["_turn"]["roll_index"] = 2
        g["_turn"]["first4oak_roll"] = 1

        suggestions = main.compute_suggestions(g)

        self.assertNotIn("POKER", {s["type"] for s in suggestions})

    def test_announced_poker_suggestion_remains_available_after_later_roll(self):
        g = self.make_game()
        g["_rolls_used"] = 2
        g["_dice"] = [4, 4, 4, 4, 2]
        g["_turn"]["roll_index"] = 2
        g["_turn"]["first4oak_roll"] = 1
        g["_announced_row4"] = "poker"

        suggestions = main.compute_suggestions(g)

        poker = [s for s in suggestions if s["type"] == "POKER"]
        self.assertEqual(len(poker), 1)
        self.assertEqual(poker[0]["points"], 66)
