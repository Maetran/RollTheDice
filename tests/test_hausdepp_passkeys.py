"""Real signed WebAuthn ceremonies on the fixed Hausdepp production origin.

All accounts, keys and HTTP requests are local test fixtures; no production
origin is contacted and no browser/OS credential is created by these tests.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from starlette.testclient import TestClient

from app import main
from app.api_auth import router as auth_router
from app.api_passkeys import router as passkey_router
from app.database import configure_database, get_engine, session_scope
from app.models import Base, User
from app.passkeys import passkey_config
from app.product_hosts import HAUSDEPP_ORIGIN
from app.security import PASSWORDLESS_HASH
from tests.test_passkeys import SoftwareAuthenticator

RP_ID = "zockdiewandan.online"
APEX = f"https://{RP_ID}"
ZILCH = f"https://zilch.{RP_ID}"


class HausdeppPasskeyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/house-passkeys.sqlite3",
            "ROLLTHEDICE_SITE_ORIGIN": APEX, "ROLLTHEDICE_ZILCH_ORIGIN": ZILCH,
            "ROLLTHEDICE_WEBAUTHN_RP_ID": RP_ID, "ROLLTHEDICE_PASSKEYS_ENABLED": "1",
            "ROLLTHEDICE_COOKIE_SECURE": "1", "ROLLTHEDICE_COOKIE_DOMAIN": "",
            "ROLLTHEDICE_EMAIL_ENABLED": "0", "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
            "ROLLTHEDICE_TURNSTILE_SECRET": "",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        Base.metadata.create_all(get_engine())
        app = FastAPI()
        app.include_router(auth_router)
        app.include_router(passkey_router)
        self.client = TestClient(app, base_url=HAUSDEPP_ORIGIN, headers={"Origin": HAUSDEPP_ORIGIN})
        self.authenticator = SoftwareAuthenticator()

    def tearDown(self):
        self.client.close()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def signup(self):
        response = self.client.post("/api/auth/passkeys/signup/options", json={"username": "House_Passkey", "preferred_language": "en"})
        self.assertEqual(response.status_code, 200, response.text)
        options = response.json()["options"]
        self.assertEqual(options["rp"]["id"], RP_ID)
        response = self.client.post("/api/auth/passkeys/signup/verify", json={
            "credential": self.authenticator.registration(options, origin=HAUSDEPP_ORIGIN), "label": "House device",
        })
        self.assertEqual(response.status_code, 201, response.text)
        self.csrf = {"X-CSRF-Token": response.json()["user"]["csrf_token"]}
        return response.json()["user"]

    def proof(self, action, target="", *, origin=HAUSDEPP_ORIGIN, count=2):
        response = self.client.post("/api/auth/passkeys/reauthentication/options", json={"action": action, "target": target}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        return {"token": response.json()["token"], "credential": self.authenticator.authentication(
            response.json()["options"], origin=origin, rp_id=RP_ID, count=count)}

    def test_fixed_house_origin_is_added_only_to_its_parent_rp_and_aliases_are_not_advertised(self):
        self.assertEqual(passkey_config().expected_origins, (APEX, ZILCH, HAUSDEPP_ORIGIN))
        for origin, expected in ((HAUSDEPP_ORIGIN, True), ("https://www.zockdiewandan.online", False),
                                 ("https://evil.zockdiewandan.online", False), ("https://hausdepp.zockdiewandan.online.evil.test", False)):
            self.assertEqual(self.client.get(origin + "/api/auth/me").json()["passkeys"]["enabled"], expected)
        for apex, zilch, rp, secure in (("https://example.test", "https://zilch.example.test", "example.test", "1"),
                                      ("http://localhost:8012", "http://zilch.localhost:8012", "localhost", "0")):
            with patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": apex, "ROLLTHEDICE_ZILCH_ORIGIN": zilch,
                                         "ROLLTHEDICE_WEBAUTHN_RP_ID": rp, "ROLLTHEDICE_COOKIE_SECURE": secure}):
                self.assertEqual(passkey_config().expected_origins, (apex, zilch))

    def test_house_passwordless_signup_authentication_and_sensitive_registration_use_real_signatures(self):
        user = self.signup()
        with session_scope() as db:
            self.assertEqual(db.get(User, user["id"]).password_hash, PASSWORDLESS_HASH)
        self.assertEqual(self.client.get("/api/auth/me").json()["passkeys"], {"enabled": True, "has_credentials": True})
        self.client.cookies.clear()
        options = self.client.post("/api/auth/passkeys/authentication/options").json()["options"]
        response = self.client.post("/api/auth/passkeys/authentication/verify", json={
            "credential": self.authenticator.authentication(options, origin=HAUSDEPP_ORIGIN, rp_id=RP_ID, count=1),
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user"]["id"], user["id"])
        self.assertIn("Secure", response.headers["set-cookie"])
        self.csrf = {"X-CSRF-Token": response.json()["user"]["csrf_token"]}
        proof = self.proof("change_username", "House_Renamed", count=2)
        changed = self.client.post("/api/auth/change-username", json={"username": "House_Renamed", "passkey": proof}, headers=self.csrf)
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["username"], "House_Renamed")
        proof = self.proof("add_passkey", count=3)
        response = self.client.post("/api/auth/passkeys/registration/options", json={"passkey": proof}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["options"]["rp"]["id"], RP_ID)
        second = SoftwareAuthenticator()
        response = self.client.post("/api/auth/passkeys/registration/verify", json={
            "credential": second.registration(response.json()["options"], origin=HAUSDEPP_ORIGIN), "label": "Second House device",
        }, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.client.get("/api/auth/passkeys").json()["credentials"]), 2)

    def test_house_ceremonies_still_reject_another_trusted_product_origin_and_missing_csrf(self):
        self.signup()
        proof = self.proof("change_username", "House_Renamed", origin=APEX)
        response = self.client.post("/api/auth/change-username", json={"username": "House_Renamed", "passkey": proof}, headers=self.csrf)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["username"], "House_Passkey")
        response = self.client.post("/api/auth/passkeys/reauthentication/options", json={"action": "change_username", "target": "House_Renamed"})
        self.assertEqual(response.status_code, 403)
        self.client.cookies.clear()
        options = self.client.post("/api/auth/passkeys/authentication/options").json()["options"]
        response = self.client.post("/api/auth/passkeys/authentication/verify", json={
            "credential": self.authenticator.authentication(options, origin=ZILCH, rp_id=RP_ID, count=1),
        })
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.client.get("/api/auth/me").json()["authenticated"])
