import json
import unittest

from app import main


class HttpShellTestCase(unittest.IsolatedAsyncioTestCase):
    def test_shell_and_service_worker_are_revalidated(self):
        self.assertIn("no-cache", main.root().headers.get("cache-control", ""))
        self.assertIn("no-store", main.service_worker().headers.get("cache-control", ""))

    def test_raster_icons_are_used_consistently(self):
        favicon = main.favicon()
        self.assertTrue(str(favicon.path).endswith("/static/favicon.png"))
        self.assertEqual(favicon.headers.get("content-type"), "image/png")

        manifest = json.loads((main.BASE / "manifest.webmanifest").read_text())
        self.assertEqual(
            [icon["src"] for icon in manifest["icons"]],
            ["/static/icons/icon-192.png?v=2", "/static/icons/icon-512.png?v=2"],
        )
        for html_path in main.STATIC_DIR.glob("*.html"):
            html = html_path.read_text()
            self.assertIn("/static/favicon.png?v=2", html, html_path.name)
            self.assertIn("/static/icons/apple-touch-icon-180.png?v=2", html, html_path.name)

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
