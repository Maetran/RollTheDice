import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from starlette.requests import Request
from sqlalchemy import func, select

from app import main
from app.api_users import AssignmentRequest, assign_game_participant, player_ranking, public_player_profile
from app.auth import change_password, create_user, login, resolve_session, validate_request_origin
from app.auth_protection import (
    enforce_login_rate_limit,
    enforce_registration_rate_limit,
    record_login_failure,
    registration_public_config,
    validate_auth_protection_config,
    verify_registration_challenge,
)
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import import_legacy_leaderboards, persist_runtime_game, stable_game_id
from app.models import AssignmentAudit, CompletedGame, DeletedGame, GameParticipant, Session, User
from app.security import validate_password
from tests.support import GameStateTestCase


def request_for(*, cookie: str = "", csrf: str = "", origin: str = "", host: str = "testserver") -> Request:
    headers = [(b"host", host.encode("ascii"))]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    if csrf:
        headers.append((b"x-csrf-token", csrf.encode("ascii")))
    if origin:
        headers.append((b"origin", origin.encode("ascii")))
    return Request({
        "type": "http",
        "method": "GET",
        "scheme": "http",
        "path": "/",
        "headers": headers,
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    })


class AccountDatabaseTestCase(GameStateTestCase):
    def setUp(self):
        super().setUp()
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "accounts.sqlite3"
        self.env_patch = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
            "ROLLTHEDICE_TURNSTILE_SECRET": "",
        })
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

    def test_password_minimum_is_eight_characters(self):
        self.assertEqual(validate_password("12345678"), "12345678")
        with self.assertRaisesRegex(ValueError, "mindestens 8 Zeichen"):
            validate_password("1234567")

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

        with patch.dict(os.environ, {
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "site-key",
            "ROLLTHEDICE_TURNSTILE_SECRET": "",
        }):
            with self.assertRaises(RuntimeError):
                validate_auth_protection_config()

    def test_enabled_turnstile_requires_a_token(self):
        with patch.dict(os.environ, {
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "site-key",
            "ROLLTHEDICE_TURNSTILE_SECRET": "secret",
        }):
            with self.assertRaisesRegex(Exception, "captcha_required") as blocked:
                verify_registration_challenge(request_for(), None)
            self.assertEqual(blocked.exception.status_code, 400)

    def test_enabled_turnstile_verifies_token_and_action(self):
        response = io.BytesIO(json.dumps({"success": True, "action": "register"}).encode("utf-8"))
        with patch.dict(os.environ, {
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "site-key",
            "ROLLTHEDICE_TURNSTILE_SECRET": "secret",
        }), patch("app.auth_protection.urlopen", return_value=response) as verify:
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
        snapshot = main._build_leaderboard_snapshot_fields(g)

        self.assertTrue(persist_runtime_game(g, main._compute_final_totals(g), snapshot))
        profile = public_player_profile("carla")["player"]

        self.assertEqual(profile["statistics"]["overall"]["games_played"], 1)
        self.assertEqual(profile["statistics"]["normal"]["points_total"], 410)
        self.assertEqual(profile["statistics"]["hardcore"]["games_played"], 0)

    def test_team_score_is_attributed_to_both_registered_members(self):
        first = create_user("Dora", "temporary-dora-123", must_change_password=False)
        second = create_user("Emil", "temporary-emil-123", must_change_password=False)
        g = self.make_game(mode="2v2", players=[
            ("p1", "Dora"), ("p2", "Gast 1"), ("p3", "Emil"), ("p4", "Gast 2"),
        ])
        g["_players"][0]["user_id"] = first.id
        g["_players"][2]["user_id"] = second.id
        g["_scoreboards_by_team"]["A"] = self.high_scoreboard()
        g["_scoreboards_by_team"]["B"] = self.low_scoreboard()

        persist_runtime_game(g, main._compute_final_totals(g), main._build_leaderboard_snapshot_fields(g))

        with session_scope() as db:
            scores = list(db.scalars(
                select(GameParticipant.points)
                .where(GameParticipant.user_id.in_([first.id, second.id]))
                .order_by(GameParticipant.user_id)
            ))
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
            persist_runtime_game(g, main._compute_final_totals(g), main._build_leaderboard_snapshot_fields(g))

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
        persist_runtime_game(g, main._compute_final_totals(g), main._build_leaderboard_snapshot_fields(g))
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
        g = self.make_game(mode="2v2", players=[
            ("p1", "DeleteOne"), ("p2", "DeleteTwo"), ("p3", "Gast A"), ("p4", "Gast B"),
        ])
        g["_players"][0]["user_id"] = first.id
        g["_players"][1]["user_id"] = second.id
        g["_scoreboards_by_team"]["A"] = self.high_scoreboard()
        g["_scoreboards_by_team"]["B"] = self.low_scoreboard()
        snapshot = main._build_leaderboard_snapshot_fields(g)
        totals = main._compute_final_totals(g)
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
        files = {
            "RECENT_FILE": Path(self.temporary_directory.name) / "recent.json",
            "ALLTIME_FILE": Path(self.temporary_directory.name) / "alltime.json",
            "SHAME_FILE": Path(self.temporary_directory.name) / "shame.json",
            "LAST_GAMES_FILE": Path(self.temporary_directory.name) / "last.json",
            "STATS_FILE": Path(self.temporary_directory.name) / "stats.json",
        }
        files["RECENT_FILE"].write_text(json.dumps({"normal": [entry], "hc": []}), encoding="utf-8")
        files["ALLTIME_FILE"].write_text(json.dumps({"normal": [entry], "hc": []}), encoding="utf-8")
        files["SHAME_FILE"].write_text(json.dumps({"recent": [entry], "alltime": [entry]}), encoding="utf-8")
        files["LAST_GAMES_FILE"].write_text(json.dumps([entry]), encoding="utf-8")
        files["STATS_FILE"].write_text(json.dumps({
            "games_played": 10,
            "average_points": {
                "normal": {"games": 5, "points_total": 2000, "average_points": 400},
                "hc": {"games": 0, "points_total": 0, "average_points": 0},
            },
        }), encoding="utf-8")

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
        with patch.multiple(main, **files):
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

        for key in ("RECENT_FILE", "ALLTIME_FILE", "SHAME_FILE", "LAST_GAMES_FILE"):
            self.assertNotIn(g["_id"], files[key].read_text(encoding="utf-8"))
        stats = json.loads(files["STATS_FILE"].read_text(encoding="utf-8"))
        self.assertEqual(stats["games_played"], 9)
        self.assertEqual(stats["average_points"]["normal"]["games"], 4)
        self.assertEqual(stats["average_points"]["normal"]["points_total"], 1590)

        legacy = Path(self.temporary_directory.name) / "deleted-legacy.json"
        legacy.write_text(json.dumps([entry]), encoding="utf-8")
        self.assertEqual(import_legacy_leaderboards([legacy]), 0)
