from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app import game_engine, game_snapshot, game_state
from tests.support import GameStateTestCase


class RollControlTestCase(GameStateTestCase):
    def test_inactivity_timeout_aborts_after_one_hour(self):
        g = self.make_game()

        g["_last_activity"] = datetime.now(timezone.utc) - timedelta(minutes=59)
        self.assertFalse(game_state.check_timeout_and_abort(g))
        self.assertTrue(g["_started"])
        self.assertFalse(g.get("_finished"))

        g["_last_activity"] = datetime.now(timezone.utc) - timedelta(minutes=61)
        self.assertTrue(game_state.check_timeout_and_abort(g))
        self.assertFalse(g["_started"])
        self.assertTrue(g["_finished"])
        self.assertTrue(g["_aborted"])

    @staticmethod
    def fill_regular_columns(board):
        for row in game_state.WRITABLE_ROWS:
            for col in ("down", "free", "up"):
                board[f"{row},{col}"] = 1

    def test_roll_cooldown_blocks_same_player_until_window_elapsed(self):
        g = {}

        with patch("app.game_state.time.monotonic", side_effect=[100.0, 100.3, 100.61]):
            self.assertTrue(game_state.roll_cooldown_ok(g, "p1"))
            self.assertFalse(game_state.roll_cooldown_ok(g, "p1"))
            self.assertTrue(game_state.roll_cooldown_ok(g, "p1"))

    def test_roll_cooldown_is_tracked_per_player(self):
        g = {}

        with patch("app.game_state.time.monotonic", side_effect=[200.0, 200.1]):
            self.assertTrue(game_state.roll_cooldown_ok(g, "p1"))
            self.assertTrue(game_state.roll_cooldown_ok(g, "p2"))

    def test_current_player_can_roll_before_cap(self):
        g = self.make_game()

        ok, why = game_engine.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_inactive_player_cannot_roll(self):
        g = self.make_game()

        ok, why = game_engine.can_roll_now(g, "p2")

        self.assertFalse(ok)
        self.assertEqual(why, "Nicht an der Reihe")

    def test_roll_is_blocked_while_correction_is_active(self):
        g = self.make_game()
        g["_correction"] = {"active": True, "player_id": "p1"}

        ok, why = game_engine.can_roll_now(g, "p1")

        self.assertFalse(ok)
        self.assertEqual(why, "Während Korrektur nicht erlaubt")

    def test_roll_is_blocked_when_no_rolls_remain(self):
        g = self.make_game()
        g["_rolls_used"] = 3
        g["_rolls_max"] = 3

        ok, why = game_engine.can_roll_now(g, "p1")

        self.assertFalse(ok)
        self.assertEqual(why, "Keine Würfe mehr")

    def test_must_announce_blocks_roll_after_first_roll_when_only_announce_column_is_open(self):
        g = self.make_game()
        self.fill_regular_columns(g["_scoreboards"]["p1"])
        g["_rolls_used"] = 1

        self.assertTrue(game_engine._must_announce_after_first(g, "p1"))
        ok, why = game_engine.can_roll_now(g, "p1")

        self.assertFalse(ok)
        self.assertIn("❗-Feld ansagen", why)

    def test_announced_field_allows_next_roll_after_announce_required_state(self):
        g = self.make_game()
        self.fill_regular_columns(g["_scoreboards"]["p1"])
        g["_rolls_used"] = 1
        g["_announced_row4"] = "poker"

        ok, why = game_engine.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_announce_requirement_is_not_applied_in_hardcore(self):
        g = self.make_game(hardcore=True)
        self.fill_regular_columns(g["_scoreboards"]["p1"])
        g["_rolls_used"] = 1
        g["_rolls_max"] = 2

        self.assertFalse(game_engine._must_announce_after_first(g, "p1"))
        ok, why = game_engine.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_last_open_cell_does_not_force_announce(self):
        g = self.make_game()
        board = g["_scoreboards"]["p1"]
        self.fill_regular_columns(board)
        for row in game_state.WRITABLE_ROWS[:-1]:
            board[f"{row},ang"] = 0
        g["_rolls_used"] = 1

        self.assertEqual(game_engine._remaining_cells_for(g, "p1"), 1)
        self.assertFalse(game_engine._must_announce_after_first(g, "p1"))
        ok, why = game_engine.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_snapshot_requests_auto_roll_for_new_single_player_turn(self):
        g = self.make_game(mode=1)

        snap = game_snapshot.snapshot(g)

        self.assertTrue(snap["_auto_single"])

    def test_snapshot_does_not_request_auto_roll_after_roll_started(self):
        g = self.make_game(mode=1)
        g["_rolls_used"] = 1
        g["_dice"] = [1, 2, 3, 4, 5]

        snap = game_snapshot.snapshot(g)

        self.assertFalse(snap["_auto_single"])
