"""Cryptographic Watten-origin tests on isolated routers, never a public host."""

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
from app.database import configure_database, get_engine
from app.models import Base
from app.passkeys import passkey_config
from app.product_hosts import WATTEN_ORIGIN
from tests.test_passkeys import SoftwareAuthenticator

RP = "zockdiewandan.online"


class WattenPasskeyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/accounts.sqlite3",
            "ROLLTHEDICE_SITE_ORIGIN": f"https://{RP}", "ROLLTHEDICE_ZILCH_ORIGIN": f"https://zilch.{RP}",
            "ROLLTHEDICE_WEBAUTHN_RP_ID": RP, "ROLLTHEDICE_PASSKEYS_ENABLED": "1",
            "ROLLTHEDICE_COOKIE_SECURE": "1", "ROLLTHEDICE_COOKIE_DOMAIN": "",
            "ROLLTHEDICE_EMAIL_ENABLED": "0", "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
            "ROLLTHEDICE_TURNSTILE_SECRET": "", "ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        Base.metadata.create_all(get_engine())
        isolated = FastAPI()
        isolated.include_router(auth_router)
        isolated.include_router(passkey_router)
        self.client = TestClient(isolated, base_url=WATTEN_ORIGIN, headers={"Origin": WATTEN_ORIGIN})
        self.authenticator = SoftwareAuthenticator()

    def tearDown(self):
        self.client.close()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def test_fixed_origin_is_allowed_only_under_its_actual_parent_rp(self):
        self.assertIn(WATTEN_ORIGIN, passkey_config().expected_origins)
        for site, zilch, rp, secure in (("https://example.test", "https://zilch.example.test", "example.test", "1"),
                                       ("http://localhost:8057", "http://zilch.localhost:8057", "localhost", "0")):
            with patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": site, "ROLLTHEDICE_ZILCH_ORIGIN": zilch,
                                         "ROLLTHEDICE_WEBAUTHN_RP_ID": rp, "ROLLTHEDICE_COOKIE_SECURE": secure}):
                self.assertEqual(passkey_config().expected_origins, (site, zilch))
        for alias in ("https://evil.zockdiewandan.online", "https://watten.zockdiewandan.online.evil.test"):
            self.assertFalse(self.client.get(alias + "/api/auth/me").json()["passkeys"]["enabled"])
            response = self.client.post("/api/auth/passkeys/authentication/options", json={}, headers={"Origin": alias})
            self.assertEqual(response.status_code, 403)

    def test_signup_login_and_sensitive_action_verify_real_watten_signatures(self):
        options = self.client.post("/api/auth/passkeys/signup/options", json={"username": "WattenSigned"}).json()["options"]
        self.assertEqual(options["rp"]["id"], RP)
        created = self.client.post("/api/auth/passkeys/signup/verify", json={
            "credential": self.authenticator.registration(options, origin=WATTEN_ORIGIN), "label": "Watten test",
        })
        self.assertEqual(created.status_code, 201, created.text)
        user_id = created.json()["user"]["id"]
        self.client.cookies.clear()
        options = self.client.post("/api/auth/passkeys/authentication/options").json()["options"]
        signed = self.authenticator.authentication(options, origin=WATTEN_ORIGIN, rp_id=RP, count=1)
        authenticated = self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": signed})
        self.assertEqual(authenticated.status_code, 200, authenticated.text)
        self.assertEqual(authenticated.json()["user"]["id"], user_id)
        csrf = {"X-CSRF-Token": authenticated.json()["user"]["csrf_token"]}
        proof = self.client.post("/api/auth/passkeys/reauthentication/options",
                                 json={"action": "change_username", "target": "WattenRenamed"}, headers=csrf).json()
        changed = self.client.post("/api/auth/change-username", headers=csrf, json={"username": "WattenRenamed", "passkey": {
            "token": proof["token"], "credential": self.authenticator.authentication(
                proof["options"], origin=WATTEN_ORIGIN, rp_id=RP, count=2),
        }})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json()["user"]["id"], user_id)
        self.assertEqual(changed.json()["user"]["username"], "WattenRenamed")
        self.client.cookies.clear()
        options = self.client.post("/api/auth/passkeys/authentication/options").json()["options"]
        wrong_origin = self.authenticator.authentication(options, origin="https://evil.zockdiewandan.online", rp_id=RP, count=3)
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": wrong_origin}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
