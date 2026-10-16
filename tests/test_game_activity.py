"""Live picker totals respect room state, human identity and current audience."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from sqlalchemy import delete
from starlette.testclient import TestClient

from app import main
from app.api_game_activity import router
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.models import Session, User
from app.ownership import bind_founder
from tests.test_user_accounts import request_for


def seat(key: str, user_id=None, *, connected=True, **extra):
    return {"id": key, "user_id": user_id, "ws": object() if connected else None, **extra}


class GameActivityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/activity.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "preview", "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
        })
        self.env.start()
        self.registry = patch.dict(main.games, clear=True)
        self.registry.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.founder = create_user("ActivityFounder", "test-password-123", role="admin", must_change_password=False)
        self.staff = create_user("ActivityStaff", "test-password-123", role="admin", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
            db.get(User, self.staff.id).analytics_access = True
        self.tokens = {user.id: login(request_for(), user.username, "test-password-123")[1]
                       for user in (self.founder, self.staff)}
        application = FastAPI()
        application.include_router(router)
        self.client = TestClient(application)
        self.addCleanup(self.client.close)

    def tearDown(self):
        self.registry.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def request(self, user=None):
        self.client.cookies.clear()
        if user:
            self.client.cookies.set("rollthedice_session", self.tokens[user.id])
        return self.client.get("/api/game-activity")

    def room(self, key, players, *, product="zdwa", **extra):
        main.games[key] = {"_game_type": product, "_started": True, "_players": players, **extra}

    def test_connected_humans_are_deduplicated_per_product_without_identity_fields(self):
        self.room("PRIVATE_ROOM_A", [seat("PRIVATE_SEAT", 71), seat("tab-two", 71), seat("guest"),
                                     seat("offline", 73, connected=False), seat("cpu-1", is_cpu=True),
                                     seat("cpu-2", type="cpu"), seat("participant-cpu")],
                  _participants=[{"id": "participant-cpu", "type": "cpu"}],
                  _spectators=[seat("PRIVATE_SPECTATOR", 74)], _name="PRIVATE_TABLE")
        self.room("PRIVATE_ROOM_B", [seat("other-device", 71), seat("guest"), seat("other-person", 72)])
        self.room("PRIVATE_ZILCH", [seat("same-account", 71)], product="zilch")
        self.room("PRIVATE_HOUSE", [seat("same-account", 71)], product="hausdepp", hand="PRIVATE_CARD")
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"}):
            response = self.request(self.founder)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"games": {
            "zdwa": {"players": 4}, "zilch": {"players": 1}, "hausdepp": {"players": 1},
        }})
        self.assertNotIn("PRIVATE", response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn("cookie", response.headers["vary"].lower())

    def test_waiting_finished_aborted_spectators_and_tournament_breaks_are_excluded(self):
        for key, extra in (("waiting", {"_started": False}), ("finished", {"_finished": True}),
                           ("aborted", {"_aborted": True}), ("break", {"_finished": True,
                            "_hausdepp_tournament": {"completed": False}})):
            self.room(key, [seat(key)], **extra)
        self.room("watching", [], _spectators=[seat("spectator")])
        self.room("legacy", [seat("legacy-guest")])
        main.games["legacy"].pop("_game_type")
        self.room("unknown", [seat("unknown")], product="unsupported")
        self.room("paused-connected", [seat("paused")], _manual_pause=True)
        self.assertEqual(self.request().json(), {"games": {"zdwa": {"players": 2}, "hausdepp": {"players": 0}}})
        main.games["legacy"]["_players"][0]["ws"] = None
        self.assertEqual(self.request().json()["games"]["zdwa"]["players"], 1)

    def test_public_house_counts_do_not_require_an_account_or_dashboard_privileges(self):
        self.room("private", [seat("private", 71)], product="hausdepp")
        self.room("zilch", [seat("zilch", 71)], product="zilch")
        for user in (None, self.staff):
            response = self.request(user)
            self.assertEqual(response.json(), {"games": {"zdwa": {"players": 0}, "hausdepp": {"players": 1}}})
            self.assertNotIn("private", response.text)
            self.assertNotIn("zilch", response.text)
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"}):
            self.assertEqual(self.request().json(), {"games": {
                "zdwa": {"players": 0}, "zilch": {"players": 1}, "hausdepp": {"players": 1},
            }})
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "authenticated"}):
            self.assertNotIn("zilch", self.request().json()["games"])
            self.assertEqual(self.request(self.staff).json()["games"]["zilch"], {"players": 1})
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": self.staff.username}):
            self.assertEqual(self.request(self.staff).json()["games"]["zilch"], {"players": 1})
            self.assertEqual(self.request(self.staff).json()["games"]["hausdepp"], {"players": 1})

    def test_sessions_and_audience_are_resolved_again_after_an_earlier_success(self):
        self.assertIn("hausdepp", self.request(self.founder).json()["games"])
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": self.staff.username}):
            self.assertIn("zilch", self.request(self.staff).json()["games"])
        self.assertNotIn("zilch", self.request(self.staff).json()["games"])
        with session_scope() as db:
            db.execute(delete(Session).where(Session.user_id == self.founder.id))
        response = self.request(self.founder)
        self.assertEqual(response.json(), {"games": {"zdwa": {"players": 0}, "hausdepp": {"players": 0}}})
        self.assertEqual(response.json()["games"]["hausdepp"], {"players": 0})

    def test_route_is_registered_without_accepting_a_client_selected_private_product(self):
        client = TestClient(main.app)
        self.addCleanup(client.close)
        self.assertEqual(client.get("/api/game-activity").json(), {"games": {"zdwa": {"players": 0}, "hausdepp": {"players": 0}}})
        self.assertEqual(self.client.get("/api/game-activity?game=hausdepp").json(),
                         {"games": {"zdwa": {"players": 0}, "hausdepp": {"players": 0}}})
