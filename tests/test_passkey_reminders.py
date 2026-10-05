"""Seven-day passkey reminders share one durable account-wide claim."""

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Barrier
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import main
from app.auth import create_user, issue_session_for_user
from app.database import configure_database, get_engine, session_scope
from app.models import Base, PasskeyCredential, User
from app.passkey_reminders import claim_passkey_prompt, router
from app.security import utcnow


class PasskeyReminderTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.directory.name}/reminders.sqlite3",
            "ROLLTHEDICE_PASSKEYS_ENABLED": "1",
            "ROLLTHEDICE_SITE_ORIGIN": "https://example.test",
            "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.example.test",
            "ROLLTHEDICE_WEBAUTHN_RP_ID": "example.test",
            "ROLLTHEDICE_COOKIE_SECURE": "1",
        })
        self.environment.start()
        configure_database(Path(self.directory.name))
        Base.metadata.create_all(get_engine())
        self.user = create_user("ReminderUser", "reminder-password-123", must_change_password=False)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app, base_url="https://example.test", headers={"Origin": "https://example.test"})
        with session_scope() as db:
            self.identity, token = issue_session_for_user(db, db.get(User, self.user.id))
        self.client.cookies.set("rollthedice_session", token)
        self.csrf = {"X-CSRF-Token": self.identity.csrf_token}

    def tearDown(self):
        self.client.close()
        get_engine().dispose()
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.directory.cleanup()

    def test_exact_seven_day_boundary_and_shared_claim(self):
        now = utcnow()
        with patch("app.passkey_reminders.utcnow", return_value=now):
            first = claim_passkey_prompt(self.user.id)
            self.assertTrue(first["show_prompt"])
            self.assertEqual(first["next_prompt_at"], now + timedelta(days=7))
            self.assertFalse(claim_passkey_prompt(self.user.id)["show_prompt"])
        with patch("app.passkey_reminders.utcnow", return_value=now + timedelta(days=7, microseconds=-1)):
            self.assertFalse(claim_passkey_prompt(self.user.id)["show_prompt"])
        with patch("app.passkey_reminders.utcnow", return_value=now + timedelta(days=7)):
            self.assertTrue(claim_passkey_prompt(self.user.id)["show_prompt"])

    def test_parallel_devices_only_claim_one_reminder(self):
        barrier = Barrier(2)

        def claim():
            barrier.wait(timeout=5)
            return claim_passkey_prompt(self.user.id)["show_prompt"]

        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(claim) for _ in range(2)]
            self.assertEqual(sum(future.result(timeout=10) for future in futures), 1)

    def test_dismissal_restarts_seven_days_across_devices(self):
        now = utcnow()
        with patch("app.passkey_reminders.utcnow", return_value=now):
            self.assertTrue(claim_passkey_prompt(self.user.id)["show_prompt"])
        later = now + timedelta(days=8)
        with patch("app.passkey_reminders.utcnow", return_value=later):
            self.assertEqual(self.client.post("/api/auth/passkeys/prompt/dismiss").status_code, 403)
            response = self.client.post("/api/auth/passkeys/prompt/dismiss", headers=self.csrf)
            self.assertEqual(response.status_code, 200)
            self.assertFalse(claim_passkey_prompt(self.user.id)["show_prompt"])
        with patch("app.passkey_reminders.utcnow", return_value=later + timedelta(days=7)):
            self.assertTrue(claim_passkey_prompt(self.user.id)["show_prompt"])

    def test_disabled_passkeys_do_not_consume_cooldown(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_PASSKEYS_ENABLED": "0"}):
            self.assertFalse(claim_passkey_prompt(self.user.id)["show_prompt"])
        with session_scope() as db:
            self.assertIsNone(db.get(User, self.user.id).passkey_prompted_at)
        self.assertTrue(claim_passkey_prompt(self.user.id)["show_prompt"])

    def test_forced_password_change_and_inactive_accounts_are_skipped(self):
        for field in ("must_change_password", "is_active"):
            with session_scope() as db:
                user = db.get(User, self.user.id)
                user.must_change_password = field == "must_change_password"
                user.is_active = field != "is_active"
            self.assertFalse(claim_passkey_prompt(self.user.id)["show_prompt"])
        with session_scope() as db:
            self.assertIsNone(db.get(User, self.user.id).passkey_prompted_at)

    def test_accounts_with_a_passkey_never_get_the_reminder(self):
        with session_scope() as db:
            db.add(PasskeyCredential(user_id=self.user.id, credential_id=b"credential", credential_public_key=b"public",
                                     created_at=utcnow()))
        self.assertFalse(claim_passkey_prompt(self.user.id)["show_prompt"])
        with session_scope() as db:
            self.assertIsNone(db.get(User, self.user.id).passkey_prompted_at)

    def test_endpoint_requires_session_csrf_and_allowed_origin(self):
        self.assertEqual(self.client.post("/api/auth/passkeys/prompt").status_code, 403)
        self.assertEqual(self.client.post("/api/auth/passkeys/prompt", headers={**self.csrf, "Origin": "https://evil.test"}).status_code, 403)
        response = self.client.post("/api/auth/passkeys/prompt", headers=self.csrf)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertTrue(response.json()["show_prompt"])
        self.assertFalse(self.client.post("/api/auth/passkeys/prompt", headers=self.csrf).json()["show_prompt"])
        self.client.cookies.clear()
        self.assertEqual(self.client.post("/api/auth/passkeys/prompt", headers=self.csrf).status_code, 401)
