"""The requested Styler reset removes awards, never games or other progress."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from alembic.config import Config
from sqlalchemy import select

from alembic import command
from app import main
from app.achievements import sync_achievements_for_users
from app.api_users import AssignmentRequest, assign_game_participant, player_ranking, public_player_profile
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.engagement import record_engagement
from app.game_achievement_evidence import record_styler_full_evidence
from app.game_history import persist_runtime_game
from app.game_results import build_leaderboard_snapshot_fields
from app.models import ActiveGame, CompletedGame, GameParticipant, User, UserAchievement
from app.security import as_utc, utcnow
from tests.support import GameStateTestCase
from tests.test_user_accounts import request_for

STYLER_KEYS = {"styler_full_once", "styler_full_10"}


class StylerResetTestCase(GameStateTestCase):
    def setUp(self):
        super().setUp()
        self.directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.directory.name) / "styler-reset.sqlite3"
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
            "ROLLTHEDICE_EMAIL_ENABLED": "0", "ROLLTHEDICE_PASSKEYS_ENABLED": "0",
        })
        self.environment.start()
        configure_database(Path(self.directory.name))
        upgrade_database(main.BASE)

    def tearDown(self):
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.directory.cleanup()
        super().tearDown()

    def config(self):
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")
        return config

    def full_result(self, user, *, finished_at=None, created_at=None):
        game = self.make_game(mode=1, players=[("p1", user.username if user else "Old Guest")])
        game["_players"][0]["user_id"] = user.id if user else None
        game["_scoreboards"]["p1"] = self.full_scoreboard({"free": {"full": 46}})
        record_styler_full_evidence(game, "p1", "13,free", 46, [2] * 5)
        snapshot = build_leaderboard_snapshot_fields(game)
        if finished_at:
            snapshot["finished_at"] = finished_at.isoformat()
        self.assertTrue(persist_runtime_game(game, {"p1": 46}, snapshot))
        with session_scope() as db:
            stored = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
            if created_at:
                stored.created_at = created_at
            return stored.id, db.scalar(select(GameParticipant.id).where(GameParticipant.game_id == stored.id))

    @staticmethod
    def ranking(user):
        return next(row for row in player_ranking(sort="achievements", mode="achievements")["players"] if row["id"] == user.id)

    @staticmethod
    def profile(user):
        return public_player_profile(user.username)["player"]

    def assert_no_styler(self, user):
        payload = self.profile(user)["achievements"]
        self.assertFalse(STYLER_KEYS & {award["key"] for award in payload["unlocked"]})
        self.assertEqual(
            {award["key"]: award["progress"]["current"] for award in payload["locked"] if award["key"] in STYLER_KEYS},
            {key: 0 for key in STYLER_KEYS},
        )

    def test_migration_resets_all_stylers_and_rank_points_but_preserves_other_data_and_retries(self):
        boundary = create_user("StylerRankBoundary", "styler-password", must_change_password=False)
        scored = create_user("StylerWithScores", "styler-password", must_change_password=False)
        old = utcnow() - timedelta(days=1)
        result_id, _ = self.full_result(scored, finished_at=old, created_at=old)
        record_engagement(scored.id, "rules_viewed")  # Real non-Styler awards in both collections.
        active_zdwa = {
            "_game_type": "zdwa", "_scoreboards": {"p1": {"13,free": 46}},
            "_styler_full_evidence": {"p1": {"13,free": 2}}, "_dice": [2] * 5,
        }
        active_zilch = {"_game_type": "zilch", "_styler_full_evidence": {"untouched": True}, "_round_points": 500}
        with session_scope() as db:
            for user, legacy in ((boundary, True), (scored, False)):
                for key in STYLER_KEYS:
                    db.add(UserAchievement(user_id=user.id, achievement_key=key, unlocked_at=old,
                                           legacy_styler=legacy, source_completed_game_id=result_id if user == scored else None))
            db.add_all([
                ActiveGame(game_id="active-zdwa", state_json=json.dumps(active_zdwa), created_at=old, updated_at=old),
                ActiveGame(game_id="active-zilch", state_json=json.dumps(active_zilch), created_at=old, updated_at=old),
            ])
        self.assertEqual(self.ranking(boundary)["achievement_points"], 13)
        self.assertEqual(self.ranking(boundary)["achievement_rank"]["key"], "rookie")

        def unchanged_rows():
            with sqlite3.connect(self.database_path) as connection:
                return {
                    table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
                    for table in ("completed_games", "game_participants", "zilch_achievement_unlocks")
                } | {"other_awards": connection.execute(
                    "SELECT * FROM user_achievements WHERE achievement_key NOT IN ('styler_full_once','styler_full_10') ORDER BY id"
                ).fetchall()}

        before = unchanged_rows()
        self.assertTrue(before["zilch_achievement_unlocks"])
        command.downgrade(self.config(), "20260912_0040")
        command.upgrade(self.config(), "head")
        self.assertEqual(unchanged_rows(), before)
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(UserAchievement).where(UserAchievement.achievement_key.in_(STYLER_KEYS)))), [])
            cutoff = db.get(User, boundary.id).achievement_styler_started_at
            self.assertIsNotNone(cutoff)
            self.assertEqual(cutoff, db.get(User, scored.id).achievement_styler_started_at)
            zdwa = json.loads(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == "active-zdwa")))
            self.assertEqual(zdwa, {key: value for key, value in active_zdwa.items() if key != "_styler_full_evidence"})
            self.assertEqual(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == "active-zilch")), json.dumps(active_zilch))
        self.assertEqual(self.ranking(boundary)["achievement_points"], 1)
        self.assertEqual(self.ranking(boundary)["achievement_rank"]["key"], "newbie")
        profile = self.profile(boundary)
        self.assertEqual(profile["achievements"]["points_earned"], 1)
        self.assertEqual(profile["statistics"]["overall"]["achievement_points"], 1)
        self.assertEqual(profile["achievement_rank"]["key"], "newbie")

        fresh_id, _ = self.full_result(boundary)
        sync_achievements_for_users({boundary.id}, source_completed_game_id=fresh_id)
        with session_scope() as db:
            earned = db.scalar(select(UserAchievement).where(UserAchievement.user_id == boundary.id,
                                                           UserAchievement.achievement_key == "styler_full_once"))
            award_identity = (earned.id, earned.unlocked_at, earned.source_completed_game_id)
        command.upgrade(self.config(), "head")
        with session_scope() as db:
            self.assertEqual(db.get(User, boundary.id).achievement_styler_started_at, cutoff)
            earned = db.get(UserAchievement, award_identity[0])
            self.assertEqual((earned.id, earned.unlocked_at, earned.source_completed_game_id), award_identity)

    def test_old_verified_results_cannot_regrant_on_profiles_engagement_or_late_assignment(self):
        user = create_user("NoStylerBackfill", "styler-password", must_change_password=False)
        admin = create_user("StylerAssignAdmin", "styler-password", role="admin", must_change_password=False)
        cutoff = utcnow() - timedelta(minutes=5)
        with session_scope() as db:
            player = db.get(User, user.id)
            player.achievement_styler_started_at = cutoff
            player.achievement_extra_started_at = cutoff - timedelta(days=1)
        before, after = cutoff - timedelta(seconds=1), cutoff + timedelta(seconds=1)
        # Neither a delayed import nor an older row with a later finish may
        # turn pre-reset proof into fresh progress.
        for finished, created in ((before, before), (before, after), (after, before)):
            game_id, _ = self.full_result(user, finished_at=finished, created_at=created)
            sync_achievements_for_users({user.id}, source_completed_game_id=game_id)
        self.assert_no_styler(user)
        record_engagement(user.id, "settings_viewed")
        self.assert_no_styler(user)
        _, participant_id = self.full_result(None, finished_at=before, created_at=before)
        identity, token = login(request_for(), admin.username, "styler-password")
        result = assign_game_participant(participant_id, AssignmentRequest(user_id=user.id), request_for(
            cookie=f"rollthedice_session={token}", csrf=identity.csrf_token, origin="http://testserver",
        ))
        self.assertTrue(result["changed"])
        self.assert_no_styler(user)
        fresh_id, _ = self.full_result(user, finished_at=after, created_at=after)
        sync_achievements_for_users({user.id}, source_completed_game_id=fresh_id)
        payload = self.profile(user)["achievements"]
        once = next(award for award in payload["unlocked"] if award["key"] == "styler_full_once")
        self.assertEqual(once["progress"], {"current": 1, "target": 1})
        series = next(award for award in payload["locked"] if award["key"] == "styler_full_10")
        self.assertEqual(series["progress"], {"current": 1, "target": 10})
        with session_scope() as db:
            self.assertEqual(db.scalar(select(UserAchievement.source_completed_game_id).where(
                UserAchievement.user_id == user.id, UserAchievement.achievement_key == "styler_full_once",
            )), fresh_id)

    def test_new_accounts_and_fresh_proof_reearn_exactly_four_then_eight_points_with_new_sources(self):
        before_create = utcnow()
        user = create_user("FreshStyler", "styler-password", must_change_password=False)
        after_create = utcnow()
        with session_scope() as db:
            cutoff = as_utc(db.get(User, user.id).achievement_styler_started_at)
        self.assertLessEqual(before_create, cutoff)
        self.assertLessEqual(cutoff, after_create)
        self.assert_no_styler(user)
        # The exact boundary is inclusive. Both timestamps prove that this
        # result belongs to the restarted collection.
        first_id, _ = self.full_result(user, finished_at=cutoff, created_at=cutoff)
        sync_achievements_for_users({user.id}, source_completed_game_id=first_id)

        def assert_points(expected_styler):
            profile = self.profile(user)
            awards = profile["achievements"]["unlocked"]
            self.assertEqual({award["key"]: award["points"] for award in awards if award["key"] in STYLER_KEYS}, expected_styler)
            total = sum(award["points"] for award in awards)
            self.assertEqual(profile["achievements"]["points_earned"], total)
            self.assertEqual(profile["statistics"]["overall"]["achievement_points"], total)
            self.assertEqual(profile["achievement_rank"]["points"], total)
            self.assertEqual(self.ranking(user)["achievement_points"], total)
            return profile

        assert_points({"styler_full_once": 4})
        for _ in range(8):
            next_id, _ = self.full_result(user)
            sync_achievements_for_users({user.id}, source_completed_game_id=next_id)
        profile = assert_points({"styler_full_once": 4})
        series = next(award for award in profile["achievements"]["locked"] if award["key"] == "styler_full_10")
        self.assertEqual(series["progress"], {"current": 9, "target": 10})
        tenth_id, _ = self.full_result(user)
        for _ in range(2):
            sync_achievements_for_users({user.id}, source_completed_game_id=tenth_id)
            assert_points({"styler_full_once": 4, "styler_full_10": 8})
        with session_scope() as db:
            awards = list(db.scalars(select(UserAchievement).where(
                UserAchievement.user_id == user.id, UserAchievement.achievement_key.in_(STYLER_KEYS),
            )))
            self.assertEqual(len(awards), 2)
            self.assertEqual({award.achievement_key: award.source_completed_game_id for award in awards}, {
                "styler_full_once": first_id, "styler_full_10": tenth_id,
            })
            db.delete(db.get(CompletedGame, tenth_id))
        # Removing the tenth qualifying result revokes its eight-point tier,
        # while the first Full and its four points remain valid.
        profile = assert_points({"styler_full_once": 4})
        series = next(award for award in profile["achievements"]["locked"] if award["key"] == "styler_full_10")
        self.assertEqual(series["progress"], {"current": 9, "target": 10})
        with session_scope() as db:
            self.assertEqual(list(db.execute(select(
                UserAchievement.achievement_key, UserAchievement.source_completed_game_id,
            ).where(UserAchievement.user_id == user.id, UserAchievement.achievement_key.in_(STYLER_KEYS)))), [
                ("styler_full_once", first_id),
            ])
