"""HTTP contracts for the private, typed Zilch statistics service."""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from starlette.requests import Request

from app import main
from app.auth import create_user, login
from app.database import configure_database, upgrade_database


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


class ZilchStatisticsApiTestCase(TestCase):
    """Preview policy, session ownership and bounded leaderboard inputs."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-statistics-api.sqlite3"
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

    def test_statistics_and_leaderboards_require_the_same_preview_policy_and_are_no_store(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")
        _normal_id, normal_token = self._identity("Normal")
        endpoints = (
            "/api/zilch/statistics",
            "/api/zilch/leaderboards/categories",
            "/api/zilch/leaderboards?category=solo_sprint",
        )

        for path in endpoints:
            with self.subTest(path=path, identity="anonymous"):
                self.assertEqual(self._get(path).status_code, 401)
            with self.subTest(path=path, identity="normal"):
                self.assertEqual(self._get(path, normal_token).status_code, 403)

        for path in endpoints:
            with self.subTest(path=path, identity="mani"):
                response = self._get(path, mani_token)
                self.assertEqual(response.status_code, 200)
                self.assertIn("no-store", response.headers.get("cache-control", ""))

    def test_statistics_uses_the_authenticated_user_not_a_query_parameter(self) -> None:
        mani_id, mani_token = self._identity("Mani", role="admin")
        fake_statistics = {"version": 1, "overview": {"completed_records": 0}}

        with patch("app.main.get_zilch_personal_statistics", return_value=fake_statistics) as statistics:
            response = self._get("/api/zilch/statistics?user_id=999999", mani_token)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), fake_statistics)
        statistics.assert_called_once_with(mani_id)

    def test_leaderboard_uses_the_preview_identity_for_own_entry_and_bounds_limit(self) -> None:
        mani_id, mani_token = self._identity("Mani", role="admin")
        fake_leaderboard = {
            "version": 1,
            "category": "cpu_wins",
            "strategy": "aggressive",
            "ranking": "competition",
            "entries": [],
            "total": 0,
            "offset": 7,
            "limit": 100,
            "own_entry": None,
        }
        with patch("app.main.get_zilch_leaderboard", return_value=fake_leaderboard) as leaderboard:
            response = self._get(
                "/api/zilch/leaderboards?category=cpu_wins&strategy=aggressive&offset=7&limit=999&user_id=42",
                mani_token,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), fake_leaderboard)
        leaderboard.assert_called_once_with(
            "cpu_wins",
            strategy="aggressive",
            offset=7,
            limit=999,
            current_user_id=mani_id,
        )

    def test_invalid_leaderboard_category_and_strategy_are_rejected_without_data(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")
        invalid_category = self._get("/api/zilch/leaderboards?category=zdwa", mani_token)
        missing_cpu_strategy = self._get("/api/zilch/leaderboards?category=cpu_wins", mani_token)
        invalid_cpu_strategy = self._get(
            "/api/zilch/leaderboards?category=cpu_wins&strategy=unfair",
            mani_token,
        )
        bounded_limit = self._get("/api/zilch/leaderboards?category=solo_sprint&limit=1000", mani_token)

        self.assertEqual(invalid_category.status_code, 400)
        self.assertEqual(invalid_category.json()["detail"], "zilch_statistics_invalid_leaderboard_category")
        self.assertEqual(missing_cpu_strategy.status_code, 400)
        self.assertEqual(missing_cpu_strategy.json()["detail"], "zilch_statistics_invalid_cpu_strategy")
        self.assertEqual(invalid_cpu_strategy.status_code, 400)
        self.assertEqual(invalid_cpu_strategy.json()["detail"], "zilch_statistics_invalid_cpu_strategy")
        self.assertEqual(bounded_limit.status_code, 200)
        self.assertEqual(bounded_limit.json()["limit"], 100)

    def test_explicit_preview_allowlist_can_read_private_statistics_without_admin_role(self) -> None:
        _preview_id, preview_token = self._identity("PreviewFriend")
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend"}):
            statistics = self._get("/api/zilch/statistics", preview_token)
            leaderboards = self._get("/api/zilch/leaderboards?category=multiplayer_wins", preview_token)

        self.assertEqual(statistics.status_code, 200)
        self.assertEqual(leaderboards.status_code, 200)
        self.assertEqual(statistics.json()["version"], 1)
        self.assertEqual(leaderboards.json()["ranking"], "competition")

    def test_direct_function_still_fails_closed_without_a_preview_identity(self) -> None:
        with self.assertRaises(HTTPException) as denied:
            main.api_zilch_statistics(request_for())
        self.assertEqual(denied.exception.status_code, 401)
