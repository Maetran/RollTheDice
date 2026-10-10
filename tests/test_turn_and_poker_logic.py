import unittest

from app import game_engine, game_scoring, game_state
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

        dice = game_engine.apply_roll(g, randint_fn=sequence_rng([6, 1, 2]))

        self.assertEqual(dice, [1, 6, 3, 1, 2])
        self.assertEqual(g["_rolls_used"], 1)
        self.assertEqual(g["_turn"]["roll_index"], 1)
        self.assertIsNone(g["_turn"]["first4oak_roll"])

    def test_apply_roll_records_first_four_of_a_kind_once(self):
        g = self.make_game()

        game_engine.apply_roll(g, randint_fn=sequence_rng([1, 2, 3, 4, 5]))
        game_engine.apply_roll(g, randint_fn=sequence_rng([2, 2, 2, 2, 5]))
        game_engine.apply_roll(g, randint_fn=sequence_rng([6, 6, 6, 6, 6]))

        self.assertEqual(g["_rolls_used"], 3)
        self.assertEqual(g["_turn"]["roll_index"], 3)
        self.assertEqual(g["_turn"]["first4oak_roll"], 2)

    def test_announced_numbers_auto_hold_new_matches_on_later_rolls_in_all_modes(self):
        for mode in (1, 2, 3, "2v2"):
            for face in range(1, 7):
                with self.subTest(mode=mode, face=face):
                    g = self.make_game(mode=mode)
                    other = face % 6 + 1
                    game_engine.apply_roll(g, randint_fn=sequence_rng([face, other, other, other, other]))
                    game_engine.apply_announcement(g, str(face))
                    self.assertEqual(g["_holds"], [True, False, False, False, False])
                    self.assertEqual(g["_auto_held_announced_indices"], [0])

                    game_engine.apply_roll(g, randint_fn=sequence_rng([face, face, other, other]))

                    self.assertEqual(g["_dice"], [face, face, face, other, other])
                    self.assertEqual(g["_holds"], [True, True, True, False, False])
                    self.assertEqual(g["_rolls_used"], 2)
                    # A later third roll retains those matches and adds a new one.
                    game_engine.apply_roll(g, randint_fn=sequence_rng([face, other]))
                    self.assertEqual(g["_holds"], [True, True, True, True, False])

    def test_first_roll_announcement_change_and_cancel_release_only_automatic_holds(self):
        g = self.make_game(mode=1)
        game_engine.apply_roll(g, randint_fn=sequence_rng([2, 2, 3, 3, 4]))
        g["_holds"] = [True, False, True, False, False]

        game_engine.apply_announcement(g, "2")
        self.assertEqual(g["_holds"], [True, True, True, False, False])
        self.assertEqual(g["_auto_held_announced_indices"], [1])

        game_engine.apply_announcement(g, "3")
        self.assertEqual(g["_holds"], [True, False, True, True, False])
        self.assertEqual(g["_auto_held_announced_indices"], [3])

        game_engine.apply_announcement(g, None)
        self.assertEqual(g["_holds"], [True, False, True, False, False])
        self.assertEqual(g["_auto_held_announced_indices"], [])

    def test_first_roll_number_auto_hold_can_be_disabled(self):
        g = self.make_game(mode=1)
        game_engine.apply_roll(g, randint_fn=sequence_rng([2, 2, 3, 3, 4]))
        g["_holds"][0] = True

        game_engine.apply_announcement(g, "2", auto_hold_announced_numbers=False)

        self.assertEqual(g["_holds"], [True, False, False, False, False])
        self.assertEqual(g["_auto_held_announced_indices"], [])

    def test_auto_holds_remain_manually_releasable_until_a_new_roll(self):
        g = self.make_game(mode=1)
        game_engine.apply_roll(g, randint_fn=sequence_rng([2, 1, 1, 1, 1]))
        g["_announced_row4"] = "2"
        g["_holds"][0] = True
        game_engine.apply_roll(g, randint_fn=sequence_rng([2, 2, 3, 4]))
        g["_holds"][1] = False

        # A released die is rerolled rather than locked to the announced face.
        game_engine.apply_roll(g, randint_fn=sequence_rng([5, 2, 6]))

        self.assertEqual(g["_dice"], [2, 5, 2, 2, 6])
        self.assertEqual(g["_holds"], [True, False, True, True, False])

    def test_auto_hold_opt_out_preserves_the_players_original_selection(self):
        g = self.make_game(mode=1)
        g["_rolls_used"] = 1
        g["_dice"] = [2, 1, 1, 1, 1]
        g["_holds"] = [True, False, False, False, False]
        g["_announced_row4"] = "2"

        game_engine.apply_roll(
            g, randint_fn=sequence_rng([2, 2, 3, 4]), auto_hold_announced_numbers=False,
        )

        self.assertEqual(g["_holds"], [True, False, False, False, False])

    def test_other_announcements_and_first_roll_do_not_auto_hold(self):
        for announced in (None, "max", "min", "kenter", "full", "poker", "60"):
            with self.subTest(announced=announced):
                g = self.make_game(mode=1)
                g["_rolls_used"] = 1
                g["_announced_row4"] = announced
                game_engine.apply_roll(g, randint_fn=sequence_rng([2, 2, 2, 2, 2]))
                self.assertEqual(g["_holds"], [False] * 5)

        for hardcore, rolls_used in ((False, 0), (True, 1)):
            with self.subTest(hardcore=hardcore, rolls_used=rolls_used):
                g = self.make_game(mode=1, hardcore=hardcore)
                g["_rolls_used"] = rolls_used
                g["_announced_row4"] = "2"
                game_engine.apply_roll(g, randint_fn=sequence_rng([2, 2, 2, 2, 2]))
                self.assertEqual(g["_holds"], [False] * 5)

    def test_begin_next_turn_resets_roll_state_and_advances_player(self):
        g = self.make_game(players=[("p1", "A"), ("p2", "B")])
        g["_dice"] = [6, 6, 6, 6, 6]
        g["_holds"] = [True, True, False, False, True]
        g["_rolls_used"] = 2
        g["_announced_row4"] = "poker"
        g["_announced_by"] = "p1"
        g["_announced_board"] = "p1"

        game_engine._begin_next_turn(g, "p1")

        self.assertEqual(g["_dice"], [0, 0, 0, 0, 0])
        self.assertEqual(g["_holds"], [False, False, False, False, False])
        self.assertEqual(g["_rolls_used"], 0)
        self.assertIsNone(g["_announced_row4"])
        self.assertIsNone(g["_announced_by"])
        self.assertIsNone(g["_announced_board"])
        self.assertEqual(g["_auto_held_announced_indices"], [])
        self.assertEqual(g["_turn"], {"player_id": "p2", "roll_index": 0, "first4oak_roll": None})

    def test_roll_cap_is_three_five_on_last_cell_and_one_in_hardcore(self):
        g = self.make_game()
        game_engine._set_roll_cap_for_current_turn(g)
        self.assertEqual(g["_rolls_max"], 3)

        g_last = self.make_game()
        board = g_last["_scoreboards"]["p1"]
        for row in game_state.WRITABLE_ROWS:
            for col in game_state.WRITABLE_COLS:
                board[f"{row},{col}"] = 0
        board.pop(f"{game_state.WRITABLE_ROWS[-1]},ang")
        game_engine._set_roll_cap_for_current_turn(g_last)
        self.assertEqual(g_last["_rolls_max"], 5)

        g_hc = self.make_game(hardcore=True)
        game_engine._set_roll_cap_for_current_turn(g_hc)
        self.assertEqual(g_hc["_rolls_max"], 1)

    def test_foreign_scoreboard_keys_do_not_complete_a_game_or_change_progress(self):
        g = self.make_game(mode=1, players=[("p1", "A")])
        board = g["_scoreboards"]["p1"]
        for index in range(game_state.WRITABLE_CELLS_PER_PLAYER):
            board[f"foreign-{index}"] = 999

        self.assertFalse(game_engine._is_game_finished(g))
        self.assertEqual(game_engine._remaining_cells_for(g, "p1"), game_state.WRITABLE_CELLS_PER_PLAYER)
        self.assertEqual(game_engine._progress_for_game(g)[0]["filled"], 0)

    def test_rolls_are_rejected_after_game_completion(self):
        g = self.make_game(mode=1, players=[("p1", "A")])
        g["_finished"] = True
        g["_started"] = False

        self.assertEqual(game_engine.can_roll_now(g, "p1"), (False, "Spiel ist bereits beendet"))

    def test_correction_disabled_reason_is_shared_across_modes(self):
        regular = self.make_game(players=[("p1", "A"), ("p2", "B")])
        single = self.make_game(mode=1)
        hardcore = self.make_game(hardcore=True)

        self.assertIsNone(game_state.correction_disabled_reason(regular))
        self.assertEqual(
            game_state.correction_disabled_reason(single),
            "Korrekturmodus ist im 1‑Spieler‑Modus deaktiviert",
        )
        self.assertEqual(
            game_state.correction_disabled_reason(hardcore),
            "Korrekturmodus ist im Hardcore-Modus deaktiviert",
        )


class WriteGuardTestCase(GameStateTestCase):
    def test_down_and_up_columns_enforce_their_required_order(self):
        g = self.make_game()

        self.assertEqual(game_engine.can_write_now(g, "p1", 0, "down", during_turn_announce=None), (True, ""))
        ok, why = game_engine.can_write_now(g, "p1", 1, "down", during_turn_announce=None)
        self.assertFalse(ok)
        self.assertIn("Zeile 0", why)

        self.assertEqual(game_engine.can_write_now(g, "p1", 15, "up", during_turn_announce=None), (True, ""))
        ok, why = game_engine.can_write_now(g, "p1", 14, "up", during_turn_announce=None)
        self.assertFalse(ok)
        self.assertIn("Zeile 15", why)

        g["_scoreboards"]["p1"]["0,down"] = 2
        self.assertEqual(game_engine.can_write_now(g, "p1", 1, "down", during_turn_announce=None), (True, ""))

    def test_active_announcement_allows_only_matching_ang_cell(self):
        g = self.make_game()
        g["_rolls_used"] = 2

        self.assertEqual(game_engine.can_write_now(g, "p1", 14, "ang", during_turn_announce="poker"), (True, ""))

        ok, why = game_engine.can_write_now(g, "p1", 13, "ang", during_turn_announce="poker")
        self.assertFalse(ok)
        self.assertIn("Angesagt ist poker", why)

        ok, why = game_engine.can_write_now(g, "p1", 14, "free", during_turn_announce="poker")
        self.assertFalse(ok)
        self.assertIn("Nur ❗-Spalte", why)

    def test_hardcore_ang_behaves_like_free_column(self):
        g = self.make_game(hardcore=True)
        g["_rolls_used"] = 1

        self.assertEqual(game_engine.can_write_now(g, "p1", 14, "ang", during_turn_announce=None), (True, ""))
        self.assertEqual(game_engine.can_write_now(g, "p1", 14, "free", during_turn_announce=None), (True, ""))


class PokerStrikeRuleTestCase(unittest.TestCase):
    def test_regular_columns_score_poker_only_on_first_four_kind_roll(self):
        dice = [4, 4, 4, 4, 2]

        self.assertTrue(game_scoring.poker_points_allowed(dice, "free", roll_index=1, first4oak_roll=1))
        self.assertFalse(game_scoring.poker_points_allowed(dice, "free", roll_index=2, first4oak_roll=1))

    def test_five_of_a_kind_always_scores_as_poker(self):
        dice = [6, 6, 6, 6, 6]

        self.assertTrue(game_scoring.poker_points_allowed(dice, "down", roll_index=3, first4oak_roll=1))

    def test_announced_poker_scores_in_ang_after_later_four_kind_roll(self):
        dice = [4, 4, 4, 4, 2]

        self.assertTrue(
            game_scoring.poker_points_allowed(
                dice,
                "ang",
                roll_index=2,
                first4oak_roll=1,
                announced_poker=True,
            )
        )

    def test_correction_can_use_remembered_first_four_kind_roll(self):
        dice = [4, 4, 4, 4, 2]

        self.assertFalse(game_scoring.poker_points_allowed(dice, "free", roll_index=3, first4oak_roll=1))
        self.assertTrue(
            game_scoring.poker_points_allowed(
                dice,
                "free",
                roll_index=3,
                first4oak_roll=1,
                correction=True,
            )
        )
