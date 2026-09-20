"""Passkey regression tests using real P-256 signatures and CBOR attestations."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Barrier
from unittest import TestCase
from unittest.mock import patch

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, select, update

from app import main
from app import passkeys as passkey_service
from app.api_auth import router as auth_router
from app.api_passkeys import router
from app.auth import create_user, issue_session_for_user, reset_password
from app.database import configure_database, get_engine, session_scope
from app.models import AccountEmailToken, Base, PasskeyCredential, User, WebAuthnCeremony
from app.models import Session as LoginSession
from app.passkeys import CEREMONY_COOKIE_NAME, passkey_config
from app.security import hash_password, hash_session_token, utcnow, verify_password

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
        app.include_router(auth_router)
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
        self.assertEqual(self.client.get("/api/auth/me").json()["passkeys"], {
            "enabled": True, "has_credentials": False,
        })
        registered = self._register()
        self.assertEqual(set(registered), {"id", "label", "created_at", "last_used_at"})
        self.assertEqual(self.client.get("/api/auth/me").json()["passkeys"], {
            "enabled": True, "has_credentials": True,
        })
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
        self.assertEqual(self.client.get("/api/auth/me").json()["passkeys"], {
            "enabled": True, "has_credentials": False,
        })

    def test_credential_presence_is_private_and_scoped_to_the_current_account(self):
        self._register()
        other = create_user("No_Passkey_User", PASSWORD, must_change_password=False)
        with session_scope() as db:
            other = db.get(User, other.id)
            _identity, raw = issue_session_for_user(db, other)
        url = f"/api/auth/me?user_id={self.user.id}&username={self.user.username}"
        response = self.client.get(url, headers={"Cookie": f"rollthedice_session={raw}"})
        self.assertEqual(response.json()["user"]["id"], other.id)
        self.assertEqual(response.json()["passkeys"], {"enabled": True, "has_credentials": False})
        self.assertEqual(response.headers["cache-control"], "no-store")
        # An unsupported alias or a disabled feature must not turn a present
        # credential into a missing one; the frontend checks both capabilities.
        with patch.dict(os.environ, {"ROLLTHEDICE_PASSKEYS_ENABLED": "0"}):
            self.assertEqual(self.client.get("/api/auth/me").json()["passkeys"], {
                "enabled": False, "has_credentials": True,
            })
        response = self.client.get("https://www.example.test/api/auth/me")
        self.assertEqual(response.json()["passkeys"], {"enabled": False, "has_credentials": True})
        self.client.cookies.clear()
        self.assertEqual(self.client.get(url).json()["passkeys"], {"enabled": True})

    def test_credential_presence_reflects_password_recovery_and_revoked_sessions(self):
        self._register()
        recovered_password = "recovered-secure-password"
        reset_password(self.user.id, recovered_password)
        response = self.client.get("/api/auth/me")
        self.assertFalse(response.json()["authenticated"])
        self.assertEqual(response.json()["passkeys"], {"enabled": True})
        response = self.client.post("/api/auth/login", json={
            "username": self.user.username, "password": recovered_password,
        })
        self.assertEqual(response.status_code, 200, response.text)
        response = self.client.get("/api/auth/me")
        self.assertTrue(response.json()["user"]["must_change_password"])
        self.assertEqual(response.json()["passkeys"], {"enabled": True, "has_credentials": False})

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

    def test_public_capability_only_advertises_the_actual_allowed_origin(self):
        self.client.cookies.clear()
        for origin, enabled in (
            (ORIGIN, True),
            ("https://zilch.example.test", True),
            ("https://www.example.test", False),
            ("https://other.example.test", False),
            ("http://example.test", False),
        ):
            with self.subTest(origin=origin):
                # The optional Origin header cannot make a different document
                # host advertise passkeys. GET /me uses the request URL itself.
                response = self.client.get(f"{origin}/api/auth/me", headers={"Origin": ORIGIN})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["passkeys"], {"enabled": enabled})
                self.assertEqual(response.headers["cache-control"], "no-store")
        with patch.dict(os.environ, {"ROLLTHEDICE_PASSKEYS_ENABLED": "0"}):
            self.assertEqual(self.client.get("/api/auth/me").json()["passkeys"], {"enabled": False})

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
        from app import auth

        verify = auth.verify_password

        def recover_after_password_verification(*args):
            result = verify(*args)
            reset_password(self.user.id, "recovered-secure-password")
            return result

        with patch("app.auth.verify_password", side_effect=recover_after_password_verification):
            response = self.client.post("/api/auth/passkeys/registration/options", json={"current_password": PASSWORD}, headers=self.csrf)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"], "current_password_invalid")
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(WebAuthnCeremony))), [])

    def _reauthentication(self, action="change_username", target="Renamed_Player", **authenticator_kwargs):
        response = self.client.post(
            "/api/auth/passkeys/reauthentication/options", json={"action": action, "target": target}, headers=self.csrf,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn("set-cookie", response.headers)
        options = response.json()["options"]
        self.assertEqual(options["userVerification"], "required")
        self.assertIn(b64(self.authenticator.credential_id), [item["id"] for item in options["allowCredentials"]])
        return {"token": response.json()["token"], "credential": self.authenticator.authentication(options, **authenticator_kwargs)}

    def _rename_with(self, proof, *, username="Renamed_Player", headers=None):
        return self.client.post(
            "/api/auth/change-username", json={"username": username, "passkey": proof},
            headers=self.csrf if headers is None else headers,
        )

    def test_passkey_confirms_every_account_action_without_the_current_password(self):
        self._register()
        original_cookie = self.client.cookies.get("rollthedice_session")
        response = self._rename_with(self._reauthentication())
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user"]["username"], "Renamed_Player")
        self.assertEqual(response.json()["passkeys"], {"enabled": True, "has_credentials": True})
        self.assertEqual(response.json()["user"]["csrf_token"], self.identity.csrf_token)
        self.assertNotIn("set-cookie", response.headers)
        self.assertEqual(self.client.cookies.get("rollthedice_session"), original_cookie)

        proof = self._reauthentication("change_email", "changed@example.test", count=2)
        email_env = {"ROLLTHEDICE_EMAIL_ENABLED": "1", "ROLLTHEDICE_RESEND_API_KEY": "test-key",
                     "ROLLTHEDICE_EMAIL_FROM": "konto@auth.example.test"}
        with patch.dict(os.environ, email_env), patch("app.email_accounts.send_account_email") as send:
            response = self.client.post("/api/auth/email", json={"email": "changed@example.test", "passkey": proof}, headers=self.csrf)
        self.assertEqual(response.status_code, 202, response.text)
        send.assert_called_once()
        with session_scope() as db:
            self.assertEqual(db.scalar(select(AccountEmailToken)).email, "changed@example.test")
            self.assertIsNone(db.get(User, self.user.id).email)

        proof = self._reauthentication("add_passkey", "", count=3)
        response = self.client.post("/api/auth/passkeys/registration/options", json={"passkey": proof}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        second_authenticator = SoftwareAuthenticator()
        response = self.client.post("/api/auth/passkeys/registration/verify", json={
            "credential": second_authenticator.registration(response.json()["options"]), "label": "Second device",
        }, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        second_id = response.json()["credential"]["id"]
        proof = self._reauthentication("delete_passkey", str(second_id), count=4)
        response = self.client.request("DELETE", f"/api/auth/passkeys/{second_id}", json={"passkey": proof}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.client.get("/api/auth/passkeys").json()["credentials"]), 1)

        proof = self._reauthentication("change_password", "", count=5)
        response = self.client.post("/api/auth/change-password", json={
            "new_password": "new-secret-known-to-the-owner", "passkey": proof,
        }, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["login_required"])
        self.assertFalse(self.client.get("/api/auth/me").json()["authenticated"])
        with session_scope() as db:
            self.assertTrue(verify_password("new-secret-known-to-the-owner", db.get(User, self.user.id).password_hash))
            self.assertEqual(list(db.scalars(select(LoginSession))), [])
            self.assertEqual(list(db.scalars(select(WebAuthnCeremony))), [])
            self.assertEqual(list(db.scalars(select(AccountEmailToken))), [])

    def test_reauthentication_allows_null_user_handle_only_for_the_bound_account(self):
        self._register()
        proof = self._reauthentication(handle="")
        proof["credential"]["response"]["userHandle"] = None
        self.assertEqual(self._rename_with(proof).status_code, 200)
        proof = self._reauthentication(target="Renamed_Again", count=2, handle=b64(b"wrong-account"))
        self.assertEqual(self._rename_with(proof, username="Renamed_Again").status_code, 400)

    def test_reauthentication_rejects_replay_and_consumes_only_with_a_successful_mutation(self):
        self._register()
        create_user("Taken_Name", PASSWORD, must_change_password=False)
        proof = self._reauthentication(target="Taken_Name")
        self.assertEqual(self._rename_with(proof, username="Taken_Name").status_code, 409)
        with session_scope() as db:
            ceremony = db.scalar(select(WebAuthnCeremony).where(WebAuthnCeremony.purpose == "reauthentication"))
            self.assertIsNone(ceremony.consumed_at)
            self.assertEqual(db.scalar(select(PasskeyCredential)).sign_count, 0)
        proof = self._reauthentication()
        self.assertEqual(self._rename_with(proof).status_code, 200)
        self.assertEqual(self._rename_with(proof).status_code, 400)

    def test_reauthentication_rejects_other_action_or_changed_target(self):
        self._register()
        proof = self._reauthentication()
        self.assertEqual(self._rename_with(proof, username="Different_Player").status_code, 400)
        response = self.client.post("/api/auth/change-password", json={"new_password": "different-password-123", "passkey": proof}, headers=self.csrf)
        self.assertEqual(response.status_code, 400)
        with session_scope() as db:
            self.assertEqual(db.get(User, self.user.id).username, "Passkey_User")
            self.assertTrue(verify_password(PASSWORD, db.get(User, self.user.id).password_hash))
        self.assertEqual(self._rename_with(proof).status_code, 200)

    def test_reauthentication_requires_csrf_origin_and_known_action(self):
        self._register()
        url = "/api/auth/passkeys/reauthentication/options"
        payload = {"action": "change_username", "target": "Renamed_Player"}
        self.assertEqual(self.client.post(url, json=payload).status_code, 403)
        self.assertEqual(self.client.post(url, json=payload, headers={**self.csrf, "Origin": "https://evil.example.test"}).status_code, 403)
        self.assertEqual(self.client.post(url, json=payload, headers={**self.csrf, "Origin": ""}).status_code, 403)
        self.assertEqual(self.client.post(url, json={"action": "admin"}, headers=self.csrf).status_code, 422)
        self.assertEqual(self.client.post(url, json={"action": "change_username"}, headers=self.csrf).status_code, 400)
        proof = self._reauthentication()
        self.assertEqual(self._rename_with(proof, headers={}).status_code, 403)
        self.assertEqual(self._rename_with(proof, headers={**self.csrf, "Origin": "https://evil.example.test"}).status_code, 403)
        self.assertEqual(self._rename_with(proof, headers={**self.csrf, "Origin": ""}).status_code, 400)
        self.assertEqual(self._rename_with(proof).status_code, 200)

    def test_reauthentication_cannot_cross_product_origins_even_with_shared_login(self):
        self._register()
        proof = self._reauthentication(origin="https://zilch.example.test")
        response = self.client.post("https://zilch.example.test/api/auth/change-username", json={
            "username": "Renamed_Player", "passkey": proof,
        }, headers={**self.csrf, "Origin": "https://zilch.example.test"})
        self.assertEqual(response.status_code, 400, response.text)
        self.assertEqual(response.json()["detail"], "passkey_ceremony_invalid")

    @patch("app.auth_protection.LOGIN_MAX_FAILURES", 20)
    def test_reauthentication_rejects_wrong_signature_origin_rp_and_missing_user_verification(self):
        self._register()
        for arguments in ({"origin": "https://evil.example.test"}, {"origin": "https://zilch.example.test"},
                          {"rp_id": "evil.example.test"}, {"flags": 0x01}, {"flags": 0x04}, {"cross_origin": True}):
            with self.subTest(arguments=arguments):
                self.assertEqual(self._rename_with(self._reauthentication(**arguments)).status_code, 400)
        proof = self._reauthentication()
        proof["credential"]["response"]["signature"] = b64(b"tampered")
        self.assertEqual(self._rename_with(proof).status_code, 400)

    @patch("app.auth_protection.LOGIN_MAX_FAILURES", 1)
    def test_bad_passkey_proofs_are_rate_limited_for_every_account_action(self):
        self._register()
        email_env = {"ROLLTHEDICE_EMAIL_ENABLED": "1", "ROLLTHEDICE_RESEND_API_KEY": "test-key",
                     "ROLLTHEDICE_EMAIL_FROM": "konto@auth.example.test"}
        for action, target, url, fields in (
            ("change_username", "Renamed_Player", "/api/auth/change-username", {"username": "Renamed_Player"}),
            ("change_password", "", "/api/auth/change-password", {"new_password": "changed-password-123"}),
            ("change_email", "changed@example.test", "/api/auth/email", {"email": "changed@example.test"}),
            ("add_passkey", "", "/api/auth/passkeys/registration/options", {}),
        ):
            with self.subTest(action=action), patch.dict(os.environ, email_env):
                proof = self._reauthentication(action, target)
                proof["credential"]["response"]["signature"] = b64(b"tampered")
                response = self.client.post(url, json={**fields, "passkey": proof}, headers=self.csrf)
                self.assertEqual(response.status_code, 400, response.text)
                response = self.client.post(url, json={**fields, "passkey": proof}, headers=self.csrf)
                self.assertEqual(response.status_code, 429, response.text)

    def test_concurrent_assertion_replay_commits_only_one_mutation(self):
        self._register()
        proof = self._reauthentication()
        library = passkey_service._webauthn()
        verify = library["verify_authentication_response"]
        verified_together = Barrier(2)
        original_cookie = self.client.cookies.get("rollthedice_session")

        def verify_together(**kwargs):
            result = verify(**kwargs)
            verified_together.wait(timeout=5)
            return result

        def rename():
            with TestClient(self.client.app, base_url=ORIGIN, headers={"Origin": ORIGIN}) as client:
                client.cookies.set("rollthedice_session", original_cookie)
                return client.post("/api/auth/change-username", json={"username": "Renamed_Player", "passkey": proof}, headers=self.csrf)

        with patch("app.passkeys._webauthn", return_value={**library, "verify_authentication_response": verify_together}):
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(lambda _: rename(), range(2)))
        self.assertEqual(sorted(response.status_code for response in responses), [200, 400])
        with session_scope() as db:
            self.assertEqual(db.get(User, self.user.id).username, "Renamed_Player")
            self.assertEqual(db.scalar(select(PasskeyCredential)).sign_count, 1)

    def test_reauthentication_rejects_a_different_accounts_valid_passkey(self):
        self._register()
        original_authenticator = self.authenticator
        original_cookie = self.client.cookies.get("rollthedice_session")
        original_csrf = self.csrf
        other = create_user("Another_Passkey", PASSWORD, must_change_password=False)
        with session_scope() as db:
            identity, raw = issue_session_for_user(db, db.get(User, other.id))
        self.client.cookies.clear()
        self.client.cookies.set("rollthedice_session", raw)
        self.csrf = {"X-CSRF-Token": identity.csrf_token}
        self.authenticator = SoftwareAuthenticator()
        self._register()
        other_authenticator = self.authenticator
        self.client.cookies.clear()
        self.client.cookies.set("rollthedice_session", original_cookie)
        self.csrf = original_csrf
        self.authenticator = original_authenticator
        response = self.client.post("/api/auth/passkeys/reauthentication/options", json={
            "action": "change_username", "target": "Renamed_Player",
        }, headers=self.csrf)
        options = response.json()["options"]
        self.assertEqual([item["id"] for item in options["allowCredentials"]], [b64(original_authenticator.credential_id)])
        proof = {"token": response.json()["token"], "credential": other_authenticator.authentication(options)}
        self.assertEqual(self._rename_with(proof).status_code, 400)
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["id"], self.user.id)

    def test_reauthentication_rejects_expiry_and_a_different_session_for_the_same_account(self):
        self._register()
        proof = self._reauthentication()
        with session_scope() as db:
            other_identity, raw = issue_session_for_user(db, db.get(User, self.user.id))
        headers = {"X-CSRF-Token": other_identity.csrf_token, "Cookie": f"rollthedice_session={raw}"}
        self.assertEqual(self._rename_with(proof, headers=headers).status_code, 400)
        with session_scope() as db:
            db.execute(update(WebAuthnCeremony).where(WebAuthnCeremony.purpose == "reauthentication").values(expires_at=utcnow() - timedelta(seconds=1)))
        self.assertEqual(self._rename_with(proof).status_code, 400)

    def test_in_flight_reauthentication_rejects_session_revocation_and_reused_session_id(self):
        self._register()
        proof = self._reauthentication()
        library = passkey_service._webauthn()
        verify = library["verify_authentication_response"]

        def revoke_after_verification(**kwargs):
            verified = verify(**kwargs)
            with session_scope() as db:
                db.execute(delete(LoginSession).where(LoginSession.id == self.identity.session_id))
                replacement, _ = issue_session_for_user(db, db.get(User, self.user.id))
                self.assertEqual(replacement.session_id, self.identity.session_id)
            return verified

        with patch("app.passkeys._webauthn", return_value={**library, "verify_authentication_response": revoke_after_verification}):
            response = self._rename_with(proof)
        self.assertIn(response.status_code, (400, 401), response.text)
        with session_scope() as db:
            self.assertEqual(db.get(User, self.user.id).username, "Passkey_User")
            self.assertEqual(db.scalar(select(PasskeyCredential)).sign_count, 0)

    def test_in_flight_reauthentication_rejects_a_revoked_or_replaced_passkey(self):
        registered = self._register()
        proof = self._reauthentication()
        library = passkey_service._webauthn()
        verify = library["verify_authentication_response"]
        replacement_id = os.urandom(32)

        def replace_after_verification(**kwargs):
            verified = verify(**kwargs)
            with session_scope() as db:
                db.execute(delete(PasskeyCredential).where(PasskeyCredential.id == registered["id"]))
                db.add(PasskeyCredential(id=registered["id"], user_id=self.user.id, credential_id=replacement_id,
                                        credential_public_key=self.authenticator.cose, sign_count=0, created_at=utcnow()))
            return verified

        with patch("app.passkeys._webauthn", return_value={**library, "verify_authentication_response": replace_after_verification}):
            response = self._rename_with(proof)
        self.assertEqual(response.status_code, 400, response.text)
        with session_scope() as db:
            self.assertEqual(db.get(User, self.user.id).username, "Passkey_User")
            self.assertEqual(db.get(PasskeyCredential, registered["id"]).credential_id, replacement_id)
            self.assertIsNone(db.get(PasskeyCredential, registered["id"]).last_used_at)

    def test_in_flight_reauthentication_rejects_password_change_or_deactivation(self):
        self._register()
        library = passkey_service._webauthn()
        verify = library["verify_authentication_response"]
        for values in ({"password_hash": hash_password("changed-underneath-proof")}, {"is_active": False}):
            with self.subTest(values=tuple(values)):
                proof = self._reauthentication()

                def change_after_verification(**kwargs):
                    verified = verify(**kwargs)
                    with session_scope() as db:
                        db.execute(update(User).where(User.id == self.user.id).values(**values))
                    return verified

                with patch("app.passkeys._webauthn", return_value={**library, "verify_authentication_response": change_after_verification}):
                    self.assertEqual(self._rename_with(proof).status_code, 400)
                with session_scope() as db:
                    user = db.get(User, self.user.id)
                    self.assertEqual(user.username, "Passkey_User")
                    user.is_active = True

    def test_new_registration_cannot_outlive_its_authorizing_passkey(self):
        registered = self._register()
        proof = self._reauthentication("add_passkey", "")
        response = self.client.post("/api/auth/passkeys/registration/options", json={"passkey": proof}, headers=self.csrf)
        self.assertEqual(response.status_code, 200, response.text)
        credential = SoftwareAuthenticator().registration(response.json()["options"])
        response = self.client.request("DELETE", f"/api/auth/passkeys/{registered['id']}", json={"current_password": PASSWORD}, headers=self.csrf)
        self.assertEqual(response.status_code, 200)
        response = self.client.post("/api/auth/passkeys/registration/verify", json={"credential": credential}, headers=self.csrf)
        self.assertEqual(response.status_code, 400)
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(PasskeyCredential))), [])

    def test_password_fallback_cannot_mutate_after_session_revocation(self):
        from app import auth

        verify = auth.verify_password

        def revoke_after_password(*args):
            valid = verify(*args)
            with session_scope() as db:
                db.execute(delete(LoginSession).where(LoginSession.id == self.identity.session_id))
            return valid

        with patch("app.auth.verify_password", side_effect=revoke_after_password):
            response = self.client.post("/api/auth/change-username", json={"username": "Renamed_Player", "current_password": PASSWORD}, headers=self.csrf)
        self.assertEqual(response.status_code, 401, response.text)
        with session_scope() as db:
            self.assertEqual(db.get(User, self.user.id).username, "Passkey_User")

    def test_confirmation_requires_exactly_one_method_and_no_passkey_bypass(self):
        self._register()
        proof = self._reauthentication()
        for confirmation in ({}, {"current_password": PASSWORD, "passkey": proof}):
            with self.subTest(fields=tuple(confirmation)):
                response = self.client.post("/api/auth/change-username", json={"username": "Renamed_Player", **confirmation}, headers=self.csrf)
                self.assertEqual(response.status_code, 422)
        with patch.dict(os.environ, {"ROLLTHEDICE_PASSKEYS_ENABLED": "0"}):
            self.assertEqual(self._rename_with(proof).status_code, 503)
        with session_scope() as db:
            self.assertEqual(db.get(User, self.user.id).username, "Passkey_User")
