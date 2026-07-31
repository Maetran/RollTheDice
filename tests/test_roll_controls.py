import unittest
from unittest.mock import patch

from app import main


class RollControlTestCase(unittest.TestCase):
    def setUp(self):
        self.gids = []

    def tearDown(self):
        for gid in self.gids:
            main.games.pop(gid, None)

    def make_game(self, *, mode=2, hardcore=False):
        gid = f"test-{len(self.gids)}"
        self.gids.append(gid)
        g = main.new_game(gid, "Test Game", mode)
        players = [{"id": "p1", "name": "A", "ws": None}]
        if int(g["_expected"]) > 1:
            players.append({"id": "p2", "name": "B", "ws": None})
        g["_players"] = players
        g["_scoreboards"] = {p["id"]: {} for p in players}
        g["_hardcore"] = hardcore
        g["_started"] = True
        g["_turn"] = {"player_id": "p1", "roll_index": 0, "first4oak_roll": None}
        g["_correction"] = {"active": False}
        g["_dice"] = [0, 0, 0, 0, 0]
        g["_holds"] = [False] * 5
        g["_rolls_used"] = 0
        g["_rolls_max"] = 3
        return g

    @staticmethod
    def fill_regular_columns(board):
        for row in main.WRITABLE_ROWS:
            for col in ("down", "free", "up"):
                board[f"{row},{col}"] = 1

    def test_roll_cooldown_blocks_same_player_until_window_elapsed(self):
        g = {}

        with patch.object(main.time, "monotonic", side_effect=[100.0, 100.3, 100.61]):
            self.assertTrue(main.roll_cooldown_ok(g, "p1"))
            self.assertFalse(main.roll_cooldown_ok(g, "p1"))
            self.assertTrue(main.roll_cooldown_ok(g, "p1"))

    def test_roll_cooldown_is_tracked_per_player(self):
        g = {}

        with patch.object(main.time, "monotonic", side_effect=[200.0, 200.1]):
            self.assertTrue(main.roll_cooldown_ok(g, "p1"))
            self.assertTrue(main.roll_cooldown_ok(g, "p2"))

    def test_current_player_can_roll_before_cap(self):
        g = self.make_game()

        ok, why = main.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_inactive_player_cannot_roll(self):
        g = self.make_game()

        ok, why = main.can_roll_now(g, "p2")

        self.assertFalse(ok)
        self.assertEqual(why, "Nicht an der Reihe")

    def test_roll_is_blocked_while_correction_is_active(self):
        g = self.make_game()
        g["_correction"] = {"active": True, "player_id": "p1"}

        ok, why = main.can_roll_now(g, "p1")

        self.assertFalse(ok)
        self.assertEqual(why, "Während Korrektur nicht erlaubt")

    def test_roll_is_blocked_when_no_rolls_remain(self):
        g = self.make_game()
        g["_rolls_used"] = 3
        g["_rolls_max"] = 3

        ok, why = main.can_roll_now(g, "p1")

        self.assertFalse(ok)
        self.assertEqual(why, "Keine Würfe mehr")

    def test_must_announce_blocks_roll_after_first_roll_when_only_announce_column_is_open(self):
        g = self.make_game()
        self.fill_regular_columns(g["_scoreboards"]["p1"])
        g["_rolls_used"] = 1

        self.assertTrue(main._must_announce_after_first(g, "p1"))
        ok, why = main.can_roll_now(g, "p1")

        self.assertFalse(ok)
        self.assertIn("❗-Feld ansagen", why)

    def test_announced_field_allows_next_roll_after_announce_required_state(self):
        g = self.make_game()
        self.fill_regular_columns(g["_scoreboards"]["p1"])
        g["_rolls_used"] = 1
        g["_announced_row4"] = "poker"

        ok, why = main.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_announce_requirement_is_not_applied_in_hardcore(self):
        g = self.make_game(hardcore=True)
        self.fill_regular_columns(g["_scoreboards"]["p1"])
        g["_rolls_used"] = 1
        g["_rolls_max"] = 2

        self.assertFalse(main._must_announce_after_first(g, "p1"))
        ok, why = main.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_last_open_cell_does_not_force_announce(self):
        g = self.make_game()
        board = g["_scoreboards"]["p1"]
        self.fill_regular_columns(board)
        for row in main.WRITABLE_ROWS[:-1]:
            board[f"{row},ang"] = 0
        g["_rolls_used"] = 1

        self.assertEqual(main._remaining_cells_for(g, "p1"), 1)
        self.assertFalse(main._must_announce_after_first(g, "p1"))
        ok, why = main.can_roll_now(g, "p1")

        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_snapshot_requests_auto_roll_for_new_single_player_turn(self):
        g = self.make_game(mode=1)

        snap = main.snapshot(g)

        self.assertTrue(snap["_auto_single"])

    def test_snapshot_does_not_request_auto_roll_after_roll_started(self):
        g = self.make_game(mode=1)
        g["_rolls_used"] = 1
        g["_dice"] = [1, 2, 3, 4, 5]

        snap = main.snapshot(g)

        self.assertFalse(snap["_auto_single"])


if __name__ == "__main__":
    unittest.main()
