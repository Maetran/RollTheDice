"""Focused durability and privacy tests for interrupted game records."""

from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import AsyncMock, patch

from sqlalchemy import select

from app import main
from app.abandoned_games import AbandonedGameWriteResult, persist_abandoned_game
from app.achievements import sync_user_achievements
from app.active_games import load_active_games, save_active_game
from app.api_users import abandonment_statistics_for_user
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_ws_session import GameSocketSession
from app.game_ws_social import _end_game
from app.models import AbandonedGame, AbandonedGameParticipant, ActiveGame, CompletedGame, User
from app.zilch_gameplay import apply_zilch_abandon_solo
from app.zilch_results import finalize_zilch_result
from app.zilch_state import (
    configure_zilch_solo_game,
    current_zilch_turn,
    join_zilch_player,
    new_zilch_game,
    start_zilch_game,
)


class AbandonedGamePersistenceTestCase(TestCase):
    """Interrupted games must be independent from completed-result storage."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "abandoned-games.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _timestamp(hour: int) -> str:
        return datetime(2026, 9, 12, hour, tzinfo=timezone.utc).isoformat()

    def _zdwa_game(self, *, user_id: int | None, started: bool = True) -> dict:
        return {
            "_id": "zdwa-abandoned-1",
            "_game_type": "zdwa",
            "_name": "Unterbrochene Runde",
            "_mode": "2",
            "_hardcore": False,
            "_started_at": self._timestamp(12) if started else None,
            "_updated_at": self._timestamp(13),
            "_aborted": True,
            "_abort_reason": "manual",
            "_aborted_by_player_id": "account-seat",
            "_players": [
                {"id": "account-seat", "name": "Anna", "user_id": user_id},
                {"id": "guest-seat", "name": "Gast", "user_id": None},
            ],
        }

    def test_started_game_stores_only_existing_account_participants(self) -> None:
        user = create_user("Anna", "secure-password-123", must_change_password=False)
        result = persist_abandoned_game(self._zdwa_game(user_id=user.id), aborted_by_player_id="account-seat")

        self.assertEqual(result.status, "stored")
        self.assertTrue(result.succeeded)
        with session_scope() as db:
            row = db.scalar(select(AbandonedGame).where(AbandonedGame.game_id == "zdwa-abandoned-1"))
            self.assertIsNotNone(row)
            assert row is not None
            self.assertEqual(row.reason, "manual")
            self.assertEqual(row.aborted_by_user_id, user.id)
            participants = list(
                db.scalars(
                    select(AbandonedGameParticipant).where(AbandonedGameParticipant.abandoned_game_id == row.id)
                )
            )

        self.assertEqual([(entry.user_id, entry.was_abort_initiator) for entry in participants], [(user.id, True)])

    def test_repeat_write_is_idempotent_and_never_duplicates_a_statistic(self) -> None:
        user = create_user("Ben", "secure-password-123", must_change_password=False)
        game = self._zdwa_game(user_id=user.id)

        first = persist_abandoned_game(game, aborted_by_player_id="account-seat")
        second = persist_abandoned_game(game, aborted_by_player_id="account-seat")

        self.assertEqual(first.status, "stored")
        self.assertEqual(second.status, "already_stored")
        self.assertEqual(first.abandoned_game_id, second.abandoned_game_id)
        with session_scope() as db:
            self.assertEqual(len(list(db.scalars(select(AbandonedGame)))), 1)
            self.assertEqual(len(list(db.scalars(select(AbandonedGameParticipant)))), 1)

    def test_lobby_cancellation_and_unknown_numeric_ids_are_not_retained(self) -> None:
        not_started = self._zdwa_game(user_id=1, started=False)
        self.assertEqual(persist_abandoned_game(not_started).status, "skipped")
        self.assertEqual(persist_abandoned_game(not_started).reason, "game_not_started")

        unknown_account = self._zdwa_game(user_id=999_999)
        unknown_account["_id"] = "zdwa-abandoned-unknown-account"
        self.assertEqual(persist_abandoned_game(unknown_account).status, "skipped")
        self.assertEqual(persist_abandoned_game(unknown_account).reason, "no_account_participants")
        with session_scope() as db:
            self.assertEqual(len(list(db.scalars(select(AbandonedGame)))), 0)

    def test_zilch_cpu_cannot_be_attributed_as_an_account_initiator(self) -> None:
        user = create_user("Cleo", "secure-password-123", must_change_password=False)
        game = {
            "_id": "zilch-abandoned-cpu",
            "_game_type": "zilch",
            "_name": "Zilch gegen den Würfelwirt",
            "_mode": "2",
            "_hardcore": False,
            "_started_at": self._timestamp(14),
            "_finished_at": self._timestamp(15),
            "_aborted": True,
            "_abort_reason": "manual",
            "_participants": [
                {"id": "human", "type": "human", "user_id": user.id},
                {"id": "cpu", "type": "cpu", "user_id": None},
            ],
        }

        result = persist_abandoned_game(game, aborted_by_player_id="cpu")

        self.assertEqual(result.status, "skipped")
        with session_scope() as db:
            row = db.scalar(select(AbandonedGame).where(AbandonedGame.game_id == game["_id"]))
            self.assertIsNone(row)

    def test_public_counts_exclude_timeouts_and_opponents(self) -> None:
        owner = create_user("Dora", "secure-password-123", must_change_password=False)
        opponent = create_user("Emil", "secure-password-123", must_change_password=False)
        first = self._zdwa_game(user_id=owner.id)
        first["_players"].append({"id": "opponent-seat", "name": "Emil", "user_id": opponent.id})
        second = self._zdwa_game(user_id=owner.id)
        second.update(
            {
                "_id": "zdwa-abandoned-2",
                "_abort_reason": "inactivity_timeout",
                "_finished_at": self._timestamp(14),
            }
        )
        second["_players"].append({"id": "opponent-seat", "name": "Emil", "user_id": opponent.id})

        self.assertTrue(persist_abandoned_game(first, aborted_by_player_id="account-seat").succeeded)
        self.assertEqual(persist_abandoned_game(second).status, "skipped")
        with session_scope() as db:
            owner_stats = abandonment_statistics_for_user(db, owner.id)
            opponent_stats = abandonment_statistics_for_user(db, opponent.id)

        self.assertEqual(owner_stats, {"games": 1, "self_ended_games": 1, "zdwa_games": 1, "zilch_games": 0})
        self.assertEqual(opponent_stats, {"games": 0, "self_ended_games": 0, "zdwa_games": 0, "zilch_games": 0})

    def test_failed_terminal_accounting_is_retained_and_recovered_on_next_start(self) -> None:
        user = create_user("Frida", "secure-password-123", must_change_password=False)
        game = self._zdwa_game(user_id=user.id)
        game["_finished"] = True
        with patch(
            "app.main.persist_abandoned_game",
            return_value=AbandonedGameWriteResult("failed", game["_id"], "zdwa", reason="temporary_database_error"),
        ):
            self.assertFalse(main._persist_abandonment(game))

        self.assertNotIn("_abandonment_accounted", game)
        with session_scope() as db:
            self.assertIsNotNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == game["_id"])))

        self.assertEqual(load_active_games(), {})
        with session_scope() as db:
            self.assertIsNotNone(db.scalar(select(AbandonedGame).where(AbandonedGame.game_id == game["_id"])))
            self.assertIsNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == game["_id"])))

    def test_recovery_can_delete_and_account_multiple_rows_without_nested_write_locks(self) -> None:
        user = create_user("Grace", "secure-password-123", must_change_password=False)
        for index in range(4):
            game = self._zdwa_game(user_id=user.id)
            game["_id"] = f"recovery-{index}"
            if index == 0:
                game["_abort_reason"] = "inactivity_timeout"
            save_active_game(game)
        self.assertEqual(load_active_games(), {})
        self.assertEqual(load_active_games(), {})
        with session_scope() as db:
            self.assertEqual(len(list(db.scalars(select(AbandonedGame)))), 3)
            self.assertEqual(len(list(db.scalars(select(ActiveGame)))), 0)

    def test_fairplay_reminders_only_count_actor_and_correct_zdwa_mode_without_points(self) -> None:
        user = create_user("Hanna", "secure-password-123", must_change_password=False)
        opponent = create_user("Ines", "secure-password-123", must_change_password=False)
        with session_scope() as db:
            baseline = sync_user_achievements(db, db.get(User, user.id))["points_earned"]
        for index in range(10):
            game = self._zdwa_game(user_id=user.id)
            game["_id"] = f"fairplay-{index}"
            game["_mode"] = "1" if index < 5 else "2"
            if index >= 5:
                game["_players"].append({"id": "opponent", "user_id": opponent.id})
            self.assertTrue(persist_abandoned_game(game).succeeded)
        with session_scope() as db:
            owner = sync_user_achievements(db, db.get(User, user.id))
            other = sync_user_achievements(db, db.get(User, opponent.id))
            self.assertEqual(len(list(db.scalars(select(CompletedGame)))), 0)
        reminders = [item for item in owner["unlocked"] if item["key"].startswith("manual_")]
        self.assertEqual({item["key"] for item in reminders}, {
            "manual_solo_aborts_1", "manual_solo_aborts_5",
            "manual_multiplayer_aborts_1", "manual_multiplayer_aborts_5",
        })
        self.assertTrue(all(item["points"] == 0 for item in reminders))
        self.assertEqual(owner["points_earned"], baseline)
        self.assertFalse(any(item["key"].startswith("manual_") for item in other["unlocked"]))

    def test_simultaneous_end_actions_cannot_change_responsible_actor(self) -> None:
        user = create_user("Jana", "secure-password-123", must_change_password=False)
        opponent = create_user("Kira", "secure-password-123", must_change_password=False)
        game = self._zdwa_game(user_id=user.id)
        game.update({"_aborted": False, "_finished": False, "_started": True})
        game["_started_at"] = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        game["_players"].append({"id": "opponent", "user_id": opponent.id})
        first = GameSocketSession(AsyncMock(), game, None, player_id="account-seat")
        second = GameSocketSession(AsyncMock(), game, None, player_id="opponent")
        game["_players"][0]["ws"] = first.websocket
        game["_players"][-1]["ws"] = second.websocket

        async def concurrent_abort():
            async def publish(*_args):
                await asyncio.sleep(0)
            with patch("app.game_ws_social.broadcast", side_effect=publish), patch("app.game_ws_social.snapshot", return_value={}):
                await asyncio.gather(_end_game(first, {}), _end_game(second, {}))

        asyncio.run(concurrent_abort())
        self.assertEqual(game["_aborted_by_player_id"], "account-seat")
        second.websocket.send_json.assert_awaited_once_with({"error": "Spiel ist bereits beendet"})
        self.assertTrue(main._persist_abandonment(game))
        with session_scope() as db:
            self.assertEqual(abandonment_statistics_for_user(db, user.id)["games"], 1)
            self.assertEqual(abandonment_statistics_for_user(db, opponent.id)["games"], 0)

    def test_explicit_zilch_solo_abort_is_counted_once_without_exposing_private_result(self) -> None:
        user = create_user("Lara", "secure-password-123", must_change_password=False)
        game = new_zilch_game("explicit-solo-abort", "Private Sprint", "1")
        configure_zilch_solo_game(game, host_user_id=user.id)
        join_zilch_player(game, {"id": "solo", "name": user.username, "user_id": user.id, "ws": None})
        start_zilch_game(game)
        turn = current_zilch_turn(game)
        apply_zilch_abandon_solo(game, "solo", turn_id=turn.turn_id, version=turn.version, confirmed=True)
        save_active_game(game)
        first = finalize_zilch_result(game)
        second = finalize_zilch_result(game)
        self.assertTrue(first["result_persisted"])
        self.assertTrue(second["result_persisted"])
        with session_scope() as db:
            stats = abandonment_statistics_for_user(db, user.id)
            self.assertEqual(stats, {"games": 1, "self_ended_games": 1, "zdwa_games": 0, "zilch_games": 1})
            self.assertFalse(any(item["key"].startswith("manual_") for item in sync_user_achievements(db, db.get(User, user.id))["unlocked"]))
            self.assertEqual(len(list(db.scalars(select(AbandonedGame)))), 1)
            self.assertEqual(len(list(db.scalars(select(ActiveGame)))), 0)

    def test_replaced_socket_cannot_end_a_room(self) -> None:
        user = create_user("Mira", "secure-password-123", must_change_password=False)
        game = self._zdwa_game(user_id=user.id)
        game.update({"_aborted": False, "_finished": False, "_started": True})
        old_socket = AsyncMock()
        game["_players"][0]["ws"] = AsyncMock()
        session = GameSocketSession(old_socket, game, None, player_id="account-seat")
        asyncio.run(_end_game(session, {}))
        self.assertFalse(game["_aborted"])
        old_socket.send_json.assert_awaited_once_with({"error": "Nur Spieler koennen das Spiel beenden"})
