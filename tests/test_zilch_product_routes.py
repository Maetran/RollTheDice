"""HTTP contracts for the private Zilch product routes.

These checks keep the browser shell routes behind the same central preview
policy as gameplay and ensure that the UI reads numeric rule facts from the
server instead of carrying an independent rules copy.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import httpx
from starlette.requests import Request

from app import main
from app.auth import create_user, login
from app.database import configure_database, upgrade_database
from app.game_state import games
from app.zilch_engine import (
    ZILCH_BANK_MINIMUM,
    ZILCH_CONFIRMATION_MINIMUM,
    ZILCH_DICE_COUNT,
    ZILCH_RULESET_VERSION,
    ZILCH_TARGET_SCORE,
    ZILCH_THIRD_ROLL_MINIMUM,
    ZILCH_ZILCH_STREAK_PENALTY,
)
from app.zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    validate_zilch_solo_objective_definition,
)
from app.zilch_state import (
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)


def request_for(*, cookie: str = "") -> Request:
    headers = [(b"host", b"testserver")]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


class ZilchProductRoutesTestCase(TestCase):
    """Private route, rules-projection and lobby-summary boundaries."""

    def setUp(self) -> None:
        self.game_ids: list[str] = []
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-product-routes.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        for game_id in self.game_ids:
            games.pop(game_id, None)
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _get(path: str, token: str | None = None) -> httpx.Response:
        async def request() -> httpx.Response:
            transport = httpx.ASGITransport(app=main.app)
            cookies = {"rollthedice_session": token} if token else None
            async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
                return await client.get(path, cookies=cookies)

        return asyncio.run(request())

    @staticmethod
    def _identity(username: str, *, role: str = "user") -> tuple[int, str]:
        password = f"{username}-secure-password-123"
        user = create_user(username, password, role=role, must_change_password=False)
        _identity, token = login(request_for(), username, password)
        return user.id, token

    def test_history_rules_shells_and_rules_api_use_the_central_preview_policy(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")
        _normal_id, normal_token = self._identity("Normal")

        for path in (
            "/zilch/historie",
            "/zilch/statistiken",
            "/zilch/bestenlisten",
            "/zilch/regeln",
            "/api/zilch/rules",
        ):
            with self.subTest(path=path, identity="anonymous"):
                self.assertEqual(self._get(path).status_code, 401)
            with self.subTest(path=path, identity="normal"):
                self.assertEqual(self._get(path, normal_token).status_code, 403)

        for path in ("/zilch/historie", "/zilch/statistiken", "/zilch/bestenlisten", "/zilch/regeln"):
            with self.subTest(path=path):
                response = self._get(path, mani_token)
                self.assertEqual(response.status_code, 200)
                self.assertIn('name="robots" content="noindex, nofollow"', response.text)
                self.assertIn("no-cache", response.headers.get("cache-control", ""))

        rules = self._get("/api/zilch/rules", mani_token)
        self.assertEqual(rules.status_code, 200)
        self.assertEqual(
            rules.json(),
            {
                "ruleset": ZILCH_RULESET_VERSION,
                "dice_count": ZILCH_DICE_COUNT,
                "target_score": ZILCH_TARGET_SCORE,
                "bank_minimum": ZILCH_BANK_MINIMUM,
                "third_roll_minimum": ZILCH_THIRD_ROLL_MINIMUM,
                "confirmation_minimum": ZILCH_CONFIRMATION_MINIMUM,
                "third_zilch_penalty": ZILCH_ZILCH_STREAK_PENALTY,
                "solo_objective": validate_zilch_solo_objective_definition(
                    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
                    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
                ).payload(),
                "scoring": {
                    "single_one": 100,
                    "single_five": 50,
                    "three_ones": 1_000,
                    "straight": 2_000,
                    "three_pairs": 500,
                    "nothing_bonus": 500,
                },
            },
        )
        self.assertEqual(self._get("/static/zilch.html", mani_token).status_code, 404)

    def test_explicit_allowlist_uses_the_same_private_rules_route_policy(self) -> None:
        _preview_id, preview_token = self._identity("PreviewFriend")

        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend"}):
            self.assertEqual(self._get("/zilch/historie", preview_token).status_code, 200)
            self.assertEqual(self._get("/zilch/statistiken", preview_token).status_code, 200)
            self.assertEqual(self._get("/zilch/bestenlisten", preview_token).status_code, 200)
            self.assertEqual(self._get("/zilch/regeln", preview_token).status_code, 200)
            self.assertEqual(self._get("/api/zilch/rules", preview_token).status_code, 200)

    def test_private_zilch_routes_are_not_globally_precached_by_the_shared_pwa(self) -> None:
        service_worker = (main.STATIC_DIR / "sw.js").read_text(encoding="utf-8")
        self.assertNotIn("'/static/zilch.js'", service_worker)
        self.assertNotIn("'/static/zilch.css'", service_worker)
        self.assertIn("url.pathname === '/zilch' || url.pathname.startsWith('/zilch/')", service_worker)

        manifest = (main.BASE / "manifest.webmanifest").read_text(encoding="utf-8")
        self.assertIn('"short_name": "ZDWA"', manifest)
        self.assertNotIn('"url": "/zilch', manifest)

    def test_zilch_lobby_exposes_only_safe_turn_and_final_round_hints(self) -> None:
        mani_id, mani_token = self._identity("Mani", role="admin")
        preview_id, _preview_token = self._identity("PreviewFriend")
        game_id = "zilch-lobby-product-summary"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "Final stretch", 2)
        join_zilch_player(game, {"id": "p1", "name": "Mani", "user_id": mani_id, "ws": None})
        join_zilch_player(game, {"id": "p2", "name": "PreviewFriend", "user_id": preview_id, "ws": None})
        start_zilch_game(game)
        record_zilch_start_roll(game, "p1", 6)
        record_zilch_start_roll(game, "p2", 2)
        game["_zilch_final_round"] = {"triggered_by": "p1", "pending_player_ids": ["p2"]}

        response = self._get("/api/games?game_type=zilch", mani_token)
        self.assertEqual(response.status_code, 200)
        entry = next(item for item in response.json()["games"] if item["id"] == game_id)
        self.assertEqual(entry["current_player_id"], "p1")
        self.assertEqual(entry["current_player_name"], "Mani")
        self.assertEqual(entry["final_round"], {"triggered_by": "p1", "pending_player_ids": ["p2"]})
        self.assertNotIn("target_score", entry["final_round"])
