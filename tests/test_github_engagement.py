"""GitHub actions are earned in the signed-in app, never from deployment."""

import asyncio
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import httpx
from sqlalchemy import select

from app import main
from app.auth import LEGACY_SESSION_COOKIE, create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.models import UserAchievement, UserEngagementEvent, ZilchAchievementUnlock
from tests.test_user_accounts import request_for


class GithubEngagementTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.directory.name}/github.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "",
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
        })
        self.environment.start()
        configure_database(Path(self.directory.name))
        upgrade_database(main.BASE)
        self.user = create_user("GithubReader", "github-test-password-123", must_change_password=False)
        self.identity, self.token = login(request_for(), self.user.username, "github-test-password-123")

    def tearDown(self):
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.directory.cleanup()

    def request(self, method, path, *, authenticated=True, csrf=True):
        async def run():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="https://testserver") as client:
                if authenticated:
                    client.cookies.set(LEGACY_SESSION_COOKIE, self.token)
                headers = {"X-CSRF-Token": self.identity.csrf_token} if csrf else {}
                return await client.request(method, path, headers=headers, follow_redirects=False)
        return asyncio.run(run())

    def unlocked(self):
        with session_scope() as db:
            return (
                set(db.scalars(select(UserAchievement.achievement_key).where(UserAchievement.user_id == self.user.id))),
                set(db.scalars(select(ZilchAchievementUnlock.achievement_key).where(ZilchAchievementUnlock.user_id == self.user.id))),
            )

    def test_requires_a_new_authenticated_click_and_preserves_redirect_fallback(self):
        for path in ("/konto", "/zilch/konto", "/api/players/GithubReader", "/api/zilch/achievements"):
            self.assertEqual(self.request("GET", path).status_code, 200)
        zdwa, zilch = self.unlocked()
        self.assertNotIn("github_clicked", zdwa)
        self.assertNotIn("zilch.github_clicked", zilch)
        for path, authenticated, csrf, status in (
            ("issues", False, False, 401),
            ("issues", True, False, 403),
            ("arbitrary-award", True, True, 422),
        ):
            self.assertEqual(self.request("POST", f"/api/account/engagement/github/{path}", authenticated=authenticated, csrf=csrf).status_code, status)
        self.assertNotIn("github_clicked", self.unlocked()[0])

        clicked = self.request("POST", "/api/account/engagement/github/issues")
        self.assertEqual(clicked.json(), {"recorded": True, "event": "github_clicked"})
        zdwa, zilch = self.unlocked()
        self.assertIn("github_clicked", zdwa)
        self.assertIn("zilch.github_clicked", zilch)
        for destination, url in (
            ("issues", "https://github.com/Maetran/RollTheDice/issues"),
            ("changelog", "https://github.com/Maetran/RollTheDice/blob/master/CHANGELOG.md"),
        ):
            response = self.request("GET", f"/go/github/{destination}")
            self.assertEqual(response.status_code, 307)
            self.assertEqual(response.headers["location"], url)
            self.assertEqual(response.headers["cache-control"], "no-store")
        with session_scope() as db:
            events = list(db.scalars(select(UserEngagementEvent).where(UserEngagementEvent.user_id == self.user.id, UserEngagementEvent.event_key == "github_clicked")))
        self.assertEqual(len(events), 1)
        self.assertEqual(self.unlocked(), (zdwa, zilch))
