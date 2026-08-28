import json
import unittest
from unittest.mock import patch

import httpx

from app import main
from scripts.sync_static_versions import content_version, desired_text


class HttpShellTestCase(unittest.IsolatedAsyncioTestCase):
    def test_shell_and_service_worker_are_revalidated(self):
        self.assertIn("no-cache", main.root().headers.get("cache-control", ""))
        self.assertIn("no-store", main.service_worker().headers.get("cache-control", ""))

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

    async def test_versioned_assets_are_immutable_but_html_is_revalidated(self):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            asset = await client.get("/static/style.css?v=93")
            shell = await client.get("/spiel/test-game")
        self.assertEqual(asset.status_code, 200)
        self.assertIn("immutable", asset.headers.get("cache-control", ""))
        self.assertIn("no-cache", shell.headers.get("cache-control", ""))

    async def test_clean_page_routes_and_legacy_redirects(self):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            for path in (
                "/regeln", "/spieler", "/spieler/Test", "/konto", "/admin",
                "/spiel/abc123", "/spiel/abc123/zuschauen", "/ergebnis/abc123", "/offline",
            ):
                response = await client.get(path)
                self.assertEqual(response.status_code, 200, path)

            room = await client.get("/static/room.html?game_id=abc123&name=Gast&spectator=1")
            profile = await client.get("/static/profile.html?user=Test")
            result = await client.get("/static/game_view.html?id=abc123")
            account = await client.get("/static/account.html")

        self.assertEqual(room.status_code, 308)
        self.assertEqual(room.headers["location"], "/spiel/abc123/zuschauen?name=Gast")
        self.assertEqual(profile.headers["location"], "/spieler/Test")
        self.assertEqual(result.headers["location"], "/ergebnis/abc123")
        self.assertEqual(account.headers["location"], "/konto")

    def test_pwa_update_and_offline_assets_are_precached(self):
        service_worker = (main.STATIC_DIR / "sw.js").read_text()
        self.assertIn("'/static/ui.js'", service_worker)
        self.assertIn("'/static/pwa.js'", service_worker)
        self.assertIn("'/offline'", service_worker)
        self.assertIn("SKIP_WAITING", service_worker)
        install_handler = service_worker.split("self.addEventListener('message'", 1)[0]
        self.assertNotIn("self.skipWaiting()", install_handler)

    async def test_lobby_create_payload_creates_game(self):
        request = main.CreateReq.model_validate({
            "name": "HTTP shell test",
            "mode": "1",
            "owner": "Tester",
            "pass": "",
            "hardcore": False,
        })

        response = await main.api_games_create(request)
        game_id = response["game_id"]
        try:
            self.assertIn(game_id, main.games)
            self.assertEqual(main.games[game_id]["_mode"], "1")
        finally:
            main.games.pop(game_id, None)
