"""Founder-bound installation with an isolated, network-only worker."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.ownership import bind_founder, grant_ownership
from tests.test_user_accounts import request_for


class HausdeppPwaTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/pwa.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        founder = create_user("PwaFounder", "test-password-123", role="admin", must_change_password=False)
        owner = create_user("PwaOwner", "test-password-123", role="admin", must_change_password=False)
        admin = create_user("PwaAdmin", "test-password-123", role="admin", must_change_password=False)
        player = create_user("PwaPlayer", "test-password-123", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, founder.id)
            grant_ownership(db, owner.id, founder.id)
        self.tokens = {
            label: login(request_for(), user.username, "test-password-123")[1]
            for label, user in (("founder", founder), ("owner", owner), ("admin", admin), ("player", player))
        }

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    async def test_only_founder_can_fetch_installation_resources_on_each_supported_host(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for host in ("http://localhost", "https://zockdiewandan.online", "https://zilch.zockdiewandan.online", "https://hausdepp.zockdiewandan.online"):
                for path in ("/hausdepp-manifest.webmanifest", "/hausdepp-manifest-en.webmanifest", "/hausdepp-sw.js"):
                    for label, status in ((None, 401), ("owner", 403), ("admin", 403), ("player", 403), ("founder", 200)):
                        with self.subTest(host=host, path=path, identity=label):
                            headers = {"Cookie": f"rollthedice_session={self.tokens[label]}"} if label else {}
                            response = await client.get(host + path, headers=headers)
                            self.assertEqual(response.status_code, status)
                            self.assertIn("no-store", response.headers["cache-control"])
                            self.assertIn("noindex", response.headers["x-robots-tag"])
                            if status == 200 and path.endswith(".js"):
                                self.assertEqual(response.headers["service-worker-allowed"], "/hausdepp")

    async def test_manifest_identity_preserves_suite_navigation_without_a_root_worker(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://localhost",
                                     headers={"Cookie": f"rollthedice_session={self.tokens['founder']}"}) as client:
            for language, suffix in (("de", ""), ("en", "-en")):
                manifest = (await client.get(f"/hausdepp-manifest{suffix}.webmanifest")).json()
                self.assertEqual(manifest["id"], "/hausdepp")
                self.assertEqual(manifest["start_url"], "/hausdepp?pwa=hausdepp")
                self.assertEqual(manifest["scope"], "/")
                self.assertEqual(manifest["display"], "standalone")
                self.assertEqual(manifest["lang"], language)
                self.assertEqual(manifest["theme_color"], "#173e34")
                self.assertEqual([item["url"] for item in manifest["shortcuts"]],
                                 ["/hausdepp", "/hausdepp/konto", "/hausdepp/regeln", "/hausdepp/rangliste"])
                self.assertEqual({icon["sizes"] for icon in manifest["icons"]}, {"192x192", "512x512"})
                for icon in manifest["icons"]:
                    self.assertIn("/static/icons/hausdepp-icon-", icon["src"])

    async def test_future_dedicated_host_bridge_keeps_founder_guard_and_housedepp_manifest(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for path in ("/zdwa", "/zdwa/regeln", "/zdwa/konto"):
                for label, expected in ((None, 401), ("admin", 403), ("founder", 200)):
                    headers = {"Cookie": f"rollthedice_session={self.tokens[label]}"} if label else {}
                    response = await client.get(f"https://hausdepp.zockdiewandan.online{path}", headers=headers)
                    self.assertEqual(response.status_code, expected)
                    self.assertIn("no-store", response.headers["cache-control"])
                    if expected == 200:
                        self.assertIn('data-zdwa-pwa-bridge="true"', response.text)
                        self.assertIn('data-pwa-product="hausdepp"', response.text)
                        self.assertIn('/hausdepp-manifest.webmanifest', response.text)
                        self.assertIn('crossorigin="use-credentials"', response.text)
            apex = await client.get("https://zockdiewandan.online/zdwa")
            self.assertEqual(apex.status_code, 404)

    def test_all_private_html_heads_use_hausdepp_installation_assets(self):
        for filename in ("hausdepp.html", "hausdepp-lobby.html", "hausdepp-account.html", "hausdepp-rules.html", "hausdepp-leaderboard.html"):
            html = (main.STATIC_DIR / filename).read_text()
            self.assertIn('data-pwa-product="hausdepp"', html)
            self.assertIn('crossorigin="use-credentials"', html)
            self.assertIn('name="theme-color" content="#173e34"', html)
            self.assertIn('/static/icons/hausdepp-icon-32.png?', html)
            self.assertIn('/static/icons/hausdepp-apple-touch-icon-180.png?', html)
            self.assertIn('name="apple-mobile-web-app-title" content="Hausdepp"', html)
            self.assertIn('name="robots" content="noindex', html)

    async def test_dedicated_host_favicon_uses_the_heart_ten_without_changing_suite_icons(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for host, filename in (
                ("https://hausdepp.zockdiewandan.online", "icons/hausdepp-icon-32.png"),
                ("https://zilch.zockdiewandan.online", "icons/zilch-icon-32.png"),
                ("https://zockdiewandan.online", "favicon.png"),
            ):
                response = await client.get(host + "/favicon.ico")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, (main.STATIC_DIR / filename).read_bytes())

    def test_worker_has_no_offline_cache_or_private_data_storage(self):
        worker = (main.STATIC_DIR / "hausdepp-sw.js").read_text()
        self.assertNotIn("caches.", worker)
        self.assertNotIn("cache.put", worker)
        self.assertNotIn("indexedDB", worker)
        self.assertIn("fetch(request).catch(connectionNeeded)", worker)
        self.assertIn("Deine Karten und Kontodaten werden nicht offline gespeichert", worker)
        self.assertIn("Your cards and account data are never stored for offline use", worker)
