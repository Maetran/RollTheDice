import json
import unittest
from html.parser import HTMLParser
from unittest.mock import patch

import httpx

from app import main
from app.achievements import ACHIEVEMENT_POINTS_POSSIBLE, ACHIEVEMENT_RANKS, achievement_rank_for_points
from app.site_seo import PUBLIC_SEO_PAGES, SITE_ORIGIN
from scripts.sync_static_versions import content_version, desired_text


class _SeoParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.h1_count = 0
        self.description = None
        self.robots = None
        self.canonical = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "h1":
            self.h1_count += 1
        elif tag == "meta" and attributes.get("name") == "description":
            self.description = attributes.get("content")
        elif tag == "meta" and attributes.get("name") == "robots":
            self.robots = attributes.get("content")
        elif tag == "link" and attributes.get("rel") == "canonical":
            self.canonical = attributes.get("href")


class HttpShellTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_shell_and_service_worker_are_revalidated(self):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            root = await client.get("/")
            service_worker = await client.get("/sw.js")

        self.assertIn("no-cache", root.headers.get("cache-control", ""))
        self.assertIn("no-store", service_worker.headers.get("cache-control", ""))

    def test_health_requires_completed_database_startup(self):
        with patch("app.main.database_schema_ready", return_value=True):
            self.assertEqual(main.health(), {"status": "ok", "database": "ready"})

    def test_raster_icons_are_used_consistently(self):
        version = content_version()
        favicon = main.favicon()
        self.assertTrue(str(favicon.path).endswith("/static/favicon.png"))
        self.assertEqual(favicon.headers.get("content-type"), "image/png")

        manifest = json.loads((main.BASE / "manifest.webmanifest").read_text())
        self.assertEqual(
            [icon["src"] for icon in manifest["icons"]],
            [
                f"/static/icons/icon-192.png?v={version}",
                f"/static/icons/icon-512.png?v={version}",
            ],
        )
        for html_path in main.STATIC_DIR.glob("*.html"):
            html = html_path.read_text()
            self.assertIn(f"/static/favicon.png?v={version}", html, html_path.name)
            self.assertIn(f"/static/icons/apple-touch-icon-180.png?v={version}", html, html_path.name)

    def test_static_asset_versions_match_the_content_hash(self):
        version = content_version()
        for path in [*main.STATIC_DIR.rglob("*.html"), *main.STATIC_DIR.rglob("*.js")]:
            self.assertEqual(path.read_text(), desired_text(path, version), path.name)

    def test_shared_head_scripts_do_not_block_rendering(self):
        for html_path in main.STATIC_DIR.glob("*.html"):
            html = html_path.read_text(encoding="utf-8")
            self.assertEqual(html.count('<script src="/static/shell.js?v='), 1, html_path.name)
            start = html.index('<script src="/static/shell.js?v=')
            end = html.index(">", start)
            self.assertIn("defer", html[start:end], f"{html_path.name}: shell.js")
            for legacy_asset in ("i18n.js", "ui.js", "pwa.js", "theme.js"):
                self.assertNotIn(f"/static/{legacy_asset}", html, html_path.name)
            if html_path.name != "offline.html":
                self.assertIn("document.documentElement.dataset.theme", html, html_path.name)

    def test_lobby_uses_its_small_page_specific_stylesheet(self):
        version = content_version()
        lobby = (main.STATIC_DIR / "index.html").read_text(encoding="utf-8")
        self.assertIn(f"/static/lobby.css?v={version}", lobby)
        self.assertNotIn("/static/style.css", lobby)

    def test_every_page_has_one_h1_and_a_meta_description(self):
        for html_path in main.STATIC_DIR.glob("*.html"):
            parser = _SeoParser()
            parser.feed(html_path.read_text(encoding="utf-8"))
            self.assertEqual(parser.h1_count, 1, html_path.name)
            self.assertTrue(parser.description, html_path.name)

    def test_search_indexing_is_limited_to_stable_public_pages(self):
        expected_canonicals = {page.static_filename: page.canonical_url for page in PUBLIC_SEO_PAGES}
        for html_path in main.STATIC_DIR.glob("*.html"):
            parser = _SeoParser()
            parser.feed(html_path.read_text(encoding="utf-8"))
            if html_path.name in expected_canonicals:
                self.assertEqual(parser.canonical, expected_canonicals[html_path.name])
                self.assertIsNone(parser.robots, html_path.name)
            else:
                self.assertIn("noindex", parser.robots or "", html_path.name)

    async def test_robots_and_sitemap_expose_only_public_canonical_pages(self):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            robots = await client.get("/robots.txt")
            sitemap = await client.get("/sitemap.xml")

        self.assertEqual(robots.status_code, 200)
        self.assertIn(f"Sitemap: {SITE_ORIGIN}/sitemap.xml", robots.text)
        self.assertIn("Disallow: /api/", robots.text)
        self.assertEqual(sitemap.status_code, 200)
        self.assertEqual(sitemap.headers["content-type"], "application/xml")
        for page in PUBLIC_SEO_PAGES:
            self.assertIn(f"<loc>{page.canonical_url}</loc>", sitemap.text)
        self.assertNotIn("/konto", sitemap.text)
        self.assertNotIn("/spiel/", sitemap.text)

    async def test_achievement_rank_legend_is_public_and_uses_live_catalog_thresholds(self):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/api/achievement-ranks")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["points_possible"], ACHIEVEMENT_POINTS_POSSIBLE)
        self.assertNotIn("current", payload)
        self.assertEqual([rank["key"] for rank in payload["ranks"]], [rank.key for rank in ACHIEVEMENT_RANKS])
        self.assertEqual(payload["ranks"][0]["minimum_points"], 0)
        self.assertEqual(
            payload["ranks"][-1]["minimum_points"],
            achievement_rank_for_points(ACHIEVEMENT_POINTS_POSSIBLE)["minimum_points"],
        )

    async def test_versioned_assets_are_immutable_but_html_is_revalidated(self):
        version = content_version()
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            asset = await client.get(f"/static/style.css?v={version}")
            stale_asset = await client.get("/static/style.css?v=stale")
            missing_asset = await client.get(f"/static/not-present.js?v={version}")
            missing_page = await client.get("/not-present")
            robots = await client.get("/robots.txt")
            shell = await client.get("/spiel/test-game")
            games = await client.get("/api/games")
        self.assertEqual(asset.status_code, 200)
        self.assertIn("immutable", asset.headers.get("cache-control", ""))
        self.assertIn("no-cache", stale_asset.headers.get("cache-control", ""))
        self.assertEqual(missing_asset.status_code, 404)
        self.assertIn("no-store", missing_asset.headers.get("cache-control", ""))
        self.assertEqual(missing_page.status_code, 404)
        self.assertIn("no-store", missing_page.headers.get("cache-control", ""))
        self.assertIn("no-cache", robots.headers.get("cache-control", ""))
        self.assertIn("no-cache", shell.headers.get("cache-control", ""))
        self.assertIn("no-store", games.headers.get("cache-control", ""))

    async def test_clean_page_routes_and_legacy_redirects(self):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            for path in (
                "/regeln",
                "/spieler",
                "/spieler/Test",
                "/rangabzeichen",
                "/konto",
                "/admin",
                "/spiel/abc123",
                "/spiel/abc123/zuschauen",
                "/ergebnis/abc123",
                "/offline",
            ):
                response = await client.get(path)
                self.assertEqual(response.status_code, 200, path)

            room = await client.get("/static/room.html?game_id=abc123&name=Gast&spectator=1")
            profile = await client.get("/static/profile.html?user=Test")
            result = await client.get("/static/game_view.html?id=abc123")
            account = await client.get("/static/account.html")
            ranks = await client.get("/static/ranks.html")

        self.assertEqual(room.status_code, 308)
        self.assertEqual(room.headers["location"], "/spiel/abc123/zuschauen?name=Gast")
        self.assertEqual(profile.headers["location"], "/spieler/Test")
        self.assertEqual(result.headers["location"], "/ergebnis/abc123")
        self.assertEqual(account.headers["location"], "/konto")
        self.assertEqual(ranks.headers["location"], "/rangabzeichen")

    def test_pwa_update_and_offline_assets_are_precached(self):
        service_worker = (main.STATIC_DIR / "sw.js").read_text()
        self.assertIn("'/static/shell.js'", service_worker)
        self.assertIn("'/static/lobby.js'", service_worker)
        self.assertIn("'/rangabzeichen'", service_worker)
        self.assertNotIn("'/static/room-scoring.js'", service_worker)
        self.assertNotIn("'/static/chat.js'", service_worker)
        self.assertNotIn("'/static/pwa.js'", service_worker)
        self.assertIn("'/offline'", service_worker)
        self.assertIn("SKIP_WAITING", service_worker)
        self.assertIn("await cache.put(req, res.clone())", service_worker)
        self.assertIn("await runtime.put(req, res.clone())", service_worker)
        self.assertIn("await self.clients.claim()", service_worker)
        install_handler = service_worker.split("self.addEventListener('message'", 1)[0]
        self.assertNotIn("self.skipWaiting()", install_handler)

    async def test_lobby_create_payload_creates_game(self):
        request = main.CreateReq.model_validate(
            {
                "name": "HTTP shell test",
                "mode": "1",
                "pass": "",
                "hardcore": False,
            }
        )

        with patch("app.main.enforce_game_creation_rate_limit"):
            response = await main.api_games_create(request, object())
        game_id = response["game_id"]
        try:
            self.assertIn(game_id, main.games)
            self.assertEqual(main.games[game_id]["_mode"], "1")
        finally:
            main.games.pop(game_id, None)
