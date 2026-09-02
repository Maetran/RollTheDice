import asyncio
import io
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import httpx
from alembic.config import Config
from sqlalchemy import func, select
from starlette.requests import Request
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from alembic import command
from app import main
from app.achievements import ACHIEVEMENTS
from app.active_games import load_active_games, save_active_game
from app.api_auth import (
    LanguagePreferenceRequest,
    UserPreferencesRequest,
    auth_me,
    auth_update_language,
    auth_update_preferences,
)
from app.api_users import (
    AssignmentRequest,
    _recent_games_for_user,
    assign_game_participant,
    own_game_history,
    player_ranking,
    public_player_profile,
)
from app.auth import (
    auth_identity_payload,
    change_password,
    create_user,
    login,
    resolve_session,
    validate_request_origin,
)
from app.auth_protection import (
    enforce_game_creation_rate_limit,
    enforce_login_rate_limit,
    enforce_registration_rate_limit,
    record_login_failure,
    registration_public_config,
    validate_auth_protection_config,
    verify_registration_challenge,
)
from app.database import configure_database, session_scope, upgrade_database
from app.game_engine import _compute_final_totals
from app.game_history import import_legacy_leaderboards, persist_runtime_game, stable_game_id
from app.game_results import build_leaderboard_snapshot_fields
from app.leaderboard_storage import LeaderboardFiles
from app.models import (
    ActiveGame,
    AssignmentAudit,
    CompletedGame,
    DeletedGame,
    GameParticipant,
    Session,
    User,
    UserAchievement,
)
from app.security import validate_password
from app.trends import recent_points_trend
from tests.support import GameStateTestCase


def request_for(*, cookie: str = "", csrf: str = "", origin: str = "", host: str = "testserver") -> Request:
    headers = [(b"host", host.encode("ascii"))]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    if csrf:
        headers.append((b"x-csrf-token", csrf.encode("ascii")))
    if origin:
        headers.append((b"origin", origin.encode("ascii")))
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


class AccountDatabaseTestCase(GameStateTestCase):
    def setUp(self):
        super().setUp()
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "accounts.sqlite3"
        self.env_patch = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
            },
        )
        self.env_patch.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self):
        self.env_patch.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()
        super().tearDown()

    def test_login_uses_hashed_server_side_session(self):
        user = create_user("Anna", "a-secure-password-123", must_change_password=False)
        identity, raw_token = login(request_for(), "anna", "a-secure-password-123")

        self.assertEqual(identity.user_id, user.id)
        with session_scope() as db:
            stored = db.scalar(select(Session))
            self.assertIsNotNone(stored)
            self.assertNotEqual(stored.token_hash, raw_token)

        resolved = resolve_session(request_for(cookie=f"rollthedice_session={raw_token}"))
        self.assertEqual(resolved.username, "Anna")

        public_payload = auth_identity_payload(resolved)
        self.assertNotIn("csrf_token", public_payload)
        self.assertEqual(public_payload["achievement_rank"]["title"], "Newbie")
        self.assertEqual(public_payload["achievement_rank"]["points"], 1)
        self.assertEqual(public_payload["preferences"]["announce_selection_mode"], "overlay")
        self.assertFalse(public_payload["preferences"]["mobile_row_quick_entry"])
        self.assertFalse(public_payload["preferences"]["haptic_feedback"])
        self.assertFalse(public_payload["preferences"]["keep_screen_awake"])
        self.assertEqual(public_payload["preferences"]["preferred_language"], "de")
        self.assertIn("csrf_token", auth_identity_payload(resolved, include_csrf=True))

    def test_password_minimum_is_eight_characters(self):
        self.assertEqual(validate_password("12345678"), "12345678")
        with self.assertRaisesRegex(ValueError, "mindestens 8 Zeichen"):
            validate_password("1234567")

    def test_usernames_are_unique_case_insensitively(self):
        create_user("UniqueUser", "a-secure-password-123", must_change_password=False)
        with self.assertRaisesRegex(ValueError, "bereits vergeben"):
            create_user(" uniqueuser ", "another-password-123", must_change_password=False)

    def test_gameplay_preferences_are_persisted_and_returned_with_account(self):
        create_user("PrefsUser", "a-secure-password-123", must_change_password=False)
        identity, raw_token = login(request_for(), "PrefsUser", "a-secure-password-123")
        authenticated_request = request_for(
            cookie=f"rollthedice_session={raw_token}",
            csrf=identity.csrf_token,
        )

        result = auth_update_preferences(
            UserPreferencesRequest(
                announce_selection_mode="table",
                auto_write_announced=False,
                mobile_row_quick_entry=True,
                haptic_feedback=True,
                keep_screen_awake=True,
                preferred_language="en",
            ),
            authenticated_request,
        )

        self.assertEqual(
            result["preferences"],
            {
                "announce_selection_mode": "table",
                "auto_write_announced": False,
                "mobile_row_quick_entry": True,
                "haptic_feedback": True,
                "keep_screen_awake": True,
                "preferred_language": "en",
            },
        )
        account = auth_me(request_for(cookie=f"rollthedice_session={raw_token}"))
        self.assertEqual(account["user"]["preferences"], result["preferences"])
        self.assertEqual(account["registration"], registration_public_config())
        with session_scope() as db:
            user = db.scalar(select(User).where(User.username == "PrefsUser"))
            self.assertEqual(user.announce_selection_mode, "table")
            self.assertFalse(user.auto_write_announced)
            self.assertTrue(user.mobile_row_quick_entry)
            self.assertTrue(user.haptic_feedback)
            self.assertTrue(user.keep_screen_awake)
            self.assertEqual(user.preferred_language, "en")

    def test_mobile_quick_entry_migration_enables_existing_but_not_new_accounts(self):
        create_user("ExistingUser", "a-secure-password-123", must_change_password=False)
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")

        command.downgrade(config, "20260824_0005")
        command.upgrade(config, "head")

        with session_scope() as db:
            existing = db.scalar(select(User).where(User.username == "ExistingUser"))
            self.assertTrue(existing.mobile_row_quick_entry)
            self.assertIsNotNone(existing.achievement_extra_started_at)
            self.assertIsNotNone(existing.achievement_expansion_started_at)
            self.assertIsNotNone(existing.achievement_office_hours_started_at)
            self.assertIsNotNone(existing.achievement_multiplayer_started_at)

        create_user("NewUser", "a-secure-password-123", must_change_password=False)
        with session_scope() as db:
            new_user = db.scalar(select(User).where(User.username == "NewUser"))
            self.assertFalse(new_user.mobile_row_quick_entry)
            self.assertFalse(new_user.haptic_feedback)
            self.assertFalse(new_user.keep_screen_awake)
            self.assertIsNotNone(new_user.achievement_office_hours_started_at)
            self.assertIsNotNone(new_user.achievement_multiplayer_started_at)

    def test_language_can_be_updated_independently(self):
        create_user("LanguageUser", "a-secure-password-123", must_change_password=False)
        identity, raw_token = login(request_for(), "LanguageUser", "a-secure-password-123")
        authenticated_request = request_for(
            cookie=f"rollthedice_session={raw_token}",
            csrf=identity.csrf_token,
        )

        result = auth_update_language(LanguagePreferenceRequest(preferred_language="en"), authenticated_request)

        self.assertEqual(result, {"preferred_language": "en"})
        account = auth_me(request_for(cookie=f"rollthedice_session={raw_token}"))
        self.assertEqual(account["user"]["preferences"]["preferred_language"], "en")

    def test_three_game_trend_compares_recent_average_with_mode_average(self):
        self.assertEqual(
            recent_points_trend(
                [500, 400, 300],
                games_played=5,
                points_total=1500,
            )["trend"],
            "up",
        )
        self.assertEqual(
            recent_points_trend(
                [100, 200, 300],
                games_played=5,
                points_total=1500,
            )["trend"],
            "down",
        )
        self.assertEqual(
            recent_points_trend(
                [300, 300, 300],
                games_played=5,
                points_total=1500,
            )["trend"],
            "same",
        )
        incomplete = recent_points_trend([500, 400], games_played=5, points_total=1500)
        self.assertIsNone(incomplete["trend"])
        self.assertEqual(incomplete["trend_games"], 2)
        self.assertIsNone(
            recent_points_trend(
                [500, 400, 300],
                games_played=2,
                points_total=900,
            )["trend"]
        )

    def test_origin_check_accepts_proxy_scheme_but_rejects_other_hosts(self):
        validate_request_origin(request_for(origin="https://testserver"))
        validate_request_origin(request_for(origin="https://testserver:443"))
        with self.assertRaisesRegex(Exception, "origin_rejected") as rejected:
            validate_request_origin(request_for(origin="https://evil.example"))
        self.assertEqual(rejected.exception.status_code, 403)

    def test_database_upgrade_is_idempotent_across_restarts(self):
        upgrade_database(main.BASE)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(User)), 0)

    def test_online_user_count_deduplicates_tabs_with_the_same_browser_id(self):
        original = dict(main.presence_connections)
        try:
            main.presence_connections.clear()
            main.presence_connections.update({"browser-a": 2, "browser-b": 1})
            self.assertEqual(main.online_user_count(), 2)
        finally:
            main.presence_connections.clear()
            main.presence_connections.update(original)

    def test_running_game_is_restored_without_process_local_connections(self):
        game = self.make_game(mode=2, players=[("p1", "Anna"), ("p2", "Berta")])
        game["_players"][0]["resume_token"] = "resume-anna"
        game["_players"][0]["ws"] = object()
        game["_spectators"] = [{"id": "s1", "name": "Gast", "ws": object()}]
        game["_scoreboards"]["p1"]["0,down"] = 3
        game["_dice"] = [1, 2, 3, 4, 5]
        save_active_game(game)

        restored = load_active_games()[game["_id"]]

        self.assertEqual(restored["_scoreboards"]["p1"]["0,down"], 3)
        self.assertEqual(restored["_dice"], [1, 2, 3, 4, 5])
        self.assertEqual(restored["_players"][0]["resume_token"], "resume-anna")
        self.assertIsNone(restored["_players"][0]["ws"])
        self.assertEqual(restored["_spectators"], [])
        self.assertTrue(restored["_resume_required"])

    def test_finished_game_removes_active_snapshot(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        save_active_game(game)
        game["_finished"] = True
        game["_started"] = False
        save_active_game(game)

        with session_scope() as db:
            self.assertIsNone(db.scalar(select(ActiveGame).where(ActiveGame.game_id == game["_id"])))

    def test_snapshotless_legacy_score_is_imported_once(self):
        entry = {
            "ts": "2025-08-30T20:36:11+00:00",
            "name": "Mani",
            "points": 1354,
            "gamename": "Neues Spiel",
            "opponent": "-",
            "opp_points": 0,
        }
        source = Path(self.temporary_directory.name) / "legacy.json"
        source.write_text(json.dumps({"normal": [entry]}), encoding="utf-8")

        self.assertEqual(import_legacy_leaderboards([source]), 1)
        self.assertEqual(import_legacy_leaderboards([source]), 0)
        with session_scope() as db:
            game = db.scalar(select(CompletedGame))
            participant = db.scalar(select(GameParticipant))
            self.assertEqual(game.game_id, stable_game_id(entry))
            self.assertEqual(game.mode, "1")
            self.assertEqual(participant.display_name, "Mani")
            self.assertEqual(participant.points, 1354)

    def test_registration_rate_limit_is_persistent(self):
        request = request_for()
        enforce_registration_rate_limit(request)

        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

        with self.assertRaisesRegex(Exception, "registration_temporarily_blocked") as blocked:
            enforce_registration_rate_limit(request)
        self.assertEqual(blocked.exception.status_code, 429)

    def test_game_creation_rate_limit_blocks_bursts(self):
        request = request_for()
        for _ in range(5):
            enforce_game_creation_rate_limit(request)

        with self.assertRaisesRegex(Exception, "game_creation_temporarily_blocked") as blocked:
            enforce_game_creation_rate_limit(request)
        self.assertEqual(blocked.exception.status_code, 429)

    def test_game_creation_payload_has_server_side_limits(self):
        valid = main.CreateReq.model_validate({"name": " Runde ", "mode": 2, "pass": " geheim "})
        self.assertEqual(valid.name, "Runde")
        self.assertEqual(valid.mode, "2")
        self.assertEqual(valid.passphrase, "geheim")

        for payload in (
            {"name": "", "mode": "2"},
            {"name": "x" * 81, "mode": "2"},
            {"name": "Runde", "mode": "5"},
            {"name": "Runde", "mode": "2", "pass": "x" * 101},
        ):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                main.CreateReq.model_validate(payload)

    def test_game_creation_http_validation_and_rate_limit(self):
        async def scenario():
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                invalid = await client.post("/api/games", json={"name": "Runde", "mode": "5"})
                self.assertEqual(invalid.status_code, 422)
                too_long = await client.post("/api/games", json={"name": "x" * 81, "mode": "2"})
                self.assertEqual(too_long.status_code, 422)

                created_ids = []
                for index in range(5):
                    response = await client.post("/api/games", json={"name": f"Runde {index}", "mode": "2"})
                    self.assertEqual(response.status_code, 200)
                    created_ids.append(response.json()["game_id"])
                blocked = await client.post("/api/games", json={"name": "Eine zu viel", "mode": "2"})
                self.assertEqual(blocked.status_code, 429)
                self.assertEqual(blocked.json()["detail"], "game_creation_temporarily_blocked")
                return created_ids

        for game_id in asyncio.run(scenario()):
            main.games.pop(game_id, None)

    def test_websocket_rejects_foreign_origin_and_unknown_actions(self):
        game = self.make_game(mode=1, players=[("p1", "Anna")])
        game["_passphrase"] = "private-round"
        game["_chat_history"] = [{"sender": "Anna", "text": "private message"}]
        save_active_game(game)
        with TestClient(main.app) as client:
            with self.assertRaises(WebSocketDisconnect) as rejected:
                with client.websocket_connect(f"/ws/{game['_id']}", headers={"origin": "https://evil.example"}):
                    pass
            self.assertEqual(rejected.exception.code, 1008)

            with client.websocket_connect(f"/ws/{game['_id']}", headers={"origin": "http://testserver"}) as websocket:
                initial = websocket.receive_json()
                self.assertTrue(initial["game"]["locked"])
                self.assertNotIn("scoreboard", initial)
                self.assertNotIn("private message", str(initial))
                websocket.send_json({"action": "not-a-real-action"})
                self.assertIn("Unbekannte Aktion", websocket.receive_json()["error"])
                websocket.send_json({"action": "chat_message", "text": "vor Beitritt"})
                self.assertEqual(websocket.receive_json()["error"], "Nicht beigetreten")
                websocket.send_json({"action": "end_game"})
                self.assertEqual(websocket.receive_json()["error"], "Nicht beigetreten")
                self.assertFalse(game["_aborted"])

    def test_websocket_connection_limits_are_released(self):
        websocket = type("Socket", (), {"client": type("Client", (), {"host": "127.0.0.9"})()})()
        original = dict(main.websocket_connections_by_address)
        main.websocket_connections_by_address.clear()
        try:
            with patch.object(main, "MAX_WEBSOCKETS_PER_ADDRESS", 2), patch.object(main, "MAX_WEBSOCKETS_GLOBAL", 2):
                first = main._reserve_websocket(websocket)
                second = main._reserve_websocket(websocket)
                self.assertEqual(first, "127.0.0.9")
                self.assertEqual(second, "127.0.0.9")
                self.assertIsNone(main._reserve_websocket(websocket))
                main._release_websocket(first)
                self.assertEqual(main._reserve_websocket(websocket), "127.0.0.9")
        finally:
            main.websocket_connections_by_address.clear()
            main.websocket_connections_by_address.update(original)

    def test_login_failure_limit_is_persistent(self):
        request = request_for()
        key = enforce_login_rate_limit(request, "anna")
        for _ in range(5):
            record_login_failure(key)

        with self.assertRaisesRegex(Exception, "login_temporarily_blocked") as blocked:
            enforce_login_rate_limit(request, "anna")
        self.assertEqual(blocked.exception.status_code, 429)

    def test_turnstile_is_optional_but_partial_config_is_rejected(self):
        self.assertFalse(registration_public_config()["turnstile_enabled"])
        verify_registration_challenge(request_for(), None)

        with patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "site-key",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
            },
        ):
            with self.assertRaises(RuntimeError):
                validate_auth_protection_config()

    def test_enabled_turnstile_requires_a_token(self):
        with patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "site-key",
                "ROLLTHEDICE_TURNSTILE_SECRET": "secret",
            },
        ):
            with self.assertRaisesRegex(Exception, "captcha_required") as blocked:
                verify_registration_challenge(request_for(), None)
            self.assertEqual(blocked.exception.status_code, 400)

    def test_enabled_turnstile_verifies_token_and_action(self):
        response = io.BytesIO(json.dumps({"success": True, "action": "register"}).encode("utf-8"))
        with (
            patch.dict(
                os.environ,
                {
                    "ROLLTHEDICE_TURNSTILE_SITE_KEY": "site-key",
                    "ROLLTHEDICE_TURNSTILE_SECRET": "secret",
                },
            ),
            patch("app.auth_protection.urlopen", return_value=response) as verify,
        ):
            verify_registration_challenge(request_for(), "valid-token")

        self.assertEqual(verify.call_count, 1)
        sent_body = verify.call_args.args[0].data.decode("ascii")
        self.assertIn("secret=secret", sent_body)
        self.assertIn("response=valid-token", sent_body)

    def test_password_change_revokes_all_sessions(self):
        create_user("Ben", "first-password-123", must_change_password=True)
        identity, _raw_token = login(request_for(), "Ben", "first-password-123")

        change_password(identity, "first-password-123", "second-password-123")

        with session_scope() as db:
            user = db.scalar(select(User).where(User.username == "Ben"))
            self.assertFalse(user.must_change_password)
            self.assertEqual(db.scalar(select(func.count()).select_from(Session)), 0)

    def test_completed_game_drives_split_profile_statistics(self):
        user = create_user("Carla", "temporary-carla-123", must_change_password=False)
        g = self.make_game(mode=2, players=[("p1", "Carla"), ("p2", "Gast")])
        g["_players"][0]["user_id"] = user.id
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        g["_scoreboards"]["p2"] = self.low_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(g)

        self.assertTrue(persist_runtime_game(g, _compute_final_totals(g), snapshot))
        profile = public_player_profile("carla")["player"]

        self.assertEqual(profile["statistics"]["overall"]["games_played"], 1)
        self.assertEqual(profile["statistics"]["normal"]["points_total"], 410)
        self.assertEqual(profile["statistics"]["hardcore"]["games_played"], 0)
        self.assertEqual(len(profile["recent_games"]), 1)
        self.assertEqual(profile["recent_games"][0]["points"], 410)
        self.assertFalse(profile["recent_games"][0]["hardcore"])

        identity, raw_token = login(request_for(), "Carla", "temporary-carla-123")
        history = own_game_history(
            request_for(cookie=f"rollthedice_session={raw_token}", csrf=identity.csrf_token),
            limit="all",
        )
        self.assertEqual(history["selection"], "all")
        self.assertEqual(history["mode"], "normal")
        self.assertEqual(
            history["summary"],
            {
                "games": 1,
                "points_total": 410,
                "normal": {"games": 1, "median_points": 410.0, "average_points": 410.0},
                "hardcore": {"games": 0, "median_points": None, "average_points": None},
            },
        )
        self.assertEqual(history["games"][0]["game_id"], g["_id"])

    def test_profile_achievements_are_backfilled_from_saved_games(self):
        user = create_user("Achiever", "temporary-achiever-123", must_change_password=False)
        g = self.make_game(mode=1, players=[("p1", user.username)])
        g["_players"][0]["user_id"] = user.id
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(g)
        snapshot["finished_at"] = "2026-08-30T01:30:00+00:00"  # Sunday, 03:30 in Zurich
        self.assertTrue(persist_runtime_game(g, {"p1": 1_200}, snapshot))
        with session_scope() as db:
            player = db.get(User, user.id)
            player.statistics_views = 10
            player.achievement_gameplay_started_at = datetime(2026, 8, 1, tzinfo=timezone.utc)

        achievements = public_player_profile(user.username)["player"]["achievements"]
        unlocked = {item["key"] for item in achievements["unlocked"]}
        expected = {
            "account_created",
            "single_game_score_1000",
            "single_game_score_1100",
            "single_game_score_1200",
            "lower_six_strikes",
            "sixty_once",
            "night_owl",
            "statistics_views",
        }
        self.assertTrue(expected.issubset(unlocked), unlocked)
        self.assertEqual(len(unlocked) + len(achievements["locked"]), len(ACHIEVEMENTS))
        weekend = next(item for item in achievements["locked"] if item["key"] == "weekend_games")
        self.assertEqual(weekend["progress"], {"current": 1, "target": 10})
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(UserAchievement)), len(unlocked))

    def test_gameplay_achievements_ignore_games_before_the_rollout_marker(self):
        user = create_user("FreshStart", "temporary-fresh-start-123", must_change_password=False)
        g = self.make_game(mode=1, players=[("p1", user.username)])
        g["_players"][0]["user_id"] = user.id
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(g)
        snapshot["finished_at"] = "2020-08-30T01:30:00+00:00"
        self.assertTrue(persist_runtime_game(g, {"p1": 1_200}, snapshot))

        achievements = public_player_profile(user.username)["player"]["achievements"]
        unlocked = {item["key"] for item in achievements["unlocked"]}
        self.assertTrue({"account_created", "career_points_1000", "single_game_score_1200"}.issubset(unlocked))
        self.assertNotIn("lower_six_strikes", unlocked)
        self.assertNotIn("sixty_once", unlocked)
        self.assertNotIn("row_401", unlocked)

    def test_new_game_achievements_cover_minimal_combinations_and_differences(self):
        user = create_user("CombinationPro", "temporary-combination-123", must_change_password=False)
        g = self.make_game(mode=1, players=[("p1", user.username)])
        g["_players"][0]["user_id"] = user.id
        column = {
            "1": 5,
            "2": 10,
            "3": 9,
            "4": 12,
            "5": 8,
            "6": 18,
            "max": 30,
            "min": 1,
            "kenter": 35,
            "full": 43,
            "poker": 54,
            "60": 65,
        }
        g["_scoreboards"]["p1"] = self.full_scoreboard({name: column for name in ("down", "free", "up", "ang")})
        snapshot = build_leaderboard_snapshot_fields(g)
        snapshot["finished_at"] = "2026-09-03T12:00:00+00:00"
        self.assertTrue(persist_runtime_game(g, {"p1": 900}, snapshot))
        with session_scope() as db:
            db.get(User, user.id).achievement_gameplay_started_at = datetime(2026, 9, 1, tzinfo=timezone.utc)

        unlocked = {item["key"] for item in public_player_profile(user.username)["player"]["achievements"]["unlocked"]}
        self.assertTrue(
            {
                "full_minimal",
                "poker_minimal",
                "diff_over_100",
                "diff_over_120",
                "diff_pro",
                "kenter_all_written",
                "top_totals_equal",
                "diffs_equal",
                "all_top_bonuses",
            }.issubset(unlocked)
        )

    def test_additional_achievements_track_new_scores_streaks_and_hardcore_goals(self):
        user = create_user("AchievementSprint", "temporary-sprint-123", must_change_password=False)
        rollout = datetime(2026, 9, 2, 12, tzinfo=timezone.utc)
        with session_scope() as db:
            player = db.get(User, user.id)
            player.achievement_gameplay_started_at = rollout
            player.achievement_extra_started_at = rollout
            player.achievement_expansion_started_at = rollout

        columns = {
            "down": {
                "1": 5,
                "2": 10,
                "3": 15,
                "4": 20,
                "5": 25,
                "6": 30,
                "max": 30,
                "min": 5,
                "full": 58,
            },
            "free": {
                "1": 6,
                "6": 18,
                "max": 9,
                "min": 9,
                "full": 55,
            },
            "up": {
                "1": 6,
                "6": 18,
                "max": 26,
                "min": 26,
                "full": 49,
            },
            "ang": {
                "1": 6,
                "6": 18,
                "max": 30,
                "min": 5,
                "full": 46,
            },
        }
        for day in range(30):
            game = self.make_game(mode=1, players=[("p1", user.username)])
            game["_players"][0]["user_id"] = user.id
            game["_hardcore"] = day >= 20
            game["_scoreboards"]["p1"] = self.full_scoreboard(columns)
            snapshot = build_leaderboard_snapshot_fields(game)
            snapshot["finished_at"] = (rollout + timedelta(days=day)).isoformat()
            self.assertTrue(
                persist_runtime_game(game, {"p1": 1_000 if game["_hardcore"] else 600}, snapshot)
            )

        unlocked = {
            item["key"]
            for item in public_player_profile(user.username)["player"]["achievements"]["unlocked"]
        }
        self.assertTrue(
            {
                "five_ones_written",
                "five_twos_written",
                "five_threes_written",
                "five_fours_written",
                "five_fives_written",
                "min_five",
                "max_under_ten",
                "min_under_ten",
                "max_over_25",
                "min_over_25",
                "diff_over_125",
                "max_thirty",
                "six_thirty",
                "styler_full_once",
                "styler_full_10",
                "daily_streak_7",
                "daily_streak_14",
                "daily_streak_30",
                "hardcore_games_1",
                "hardcore_games_10",
                "hardcore_streak_7",
                "hardcore_score_300",
                "hardcore_score_400",
                "hardcore_score_500",
                "hardcore_score_600",
                "hardcore_score_700",
                "hardcore_score_800",
                "hardcore_score_900",
                "hardcore_score_1000",
                "normal_under_700",
            }.issubset(unlocked),
            unlocked,
        )

    def test_office_hours_series_counts_only_games_after_its_rollout_marker(self):
        user = create_user("OfficeFraud", "temporary-office-fraud-123", must_change_password=False)
        rollout = datetime(2026, 9, 2, 7, tzinfo=timezone.utc)
        with session_scope() as db:
            player = db.get(User, user.id)
            player.achievement_gameplay_started_at = rollout
            player.achievement_office_hours_started_at = rollout

        def persist_office_game(finished_at: datetime) -> None:
            game = self.make_game(mode=1, players=[("p1", user.username)])
            game["_players"][0]["user_id"] = user.id
            game["_scoreboards"]["p1"] = self.low_scoreboard()
            snapshot = build_leaderboard_snapshot_fields(game)
            snapshot["finished_at"] = finished_at.isoformat()
            self.assertTrue(persist_runtime_game(game, {"p1": 600}, snapshot))

        # This is a valid office-hours game, but it is just before the series
        # rollout and must not contribute to the new 10/25/50 thresholds.
        persist_office_game(rollout - timedelta(minutes=1))
        for index in range(9):
            persist_office_game(rollout + timedelta(minutes=index))

        achievements = public_player_profile(user.username)["player"]["achievements"]
        locked = {achievement["key"]: achievement for achievement in achievements["locked"]}
        self.assertEqual(locked["office_hours_10"]["progress"], {"current": 9, "target": 10})

        persist_office_game(rollout + timedelta(minutes=9))
        for index in range(10, 50):
            persist_office_game(rollout + timedelta(minutes=index))

        unlocked = {
            achievement["key"]
            for achievement in public_player_profile(user.username)["player"]["achievements"]["unlocked"]
        }
        self.assertTrue(
            {"office_hours", "office_hours_10", "office_hours_25", "office_hours_50"}.issubset(unlocked),
            unlocked,
        )

    def test_multiplayer_achievements_are_winner_only_and_start_at_their_rollout(self):
        winner = create_user("MarginWinner", "temporary-margin-winner-123", must_change_password=False)
        runner_up = create_user("MarginRunner", "temporary-margin-runner-123", must_change_password=False)
        last_place = create_user("MarginLast", "temporary-margin-last-123", must_change_password=False)
        teammate = create_user("MarginTeam", "temporary-margin-team-123", must_change_password=False)
        historic = create_user("MarginHistoric", "temporary-margin-historic-123", must_change_password=False)
        boundary = create_user("MarginBoundary", "temporary-margin-boundary-123", must_change_password=False)
        rollout = datetime(2026, 9, 2, 12, tzinfo=timezone.utc)
        users = (winner, runner_up, last_place, teammate, historic, boundary)
        with session_scope() as db:
            for user in users:
                db.get(User, user.id).achievement_multiplayer_started_at = rollout

        def persist_multiplayer_game(
            mode: int | str,
            players: list[tuple[str, str]],
            totals: dict[str, int],
            finished_at: datetime,
            assigned_ids: dict[str, int],
        ) -> None:
            game = self.make_game(mode=mode, players=players)
            for player in game["_players"]:
                player["user_id"] = assigned_ids.get(player["id"])
            if str(mode).lower() == "2v2":
                game["_scoreboards_by_team"] = {"A": self.low_scoreboard(), "B": self.low_scoreboard()}
            else:
                for player in game["_players"]:
                    game["_scoreboards"][player["id"]] = self.low_scoreboard()
            snapshot = build_leaderboard_snapshot_fields(game)
            snapshot["finished_at"] = finished_at.isoformat()
            self.assertTrue(persist_runtime_game(game, totals, snapshot))

        # A game from before rollout must not award any of the fresh multiplayer goals.
        persist_multiplayer_game(
            2,
            [("h1", historic.username), ("h2", "Guest")],
            {"h1": 1_000, "h2": 300},
            rollout - timedelta(minutes=1),
            {"h1": historic.id},
        )
        # A strict 100-point lead is deliberately not "more than 100". A tie is
        # not a win either, so neither game can create a multiplayer achievement.
        persist_multiplayer_game(
            2,
            [("b1", boundary.username), ("b2", "Guest")],
            {"b1": 800, "b2": 700},
            rollout + timedelta(minutes=1),
            {"b1": boundary.id},
        )
        persist_multiplayer_game(
            2,
            [("b3", boundary.username), ("b4", "Guest")],
            {"b3": 700, "b4": 700},
            rollout + timedelta(minutes=2),
            {"b3": boundary.id},
        )
        persist_multiplayer_game(
            2,
            [("p1", winner.username), ("p2", runner_up.username)],
            {"p1": 1_000, "p2": 400},
            rollout + timedelta(minutes=3),
            {"p1": winner.id, "p2": runner_up.id},
        )
        persist_multiplayer_game(
            3,
            [
                ("p1", winner.username),
                ("p2", runner_up.username),
                ("p3", last_place.username),
            ],
            {"p1": 1_000, "p2": 600, "p3": 400},
            rollout + timedelta(minutes=4),
            {"p1": winner.id, "p2": runner_up.id, "p3": last_place.id},
        )
        persist_multiplayer_game(
            "2v2",
            [
                ("p1", winner.username),
                ("p2", runner_up.username),
                ("p3", teammate.username),
                ("p4", "Guest"),
            ],
            {"A": 1_000, "B": 400},
            rollout + timedelta(minutes=5),
            {"p1": winner.id, "p2": runner_up.id, "p3": teammate.id},
        )
        persist_multiplayer_game(
            2,
            [("p1", winner.username), ("p2", runner_up.username)],
            {"p1": 701, "p2": 700},
            rollout + timedelta(minutes=6),
            {"p1": winner.id, "p2": runner_up.id},
        )

        expected_winner_keys = {
            "multiplayer_2p_margin_100",
            "multiplayer_2p_margin_200",
            "multiplayer_2p_margin_350",
            "multiplayer_3p_runner_up_margin_100",
            "multiplayer_3p_runner_up_margin_200",
            "multiplayer_3p_runner_up_margin_350",
            "multiplayer_3p_last_margin_100",
            "multiplayer_3p_last_margin_200",
            "multiplayer_3p_last_margin_350",
            "multiplayer_2v2_margin_100",
            "multiplayer_2v2_margin_200",
            "multiplayer_2v2_margin_350",
            "multiplayer_close_win",
            "multiplayer_one_point_win",
            "multiplayer_blowout",
        }
        winner_keys = {
            item["key"]
            for item in public_player_profile(winner.username)["player"]["achievements"]["unlocked"]
            if item["key"].startswith("multiplayer_")
        }
        self.assertEqual(winner_keys, expected_winner_keys)
        teammate_keys = {
            item["key"]
            for item in public_player_profile(teammate.username)["player"]["achievements"]["unlocked"]
            if item["key"].startswith("multiplayer_")
        }
        self.assertEqual(
            teammate_keys,
            {
                "multiplayer_2v2_margin_100",
                "multiplayer_2v2_margin_200",
                "multiplayer_2v2_margin_350",
                "multiplayer_blowout",
            },
        )
        for user in (runner_up, last_place, historic, boundary):
            unlocked = public_player_profile(user.username)["player"]["achievements"]["unlocked"]
            self.assertFalse(any(item["key"].startswith("multiplayer_") for item in unlocked), user.username)

    def test_hardcore_count_and_score_achievements_are_historical_only(self):
        user = create_user("HistoricalHardcore", "temporary-hardcore-123", must_change_password=False)
        historic = datetime(2026, 8, 1, 12, tzinfo=timezone.utc)
        game = self.make_game(mode=1, players=[("p1", user.username)])
        game["_players"][0]["user_id"] = user.id
        game["_hardcore"] = True
        game["_scoreboards"]["p1"] = self.high_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(game)
        snapshot["finished_at"] = historic.isoformat()
        self.assertTrue(persist_runtime_game(game, {"p1": 1_000}, snapshot))
        with session_scope() as db:
            player = db.get(User, user.id)
            player.achievement_gameplay_started_at = datetime(2026, 9, 2, tzinfo=timezone.utc)
            player.achievement_extra_started_at = datetime(2026, 9, 2, tzinfo=timezone.utc)

        unlocked = {
            item["key"]
            for item in public_player_profile(user.username)["player"]["achievements"]["unlocked"]
        }
        self.assertIn("hardcore_games_1", unlocked)
        self.assertTrue(
            {f"hardcore_score_{score}" for score in (300, 400, 500, 600, 700, 800, 900, 1000)}.issubset(
                unlocked
            )
        )
        self.assertNotIn("five_ones_written", unlocked)
        self.assertNotIn("styler_full_once", unlocked)
        self.assertNotIn("daily_streak_7", unlocked)
        self.assertNotIn("hardcore_streak_7", unlocked)

    def test_exact_score_achievements_are_historical_and_drive_the_achievement_ranking(self):
        achiever = create_user("PointLanding", "temporary-landing-123", must_change_password=False)
        newcomer = create_user("Newcomer", "temporary-newcomer-123", must_change_password=False)
        game = self.make_game(mode=1, players=[("p1", achiever.username)])
        game["_players"][0]["user_id"] = achiever.id
        game["_scoreboards"]["p1"] = self.low_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(game)
        snapshot["finished_at"] = "2020-01-15T12:00:00+00:00"
        self.assertTrue(persist_runtime_game(game, {"p1": 555}, snapshot))

        profile = public_player_profile(achiever.username)["player"]
        unlocked = {item["key"]: item for item in profile["achievements"]["unlocked"]}
        self.assertIn("exact_game_score_555", unlocked)
        self.assertIn("normal_under_700", unlocked)
        self.assertEqual(unlocked["exact_game_score_555"]["points"], 4)
        self.assertEqual(profile["statistics"]["overall"]["achievement_points"], 8)
        self.assertEqual(profile["achievements"]["points_earned"], 8)

        ranking = player_ranking(mode="achievements", sort="achievements")
        self.assertEqual([row["username"] for row in ranking["players"][:2]], [achiever.username, newcomer.username])
        self.assertEqual(ranking["players"][0]["achievement_points"], 8)
        self.assertEqual(ranking["players"][1]["games_played"], 0)

    def test_achievement_score_migration_backfills_existing_final_scores(self):
        user = create_user("MigrationScore", "temporary-migration-123", must_change_password=False)
        game = self.make_game(mode=1, players=[("p1", user.username)])
        game["_players"][0]["user_id"] = user.id
        game["_scoreboards"]["p1"] = self.low_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(game)
        snapshot["finished_at"] = "2020-01-15T12:00:00+00:00"
        self.assertTrue(persist_runtime_game(game, {"p1": 666}, snapshot))
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")

        command.downgrade(config, "20260902_0011")
        command.upgrade(config, "head")

        with session_scope() as db:
            keys = set(
                db.scalars(
                    select(UserAchievement.achievement_key).where(UserAchievement.user_id == user.id)
                )
            )
        self.assertIn("exact_game_score_666", keys)
        self.assertIn("normal_under_700", keys)

    def test_account_statistics_and_history_keep_modes_separate(self):
        user = create_user("ModeStats", "temporary-mode-stats-123", must_change_password=False)
        base_time = datetime(2026, 8, 1, tzinfo=timezone.utc)
        samples = [
            (False, 900),
            (False, 1000),
            (True, 400),
            (False, 1100),
            (True, 500),
            (False, 1200),
            (False, 1300),
        ]
        with session_scope() as db:
            for index, (hardcore, score) in enumerate(samples):
                timestamp = base_time + timedelta(minutes=index)
                game = CompletedGame(
                    game_id=f"mode-stats-{index}",
                    game_name=f"Mode stats {index}",
                    finished_at=timestamp,
                    mode="1",
                    hardcore=hardcore,
                    snapshot_json="{}",
                    imported_from_legacy=False,
                    created_at=timestamp,
                )
                db.add(game)
                db.flush()
                db.add(
                    GameParticipant(
                        game_id=game.id,
                        position=0,
                        player_key=f"player-{index}",
                        display_name=user.username,
                        points=score,
                        user_id=user.id,
                    )
                )

        statistics = public_player_profile(user.username)["player"]["statistics"]
        self.assertEqual(statistics["overall"]["games_played"], 7)
        self.assertEqual(statistics["overall"]["points_total"], 6400)
        self.assertGreater(statistics["overall"]["achievement_points"], 0)
        self.assertGreater(statistics["overall"]["achievement_points_possible"], statistics["overall"]["achievement_points"])
        self.assertEqual(statistics["normal"]["games_played"], 5)
        self.assertEqual(statistics["normal"]["points_total"], 5500)
        self.assertEqual(statistics["normal"]["average_points"], 1100.0)
        self.assertEqual(statistics["normal"]["median_points"], 1100.0)
        self.assertEqual(statistics["normal"]["min_points"], 900)
        self.assertEqual(statistics["normal"]["max_points"], 1300)
        self.assertEqual(statistics["hardcore"]["games_played"], 2)
        self.assertEqual(statistics["hardcore"]["points_total"], 900)
        self.assertEqual(statistics["hardcore"]["average_points"], 450.0)
        self.assertEqual(statistics["hardcore"]["median_points"], 450.0)
        self.assertEqual(statistics["hardcore"]["min_points"], 400)
        self.assertEqual(statistics["hardcore"]["max_points"], 500)
        self.assertIsNone(statistics["hardcore"]["trend"])

        identity, raw_token = login(request_for(), user.username, "temporary-mode-stats-123")
        request = request_for(cookie=f"rollthedice_session={raw_token}", csrf=identity.csrf_token)
        with session_scope() as db:
            newest_normal = _recent_games_for_user(db, user.id, limit=3, mode="normal")
        self.assertEqual([game["points"] for game in newest_normal], [1300, 1200, 1100])
        self.assertTrue(all(not game["hardcore"] for game in newest_normal))

        normal_history = own_game_history(request, limit="10", mode="normal")
        self.assertEqual([game["points"] for game in normal_history["games"]], [1300, 1200, 1100, 1000, 900])

        hardcore_history = own_game_history(request, limit="10", mode="hardcore")
        self.assertEqual([game["points"] for game in hardcore_history["games"]], [500, 400])
        self.assertTrue(all(game["hardcore"] for game in hardcore_history["games"]))

    def test_team_score_is_attributed_to_both_registered_members(self):
        first = create_user("Dora", "temporary-dora-123", must_change_password=False)
        second = create_user("Emil", "temporary-emil-123", must_change_password=False)
        g = self.make_game(
            mode="2v2",
            players=[
                ("p1", "Dora"),
                ("p2", "Gast 1"),
                ("p3", "Emil"),
                ("p4", "Gast 2"),
            ],
        )
        g["_players"][0]["user_id"] = first.id
        g["_players"][2]["user_id"] = second.id
        g["_scoreboards_by_team"]["A"] = self.high_scoreboard()
        g["_scoreboards_by_team"]["B"] = self.low_scoreboard()

        persist_runtime_game(g, _compute_final_totals(g), build_leaderboard_snapshot_fields(g))

        with session_scope() as db:
            scores = list(
                db.scalars(
                    select(GameParticipant.points)
                    .where(GameParticipant.user_id.in_([first.id, second.id]))
                    .order_by(GameParticipant.user_id)
                )
            )
            self.assertEqual(scores, [410, 410])
            self.assertEqual(db.scalar(select(func.count()).select_from(CompletedGame)), 1)

    def test_player_ranking_separates_normal_and_hardcore_games(self):
        first = create_user("Rina", "temporary-rina-123", must_change_password=False)
        second = create_user("Sven", "temporary-sven-123", must_change_password=False)
        for hardcore, user, board in (
            (False, first, self.high_scoreboard()),
            (True, first, self.low_scoreboard()),
            (False, second, self.low_scoreboard()),
        ):
            g = self.make_game(mode=1, hardcore=hardcore, players=[("p1", user.username)])
            g["_players"][0]["user_id"] = user.id
            g["_scoreboards"]["p1"] = board
            persist_runtime_game(g, _compute_final_totals(g), build_leaderboard_snapshot_fields(g))

        normal = player_ranking(mode="normal")
        hardcore = player_ranking(mode="hardcore")

        self.assertEqual([row["username"] for row in normal["players"]], ["Rina", "Sven"])
        self.assertEqual(normal["players"][0]["games_played"], 1)
        self.assertEqual(normal["players"][0]["points_total"], 410)
        self.assertEqual([row["username"] for row in hardcore["players"]], ["Rina"])
        self.assertEqual(hardcore["players"][0]["games_played"], 1)

    def test_admin_assignment_is_audited_and_updates_profile(self):
        admin = create_user("Admin", "temporary-admin-123", role="admin", must_change_password=False)
        player = create_user("Fiona", "temporary-fiona-123", must_change_password=False)
        g = self.make_game(mode=1, players=[("guest", "Fiona als Gast")])
        g["_scoreboards"]["guest"] = self.high_scoreboard()
        persist_runtime_game(g, _compute_final_totals(g), build_leaderboard_snapshot_fields(g))
        with session_scope() as db:
            participant_id = db.scalar(select(GameParticipant.id))

        identity, raw_token = login(request_for(), "Admin", "temporary-admin-123")
        request = request_for(
            cookie=f"rollthedice_session={raw_token}",
            csrf=identity.csrf_token,
            origin="http://testserver",
        )
        result = assign_game_participant(participant_id, AssignmentRequest(user_id=player.id), request)

        self.assertTrue(result["changed"])
        self.assertEqual(public_player_profile("Fiona")["player"]["statistics"]["overall"]["points_total"], 410)
        with session_scope() as db:
            audit = db.scalar(select(AssignmentAudit))
            self.assertEqual(audit.admin_user_id, admin.id)
            self.assertEqual(audit.new_user_id, player.id)

    def test_admin_deletion_updates_users_files_stats_and_blocks_reimport(self):
        admin = create_user("DeleteAdmin", "temporary-delete-123", role="admin", must_change_password=False)
        first = create_user("DeleteOne", "temporary-delete-123", must_change_password=False)
        second = create_user("DeleteTwo", "temporary-delete-123", must_change_password=False)
        g = self.make_game(
            mode="2v2",
            players=[
                ("p1", "DeleteOne"),
                ("p2", "DeleteTwo"),
                ("p3", "Gast A"),
                ("p4", "Gast B"),
            ],
        )
        g["_players"][0]["user_id"] = first.id
        g["_players"][1]["user_id"] = second.id
        g["_scoreboards_by_team"]["A"] = self.high_scoreboard()
        g["_scoreboards_by_team"]["B"] = self.low_scoreboard()
        snapshot = build_leaderboard_snapshot_fields(g)
        totals = _compute_final_totals(g)
        self.assertTrue(persist_runtime_game(g, totals, snapshot))

        entry = {
            **snapshot,
            "ts": snapshot["finished_at"],
            "points": max(totals.values()),
            "name": "DeleteOne, Gast A",
            "gamename": "Delete test",
            "opponent": "DeleteTwo, Gast B",
            "opp_points": min(totals.values()),
        }
        root = Path(self.temporary_directory.name)
        files = LeaderboardFiles(
            recent=root / "recent.json",
            alltime=root / "alltime.json",
            shame=root / "shame.json",
            last_games=root / "last.json",
            stats=root / "stats.json",
        )
        files.recent.write_text(json.dumps({"normal": [entry], "hc": []}), encoding="utf-8")
        files.alltime.write_text(json.dumps({"normal": [entry], "hc": []}), encoding="utf-8")
        files.shame.write_text(json.dumps({"recent": [entry], "alltime": [entry]}), encoding="utf-8")
        files.last_games.write_text(json.dumps([entry]), encoding="utf-8")
        files.stats.write_text(
            json.dumps(
                {
                    "games_played": 10,
                    "average_points": {
                        "normal": {"games": 5, "points_total": 2000, "average_points": 400},
                        "hc": {"games": 0, "points_total": 0, "average_points": 0},
                    },
                }
            ),
            encoding="utf-8",
        )

        identity, raw_token = login(request_for(), admin.username, "temporary-delete-123")
        request = request_for(
            cookie=f"rollthedice_session={raw_token}",
            csrf=identity.csrf_token,
            origin="http://testserver",
        )
        payload = main.DeleteCompletedGameReq(
            reason="Unsachgemäße Punktebearbeitung",
            confirmation_game_id=g["_id"],
        )
        with patch.object(main, "LEADERBOARD_FILES", files):
            mismatch = main.DeleteCompletedGameReq(
                reason="Unsachgemäße Punktebearbeitung",
                confirmation_game_id="falsche-id",
            )
            with self.assertRaisesRegex(Exception, "game_delete_confirmation_mismatch") as rejected:
                main.admin_delete_completed_game(g["_id"], mismatch, request)
            self.assertEqual(rejected.exception.status_code, 400)
            result = main.admin_delete_completed_game(g["_id"], payload, request)
            self.assertTrue(result["ok"])
            with self.assertRaisesRegex(Exception, "not_found"):
                main.api_game_from_leaderboard(g["_id"])
            with self.assertRaisesRegex(Exception, "game_already_deleted") as duplicate:
                main.admin_delete_completed_game(g["_id"], payload, request)
            self.assertEqual(duplicate.exception.status_code, 409)

        self.assertEqual(public_player_profile(first.username)["player"]["statistics"]["overall"]["games_played"], 0)
        self.assertEqual(public_player_profile(second.username)["player"]["statistics"]["overall"]["games_played"], 0)
        with session_scope() as db:
            self.assertIsNone(db.scalar(select(CompletedGame).where(CompletedGame.game_id == g["_id"])))
            tombstone = db.scalar(select(DeletedGame).where(DeletedGame.game_id == g["_id"]))
            self.assertEqual(tombstone.deleted_by_user_id, admin.id)
            self.assertEqual(tombstone.reason, "Unsachgemäße Punktebearbeitung")

        for path in (files.recent, files.alltime, files.shame, files.last_games):
            self.assertNotIn(g["_id"], path.read_text(encoding="utf-8"))
        stats = json.loads(files.stats.read_text(encoding="utf-8"))
        self.assertEqual(stats["games_played"], 9)
        self.assertEqual(stats["average_points"]["normal"]["games"], 4)
        self.assertEqual(stats["average_points"]["normal"]["points_total"], 1590)

        legacy = Path(self.temporary_directory.name) / "deleted-legacy.json"
        legacy.write_text(json.dumps([entry]), encoding="utf-8")
        self.assertEqual(import_legacy_leaderboards([legacy]), 0)
