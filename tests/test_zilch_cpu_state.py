"""Focused durable-state contracts for Zilch CPU participants.

These tests stop short of the runner and gameplay actions.  They prove the
important boundary that a CPU is a real Zilch seat, never a WebSocket player.
"""

from __future__ import annotations

from unittest import TestCase

from app.active_games import serializable_game_state
from app.game_registry import project_game_progress
from app.game_state import games
from app.zilch_snapshot import snapshot_zilch
from app.zilch_state import (
    ZILCH_CPU_MODE,
    ZILCH_SOLO_MODE,
    configure_zilch_cpu_game,
    configure_zilch_solo_game,
    join_zilch_player,
    new_zilch_game,
    start_zilch_game,
    zilch_expected_connection_count,
    zilch_human_join_error,
    zilch_is_ready_to_start,
)


class ZilchCpuStateTestCase(TestCase):
    def setUp(self) -> None:
        self.game_ids: list[str] = []

    def tearDown(self) -> None:
        for game_id in self.game_ids:
            games.pop(game_id, None)

    def _new_game(self, *, game_id: str = "zilch-cpu-state") -> dict:
        self.game_ids.append(game_id)
        return new_zilch_game(game_id, "CPU table", 2)

    @staticmethod
    def _host(*, user_id: int = 7) -> dict:
        return {"id": "human-1", "name": "Mani", "user_id": user_id, "ws": object()}

    def test_cpu_configuration_keeps_cpu_out_of_transport_players_and_starts_with_one_human(self) -> None:
        game = self._new_game()
        game["_passphrase"] = "room-lock"

        cpu = configure_zilch_cpu_game(game, host_user_id=7, cpu_strategy="normal")

        self.assertEqual(game["_play_mode"], ZILCH_CPU_MODE)
        self.assertEqual(game["_expected"], 2)
        self.assertEqual(game["_expected_connections"], 1)
        self.assertEqual(game["_passphrase"], "room-lock")
        self.assertEqual(game["_players"], [])
        self.assertEqual(game["_participants"], [cpu])
        self.assertEqual(cpu["type"], "cpu")
        self.assertIsNone(cpu["connection_player_id"])
        self.assertIsNone(cpu["user_id"])
        self.assertEqual(cpu["cpu_strategy"], "normal")
        self.assertIn(cpu["id"], game["_zilch_boards"])
        self.assertEqual(zilch_expected_connection_count(game), 1)
        self.assertFalse(zilch_is_ready_to_start(game))

        join_zilch_player(game, self._host())
        self.assertTrue(zilch_is_ready_to_start(game))
        self.assertEqual([participant["type"] for participant in game["_participants"]], ["human", "cpu"])
        self.assertEqual(len(game["_players"]), 1)

        start_zilch_game(game)
        projected = snapshot_zilch(game)
        self.assertTrue(projected["_started"])
        self.assertEqual(projected["_players_joined"], 1)
        self.assertEqual(projected["_connections_joined"], 1)
        self.assertEqual(projected["_expected_connections"], 1)
        self.assertEqual(projected["_participants_joined"], 2)
        self.assertEqual(projected["_expected_participants"], 2)
        self.assertEqual([player["id"] for player in projected["_players"]], ["human-1"])
        self.assertEqual([participant["type"] for participant in projected["_participants"]], ["human", "cpu"])
        cpu_view = next(participant for participant in projected["_participants"] if participant["type"] == "cpu")
        self.assertTrue(cpu_view["is_cpu"])
        self.assertIsNone(cpu_view["connected"])
        self.assertEqual(projected["_participant_connected"][cpu_view["id"]], None)
        self.assertIsNone(projected["_zilch_boards"][cpu_view["id"]]["connected"])
        self.assertEqual(projected["_offline_players"], [])
        self.assertEqual(set(projected["_zilch_boards"]), {"human-1", cpu_view["id"]})

        progress = project_game_progress(game)
        self.assertEqual([entry["participant_type"] for entry in progress], ["human", "cpu"])
        self.assertIsNone(progress[1]["connected"])
        self.assertEqual(progress[1]["cpu_strategy"], "normal")

        durable = serializable_game_state(game)
        self.assertEqual(durable["_expected_connections"], 1)
        self.assertEqual(durable["_participants"][1]["type"], "cpu")
        self.assertIsNone(durable["_participants"][1]["connection_player_id"])

    def test_cpu_human_seat_is_bound_to_creator_and_never_accepts_a_second_transport_player(self) -> None:
        game = self._new_game()
        configure_zilch_cpu_game(game, host_user_id=7, cpu_strategy="conservative")

        self.assertEqual(zilch_human_join_error(game, user_id=8), "zilch_cpu_host_required")
        with self.assertRaisesRegex(ValueError, "zilch_cpu_host_required"):
            join_zilch_player(game, self._host(user_id=8))

        join_zilch_player(game, self._host())
        self.assertEqual(zilch_human_join_error(game, user_id=7), "zilch_cpu_human_seat_taken")
        with self.assertRaisesRegex(ValueError, "zilch_cpu_human_seat_taken"):
            join_zilch_player(game, {"id": "human-2", "name": "Mani", "user_id": 7, "ws": object()})

    def test_guest_host_capability_is_hashed_and_can_open_only_its_cpu_or_solo_seat(self) -> None:
        token = "guest-capability-token-which-is-long-enough"
        cpu_game = self._new_game(game_id="zilch-guest-cpu")
        configure_zilch_cpu_game(cpu_game, host_token=token, cpu_strategy="normal")

        self.assertEqual(cpu_game["_play_mode"], ZILCH_CPU_MODE)
        self.assertIsNone(cpu_game["_zilch_cpu_host_user_id"])
        self.assertIn("_zilch_cpu_host_token_hash", cpu_game)
        self.assertNotIn(token, repr(serializable_game_state(cpu_game)))
        self.assertEqual(zilch_human_join_error(cpu_game, user_id=None, host_token="wrong"), "zilch_cpu_host_required")
        self.assertIsNone(zilch_human_join_error(cpu_game, user_id=None, host_token=token))

        guest_player = {"id": "guest-cpu", "name": "Gast", "user_id": None, "ws": object(), "_zilch_host_token": token}
        join_zilch_player(cpu_game, guest_player)
        self.assertNotIn("_zilch_host_token", guest_player)
        self.assertNotIn(token, repr(serializable_game_state(cpu_game)))
        self.assertEqual(zilch_human_join_error(cpu_game, user_id=None, host_token=token), "zilch_cpu_human_seat_taken")

        solo_game = self._new_game(game_id="zilch-guest-solo")
        configure_zilch_solo_game(solo_game, host_token=token)
        self.assertEqual(solo_game["_play_mode"], ZILCH_SOLO_MODE)
        self.assertIsNone(solo_game["_zilch_solo_host_user_id"])
        self.assertNotIn(token, repr(serializable_game_state(solo_game)))
        self.assertEqual(zilch_human_join_error(solo_game, user_id=None, host_token="wrong"), "zilch_solo_host_required")
        join_zilch_player(
            solo_game,
            {"id": "guest-solo", "name": "Gast", "user_id": None, "ws": object(), "_zilch_host_token": token},
        )
        self.assertNotIn(token, repr(serializable_game_state(solo_game)))

    def test_legacy_human_multiplayer_snapshots_still_require_two_connections(self) -> None:
        game = self._new_game(game_id="zilch-hvh-legacy-connections")
        game.pop("_expected_connections")
        join_zilch_player(game, {"id": "p1", "name": "One", "user_id": 1, "ws": object()})

        self.assertEqual(zilch_expected_connection_count(game), 2)
        self.assertFalse(zilch_is_ready_to_start(game))
        start_zilch_game(game)
        self.assertFalse(game["_started"])

        join_zilch_player(game, {"id": "p2", "name": "Two", "user_id": 2, "ws": object()})
        self.assertTrue(zilch_is_ready_to_start(game))
        start_zilch_game(game)
        self.assertTrue(game["_started"])
        self.assertEqual(game["_expected_connections"], 2)
