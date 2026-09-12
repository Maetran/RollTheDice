"""Passkey regression tests using real P-256 signatures and CBOR attestations."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import main
from app import passkeys as passkey_service
from app.api_passkeys import router
from app.auth import create_user, issue_session_for_user, reset_password
from app.database import configure_database, get_engine, session_scope
from app.models import Base, PasskeyCredential, User, WebAuthnCeremony
from app.models import Session as LoginSession
from app.passkeys import CEREMONY_COOKIE_NAME, passkey_config
from app.security import hash_session_token, utcnow

ORIGIN = "https://example.test"
RP_ID = "example.test"
PASSWORD = "a-real-test-password-123"


def b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


class SoftwareAuthenticator:
    """A test authenticator producing the real WebAuthn wire format."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(32)
        self.handle = ""
        public = self.key.public_key().public_numbers()
        self.cose = cbor2.dumps({1: 2, 3: -7, -1: 1, -2: public.x.to_bytes(32, "big"), -3: public.y.to_bytes(32, "big")})

    def _client(self, kind, challenge, *, origin=ORIGIN, cross_origin=False):
        return json.dumps({"type": kind, "challenge": challenge, "origin": origin, "crossOrigin": cross_origin}).encode()

    def registration(self, options, *, origin=ORIGIN, flags=0x45):
        self.handle = options["user"]["id"]
        client = self._client("webauthn.create", options["challenge"], origin=origin)
        auth_data = (
            hashlib.sha256(options["rp"]["id"].encode()).digest()
            + bytes([flags]) + (0).to_bytes(4, "big") + bytes(16)
            + len(self.credential_id).to_bytes(2, "big") + self.credential_id + self.cose
        )
        return {
            "id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
            "response": {
                "clientDataJSON": b64(client),
                "attestationObject": b64(cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})),
            },
        }

    def authentication(self, options, *, origin=ORIGIN, flags=0x05, count=1, rp_id=RP_ID, cross_origin=False, handle=None):
        client = self._client("webauthn.get", options["challenge"], origin=origin, cross_origin=cross_origin)
        auth_data = hashlib.sha256(rp_id.encode()).digest() + bytes([flags]) + count.to_bytes(4, "big")
        signature = self.key.sign(auth_data + hashlib.sha256(client).digest(), ec.ECDSA(hashes.SHA256()))
        return {
            "id": b64(self.credential_id), "rawId": b64(self.credential_id), "type": "public-key",
            "response": {
                "clientDataJSON": b64(client), "authenticatorData": b64(auth_data),
                "signature": b64(signature), "userHandle": self.handle if handle is None else handle,
            },
        }


class PasskeyTestCase(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.directory.name}/passkeys.sqlite3",
            "ROLLTHEDICE_PASSKEYS_ENABLED": "1",
            "ROLLTHEDICE_SITE_ORIGIN": ORIGIN,
            "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.example.test",
            "ROLLTHEDICE_WEBAUTHN_RP_ID": RP_ID,
            "ROLLTHEDICE_COOKIE_SECURE": "1",
            "ROLLTHEDICE_COOKIE_DOMAIN": "",
        })
        self.environment.start()
        configure_database(Path(self.directory.name))
        Base.metadata.create_all(get_engine())
        self.user = create_user("Passkey_User", PASSWORD, must_change_password=False)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app, base_url=ORIGIN, headers={"Origin": ORIGIN})
        with session_scope() as db:
            user = db.get(User, self.user.id)
            self.identity, raw = issue_session_for_user(db, user)
        self.client.cookies.set("rollthedice_session", raw)
        self.csrf = {"X-CSRF-Token": self.identity.csrf_token}
        self.authenticator = SoftwareAuthenticator()

    def tearDown(self):
        self.client.close()
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.directory.cleanup()

    def _register(self):
        response = self.client.post("/api/auth/passkeys/registration/options", json={"current_password": PASSWORD}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        options = response.json()["options"]
        self.assertEqual(options["authenticatorSelection"]["residentKey"], "required")
        self.assertEqual(options["authenticatorSelection"]["userVerification"], "required")
        payload = self.authenticator.registration(options)
        response = self.client.post("/api/auth/passkeys/registration/verify", json={"credential": payload, "label": "My phone"}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["credential"]

    def _authentication_options(self):
        response = self.client.post("/api/auth/passkeys/authentication/options")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["options"]

    def test_full_registration_login_and_owned_deletion(self):
        registered = self._register()
        self.assertEqual(set(registered), {"id", "label", "created_at", "last_used_at"})
        self.client.cookies.clear()
        options = self._authentication_options()
        self.assertFalse(options.get("allowCredentials"))
        self.assertEqual(options["userVerification"], "required")
        cookie = self.client.cookies.get(CEREMONY_COOKIE_NAME)
        credential = self.authenticator.authentication(options)
        response = self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user"]["id"], self.user.id)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertIn("Secure", response.headers["set-cookie"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        csrf = {"X-CSRF-Token": response.json()["user"]["csrf_token"]}
        records = self.client.get("/api/auth/passkeys").json()["credentials"]
        self.assertEqual(records[0]["label"], "My phone")
        self.assertIsNotNone(records[0]["last_used_at"])
        # Reusing the original cookie and signed assertion cannot issue another session.
        replay = self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential}, headers={"Cookie": f"{CEREMONY_COOKIE_NAME}={cookie}"})
        self.assertEqual(replay.status_code, 400)
        deleted = self.client.request("DELETE", f"/api/auth/passkeys/{registered['id']}", json={"current_password": PASSWORD}, headers=csrf)
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(self.client.get("/api/auth/passkeys").json()["credentials"], [])

    def test_authentication_rejects_tampering_wrong_origin_rp_and_absent_uv(self):
        self._register()
        self.client.cookies.clear()
        attempts = (
            {"origin": "https://evil.example.test"},
            {"origin": "https://zilch.example.test"},
            {"rp_id": "evil.example.test"},
            {"flags": 0x01},
            {"flags": 0x04},
            {"cross_origin": True},
            {"handle": b64(b"another-account")},
            {"handle": ""},
        )
        for arguments in attempts:
            with self.subTest(arguments=arguments):
                options = self._authentication_options()
                credential = self.authenticator.authentication(options, **arguments)
                response = self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertEqual(response.json()["detail"], "passkey_verification_failed")
        options = self._authentication_options()
        credential = self.authenticator.authentication(options)
        credential["response"]["signature"] = b64(b"tampered")
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential}).status_code, 400)

    def test_counter_regression_and_new_challenge_replay_are_rejected(self):
        self._register()
        self.client.cookies.clear()
        options = self._authentication_options()
        credential = self.authenticator.authentication(options, count=5)
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential}).status_code, 200)
        options = self._authentication_options()
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential}).status_code, 400)
        repeated_count = self.authenticator.authentication(options, count=5)
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": repeated_count}).status_code, 400)

    def test_invalid_cookie_expiry_and_disabled_account_are_rejected(self):
        self._register()
        options = self._authentication_options()
        credential = self.authenticator.authentication(options)
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential}, headers={"Cookie": f"{CEREMONY_COOKIE_NAME}=invented"}).status_code, 400)
        with session_scope() as db:
            user = db.get(User, self.user.id)
            user.is_active = False
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential}).status_code, 400)
        with session_scope() as db:
            user = db.get(User, self.user.id)
            user.is_active = True
            for ceremony in db.scalars(select(WebAuthnCeremony)):
                ceremony.expires_at = utcnow() - timedelta(seconds=1)
        self.assertEqual(self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential}).status_code, 400)

    def test_registration_requires_password_csrf_and_same_session(self):
        url = "/api/auth/passkeys/registration/options"
        self.assertEqual(self.client.post(url, json={"current_password": PASSWORD}).status_code, 403)
        self.assertEqual(self.client.post(url, json={"current_password": "incorrect"}, headers=self.csrf).status_code, 400)
        options = self.client.post(url, json={"current_password": PASSWORD}, headers=self.csrf).json()["options"]
        credential = self.authenticator.registration(options)
        with session_scope() as db:
            user = db.get(User, self.user.id)
            identity, raw = issue_session_for_user(db, user)
        cookie = self.client.cookies.get(CEREMONY_COOKIE_NAME)
        headers = {"X-CSRF-Token": identity.csrf_token, "Cookie": f"rollthedice_session={raw}; {CEREMONY_COOKIE_NAME}={cookie}"}
        self.assertEqual(self.client.post("/api/auth/passkeys/registration/verify", json={"credential": credential}, headers=headers).status_code, 400)
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(PasskeyCredential))), [])

    def test_delete_cannot_target_another_accounts_credential(self):
        record = self._register()
        other = create_user("Another_User", PASSWORD, must_change_password=False)
        with session_scope() as db:
            other = db.get(User, other.id)
            identity, raw = issue_session_for_user(db, other)
        headers = {"X-CSRF-Token": identity.csrf_token, "Cookie": f"rollthedice_session={raw}"}
        response = self.client.request("DELETE", f"/api/auth/passkeys/{record['id']}", json={"current_password": PASSWORD}, headers=headers)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(len(self.client.get("/api/auth/passkeys").json()["credentials"]), 1)

    def test_origin_feature_flag_rate_and_cookie_policy(self):
        url = "/api/auth/passkeys/authentication/options"
        self.assertEqual(self.client.post(url, headers={"Origin": "https://evil.example.test"}).status_code, 403)
        self.assertEqual(self.client.post(url, headers={"Origin": ""}).status_code, 403)
        with patch.dict(os.environ, {"ROLLTHEDICE_PASSKEYS_ENABLED": "0"}):
            self.assertEqual(self.client.post(url).status_code, 503)
        with patch("app.api_passkeys.PASSKEY_RATE_IP_MAX", 1):
            response = self.client.post(url)
            self.assertEqual(response.status_code, 200)
            cookie = response.headers["set-cookie"]
            self.assertIn("HttpOnly", cookie)
            self.assertIn("Secure", cookie)
            self.assertIn("SameSite=strict", cookie)
            self.assertNotIn("Domain=", cookie)
            self.assertEqual(self.client.post(url).status_code, 429)
        with patch.dict(os.environ, {"ROLLTHEDICE_WEBAUTHN_RP_ID": "test"}):
            with self.assertRaises(RuntimeError):
                passkey_config()
        with patch.dict(os.environ, {
            "ROLLTHEDICE_SITE_ORIGIN": "http://localhost:8012",
            "ROLLTHEDICE_ZILCH_ORIGIN": "http://zilch.localhost:8012",
            "ROLLTHEDICE_WEBAUTHN_RP_ID": "localhost",
            "ROLLTHEDICE_COOKIE_SECURE": "0",
        }):
            self.assertEqual(passkey_config().expected_origins, ("http://localhost:8012", "http://zilch.localhost:8012"))

    def test_registration_rejects_missing_uv_and_duplicate_credential(self):
        self._register()
        response = self.client.post("/api/auth/passkeys/registration/options", json={"current_password": PASSWORD}, headers=self.csrf)
        options = response.json()["options"]
        credential = self.authenticator.registration(options, flags=0x41)
        url = "/api/auth/passkeys/registration/verify"
        self.assertEqual(self.client.post(url, json={"credential": credential}, headers=self.csrf).status_code, 400)
        credential = self.authenticator.registration(options)
        response = self.client.post(url, json={"credential": credential}, headers=self.csrf)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "passkey_already_registered")

    def test_in_flight_authentication_rejects_a_reused_credential_row_after_recovery(self):
        registered = self._register()
        options = self._authentication_options()
        credential = self.authenticator.authentication(options)
        library = passkey_service._webauthn()
        verify = library["verify_authentication_response"]
        replacement_id = os.urandom(32)

        def recover_after_crypto_verification(**kwargs):
            verified = verify(**kwargs)
            reset_password(self.user.id, "recovered-secure-password")
            # SQLite can reuse the deleted row's integer ID. A new credential
            # with counter zero must never inherit the old signature's proof.
            with session_scope() as db:
                db.add(PasskeyCredential(
                    id=registered["id"], user_id=self.user.id,
                    credential_id=replacement_id, credential_public_key=self.authenticator.cose,
                    sign_count=0, created_at=utcnow(),
                ))
            return verified

        with patch("app.passkeys._webauthn", return_value={**library, "verify_authentication_response": recover_after_crypto_verification}):
            response = self.client.post("/api/auth/passkeys/authentication/verify", json={"credential": credential})
        self.assertEqual(response.status_code, 400, response.text)
        with session_scope() as db:
            replacement = db.get(PasskeyCredential, registered["id"])
            self.assertEqual(replacement.credential_id, replacement_id)
            self.assertIsNone(replacement.last_used_at)
            self.assertEqual(list(db.scalars(select(LoginSession))), [])

    def test_in_flight_registration_rejects_a_reused_ceremony_row_after_recovery(self):
        response = self.client.post("/api/auth/passkeys/registration/options", json={"current_password": PASSWORD}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        credential = self.authenticator.registration(response.json()["options"])
        with session_scope() as db:
            original_ceremony_id = db.scalar(select(WebAuthnCeremony.id))
        library = passkey_service._webauthn()
        verify = library["verify_registration_response"]
        replacement_hash = hash_session_token("fresh-ceremony-state-after-recovery")

        def recover_after_crypto_verification(**kwargs):
            verified = verify(**kwargs)
            reset_password(self.user.id, "recovered-secure-password")
            # Reproduce a fresh owner session/ceremony reusing SQLite IDs while
            # the earlier enrollment request is still finishing verification.
            with session_scope() as db:
                user = db.get(User, self.user.id)
                user.must_change_password = False
                owner_identity, _ = issue_session_for_user(db, user)
                db.add(WebAuthnCeremony(
                    id=original_ceremony_id, purpose="registration", user_id=user.id,
                    session_id=owner_identity.session_id, state_token_hash=replacement_hash,
                    challenge=os.urandom(32), created_at=utcnow(),
                    expires_at=utcnow() + timedelta(minutes=5),
                ))
            return verified

        with patch("app.passkeys._webauthn", return_value={**library, "verify_registration_response": recover_after_crypto_verification}):
            response = self.client.post("/api/auth/passkeys/registration/verify", json={"credential": credential}, headers=self.csrf)
        self.assertEqual(response.status_code, 400, response.text)
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(PasskeyCredential))), [])
            replacement = db.get(WebAuthnCeremony, original_ceremony_id)
            self.assertEqual(replacement.state_token_hash, replacement_hash)
            self.assertIsNone(replacement.consumed_at)

    def test_management_rejects_a_password_proof_superseded_by_recovery(self):
        from app import api_passkeys

        verify = api_passkeys.verify_password

        def recover_after_password_verification(*args):
            result = verify(*args)
            reset_password(self.user.id, "recovered-secure-password")
            return result

        with patch("app.api_passkeys.verify_password", side_effect=recover_after_password_verification):
            response = self.client.post("/api/auth/passkeys/registration/options", json={"current_password": PASSWORD}, headers=self.csrf)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"], "current_password_invalid")
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(WebAuthnCeremony))), [])
