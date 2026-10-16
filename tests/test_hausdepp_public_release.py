"""Public discovery and authenticated play use the real V3 audience policy."""

from __future__ import annotations

import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

from sqlalchemy import delete
from starlette.testclient import TestClient

from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.hausdepp_cpu_runner import stop_cpu_runners
from app.models import Session, User
from app.product_hosts import safe_hausdepp_path
from app.site_seo import HAUSDEPP_ORIGIN, SITE_ORIGIN, ZILCH_ORIGIN
from tests.test_user_accounts import request_for
from tests.test_zilch_seo import _PublicDocument


class HausdeppPublicReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/public.sqlite3",
            "ROLLTHEDICE_SITE_ORIGIN": SITE_ORIGIN, "ROLLTHEDICE_ZILCH_ORIGIN": ZILCH_ORIGIN,
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
        })
        self.env.start()
        self.registry = patch.dict(main.games, clear=True)
        self.registry.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.player = create_user("PublicCardPlayer", "test-password-123", must_change_password=False)
        self.other = create_user("OtherCardPlayer", "test-password-123", must_change_password=False)
        self.identity, self.token = login(request_for(), self.player.username, "test-password-123")
        self.client = TestClient(main.app)
        self.addCleanup(self.client.close)

    def tearDown(self):
        asyncio.run(stop_cpu_runners())
        self.registry.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def signed_in(self):
        self.client.cookies.set("rollthedice_session", self.token)
        return self.client

    def test_public_lobby_and_rules_are_indexable_on_each_suite_host_with_one_canonical(self):
        for origin in (SITE_ORIGIN, ZILCH_ORIGIN, HAUSDEPP_ORIGIN):
            for path in ("/hausdepp", "/hausdepp/regeln"):
                with self.subTest(origin=origin, path=path):
                    response = self.client.get(f"{origin}{path}?lang=en&utm_source=test")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["cache-control"], "no-store")
                    self.assertNotIn("noindex", response.headers.get("x-robots-tag", ""))
                    document = _PublicDocument(response.text)
                    self.assertEqual(document.canonical, f"{HAUSDEPP_ORIGIN}{path}")
                    self.assertEqual(document.meta["og:url"], document.canonical)
                    self.assertEqual(response.headers["link"], f'<{document.canonical}>; rel="canonical"')
                    self.assertNotIn("noindex", document.meta.get("robots", ""))
                    self.assertTrue(document.headings)
                    self.assertNotIn(self.player.username, response.text)
                    self.assertNotIn(self.other.username, response.text)
        root = self.client.get(f"{HAUSDEPP_ORIGIN}/", follow_redirects=False)
        self.assertEqual(root.status_code, 308)
        self.assertEqual(root.headers["location"], "/hausdepp")

    def test_private_pages_and_personal_apis_require_authentication_then_accept_normal_accounts(self):
        for path in ("/hausdepp/konto", "/hausdepp/rangliste", "/hausdepp/spiel/guessed-private-id"):
            response = self.client.get(path, follow_redirects=False)
            self.assertEqual(response.status_code, 303)
            self.assertIn("noindex", response.headers["x-robots-tag"])
        for path in ("/api/hausdepp/account", "/api/hausdepp/results", "/api/hausdepp/leaderboard"):
            self.assertEqual(self.client.get(path).status_code, 401)
        self.assertFalse(self.client.get("/api/auth/me").json()["game_access"]["hausdepp_preview"])
        self.assertTrue(self.client.get("/api/auth/me").json()["game_access"]["hausdepp_public"])
        client = self.signed_in()
        access = client.get("/api/auth/me").json()["game_access"]
        self.assertTrue(access["hausdepp_preview"])
        for path in ("/hausdepp/konto", "/hausdepp/rangliste", "/api/hausdepp/account", "/api/hausdepp/leaderboard"):
            response = client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("noindex", response.headers["x-robots-tag"])
        self.assertEqual(client.get("/api/hausdepp/results?user_id=" + str(self.other.id)).json(), {"results": []})
        with session_scope() as db:
            db.execute(delete(Session).where(Session.user_id == self.player.id))
        self.assertEqual(client.get("/api/hausdepp/account").status_code, 401)
        self.assertEqual(client.get("/hausdepp").status_code, 200)

    def test_normal_account_can_create_a_table_but_public_html_and_anonymous_api_disclose_no_seats(self):
        client = self.signed_in()
        with patch.object(main, "enforce_game_creation_rate_limit"):
            created = client.post("/api/games", headers={"X-CSRF-Token": self.identity.csrf_token}, json={
                "name": "PRIVATE_OWNER_TABLE", "mode": "2", "game_type": "hausdepp", "cpu_count": 1,
            })
        self.assertEqual(created.status_code, 200, created.text)
        game_id = created.json()["game_id"]
        self.assertEqual(main.games[game_id]["_hausdepp_host_user_id"], self.player.id)
        self.assertEqual(client.get(f"/hausdepp/spiel/{game_id}").status_code, 200)
        client.cookies.clear()
        self.assertEqual(client.get("/api/games?game_type=hausdepp").json()["games"], [])
        self.assertEqual(client.get(f"/api/games/{game_id}").status_code, 404)
        html = client.get("/hausdepp").text
        self.assertNotIn("PRIVATE_OWNER_TABLE", html)
        self.assertNotIn(self.player.username, html)

    def test_house_login_stays_in_origin_and_legacy_apex_handoff_keeps_fixed_destinations(self):
        for path in ("/hausdepp", "/hausdepp/konto", "/hausdepp/rangliste", "/hausdepp/regeln?lang=en",
                     "/hausdepp/spiel/table42", "/hausdepp/spiel/table42/zuschauen"):
            response = self.client.get(f"{HAUSDEPP_ORIGIN}/zilch/anmelden?{urlencode({'return_to': path})}", follow_redirects=False)
            self.assertEqual(response.status_code, 200)
            self.assertIn('data-hausdepp-login="true"', response.text)
            self.assertIn('data-game="zilch"', response.text)
            self.assertIn('data-pwa-product="hausdepp"', response.text)
            self.assertIn('/hausdepp-manifest.webmanifest', response.text)
            self.assertIn('/static/icons/hausdepp-icon-32.png', response.text)
            self.assertNotIn('rel="manifest" href="/zilch-manifest', response.text)
            self.assertIn("noindex", response.headers["x-robots-tag"])
            self.client.cookies.set("rollthedice_session", self.token)
            continuation = "/auth/continue?" + urlencode({"app": "hausdepp", "path": path})
            resumed = self.client.get(f"{SITE_ORIGIN}{continuation}", follow_redirects=False)
            self.assertEqual(resumed.status_code, 303)
            self.assertEqual(resumed.headers["location"], f"{HAUSDEPP_ORIGIN}{path}")
        invalid = ("https://evil.invalid/x", "//evil.invalid/x", "/admin", "/hausdepp/spiel/../konto",
                   "/hausdepp/spiel/%252e%252e", "/hausdepp/spiel/foo%252fbar", "/hausdepp/spiel/foo\\bar",
                   "/hausdepp/konto#outside", "/hausdepp/spiel/%00", "/hausdepp/spiel/foo/zuschauen/extra")
        for path in invalid:
            with self.subTest(path=path):
                self.assertEqual(safe_hausdepp_path(path), "/hausdepp")
                response = self.client.get(f"{SITE_ORIGIN}/auth/continue?{urlencode({'app': 'hausdepp', 'path': path})}", follow_redirects=False)
                self.assertEqual(response.headers["location"], f"{HAUSDEPP_ORIGIN}/hausdepp")
        self.assertEqual(self.client.get(f"{HAUSDEPP_ORIGIN}/auth/continue?app=hausdepp", follow_redirects=False).status_code, 404)

    def test_private_house_destination_keeps_in_origin_login_and_disabled_accounts_do_not_pass(self):
        response = self.client.get(f"{HAUSDEPP_ORIGIN}/hausdepp/konto", follow_redirects=False)
        self.assertEqual(urlsplit(response.headers["location"]).path, "/zilch/anmelden")
        self.assertEqual(parse_qs(urlsplit(response.headers["location"]).query), {"return_to": ["/hausdepp/konto"]})
        client = self.signed_in()
        with session_scope() as db:
            db.get(User, self.player.id).is_active = False
        self.assertEqual(client.get("/api/hausdepp/account").status_code, 401)
        redirected = client.get(f"{SITE_ORIGIN}/auth/continue?app=hausdepp&path=%2Fhausdepp%2Fkonto", follow_redirects=False)
        self.assertTrue(redirected.headers["location"].startswith(f"{SITE_ORIGIN}/zilch/anmelden?"))
        self.assertEqual(client.get("/hausdepp/regeln").status_code, 200)
