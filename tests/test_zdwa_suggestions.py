"""The highlighted field on the ZDWA 2026 score sheet (``best`` in the field previews).

The server flags at most one preview as worth writing now. It weighs every
write against what the field usually ends up with, not by raw points, and
before the last roll it only highlights a write that beats rolling on.
"""

import random

from app import game_engine, zdwa_advice
from app.game_state import KEY_TO_ROW, WRITABLE_COLS, WRITABLE_MAP, WRITABLE_ROWS
from tests.support import GameStateTestCase


def row(field):
    return KEY_TO_ROW[field]


class SuggestionTestCase(GameStateTestCase):
    def turn(self, dice, *, roll=1, rolls_max=3, board=None, hardcore=False, mode=2, player="p1",
             first_four=None, announced=None):
        g = self.make_game(hardcore=hardcore, mode=mode)
        g["_turn"]["player_id"] = player
        g["_dice"] = list(dice)
        g["_rolls_used"] = roll
        g["_rolls_max"] = 1 if hardcore else rolls_max
        g["_turn"]["roll_index"] = roll
        g["_turn"]["first4oak_roll"] = first_four
        g["_announced_row4"] = announced
        sheet = g["_scoreboards_by_team"]["A"] if mode == "2v2" else g["_scoreboards"][player]
        sheet.update(board or {})
        return g

    def best(self, g):
        flagged = [(p["row"], p["col"], p["points"]) for p in game_engine.compute_field_previews(g) if p.get("best")]
        self.assertLessEqual(len(flagged), 1)
        return flagged[0] if flagged else None


class ManuelsTableTests(SuggestionTestCase):
    def test_a_weak_first_roll_does_not_highlight_the_maximum(self):
        # Live 2.51.0: 2,4,2,1,2 after roll 1 of 3 on an empty sheet highlighted + = 11.
        g = self.turn([2, 4, 2, 1, 2])

        previews = {(p["row"], p["col"]): p for p in game_engine.compute_field_previews(g)}

        self.assertEqual(previews[(row("max"), "free")]["points"], 11)
        self.assertNotIn("best", previews[(row("max"), "free")])
        self.assertIsNone(self.best(g))

    def test_the_same_dice_on_the_last_roll_keep_the_maximum_for_better_dice(self):
        best = self.best(self.turn([2, 4, 2, 1, 2], roll=3))

        self.assertIsNotNone(best)
        self.assertNotIn(best[0], (row("max"), row("min")))

    def test_previews_stay_backward_compatible(self):
        previews = game_engine.compute_field_previews(self.turn([1, 2, 3, 4, 6]))

        for preview in previews:
            self.assertLessEqual({"row", "col", "points"}, set(preview))
            self.assertLessEqual(set(preview), {"row", "col", "points", "best"})
            self.assertIs(preview.get("best", True), True)


class FirstRollTests(SuggestionTestCase):
    def test_a_kenter_on_the_first_roll_is_written_at_once(self):
        self.assertEqual(self.best(self.turn([1, 2, 3, 4, 6])), (row("kenter"), "free", 35))

    def test_a_full_on_the_first_roll_goes_to_the_announcement_column(self):
        # ❗ is only open without an announcement right after roll 1.
        self.assertEqual(self.best(self.turn([5, 5, 5, 2, 2])), (row("full"), "ang", 55))

    def test_four_ones_keep_rolling_for_the_fifth(self):
        self.assertIsNone(self.best(self.turn([1, 1, 1, 1, 3], first_four=1)))

    def test_three_of_a_kind_keeps_rolling(self):
        self.assertIsNone(self.best(self.turn([6, 6, 6, 2, 3])))


class LastRollTests(SuggestionTestCase):
    def test_junk_scratches_the_cheapest_field_instead_of_a_poor_maximum(self):
        best = self.best(self.turn([2, 3, 3, 5, 6], roll=3))

        self.assertIsNotNone(best)
        self.assertNotEqual(best[:2], (row("max"), "free"))
        self.assertLessEqual(best[2], 6)

    def test_a_strong_maximum_is_written(self):
        self.assertEqual(self.best(self.turn([6, 6, 6, 5, 4], roll=3)), (row("max"), "free", 27))

    def test_a_column_without_ones_takes_max_and_min_as_a_dump(self):
        board = {f"{row('1')},free": 0}
        g = self.turn([2, 3, 4, 4, 6], roll=3, board=board)

        self.assertIn(self.best(g)[:2], ((row("max"), "free"), (row("min"), "free")))
        columns = zdwa_advice.columns_from_board(board)
        self.assertEqual(zdwa_advice.write_gain(columns, "free", "max", 12),
                         zdwa_advice.write_gain(columns, "free", "max", 25))

    def test_ones_in_the_column_make_a_poor_maximum_expensive(self):
        best = self.best(self.turn([2, 3, 4, 4, 6], roll=3, board={f"{row('1')},free": 5}))

        self.assertNotIn(best[0], (row("max"), row("min")))

    def test_the_last_open_cell_is_always_highlighted_on_the_last_roll(self):
        board = self.full_scoreboard()
        del board[f"{row('60')},free"]
        g = self.turn([1, 2, 3, 5, 6], roll=5, rolls_max=5, board=board)

        self.assertEqual(self.best(g), (row("60"), "free", 0))


class RuleTests(SuggestionTestCase):
    def test_hardcore_always_highlights_its_single_roll(self):
        # In Hardcore ❗ is a second free column, so either takes the Kenter.
        self.assertIn(self.best(self.turn([1, 2, 3, 4, 5], hardcore=True)),
                      ((row("kenter"), "free", 35), (row("kenter"), "ang", 35)))
        junk = self.best(self.turn([2, 3, 3, 5, 6], hardcore=True))
        self.assertIsNotNone(junk)
        self.assertNotEqual(junk[:2], (row("max"), "free"))

    def test_team_mode_judges_the_team_sheet(self):
        # Team A's free column already holds 0 ones; player 3 writes for team A.
        g = self.turn([2, 3, 4, 4, 6], roll=3, mode="2v2", player="p3", board={f"{row('1')},free": 0})
        g["_scoreboards"]["p3"] = {}

        self.assertIn(self.best(g)[:2], ((row("max"), "free"), (row("min"), "free")))

    def test_an_announced_field_is_highlighted_once_it_cannot_improve(self):
        self.assertEqual(self.best(self.turn([1, 2, 3, 4, 6], roll=2, announced="kenter")),
                         (row("kenter"), "ang", 35))
        self.assertIsNone(self.best(self.turn([6, 6, 6, 2, 3], roll=2, announced="6")))
        self.assertEqual(self.best(self.turn([6, 6, 6, 2, 3], roll=3, announced="6")), (row("6"), "ang", 18))

    def test_with_only_announcement_fields_left_a_better_announcement_keeps_rolling(self):
        board = self.full_scoreboard(default=10)
        for field in ("kenter", "6"):
            del board[f"{row(field)},ang"]

        self.assertEqual(self.best(self.turn([1, 2, 3, 4, 5], board=board)), (row("kenter"), "ang", 35))
        self.assertIsNone(self.best(self.turn([6, 6, 6, 2, 3], board=board)))

    def test_a_poker_counts_only_on_the_roll_that_brought_it(self):
        self.assertEqual(self.best(self.turn([6, 6, 6, 6, 2], first_four=1)), (row("poker"), "ang", 74))

        stale = self.turn([6, 6, 6, 6, 2], roll=2, first_four=1)
        poker = next(p for p in game_engine.compute_field_previews(stale) if p["row"] == row("poker"))
        self.assertEqual(poker["points"], 0)
        self.assertNotEqual((self.best(stale) or (None,))[0], row("poker"))

        self.assertEqual(self.best(self.turn([6, 6, 6, 6, 2], roll=3, first_four=3)), (row("poker"), "free", 74))

    def test_no_highlight_during_a_correction(self):
        g = self.turn([1, 2, 3, 4, 6], roll=3)
        g["_correction"] = {"active": True, "player_id": "p1"}

        self.assertIsNone(self.best(g))

    def test_at_most_one_field_is_highlighted_and_the_last_roll_always_has_one(self):
        rng = random.Random(7)
        for _ in range(60):
            board = {f"{r},{c}": rng.randint(0, 20) for r in WRITABLE_ROWS for c in WRITABLE_COLS
                     if rng.random() < 0.5}
            roll = rng.randint(1, 3)
            g = self.turn([rng.randint(1, 6) for _ in range(5)], roll=roll, board=board)
            best = self.best(g)
            if roll == 3 and game_engine.compute_field_previews(g):
                self.assertIsNotNone(best)


class ValueTests(SuggestionTestCase):
    def test_upper_rows_are_judged_against_their_bonus_pace(self):
        columns = zdwa_advice.columns_from_board({})

        par = zdwa_advice.write_gain(columns, "down", "4", 12)
        self.assertGreater(zdwa_advice.write_gain(columns, "down", "4", 16), par + 4)
        self.assertLess(zdwa_advice.write_gain(columns, "down", "4", 8), par - 4)

    def test_a_scratch_costs_the_fields_expectation(self):
        columns = zdwa_advice.columns_from_board({})

        self.assertLess(zdwa_advice.write_gain(columns, "up", "full", 0), -30)
        self.assertGreater(zdwa_advice.write_gain(columns, "up", "60", 0), -30)

    def test_every_writable_row_maps_to_a_field(self):
        self.assertEqual(sorted(WRITABLE_MAP.values()), sorted(zdwa_advice.FIELDS))
