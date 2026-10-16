"""Account-only Hausdepp experience, private evidence and durable receipts."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from starlette.testclient import TestClient

from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.ownership import bind_founder
from tests.test_user_accounts import request_for


class HausdeppProgressApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp-progress.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.founder = create_user("Founder", "secure-password-123", role="admin", must_change_password=False)
        self.other = create_user("OtherAdmin", "secure-password-123", role="admin", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
        self.identity, self.token = login(request_for(), self.founder.username, "secure-password-123")

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def store_round(self, game_id="round-one", *, user_id=None, flags=None, cpu_flags=None):
        # Explicit server-result fixture, not a client award command. Legacy
        # schema 1 proves outcomes only; schema 2 contains isolated event flags.
        payload = {
            "schema_version": 2 if flags is not None else 1,
            "payload_kind": "hausdepp_result", "game_type": "hausdepp", "game_id": game_id,
            "name": "Privater Testtisch", "finished_at": "2026-10-16T12:00:00+00:00",
            "participants": [{"id": "human", "name": "Founder", "is_cpu": False},
                             {"id": "cpu-1", "name": "Kartensepp", "is_cpu": True}],
            "loser_id": "cpu-1", "finished_order": ["human"],
        }
        if flags is not None:
            payload["achievement_evidence"] = {"schema_version": 1, "complete": True, "players": {
                "human": {"flags": flags, "ten_clears": 0},
                "cpu-1": {"flags": cpu_flags or [], "ten_clears": 0},
            }}
        saved = persist_completed_game_result(
            game_id=game_id, game_name=payload["name"], game_type="hausdepp", mode="2", hardcore=False,
            finished_at=datetime(2026, 10, 16, 12, tzinfo=timezone.utc), snapshot=payload,
            participants=[{"player_key": "human", "display_name": "Founder",
                           "user_id": self.founder.id if user_id is None else user_id},
                          {"player_key": "cpu-1", "display_name": "Kartensepp", "user_id": None}],
        )
        self.assertTrue(saved.succeeded)

    def client(self):
        client = TestClient(main.app)
        client.cookies.set("rollthedice_session", self.token)
        return client

    def test_progress_and_receipts_require_the_bound_founder_account(self):
        with TestClient(main.app) as client:
            self.assertEqual(client.get("/api/hausdepp/account").status_code, 401)
            self.assertEqual(client.post("/api/hausdepp/account/acknowledge", json={"revision": 0}).status_code, 401)
            other_identity, other_token = login(request_for(), self.other.username, "secure-password-123")
            client.cookies.set("rollthedice_session", other_token)
            self.assertEqual(client.get("/api/hausdepp/account").status_code, 403)
            denied = client.post("/api/hausdepp/account/acknowledge", json={"revision": 0},
                                 headers={"X-CSRF-Token": other_identity.csrf_token})
            self.assertEqual(denied.status_code, 403)
            self.assertEqual(denied.headers["cache-control"], "no-store")

    def test_existing_outcomes_credit_only_provable_progress_and_newton_greeting(self):
        self.store_round()
        with self.client() as client:
            response = client.get("/api/hausdepp/account")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            data = response.json()
            self.assertEqual(data["scoring"], {"available": True, "points": 50, "round_points": 10,
                                                "achievement_points": 40, "round_reward": 10})
            self.assertEqual(data["rank"]["name"]["de"], "Newton")
            self.assertEqual(data["rank"]["quote"]["de"], "Ab jetzt geht’s bergab. Ganz nach den Naturgesetzen.")
            self.assertEqual(len(data["ranks"]), 24)
            self.assertEqual(len(data["achievements"]["items"]), 100)
            self.assertEqual({item["id"] for item in data["achievements"]["items"] if item["unlocked"]},
                             {"hausdepp_01", "hausdepp_03", "hausdepp_09", "hausdepp_57"})
            self.assertEqual(data["presentation"]["pending"]["to_rank"]["name"]["de"], "Newton")
            self.assertEqual(client.get("/api/hausdepp/account").json()["scoring"], data["scoring"])

    def test_own_catalogue_never_contains_foreign_private_peek_unlocks_or_raw_evidence(self):
        self.store_round(flags=["hausdepp_23"], cpu_flags=["hausdepp_20"])
        self.store_round("foreign-round", user_id=self.other.id, flags=["hausdepp_19"])
        with self.client() as client:
            data = client.get("/api/hausdepp/account").json()
            items = {item["id"]: item for item in data["achievements"]["items"]}
            self.assertTrue(items["hausdepp_23"]["unlocked"])
            self.assertFalse(items["hausdepp_20"]["unlocked"])
            self.assertFalse(items["hausdepp_19"]["unlocked"])
            self.assertEqual(data["statistics"]["rounds_played"], 1)
            results = client.get("/api/hausdepp/results").json()
            self.assertEqual(len(results["results"]), 1)
            for private in ("achievement_evidence", "ten_clears", "cpu_flags", "foreign-round"):
                self.assertNotIn(private, json.dumps(results))
                self.assertNotIn(private, json.dumps(data))

    def test_acknowledgement_is_csrf_protected_strict_and_durable(self):
        self.store_round()
        with self.client() as client:
            data = client.get("/api/hausdepp/account").json()
            revision = data["presentation"]["pending"]["revision"]
            endpoint = "/api/hausdepp/account/acknowledge"
            self.assertEqual(client.post(endpoint, json={"revision": revision}).status_code, 403)
            headers = {"X-CSRF-Token": self.identity.csrf_token}
            for invalid in (True, -1, "50", 1.5, None):
                with self.subTest(invalid=invalid):
                    self.assertEqual(client.post(endpoint, json={"revision": invalid}, headers=headers).status_code, 422)
            self.assertEqual(client.post(endpoint, json={"revision": revision, "user_id": self.other.id},
                                         headers=headers).status_code, 422)
            self.assertEqual(client.post(endpoint, json={"revision": revision + 1}, headers=headers).status_code, 400)
            acknowledged = client.post(endpoint, json={"revision": revision}, headers=headers)
            self.assertEqual(acknowledged.status_code, 200)
            self.assertEqual(acknowledged.headers["cache-control"], "no-store")
            self.assertTrue(acknowledged.json()["acknowledged"])
            self.assertIsNone(client.get("/api/hausdepp/account").json()["presentation"]["pending"])

    def test_old_tab_receipt_cannot_hide_new_round_progress(self):
        self.store_round()
        with self.client() as client:
            old_revision = client.get("/api/hausdepp/account").json()["scoring"]["points"]
            self.store_round("round-two")
            latest = client.get("/api/hausdepp/account").json()["scoring"]["points"]
            self.assertEqual(latest, old_revision + 10)
            response = client.post("/api/hausdepp/account/acknowledge", json={"revision": old_revision},
                                   headers={"X-CSRF-Token": self.identity.csrf_token})
            self.assertEqual(response.status_code, 200)
            pending = client.get("/api/hausdepp/account").json()["presentation"]["pending"]
            self.assertEqual(pending["revision"], latest)
            self.assertEqual(pending["points_earned"], 10)

    def test_private_leaderboard_page_and_api_keep_founder_and_search_boundaries(self):
        self.store_round()
        with self.client() as client:
            page = client.get("/hausdepp/rangliste")
            self.assertEqual(page.status_code, 200)
            self.assertEqual(page.headers["x-robots-tag"], "noindex, nofollow")
            self.assertIn('name="robots" content="noindex, nofollow"', page.text)
            response = client.get("/api/hausdepp/leaderboard")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
            self.assertEqual(response.json()["entries"], [{
                "place": 1, "display_name": "Founder", "wins": 1, "rounds_played": 1,
                "win_rate": 100.0, "is_self": True,
            }])
            self.assertEqual(client.get("/api/hausdepp/leaderboard?players=3").json()["entries"], [])
            for query in ("players=1", "players=7", "limit=0", "limit=51"):
                self.assertEqual(client.get(f"/api/hausdepp/leaderboard?{query}").status_code, 422)
            self.assertEqual(client.get("/static/hausdepp-leaderboard.html").status_code, 404)
        with TestClient(main.app) as anonymous:
            page = anonymous.get("/hausdepp/rangliste", follow_redirects=False)
            self.assertEqual(page.status_code, 303)
            self.assertEqual(page.headers["x-robots-tag"], "noindex, nofollow")
            self.assertEqual(anonymous.get("/api/hausdepp/leaderboard").status_code, 401)
            _, token = login(request_for(), self.other.username, "secure-password-123")
            anonymous.cookies.set("rollthedice_session", token)
            self.assertEqual(anonymous.get("/hausdepp/rangliste").status_code, 403)
            self.assertEqual(anonymous.get("/api/hausdepp/leaderboard").status_code, 403)


if __name__ == "__main__":
    unittest.main()
