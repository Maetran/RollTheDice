from copy import deepcopy
from unittest.mock import patch

from app.game_snapshot import snapshot_zdwa
from tests.support import GameStateTestCase


class CorrectionAvailabilityTestCase(GameStateTestCase):
    def test_snapshot_distinguishes_direct_announce_column_entries_from_announced_turns(self):
        game = self.make_game()
        game["_turn"]["player_id"] = "p2"
        game["_last_write"]["p1"] = (0, "ang", 1)
        game["_last_dice"]["p1"] = [1, 2, 3, 4, 5]
        game["_last_meta"]["p1"] = {"announced": False}
        with patch("app.game_snapshot.multiplayer_pause_reason", return_value=None):
            direct = snapshot_zdwa(game)
            self.assertEqual(direct["_can_request_correction"], {"p1": True, "p2": False})
            self.assertNotIn("_last_meta", direct)
            self.assertNotIn("_last_dice", direct)
            game["_last_meta"]["p1"]["announced"] = True
            self.assertFalse(snapshot_zdwa(game)["_can_request_correction"]["p1"])

    def test_correction_control_disappears_when_the_next_roll_or_another_lock_closes_it(self):
        game = self.make_game()
        game["_turn"]["player_id"] = "p2"
        game["_last_write"]["p1"] = (0, "free", 1)
        game["_last_dice"]["p1"] = [1, 2, 3, 4, 5]
        for updates in (
            {"_rolls_used": 1},
            {"_correction": {"active": True, "player_id": "p1"}},
            {"_hardcore": True},
            {"_expected": 1},
            {"_started": False},
            {"_last_dice": {}},
            {"_last_meta": {"p1": {"correction_expired": True}}},
        ):
            with self.subTest(updates=updates):
                candidate = deepcopy(game)
                candidate.update(updates)
                with patch("app.game_snapshot.multiplayer_pause_reason", return_value=None):
                    self.assertFalse(snapshot_zdwa(candidate)["_can_request_correction"]["p1"])
        with patch("app.game_snapshot.multiplayer_pause_reason", return_value="Offline"):
            self.assertFalse(snapshot_zdwa(game)["_can_request_correction"]["p1"])

    def test_team_snapshot_reports_availability_for_players_instead_of_team_ids(self):
        game = self.make_game(mode="2v2")
        game["_turn"]["player_id"] = "p2"
        game["_last_write"]["p1"] = (0, "free", 1)
        game["_last_dice"]["p1"] = [1, 2, 3, 4, 5]
        with patch("app.game_snapshot.multiplayer_pause_reason", return_value=None):
            self.assertEqual(
                snapshot_zdwa(game)["_can_request_correction"],
                {"p1": True, "p2": False, "p3": False, "p4": False},
            )
