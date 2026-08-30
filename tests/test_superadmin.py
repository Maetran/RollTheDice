from app import main
from tests.support import GameStateTestCase


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
        self.assertFalse(main.action_blocked_by_superadmin(g, "superadmin_roll_dice"))
        self.assertFalse(main.action_blocked_by_superadmin(g, "superadmin_set_die"))

    def test_extra_roll_replaces_only_free_dice_without_changing_turn_flow(self):
        g = self.make_game(mode=2, players=[("p1", "Admin"), ("p2", "Other")])
        g["_dice"] = [1, 2, 3, 4, 5]
        g["_holds"] = [True, False, True, False, False]
        g["_rolls_used"] = 3
        g["_rolls_max"] = 3
        g["_turn"] = {"player_id": "p1", "roll_index": 3, "first4oak_roll": 1}
        g["_announced_row4"] = "5"
        g["_superadmins"]["p1"] = {"board_id": "p1"}

        rolls = iter([6, 1, 2])
        result = main.apply_superadmin_roll(g, "p1", randint_fn=lambda _low, _high: next(rolls))

        self.assertEqual(g["_dice"], [1, 6, 3, 1, 2])
        self.assertEqual(g["_holds"], [True, False, True, False, False])
        self.assertEqual(g["_rolls_used"], 3)
        self.assertEqual(g["_rolls_max"], 3)
        self.assertEqual(g["_turn"], {"player_id": "p1", "roll_index": 3, "first4oak_roll": 1})
        self.assertEqual(g["_announced_row4"], "5")
        self.assertEqual(result["changed_indices"], [1, 3, 4])

    def test_single_die_edit_becomes_current_scoring_truth(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])
        g["_dice"] = [1, 3, 3, 4, 6]
        g["_rolls_used"] = 2
        g["_turn"] = {"player_id": "p1", "roll_index": 2, "first4oak_roll": None}
        g["_superadmins"]["p1"] = {"board_id": "p1"}

        result = main.apply_superadmin_die_change(g, "p1", 4, 5)

        self.assertEqual(g["_dice"], [1, 3, 3, 4, 5])
        self.assertEqual(main.score_field_value("5", g["_dice"]), 5)
        self.assertEqual(g["_rolls_used"], 2)
        self.assertEqual(g["_turn"]["roll_index"], 2)
        self.assertEqual(result["old"], 6)
        self.assertEqual(result["new"], 5)

    def test_die_edit_reconciles_current_poker_metadata(self):
        g = self.make_game(mode=1, players=[("p1", "Admin")])
        g["_dice"] = [5, 5, 5, 2, 5]
        g["_rolls_used"] = 2
        g["_turn"] = {"player_id": "p1", "roll_index": 2, "first4oak_roll": None}
        g["_superadmins"]["p1"] = {"board_id": "p1"}

        main.apply_superadmin_die_change(g, "p1", 3, 5)
        self.assertEqual(g["_turn"]["first4oak_roll"], 2)

        main.apply_superadmin_die_change(g, "p1", 3, 2)
        self.assertEqual(g["_turn"]["first4oak_roll"], 2)

        main.apply_superadmin_die_change(g, "p1", 0, 1)
        self.assertIsNone(g["_turn"]["first4oak_roll"])

    def test_dice_edit_is_limited_to_active_target_board_and_existing_roll(self):
        g = self.make_game(mode=2, players=[("p1", "Admin"), ("p2", "Other")])
        g["_superadmins"]["p1"] = {"board_id": "p2"}
        g["_rolls_used"] = 1

        with self.assertRaisesRegex(ValueError, "aktuell aktiven Spieler"):
            main.apply_superadmin_die_change(g, "p1", 0, 5)

        g["_superadmins"]["p1"] = {"board_id": "p1"}
        g["_rolls_used"] = 0
        with self.assertRaisesRegex(ValueError, "ersten regulären Wurf"):
            main.apply_superadmin_roll(g, "p1")

    def test_save_exit_preserves_current_turn_in_all_player_modes(self):
        for mode in (1, 2, 3, "2v2"):
            with self.subTest(mode=mode):
                count = 4 if mode == "2v2" else int(mode)
                players = [(f"p{i}", f"Player {i}") for i in range(1, count + 1)]
                g = self.make_game(mode=mode, players=players)
                active_id = players[-1][0]
                original_turn = {"player_id": active_id, "roll_index": 2, "first4oak_roll": 1}
                g["_turn"] = original_turn.copy()
                g["_dice"] = [6, 6, 6, 6, 2]
                g["_holds"] = [True, True, True, True, False]
                g["_rolls_used"] = 2
                g["_superadmins"]["p1"] = {"board_id": main.board_key_for_actor(g, "p1")}

                restored = main.complete_superadmin_save(g, "p1")

                self.assertEqual(restored, active_id)
                self.assertEqual(g["_turn"], original_turn)
                self.assertEqual(g["_dice"], [6, 6, 6, 6, 2])
                self.assertEqual(g["_holds"], [True, True, True, True, False])
                self.assertEqual(g["_rolls_used"], 2)
                self.assertFalse(main.superadmin_edit_active(g))
                self.assertFalse(main.action_blocked_by_superadmin(g, "roll_dice"))

    def test_save_exit_repairs_missing_turn_in_all_player_modes(self):
        for mode in (1, 2, 3, "2v2"):
            with self.subTest(mode=mode):
                count = 4 if mode == "2v2" else int(mode)
                players = [(f"p{i}", f"Player {i}") for i in range(1, count + 1)]
                g = self.make_game(mode=mode, players=players)
                g["_turn"] = None
                g["_dice"] = [5, 4, 3, 2, 1]
                g["_holds"] = [True] * 5
                g["_rolls_used"] = 3
                g["_superadmins"]["p1"] = {"board_id": main.board_key_for_actor(g, "p1")}

                restored = main.complete_superadmin_save(g, "p1")

                self.assertEqual(restored, "p1")
                self.assertEqual(g["_turn"], {"player_id": "p1", "roll_index": 0, "first4oak_roll": None})
                self.assertEqual(g["_dice"], [0, 0, 0, 0, 0])
                self.assertEqual(g["_holds"], [False] * 5)
                self.assertEqual(g["_rolls_used"], 0)
                self.assertFalse(main.superadmin_edit_active(g))
