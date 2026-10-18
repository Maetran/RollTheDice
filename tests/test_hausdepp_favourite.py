"""Saved room recipes are private, durable and deliberately password-free."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from alembic.config import Config
from sqlalchemy import create_engine
from starlette.testclient import TestClient

from alembic import command
from app import main
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.models import HausdeppPreferences
from tests.test_user_accounts import request_for


class HausdeppFavouriteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/favourites.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.accounts = [create_user(name, "secure-password-123", must_change_password=False)
                         for name in ("FavouriteHost", "FavouriteFriend")]
        self.identities = [login(request_for(), account.username, "secure-password-123") for account in self.accounts]
        self.client = TestClient(main.app)
        self.preset = {"waiting_mode": "fixed", "players": 3, "cpu_count": 2,
                       "tournament": False, "password_required": True}
        self.path = "/api/hausdepp/favourite"

    def tearDown(self):
        self.client.close()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def headers(self, index=0, *, csrf=True):
        identity, token = self.identities[index]
        return {"cookie": f"rollthedice_session={token}",
                **({"x-csrf-token": identity.csrf_token} if csrf else {})}

    def test_save_replace_and_delete_are_durable_and_account_scoped(self):
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json(), {"favourite": None})
        saved = self.client.put(self.path, json=self.preset, headers=self.headers())
        self.assertEqual(saved.json(), {"favourite": self.preset})
        self.assertEqual(saved.headers["cache-control"], "no-store")
        self.assertEqual(self.client.get(self.path, headers=self.headers(1)).json(), {"favourite": None})
        # A caller-provided account ID cannot redirect this account-free route.
        self.assertEqual(self.client.get(f"{self.path}?user_id={self.accounts[1].id}",
                                         headers=self.headers()).json(), {"favourite": self.preset})
        replaced = {**self.preset, "waiting_mode": "open", "players": 2, "cpu_count": 5, "tournament": True}
        expected = {**replaced, "players": 6}
        self.assertEqual(self.client.put(self.path, json=replaced, headers=self.headers()).json(),
                         {"favourite": expected})
        with session_scope() as db:
            self.assertEqual(json.loads(db.get(HausdeppPreferences, self.accounts[0].id).favourite_preset_json), expected)
        self.assertEqual(self.client.delete(self.path, headers=self.headers(1)).json(), {"favourite": None})
        read = self.client.get(self.path, headers=self.headers())
        self.assertEqual(read.json(), {"favourite": expected})
        self.assertEqual(read.headers["cache-control"], "no-store")
        self.assertEqual(self.client.delete(self.path, headers=self.headers()).json(), {"favourite": None})
        self.assertEqual(self.client.delete(self.path, headers=self.headers()).json(), {"favourite": None})
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json(), {"favourite": None})

    def test_authentication_csrf_and_secret_or_account_fields_are_rejected(self):
        for method, kwargs in (("get", {}), ("put", {"json": self.preset}), ("delete", {})):
            response = getattr(self.client, method)(self.path, **kwargs)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.headers["cache-control"], "no-store")
        for method, kwargs in (("put", {"json": self.preset}), ("delete", {})):
            self.assertEqual(getattr(self.client, method)(self.path, headers=self.headers(csrf=False),
                                                        **kwargs).status_code, 403)
        for field in ("pass", "password", "passphrase", "user_id", "account_id"):
            response = self.client.put(self.path, json={**self.preset, field: "private-test-secret"},
                                       headers=self.headers())
            self.assertEqual(response.status_code, 422)
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json(), {"favourite": None})
        with session_scope() as db:
            self.assertIsNone(db.get(HausdeppPreferences, self.accounts[0].id))

    def test_strict_counts_and_flags_reject_bad_recipes_without_replacing_valid_one(self):
        self.client.put(self.path, json=self.preset, headers=self.headers())
        for changes in ({"players": 1}, {"players": 7}, {"players": True}, {"players": "3"},
                        {"cpu_count": -1}, {"cpu_count": 3}, {"cpu_count": True}, {"cpu_count": "2"},
                        {"waiting_mode": "unknown"}, {"tournament": "false"}, {"password_required": 1}):
            with self.subTest(changes=changes):
                self.assertEqual(self.client.put(self.path, json={**self.preset, **changes},
                                                  headers=self.headers()).status_code, 422)
        self.assertEqual(self.client.get(self.path, headers=self.headers()).json(), {"favourite": self.preset})

    def test_auto_refill_and_auth_payload_remain_compatible_and_independent(self):
        preference = self.client.put("/api/auth/preferences/hausdepp", json={"hausdepp_auto_refill": True},
                                     headers=self.headers())
        self.assertEqual(preference.json(), {"hausdepp_auto_refill": True})
        self.client.put(self.path, json=self.preset, headers=self.headers())
        preferences = self.client.get("/api/auth/me", headers=self.headers()).json()["user"]["preferences"]
        self.assertTrue(preferences["hausdepp_auto_refill"])
        self.assertNotIn("favourite", preferences)
        self.client.delete(self.path, headers=self.headers())
        self.assertTrue(self.client.get("/api/auth/me", headers=self.headers()).json()["user"]["preferences"]
                        ["hausdepp_auto_refill"])

    def test_invalid_stored_json_never_exposes_unvalidated_or_secret_fields(self):
        for raw in ('{"passphrase":"private-test-secret"}', '{"players":3,"cpu_count":5}', "malformed"):
            with session_scope() as db:
                row = db.get(HausdeppPreferences, self.accounts[0].id)
                if row is None:
                    row = HausdeppPreferences(user_id=self.accounts[0].id)
                    db.add(row)
                row.favourite_preset_json = raw
            self.assertEqual(self.client.get(self.path, headers=self.headers()).json(), {"favourite": None})


def test_favourite_migration_preserves_existing_auto_refill_and_account_rows(tmp_path):
    base = Path(__file__).resolve().parents[1]
    config = Config(str(base / "alembic.ini"))
    config.set_main_option("script_location", str(base / "alembic"))
    url = f"sqlite:///{tmp_path}/favourite-migration.sqlite3"
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "20261017_0064")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO users(username,username_normalized,password_hash,role,is_active,must_change_password,created_at,updated_at) "
                "VALUES ('PresetUser','presetuser','unchanged','user',1,0,'2026-10-18','2026-10-18')"
            )
            user_id = connection.exec_driver_sql("SELECT id FROM users WHERE username='PresetUser'").scalar_one()
            connection.exec_driver_sql("INSERT INTO hausdepp_preferences(user_id,auto_refill) VALUES (?,1)", (user_id,))
        command.upgrade(config, "20261018_0065")
        with engine.begin() as connection:
            assert connection.exec_driver_sql("SELECT auto_refill,favourite_preset_json FROM hausdepp_preferences").one() == (1, None)
            connection.exec_driver_sql("UPDATE hausdepp_preferences SET favourite_preset_json='{}'")
        command.downgrade(config, "20261017_0064")
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT user_id,auto_refill FROM hausdepp_preferences").one() == (user_id, 1)
            assert connection.exec_driver_sql("SELECT username FROM users WHERE id=?", (user_id,)).scalar_one() == "PresetUser"
            assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        command.upgrade(config, "20261018_0065")
        with engine.connect() as connection:
            assert connection.exec_driver_sql("SELECT auto_refill,favourite_preset_json FROM hausdepp_preferences").one() == (1, None)
    finally:
        engine.dispose()
