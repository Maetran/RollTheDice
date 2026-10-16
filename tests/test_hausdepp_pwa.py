"""Public installation with an isolated, network-only worker."""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.ownership import bind_founder, grant_ownership
from tests.test_user_accounts import request_for


class _AppleIconHead(HTMLParser):
    def __init__(self, html):
        super().__init__()
        self.icons = []
        self.preloads = []
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "link" and attributes.get("rel") == "apple-touch-icon":
            self.icons.append(attributes)
        if tag == "link" and attributes.get("rel") == "preload" and attributes.get("as") == "image":
            self.preloads.append(attributes)


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

    async def test_public_installation_resources_work_on_each_supported_host(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for host in ("http://localhost", "https://zockdiewandan.online", "https://zilch.zockdiewandan.online", "https://hausdepp.zockdiewandan.online"):
                for path in ("/hausdepp-manifest.webmanifest", "/hausdepp-manifest-en.webmanifest", "/hausdepp-sw.js"):
                    for label, status in ((None, 200), ("owner", 200), ("admin", 200), ("player", 200), ("founder", 200)):
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

    async def test_dedicated_host_bridge_keeps_noindex_and_hausdepp_manifest(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for path in ("/zdwa", "/zdwa/regeln", "/zdwa/konto"):
                for label, expected in ((None, 200), ("admin", 200), ("founder", 200)):
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
            self.assertIn('/static/icons/hausdepp-apple-touch-icon-180-v2.png?', html)
            self.assertIn('name="apple-mobile-web-app-title" content="Hausdepp"', html)
            self.assertEqual('name="robots" content="noindex' in html, filename not in {"hausdepp-lobby.html", "hausdepp-rules.html"})

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

    async def test_apple_discovery_aliases_are_public_host_specific_png_for_get_and_head(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for host, filename in (
                ("https://hausdepp.zockdiewandan.online", "hausdepp-apple-touch-icon-180-v2.png"),
                ("https://zilch.zockdiewandan.online", "zilch-apple-touch-icon-180.png"),
                ("https://zockdiewandan.online", "apple-touch-icon-180.png"),
                ("http://localhost", "apple-touch-icon-180.png"),
            ):
                expected = (main.STATIC_DIR / "icons" / filename).read_bytes()
                for path in ("/apple-touch-icon.png", "/apple-touch-icon-precomposed.png"):
                    for method in ("GET", "HEAD"):
                        for token in (None, self.tokens["player"]):
                            with self.subTest(host=host, path=path, method=method, authenticated=bool(token)):
                                headers = {"Cookie": f"rollthedice_session={token}"} if token else {}
                                response = await client.request(method, host + path, headers=headers)
                                self.assertEqual(response.status_code, 200)
                                self.assertEqual(response.headers["content-type"], "image/png")
                                self.assertEqual(response.headers["cache-control"], "no-cache, must-revalidate")
                                self.assertEqual(int(response.headers["content-length"]), len(expected))
                                self.assertNotIn("location", response.headers)
                                self.assertNotIn("set-cookie", response.headers)
                                self.assertEqual(response.content, expected if method == "GET" else b"")
                    # A caller cannot turn an unversioned public alias into an
                    # immutable response by supplying the current bundle token.
                    response = await client.get(host + path + f"?v={main.STATIC_ASSET_VERSION}")
                    self.assertEqual(response.headers["cache-control"], "no-cache, must-revalidate")
                with Image.open(io.BytesIO(expected)) as icon:
                    self.assertEqual(icon.format, "PNG")
                    self.assertEqual(icon.size, (180, 180))
                    if "hausdepp" in filename:
                        self.assertEqual(icon.mode, "RGB")
            for path in ("/hausdepp/konto/einstellungen", "/api/auth/me", "/hausdepp/anmelden"):
                response = await client.get("https://hausdepp.zockdiewandan.online" + path)
                self.assertEqual(response.headers["cache-control"], "no-store")

    def test_house_heads_declare_one_precise_preloaded_apple_icon(self):
        for path in main.STATIC_DIR.glob("hausdepp*.html"):
            with self.subTest(path=path.name):
                head = _AppleIconHead(path.read_text())
                self.assertEqual(len(head.icons), 1)
                icon = head.icons[0]
                self.assertEqual(icon["sizes"], "180x180")
                self.assertEqual(icon["type"], "image/png")
                self.assertTrue(icon["href"].startswith("/static/icons/hausdepp-apple-touch-icon-180-v2.png?"))
                matching = [item for item in head.preloads if item.get("href") == icon["href"]]
                self.assertEqual(len(matching), 1)
                self.assertEqual(matching[0]["type"], "image/png")

    async def test_house_bridge_apple_link_keeps_installed_house_identity(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for path in ("/zdwa", "/zdwa/konto", "/zdwa/regeln"):
                response = await client.get("https://hausdepp.zockdiewandan.online" + path)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["cache-control"], "no-store")
                head = _AppleIconHead(response.text)
                self.assertEqual(len(head.icons), 1)
                icon = head.icons[0]
                self.assertEqual(icon["sizes"], "180x180")
                self.assertEqual(icon["type"], "image/png")
                self.assertTrue(icon["href"].startswith("/static/icons/hausdepp-apple-touch-icon-180-v2.png?"))
                self.assertEqual([item["href"] for item in head.preloads if item.get("href") == icon["href"]], [icon["href"]])

    def test_worker_has_no_offline_cache_or_private_data_storage(self):
        worker = (main.STATIC_DIR / "hausdepp-sw.js").read_text()
        self.assertNotIn("caches.", worker)
        self.assertNotIn("cache.put", worker)
        self.assertNotIn("indexedDB", worker)
        self.assertIn("fetch(request).catch(connectionNeeded)", worker)
        self.assertIn("Deine Karten und Kontodaten werden nicht offline gespeichert", worker)
        self.assertIn("Your cards and account data are never stored for offline use", worker)
