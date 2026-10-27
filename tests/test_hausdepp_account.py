"""Private all-time Hausdepp facts and evidence-backed progress."""

from __future__ import annotations

import base64
import copy
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select

from app import main
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.hausdepp_account import build_hausdepp_account_for_user, build_hausdepp_account_for_user_in_session
from app.hausdepp_achievements import synchronize_hausdepp_progress_in_session
from app.hausdepp_results import finalize_hausdepp_result, list_hausdepp_results_for_user, validate_hausdepp_result
from app.models import (
    CompletedGame,
    GameParticipant,
    HausdeppAchievementUnlock,
    HausdeppPresentationReceipt,
    HausdeppRoundCredit,
    HausdeppWithdrawal,
)


class HausdeppAccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp-account.sqlite3",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.user = create_user("Hauskonto", "test-password-123", must_change_password=False)
        self.other = create_user("Anderkonto", "test-password-123", must_change_password=False)
        self.at = datetime(2026, 10, 16, 18, 30, tzinfo=timezone.utc)  # no play-time achievement

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def payload(self, game_id="round-1", *, loser="self", at=None):
        return {"schema_version": 1, "payload_kind": "hausdepp_result", "game_type": "hausdepp",
                "game_id": game_id, "name": "Privater Kartentisch", "finished_at": (at or self.at).isoformat(),
                "participants": [{"id": "self", "name": self.user.username, "is_cpu": False},
                                 {"id": "other", "name": self.other.username, "is_cpu": False},
                                 {"id": "cpu-1", "name": "Kartensepp", "is_cpu": True}],
                "loser_id": loser, "finished_order": [key for key in ("self", "cpu-1", "other") if key != loser]}

    def store(self, payload, *, user_id=None, game_type="hausdepp"):
        result = persist_completed_game_result(
            game_id=payload["game_id"], game_name=payload["name"], game_type=game_type, mode="3", hardcore=False,
            finished_at=datetime.fromisoformat(payload["finished_at"]), snapshot=payload,
            participants=[{"player_key": player["id"], "display_name": player["name"],
                           "user_id": (self.user.id if user_id is None else user_id) if player["id"] == "self"
                           else self.other.id if player["id"] == "other" else None}
                          for player in payload["participants"]],
        )
        self.assertTrue(result.succeeded)
        return result

    def test_caller_session_recovery_rolls_back_all_derived_rows_without_acknowledging(self):
        self.store(self.payload("outer-one", loser="other"))
        self.store(self.payload("outer-two", at=self.at + timedelta(minutes=1)))
        derived = (HausdeppRoundCredit, HausdeppAchievementUnlock, HausdeppPresentationReceipt)
        with session_scope() as db:
            sources = tuple(tuple(db.execute(select(model.__table__))) for model in (CompletedGame, GameParticipant))
        with self.assertRaisesRegex(RuntimeError, "rollback outer transaction"):
            with session_scope() as db:
                with patch("app.hausdepp_account.session_scope", side_effect=AssertionError("nested account session")), \
                        patch("app.hausdepp_achievements.session_scope", side_effect=AssertionError("nested recovery session")), \
                        patch("app.hausdepp_results.session_scope", side_effect=AssertionError("nested membership session")):
                    account = build_hausdepp_account_for_user_in_session(db, self.user.id, limit=1)
                    self.assertEqual(account["statistics"]["rounds_played"], 2)
                    self.assertIsNotNone(account["history"]["next_cursor"])
                    self.assertEqual(account["presentation"],
                                     synchronize_hausdepp_progress_in_session(db, self.user.id)["presentation"])
                    self.assertIsNotNone(account["presentation"]["pending"])
                    receipt = db.get(HausdeppPresentationReceipt, self.user.id)
                    self.assertEqual(receipt.acknowledged_points, 0)
                    self.assertIn(str(account["presentation"]["revision"]), json.loads(receipt.presentation_scores_json))
                    self.assertTrue(all(db.scalar(select(func.count()).select_from(model)) > 0 for model in derived))
                    self.assertEqual(tuple(tuple(db.execute(select(model.__table__)))
                                           for model in (CompletedGame, GameParticipant)), sources)
                    raise RuntimeError("rollback outer transaction")
        with session_scope() as db:
            self.assertEqual(tuple(db.scalar(select(func.count()).select_from(model)) for model in derived), (0, 0, 0))
            self.assertEqual(tuple(tuple(db.execute(select(model.__table__)))
                                   for model in (CompletedGame, GameParticipant)), sources)
        # The ordinary entry point retains exactly the same response and unseen boundary.
        self.assertEqual(build_hausdepp_account_for_user(self.user.id, limit=1), account)

    def test_favorite_opponents_count_only_direct_decisions_after_ten_and_respect_withdrawals(self):
        for index in range(10):
            self.store(self.payload(f"opponent-{index}", loser="other" if index < 6 else "self"))
        # Sharing a round while a third seat loses is not a direct decision.
        self.store(self.payload("third-loser", loser="cpu-1"))
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["favorite_opponents"], [])
        abandoned = self.payload("no-loser")
        abandoned.update(schema_version=4, loser_id=None, finished_order=["self"], withdrawn_ids=["cpu-1"],
                         remaining_player_id="other", round_end_reason="insufficient_players",
                         achievement_evidence={"schema_version": 1, "complete": True,
                             "players": {player["id"]: {"flags": [], "ten_clears": 0}
                                         for player in abandoned["participants"]}})
        self.store(abandoned)
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["favorite_opponents"], [])
        self.store(self.payload("eleventh", loser="self"))
        expected = [{"name": self.other.username, "wins": 6, "losses": 5, "draws": 0, "games": 11}]
        self.assertEqual(build_hausdepp_account_for_user(self.user.id, limit=1)["favorite_opponents"], expected)
        other = build_hausdepp_account_for_user(self.other.id)["favorite_opponents"]
        self.assertEqual(other, [{"name": self.user.username, "wins": 5, "losses": 6, "draws": 0, "games": 11}])
        outsider = create_user("Unrelated", "test-password-123", must_change_password=False)
        self.assertEqual(build_hausdepp_account_for_user(outsider.id)["favorite_opponents"], [])
        with session_scope() as db:
            db.add(HausdeppWithdrawal(user_id=self.other.id, result_id="eleventh", table_game_id="eleventh",
                                       player_id="other", departed_at=self.at))
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["favorite_opponents"], [])

    def test_all_time_totals_exceed_both_history_and_source_page_limits(self):
        # More than the former 30-result cap and the bounded 250-row source page.
        for index in range(263):
            self.store(self.payload(f"round-{index}", loser="self" if index % 3 == 0 else "cpu-1",
                                    at=self.at + timedelta(minutes=index)))
        self.store(self.payload("other-private-round"), user_id=self.other.id)
        self.store(self.payload("zdwa-round"), game_type="zdwa")
        self.store(self.payload("zilch-round"), game_type="zilch")
        account = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(account["statistics"], {
            "rounds_played": 263, "hausdepp_rounds": 88, "finished_rounds": 175,
            "last_finished_at": (self.at + timedelta(minutes=262)).isoformat(),
        })
        self.assertEqual(len(account["history"]["rounds"]), 12)
        self.assertIsNotNone(account["history"]["next_cursor"])
        self.assertEqual(account["history"]["rounds"][0]["game_id"], "round-262")
        self.assertTrue(account["scoring"]["available"])
        self.assertEqual(account["scoring"]["round_points"], 526)
        self.assertTrue(account["achievements"]["available"])
        self.assertEqual(len(account["achievements"]["items"]), 138)
        self.assertEqual(len(account["ranks"]), 24)

    def test_timestamp_boundaries_reject_invalid_cursors_and_skip_corrupt_results(self):
        for at in ("0001-01-01T00:00:00+01:00", "9999-12-31T23:59:59-01:00"):
            with self.subTest(at=at):
                cursor = base64.urlsafe_b64encode(json.dumps({"v": 1, "at": at, "id": 1}).encode()).decode()
                with self.assertRaisesRegex(ValueError, "hausdepp_invalid_cursor"):
                    build_hausdepp_account_for_user(self.user.id, before=cursor)
                malformed = self.payload()
                malformed["finished_at"] = at
                with self.assertRaisesRegex(ValueError, "hausdepp_result_invalid_timestamp"):
                    validate_hausdepp_result(malformed)
        payload = self.payload()
        self.store(payload)
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == payload["game_id"]))
            payload["finished_at"] = "0001-01-01T00:00:00+01:00"
            row.snapshot_json = json.dumps(payload)
        account = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(account["statistics"]["rounds_played"], 0)
        self.assertEqual(account["history"]["rounds"], [])
        self.assertEqual(list_hausdepp_results_for_user(self.user.id), [])

    def test_cursor_pages_are_stable_for_identical_timestamps_and_remain_private(self):
        for index in range(35):
            self.store(self.payload(f"same-time-{index}", loser="other"))
        first = build_hausdepp_account_for_user(self.user.id, limit=12)
        self.store(self.payload("inserted-later", loser="cpu-1", at=self.at + timedelta(minutes=1)))
        second = build_hausdepp_account_for_user(self.user.id, before=first["history"]["next_cursor"], limit=12)
        third = build_hausdepp_account_for_user(self.user.id, before=second["history"]["next_cursor"], limit=12)
        ids = [row["game_id"] for page in (first, second, third) for row in page["history"]["rounds"]]
        self.assertEqual(ids, [f"same-time-{index}" for index in reversed(range(35))])
        self.assertIsNone(third["history"]["next_cursor"])
        self.assertEqual(second["statistics"]["rounds_played"], 36)
        # Reusing a foreign user's cursor cannot grant membership to their rows.
        outsider = create_user("Unbeteiligt", "test-password-123", must_change_password=False)
        private = build_hausdepp_account_for_user(outsider.id, before=first["history"]["next_cursor"])
        self.assertEqual(private["statistics"]["rounds_played"], 0)
        self.assertEqual(private["history"], {"rounds": [], "next_cursor": None})

    def test_own_outcome_exit_order_cpu_badge_and_historic_dates_are_precise(self):
        self.store(self.payload("finished", loser="other"))
        self.store(self.payload("hausdepp", loser="self", at=self.at + timedelta(hours=1)))
        rounds = build_hausdepp_account_for_user(self.user.id)["history"]["rounds"]
        self.assertEqual((rounds[0]["outcome"], rounds[0]["finished_position"]), ("hausdepp", None))
        self.assertEqual((rounds[1]["outcome"], rounds[1]["finished_position"]), ("finished", 1))
        self.assertEqual(rounds[0]["player_id"], "self")
        self.assertEqual((rounds[0]["participant_count"], rounds[0]["cpu_count"]), (3, 1))
        self.assertEqual(rounds[0]["finished_at"], (self.at + timedelta(hours=1)).isoformat())
        self.assertTrue(rounds[0]["participants"][2]["is_cpu"])
        encoded = json.dumps(rounds)
        for private_key in ("user_id", "hand", "deck", "resume_token", "password"):
            self.assertNotIn(private_key, encoded)

    def test_idempotent_terminal_result_never_changes_original_outcome_or_doubles_totals(self):
        payload = self.payload(loser="self")
        game = {"_id": payload["game_id"], "_name": payload["name"], "_mode": "3", "_finished": True,
                "_finished_at": payload["finished_at"],
                "_participants": [{**player, "user_id": self.user.id if player["id"] == "self"
                                    else self.other.id if player["id"] == "other" else None}
                                   for player in payload["participants"]],
                "_hausdepp": {"phase": "finished", "loser_id": "self", "finished_order": ["cpu-1", "other"]}}
        self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
        game["_hausdepp"].update(loser_id="other", finished_order=["self", "cpu-1"])
        self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
        account = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(account["statistics"]["rounds_played"], 1)
        self.assertEqual(account["history"]["rounds"][0]["outcome"], "hausdepp")

    def test_damaged_unknown_and_mismatched_rows_are_skipped_without_leaking_live_fields(self):
        for index in range(5):
            self.store(self.payload(f"damaged-{index}"))
        good = self.payload("good")
        good.update(hand=["acorns-A"], resume_token="secret-token", user_id=123)
        self.store(good)
        with session_scope() as db:
            rows = list(db.scalars(select(CompletedGame).where(CompletedGame.game_id.like("damaged-%"))
                                   .order_by(CompletedGame.game_id)).all())
            rows[0].snapshot_json = "{"
            for row, changes in zip(rows[1:], ({"schema_version": 99}, {"game_id": "different"},
                                               {"finished_order": ["other", "other"]},
                                               {"finished_at": (self.at + timedelta(days=1)).isoformat()})):
                damaged = json.loads(row.snapshot_json)
                damaged.update(changes)
                row.snapshot_json = json.dumps(damaged)
        account = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(account["statistics"]["rounds_played"], 1)
        self.assertEqual(account["history"]["rounds"][0]["game_id"], "good")
        compatibility = list_hausdepp_results_for_user(self.user.id)
        self.assertEqual(len(compatibility), 1)
        for private in ("hand", "resume_token", "user_id", "secret-token"):
            self.assertNotIn(private, json.dumps(compatibility))

    def test_relational_seats_are_authoritative_and_cannot_assign_cpu_to_an_account(self):
        self.store(self.payload("forged-seat"))
        self.store(self.payload("cpu-owner"))
        self.store(self.payload("ambiguous-owner"))
        with session_scope() as db:
            for game_id, key in (("forged-seat", "self"), ("cpu-owner", "cpu-1"), ("ambiguous-owner", "other")):
                seat = db.scalar(select(GameParticipant).join(CompletedGame)
                                 .where(CompletedGame.game_id == game_id, GameParticipant.player_key == key))
                if game_id == "forged-seat":
                    seat.player_key = "not-in-payload"
                else:
                    seat.user_id = self.user.id
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["statistics"]["rounds_played"], 0)

    def test_cursor_limit_and_schema_validation_fail_closed(self):
        invalid_cursor_data = ["not-base64!!", "", "a" * 257,
                               base64.urlsafe_b64encode(b'{"v":1,"at":"2026-10-16","id":1}').decode(),
                               base64.urlsafe_b64encode(b'{"v":true,"at":"2026-10-16T00:00:00Z","id":1}').decode()]
        for value in invalid_cursor_data:
            with self.subTest(cursor=value[:50]), self.assertRaisesRegex(ValueError, "hausdepp_invalid_cursor"):
                build_hausdepp_account_for_user(self.user.id, before=value)
        for limit in (0, 31, True, "12"):
            with self.subTest(limit=limit), self.assertRaisesRegex(ValueError, "hausdepp_invalid_limit"):
                build_hausdepp_account_for_user(self.user.id, limit=limit)
        original = self.payload()
        for changes in ({"schema_version": True}, {"participants": []}, {"loser_id": "unknown"},
                        {"finished_order": ["other", "other"]}, {"finished_at": "invalid"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                validate_hausdepp_result({**copy.deepcopy(original), **changes})

    def test_naive_historical_timestamp_is_stably_utc_and_empty_account_is_truthful(self):
        payload = self.payload()
        payload["finished_at"] = "2026-10-16T10:30:00"
        self.store(payload)
        account = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(account["history"]["rounds"][0]["finished_at"], "2026-10-16T10:30:00+00:00")
        with patch("app.hausdepp_account.database_schema_ready", return_value=False):
            empty = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(empty["statistics"], {
            "rounds_played": 0, "hausdepp_rounds": 0, "finished_rounds": 0, "last_finished_at": None,
        })
        self.assertEqual(empty["history"], {"rounds": [], "next_cursor": None})


if __name__ == "__main__":
    unittest.main()
