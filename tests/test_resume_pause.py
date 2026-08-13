from tests.support import GameStateTestCase

from app import main


class ResumePauseTests(GameStateTestCase):
    def test_multiplayer_snapshot_pauses_when_a_player_is_offline(self):
        g = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        g["_players"][0]["ws"] = object()
        g["_players"][1]["ws"] = None

        snap = main.snapshot(g)

        self.assertTrue(snap["_paused"])
        self.assertEqual(snap["_offline_players"], [{"id": "p2", "name": "Ben"}])
        self.assertEqual(snap["_connected"], {"p1": True, "p2": False})

        ok, why = main.can_roll_now(g, "p1")
        self.assertFalse(ok)
        self.assertIn("Ben", why)

    def test_multiplayer_unpauses_when_all_players_are_connected(self):
        g = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Ben")])
        for player in g["_players"]:
            player["ws"] = object()

        snap = main.snapshot(g)
        ok, why = main.can_roll_now(g, "p1")

        self.assertFalse(snap["_paused"])
        self.assertEqual(snap["_offline_players"], [])
        self.assertTrue(ok, why)

    def test_single_player_is_not_paused_by_missing_socket(self):
        g = self.make_game(mode=1, players=[("p1", "Solo")])
        g["_players"][0]["ws"] = None

        snap = main.snapshot(g)
        ok, why = main.can_roll_now(g, "p1")

        self.assertFalse(snap["_paused"])
        self.assertEqual(snap["_offline_players"], [])
        self.assertTrue(ok, why)

    def test_manual_pause_pauses_single_player_and_reports_timeout(self):
        g = self.make_game(mode=1, players=[("p1", "Solo")])
        g["_manual_pause"] = True
        g["_manual_pause_by"] = "p1"
        g["_manual_pause_by_name"] = "Solo"

        snap = main.snapshot(g)
        ok, why = main.can_roll_now(g, "p1")

        self.assertTrue(snap["_paused"])
        self.assertTrue(snap["_manual_pause"])
        self.assertEqual(snap["_timeout_seconds"], 3600)
        self.assertIn("1 h 0 min", snap["_pause_reason"])
        self.assertFalse(ok)
        self.assertIn("Solo hat das Spiel pausiert", why)
