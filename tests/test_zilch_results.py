"""Typed Zilch result persistence contracts.

These tests deliberately exercise the result boundary with an authoritative
terminal Zilch state.  They do not use the ZDWA scorecard finalizer or a
browser-derived score, which makes accidental cross-game routing visible.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import func, select
from starlette.requests import Request

from app import main
from app.active_games import save_active_game
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import CompletedGameWriteResult, persist_completed_game_result, recent_winner_points_by_mode
from app.game_registry import finalize_completed_game
from app.game_state import games
from app.game_types import DEFAULT_GAME_TYPE, ZILCH_GAME_TYPE
from app.models import ActiveGame, CompletedGame, GameParticipant
from app.zilch_results import (
    ZILCH_RESULT_PAYLOAD_KIND,
    ZILCH_RESULT_SCHEMA_VERSION,
    build_zilch_result_payload,
    finalize_zilch_result,
    load_zilch_result,
)
from app.zilch_state import (
    configure_zilch_cpu_game,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)


def request_for(*, cookie: str = "") -> Request:
    headers = [(b"host", b"testserver")]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


class ZilchResultsTestCase(TestCase):
    """Result payload, idempotency, recovery and access contracts."""

    def setUp(self) -> None:
        self.game_ids: list[str] = []
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-results.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        for game_id in self.game_ids:
            games.pop(game_id, None)
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _player(player_id: str, name: str, user_id: int | None) -> dict:
        return {"id": player_id, "name": name, "user_id": user_id, "ws": None}

    def _terminal_game(
        self,
        *,
        player_one: tuple[str, int | None] = ("Mani", None),
        player_two: tuple[str, int | None] = ("Preview", None),
        tied: bool = False,
    ) -> dict:
        """Build a complete terminal state with auditable board history."""
        game_id = f"zilch-result-{len(self.game_ids)}"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "Private Zilch final", 2)
        join_zilch_player(game, self._player("p1", player_one[0], player_one[1]))
        join_zilch_player(game, self._player("p2", player_two[0], player_two[1]))
        start_zilch_game(game)
        record_zilch_start_roll(game, "p1", 6)
        record_zilch_start_roll(game, "p2", 2)

        player_two_total = 10_000 if tied else 9_700
        game["_total_points"] = {"p1": 10_000, "p2": player_two_total}
        game["_round_points"] = {"p1": 0, "p2": 0}
        game["_zilch_zilch_streaks"] = {"p1": 0, "p2": 0}
        game["_zilch_boards"] = {
            "p1": {
                "player_id": "p1",
                "round_points": 0,
                "total_points": 10_000,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 1,
                        "round": 1,
                        "event": "bank",
                        "points": 8_000,
                        "total_after": 8_000,
                        "rolls_used": 2,
                        "committed_holds": [{"id": "hot-1", "hot_dice": True}],
                    },
                    {
                        "turn_id": 3,
                        "round": 2,
                        "event": "zilch",
                        "reason": "no_scoring_option",
                        "discarded_points": 150,
                        "penalty": 0,
                        "total_after": 8_000,
                        "zilch_streak": 1,
                        "rolls_used": 1,
                        "committed_holds": [],
                    },
                    {
                        "turn_id": 5,
                        "round": 3,
                        "event": "bank",
                        "points": 2_000,
                        "total_after": 10_000,
                        "rolls_used": 2,
                        "committed_holds": [],
                    },
                ],
            },
            "p2": {
                "player_id": "p2",
                "round_points": 0,
                "total_points": player_two_total,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 2,
                        "round": 1,
                        "event": "bank",
                        "points": player_two_total,
                        "total_after": player_two_total,
                        "rolls_used": 2,
                        "committed_holds": [],
                    }
                ],
            },
        }
        game["_zilch_final_round"] = {
            "triggered_by": "p1",
            "target_score": 10_000,
            "pending_player_ids": [],
        }
        finish_zilch_game(game)
        return game

    def _terminal_cpu_game(self, *, strategy: str = "normal") -> dict:
        """Build a terminal CPU result through the real participant boundary."""
        game_id = f"zilch-cpu-result-{len(self.game_ids)}"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "Private CPU final", 2)
        cpu = configure_zilch_cpu_game(game, host_user_id=41, cpu_strategy=strategy)
        cpu_id = str(cpu["id"])
        join_zilch_player(game, self._player("p1", "Mani", 41))
        start_zilch_game(game)
        record_zilch_start_roll(game, "p1", 6)
        record_zilch_start_roll(game, cpu_id, 2)
        game["_total_points"] = {"p1": 10_000, cpu_id: 9_600}
        game["_round_points"] = {"p1": 0, cpu_id: 0}
        game["_zilch_zilch_streaks"] = {"p1": 0, cpu_id: 0}
        game["_zilch_boards"] = {
            "p1": {
                "player_id": "p1",
                "round_points": 0,
                "total_points": 10_000,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 1,
                        "round": 1,
                        "event": "bank",
                        "points": 10_000,
                        "total_after": 10_000,
                        "rolls_used": 2,
                        "committed_holds": [],
                    }
                ],
            },
            cpu_id: {
                "player_id": cpu_id,
                "round_points": 0,
                "total_points": 9_600,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 2,
                        "round": 1,
                        "event": "bank",
                        "points": 9_600,
                        "total_after": 9_600,
                        "rolls_used": 2,
                        "committed_holds": [],
                    }
                ],
            },
        }
        game["_zilch_final_round"] = {
            "triggered_by": "p1",
            "target_score": 10_000,
            "pending_player_ids": [],
        }
        finish_zilch_game(game)
        return game

    @staticmethod
    def _active_row(game_id: str) -> ActiveGame | None:
        with session_scope() as db:
            return db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id))

    @staticmethod
    def _completed_count(game_id: str) -> int:
        with session_scope() as db:
            return int(
                db.scalar(
                    select(func.count()).select_from(CompletedGame).where(CompletedGame.game_id == game_id)
                )
                or 0
            )

    def _identity(self, username: str, *, role: str = "user") -> tuple[int, str]:
        password = f"{username}-secure-password-123"
        user = create_user(username, password, role=role, must_change_password=False)
        _identity, token = login(request_for(), username, password)
        return user.id, token

    def test_winner_payload_is_versioned_uses_two_boards_and_has_no_zdwa_scorecard(self) -> None:
        payload = build_zilch_result_payload(self._terminal_game())

        self.assertEqual(payload["schema_version"], ZILCH_RESULT_SCHEMA_VERSION)
        self.assertEqual(payload["payload_kind"], ZILCH_RESULT_PAYLOAD_KIND)
        self.assertEqual(payload["game_type"], ZILCH_GAME_TYPE)
        self.assertEqual(payload["ruleset"], "zilch-house-v1")
        self.assertEqual(payload["target_score"], 10_000)
        self.assertEqual(payload["participant_order"], ["p1", "p2"])
        self.assertEqual(set(payload["boards"]), {"p1", "p2"})
        self.assertEqual(payload["outcome"]["winner_id"], "p1")
        self.assertFalse(payload["outcome"]["tied"])
        self.assertEqual(payload["final_round"]["triggered_by"], "p1")
        self.assertEqual(payload["final_round"]["pending_player_ids"], [])
        self.assertEqual(payload["metrics"]["zilch_count"], 1)
        self.assertEqual(payload["metrics"]["hot_dice_events"], 1)
        self.assertTrue(payload["metrics"]["hot_dice_events_complete"])
        self.assertNotIn("scoreboards", payload)
        self.assertNotIn("reihen", payload["boards"]["p1"])

    def test_equal_totals_keep_a_typed_tie_without_inventing_a_winner(self) -> None:
        payload = build_zilch_result_payload(self._terminal_game(tied=True))

        self.assertTrue(payload["outcome"]["tied"])
        self.assertIsNone(payload["outcome"]["winner_id"])
        self.assertEqual(payload["outcome"]["winner_ids"], ["p1", "p2"])
        self.assertEqual(payload["totals"], {"p1": 10_000, "p2": 10_000})

    def test_cpu_result_is_persisted_by_the_existing_zilch_finalizer_without_a_user_or_connection(self) -> None:
        game = self._terminal_cpu_game(strategy="aggressive")

        completion = finalize_zilch_result(game)

        self.assertTrue(completion["result_persisted"])
        payload = load_zilch_result(game["_id"])
        self.assertIsNotNone(payload)
        cpu = next(participant for participant in payload["participants"] if participant["participant_type"] == "cpu")
        self.assertEqual(cpu["cpu_strategy"], "aggressive")
        self.assertIsNone(cpu["user_id"])
        self.assertNotIn("connection_player_id", cpu)
        self.assertEqual(payload["play_mode"], "cpu")
        with session_scope() as db:
            stored_cpu = db.scalar(
                select(GameParticipant)
                .join(CompletedGame)
                .where(CompletedGame.game_id == game["_id"], GameParticipant.player_key == cpu["participant_id"])
            )
        self.assertIsNotNone(stored_cpu)
        self.assertIsNone(stored_cpu.user_id)

    def test_tampered_cpu_mode_payload_with_two_humans_is_not_read_back(self) -> None:
        """Stored CPU reports must retain their exact participant topology."""
        game = self._terminal_cpu_game(strategy="normal")
        self.assertTrue(finalize_zilch_result(game)["result_persisted"])

        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            self.assertIsNotNone(row)
            payload = json.loads(row.snapshot_json)
            cpu = next(participant for participant in payload["participants"] if participant["participant_type"] == "cpu")
            cpu["participant_type"] = "human"
            cpu["cpu_strategy"] = None
            row.snapshot_json = json.dumps(payload)

        self.assertIsNone(load_zilch_result(game["_id"]))

    def test_registry_uses_zilch_finalizer_once_without_zdwa_aggregates(self) -> None:
        game = self._terminal_game()

        with patch(
            "app.game_results.finalize_and_log_results",
            side_effect=AssertionError("Zilch must not enter ZDWA finalization"),
        ):
            first = finalize_completed_game(game, files=object())
            second = finalize_completed_game(game, files=object())

        self.assertTrue(first["result_persisted"])
        self.assertEqual(first["result_write_status"], "stored")
        self.assertTrue(second["result_persisted"])
        self.assertEqual(second["result_write_status"], "already_stored")
        self.assertEqual(self._completed_count(game["_id"]), 1)
        self.assertIsNone(self._active_row(game["_id"]))
        self.assertTrue(game["_completion_persisted"])
        self.assertEqual(recent_winner_points_by_mode(), {"normal": [], "hc": []})
        with session_scope() as db:
            participants = db.scalars(
                select(GameParticipant).join(CompletedGame).where(CompletedGame.game_id == game["_id"])
            ).all()
            self.assertEqual(len(participants), 2)
            self.assertEqual({participant.points for participant in participants}, {9_700, 10_000})

    def test_persistence_failure_keeps_authoritative_terminal_active_state(self) -> None:
        game = self._terminal_game()
        save_active_game(game)
        failed = CompletedGameWriteResult(
            "failed",
            str(game["_id"]),
            ZILCH_GAME_TYPE,
            reason="database_error",
        )

        with patch("app.zilch_results.persist_completed_game_result", return_value=failed):
            completion = finalize_zilch_result(game)

        self.assertFalse(completion["result_persisted"])
        self.assertEqual(completion["persistence_error"], "database_error")
        self.assertFalse(game["_completion_persisted"])
        self.assertIsNotNone(self._active_row(game["_id"]))
        self.assertEqual(self._completed_count(game["_id"]), 0)

    def test_old_terminal_without_finished_at_is_rejected_and_retained_for_inspection(self) -> None:
        game = self._terminal_game()
        game.pop("_finished_at")
        save_active_game(game)

        completion = finalize_zilch_result(game)

        self.assertFalse(completion["result_persisted"])
        self.assertEqual(completion["persistence_error"], "zilch_result_missing_finished_at")
        self.assertFalse(game["_completion_persisted"])
        self.assertIsNotNone(self._active_row(game["_id"]))
        self.assertEqual(self._completed_count(game["_id"]), 0)

    def test_unknown_or_damaged_stored_payload_is_not_projected(self) -> None:
        game = self._terminal_game()
        valid_payload = build_zilch_result_payload(game)
        self.assertTrue(finalize_zilch_result(game)["result_persisted"])

        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            self.assertIsNotNone(row)
            payload = json.loads(row.snapshot_json)
            payload["schema_version"] = 99
            row.snapshot_json = json.dumps(payload)
        self.assertIsNone(load_zilch_result(game["_id"]))

        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            self.assertIsNotNone(row)
            payload = json.loads(json.dumps(valid_payload))
            payload["boards"].pop("p2")
            row.snapshot_json = json.dumps(payload)
        self.assertIsNone(load_zilch_result(game["_id"]))

    def test_restart_recovery_persists_terminal_result_then_removes_active_state(self) -> None:
        game = self._terminal_game()
        save_active_game(game)
        self.assertIsNotNone(self._active_row(game["_id"]))

        main._recover_terminal_completed_games()
        main._recover_terminal_completed_games()

        self.assertEqual(self._completed_count(game["_id"]), 1)
        self.assertIsNone(self._active_row(game["_id"]))
        self.assertNotIn(game["_id"], games)

    def test_private_result_history_and_detail_api_require_the_preview_policy(self) -> None:
        mani_id, mani_token = self._identity("Mani", role="admin")
        friend_id, friend_token = self._identity("PreviewFriend")
        _normal_id, normal_token = self._identity("Normal")
        game = self._terminal_game(player_one=("Mani", mani_id), player_two=("PreviewFriend", friend_id))
        self.assertTrue(finalize_zilch_result(game)["result_persisted"])

        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend"}):
            mani_history = main.api_zilch_results(request_for(cookie=f"rollthedice_session={mani_token}"))
            friend_history = main.api_zilch_results(request_for(cookie=f"rollthedice_session={friend_token}"))
            detail = main.api_zilch_result(
                game["_id"],
                request_for(cookie=f"rollthedice_session={friend_token}"),
            )

        self.assertEqual([entry["game_id"] for entry in mani_history["results"]], [game["_id"]])
        self.assertEqual([entry["game_id"] for entry in friend_history["results"]], [game["_id"]])
        self.assertEqual(detail["result"]["game_type"], ZILCH_GAME_TYPE)
        self.assertEqual(detail["result"]["outcome"]["winner_id"], "p1")

        for token, status_code in (("", 401), (normal_token, 403)):
            with self.subTest(identity="anonymous" if not token else "normal"):
                with self.assertRaises(HTTPException) as denied:
                    main.api_zilch_results(request_for(cookie=f"rollthedice_session={token}"))
                self.assertEqual(denied.exception.status_code, status_code)
                with self.assertRaises(HTTPException) as denied_detail:
                    main.api_zilch_result(game["_id"], request_for(cookie=f"rollthedice_session={token}"))
                self.assertEqual(denied_detail.exception.status_code, status_code)

        # A typed ZDWA row is deliberately not projected through the Zilch
        # endpoint even for an approved preview identity.
        result = persist_completed_game_result(
            game_id="zdwa-result-not-zilch",
            game_name="ZDWA",
            game_type=DEFAULT_GAME_TYPE,
            mode="2",
            hardcore=False,
            finished_at=datetime.fromisoformat(game["_finished_at"]),
            snapshot={"legacy": "zdwa"},
            participants=[],
        )
        self.assertTrue(result.succeeded)
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend"}):
            with self.assertRaises(HTTPException) as wrong_type:
                main.api_zilch_result(
                    "zdwa-result-not-zilch",
                    request_for(cookie=f"rollthedice_session={friend_token}"),
                )
        self.assertEqual(wrong_type.exception.status_code, 404)
