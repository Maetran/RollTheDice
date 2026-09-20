"""Dead Zilch document links recover without changing API or privacy contracts."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import httpx

from app import main


class ZilchUnavailablePageTestCase(TestCase):
    def setUp(self) -> None:
        self.identity = SimpleNamespace(user_id=81)
        for patcher in (
            patch.object(main, "resolve_session", return_value=self.identity),
            patch.object(main, "can_access_zilch_preview", return_value=True),
            patch.object(main, "load_zilch_result_for_user", return_value=None),
            patch.dict(main.games, {}, clear=True),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    @staticmethod
    def get(path: str, *, host: str = "zockdiewandan.online", accept: str = "text/html") -> httpx.Response:
        async def request() -> httpx.Response:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app), base_url=f"https://{host}",
            ) as client:
                return await client.get(path, headers={"Accept": accept})
        return asyncio.run(request())

    def test_html_links_have_recovery_and_keep_the_404_status(self) -> None:
        for host, prefix in (
            ("zockdiewandan.online", "/zilch"),
            ("zilch.zockdiewandan.online", ""),
        ):
            for destination in ("spiel/missing", "spiel/missing/zuschauen", "ergebnis/missing"):
                with self.subTest(host=host, destination=destination):
                    response = self.get(f"{prefix}/{destination}", host=host)
                    self.assertEqual(response.status_code, 404)
                    self.assertIn("text/html", response.headers["content-type"])
                    self.assertEqual(response.headers["cache-control"], "no-store")
                    self.assertIn("noindex", response.headers["x-robots-tag"])
                    self.assertIn(f'href="{prefix or "/"}">Zur Zilch-Lobby</a>', response.text)
                    self.assertIn(f'href="{prefix}/historie">Deine Historie</a>', response.text)
                    self.assertNotIn("missing", response.text)

    def test_json_and_default_fetch_contracts_remain_unchanged(self) -> None:
        for accept in ("application/json", "*/*", ""):
            for route, detail in (("spiel", "game_not_found"), ("ergebnis", "result_not_found")):
                with self.subTest(accept=accept, route=route):
                    response = self.get(f"/zilch/{route}/missing", accept=accept)
                    self.assertEqual(response.status_code, 404)
                    self.assertEqual(response.json(), {"detail": detail})

    def test_missing_wrong_product_and_forbidden_rooms_are_indistinguishable(self) -> None:
        main.games["wrong-product"] = {"_game_type": "zdwa"}
        main.games["private-room"] = {"_game_type": "zilch"}
        with patch.object(main, "can_access_game", return_value=False):
            responses = [self.get(f"/zilch/spiel/{game_id}") for game_id in (
                "missing", "wrong-product", "private-room",
            )]
        self.assertEqual([response.status_code for response in responses], [404, 404, 404])
        self.assertEqual(len({response.text for response in responses}), 1)

    def test_guest_room_failure_offers_login_without_exposing_private_history(self) -> None:
        with patch.object(main, "resolve_session", return_value=None):
            response = self.get("/spiel/missing", host="zilch.zockdiewandan.online")
            private_result = self.get("/ergebnis/missing", host="zilch.zockdiewandan.online")
            private_json = self.get("/ergebnis/missing", host="zilch.zockdiewandan.online", accept="application/json")
        self.assertEqual(response.status_code, 404)
        self.assertIn('href="/anmelden">Anmelden</a>', response.text)
        self.assertNotIn('href="/historie"', response.text)
        self.assertEqual(private_result.status_code, 303)
        self.assertEqual(private_result.headers["location"], "/anmelden?return_to=%2Fergebnis%2Fmissing")
        self.assertEqual(private_json.status_code, 401)
        self.assertEqual(private_json.json(), {"detail": "authentication_required"})

    def test_private_bookmarks_preserve_the_destination_through_login(self) -> None:
        with patch.object(main, "resolve_session", return_value=None):
            for host, prefix in (
                ("zockdiewandan.online", "/zilch"),
                ("zilch.zockdiewandan.online", ""),
            ):
                for destination in ("konto?push=1", "historie", "statistiken", "erfolge", "ergebnis/missing"):
                    path = f"{prefix}/{destination}"
                    with self.subTest(host=host, destination=destination):
                        response = self.get(path, host=host)
                        self.assertEqual(response.status_code, 303)
                        target = urlsplit(response.headers["location"])
                        self.assertEqual(target.path, f"{prefix}/anmelden")
                        self.assertEqual(parse_qs(target.query), {"return_to": [path]})
                        self.assertEqual(response.headers["cache-control"], "no-store")
                        denied = self.get(path, host=host, accept="application/json")
                        self.assertEqual(denied.status_code, 401)
                        self.assertEqual(denied.json(), {"detail": "authentication_required"})

    def test_signed_in_accounts_without_access_keep_the_forbidden_contract(self) -> None:
        with patch.object(main, "can_access_zilch_preview", return_value=False):
            for path in ("/zilch/konto", "/zilch/historie", "/zilch/statistiken", "/zilch/erfolge", "/zilch/ergebnis/missing"):
                response = self.get(path)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json(), {"detail": "zilch_preview_required"})

    def test_retired_participants_still_reach_their_saved_result(self) -> None:
        with patch.object(main, "load_zilch_result_for_user", return_value={"game_id": "saved"}):
            response = self.get("/spiel/saved", host="zilch.zockdiewandan.online")
        self.assertEqual(response.status_code, 307)
        self.assertEqual(response.headers["location"], "/ergebnis/saved")
