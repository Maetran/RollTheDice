import unittest

from app import main


class HttpShellTestCase(unittest.IsolatedAsyncioTestCase):
    def test_shell_and_service_worker_are_revalidated(self):
        self.assertIn("no-cache", main.root().headers.get("cache-control", ""))
        self.assertIn("no-store", main.service_worker().headers.get("cache-control", ""))

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
