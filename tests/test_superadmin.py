from tests.support import GameStateTestCase
from app import main


class SuperadminEditTestCase(GameStateTestCase):
    def test_existing_field_can_be_changed_to_nonnegative_integer(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])
        g["_scoreboards"]["p1"]["0,down"] = 3

        applied = main.apply_superadmin_changes(
            g,
            "p1",
            "p1",
            [{"row": 0, "field": "down", "value": 7}],
        )

        self.assertEqual(g["_scoreboards"]["p1"]["0,down"], 7)
        self.assertEqual(applied[0]["old"], 3)
        self.assertEqual(applied[0]["new"], 7)
        self.assertEqual(g["_admin_edits"]["p1"]["0,down"]["new"], 7)

    def test_empty_field_requires_matching_delete(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])

        with self.assertRaisesRegex(ValueError, "Leere Felder"):
            main.apply_superadmin_changes(
                g,
                "p1",
                "p1",
                [{"row": 1, "field": "down", "value": 4}],
            )

    def test_delete_and_write_empty_field_in_same_save(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])
        g["_scoreboards"]["p1"]["0,down"] = 3

        applied = main.apply_superadmin_changes(
            g,
            "p1",
            "p1",
            [
                {"row": 0, "field": "down", "delete": True},
                {"row": 1, "field": "down", "value": 4},
            ],
        )

        self.assertNotIn("0,down", g["_scoreboards"]["p1"])
        self.assertEqual(g["_scoreboards"]["p1"]["1,down"], 4)
        self.assertEqual(len(g["_scoreboards"]["p1"]), 1)
        self.assertEqual([c["new"] for c in applied], [None, 4])
        self.assertIsNone(g["_admin_edits"]["p1"]["0,down"]["new"])
        self.assertEqual(g["_admin_edits"]["p1"]["1,down"]["old"], None)

    def test_delete_batch_rejects_existing_field_write(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])
        g["_scoreboards"]["p1"]["0,down"] = 3
        g["_scoreboards"]["p1"]["1,down"] = 4

        with self.assertRaisesRegex(ValueError, "nur leere Felder"):
            main.apply_superadmin_changes(
                g,
                "p1",
                "p1",
                [
                    {"row": 0, "field": "down", "delete": True},
                    {"row": 1, "field": "down", "value": 8},
                ],
            )

    def test_chat_history_is_capped(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])

        for i in range(main.CHAT_HISTORY_LIMIT + 5):
            main._append_chat_history(g, {"sender": "Tester", "text": f"msg-{i}", "kind": "chat"})

        self.assertEqual(len(g["_chat_history"]), main.CHAT_HISTORY_LIMIT)
        self.assertEqual(g["_chat_history"][0]["text"], "msg-5")

    def test_snapshot_exposes_superadmin_lock_state(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])
        self.assertFalse(main.snapshot(g)["_superadmin_active"])

        g["_superadmins"]["p1"] = {"board_id": "p1"}

        self.assertTrue(main.superadmin_edit_active(g))
        self.assertTrue(main.snapshot(g)["_superadmin_active"])

    def test_superadmin_lock_blocks_scoreboard_and_dice_actions_only(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])
        g["_superadmins"]["p1"] = {"board_id": "p1"}

        for action in main.SUPERADMIN_BLOCKED_ACTIONS:
            self.assertTrue(main.action_blocked_by_superadmin(g, action), action)

        self.assertFalse(main.action_blocked_by_superadmin(g, "chat_message"))
        self.assertFalse(main.action_blocked_by_superadmin(g, "superadmin_save"))
        self.assertFalse(main.action_blocked_by_superadmin(g, "superadmin_deactivate"))
