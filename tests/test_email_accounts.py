"""Regression coverage for the opt-in transactional account-email flow."""

from __future__ import annotations

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from pathlib import Path
from threading import Barrier, Event
from unittest import TestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, Response
from sqlalchemy import select
from starlette.testclient import TestClient

from app import auth as auth_service
from app import main
from app.api_auth import PasswordResetRequest, auth_password_reset_request, router
from app.auth import create_user, login, resolve_session
from app.auth_protection import enforce_email_request_rate_limit
from app.database import configure_database, session_scope, upgrade_database
from app.email_accounts import (
    account_email_status,
    begin_email_verification,
    begin_password_reset,
    begin_registration,
    complete_password_reset,
    complete_registration,
    confirm_email,
    inspect_account_email_token,
    inspect_registration,
)
from app.email_delivery import (
    EmailDeliveryFailed,
    EmailDeliveryUnavailable,
    send_account_email,
    validate_account_email_config,
)
from app.models import AccountEmailToken, PasskeyCredential, PendingEmailRegistration, User
from app.models import Session as LoginSession
from app.security import hash_session_token, utcnow, validate_email_address


def request_for(*, cookie: str = "") -> Request:
    headers = [(b"host", b"testserver")]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "POST",
            "scheme": "http",
            "path": "/api/auth/test",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


def action_token(call) -> str:
    action_url = str(call.kwargs["action_url"])
    return parse_qs(urlsplit(action_url).fragment).get("token", [""])[0]


class EmailAccountsTestCase(TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "email-accounts.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_EMAIL_ENABLED": "1",
                "ROLLTHEDICE_RESEND_API_KEY": "test-key",
                "ROLLTHEDICE_EMAIL_FROM": "konto@auth.example.test",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_PASSKEYS_ENABLED": "0",
                "ROLLTHEDICE_COOKIE_DOMAIN": "",
            },
            clear=False,
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)
        api = FastAPI()
        api.include_router(router)
        self.client = TestClient(api)

    def tearDown(self) -> None:
        self.client.close()
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    def test_registration_only_creates_a_confirmed_account_after_link_and_password(self) -> None:
        with patch("app.email_accounts.send_account_email") as send:
            self.assertEqual(
                begin_registration(username="Anna", email="Anna@Example.Test", preferred_language="en"),
                {"accepted": True},
            )
            raw_token = action_token(send.call_args)
            self.assertTrue(raw_token)
            with session_scope() as db:
                self.assertIsNone(db.scalar(select(User).where(User.username_normalized == "anna")))
                pending = db.scalar(select(PendingEmailRegistration))
                self.assertIsNotNone(pending)
                assert pending is not None
                self.assertNotEqual(pending.token_hash, raw_token)

            identity, session_token = complete_registration(raw_token=raw_token, password="a-secure-password-123")

        self.assertEqual(identity.username, "Anna")
        self.assertTrue(session_token)
        with session_scope() as db:
            user = db.scalar(select(User).where(User.username_normalized == "anna"))
            self.assertIsNotNone(user)
            assert user is not None
            self.assertEqual(user.email_normalized, "anna@example.test")
            self.assertIsNotNone(user.email_confirmed_at)
        email_identity, _ = login(request_for(), "ANNA@example.test", "a-secure-password-123")
        self.assertEqual(email_identity.user_id, identity.user_id)

    def test_email_change_keeps_old_address_until_the_new_one_is_confirmed(self) -> None:
        with patch("app.email_accounts.send_account_email") as send:
            begin_registration(username="Berta", email="berta@example.test", preferred_language="de")
            identity, _ = complete_registration(
                raw_token=action_token(send.call_args), password="a-secure-password-123"
            )
            send.reset_mock()
            result = begin_email_verification(
                identity=identity,
                email="new-address@example.test",
                current_password="a-secure-password-123",
            )
            self.assertEqual(result, {"accepted": True, "already_confirmed": False})
            token = action_token(send.call_args)
            before = account_email_status(identity.user_id)
            self.assertEqual(before["email"], "b***@example.test")
            self.assertEqual(before["pending_email"], "n***@example.test")
            confirm_email(raw_token=token)

        with session_scope() as db:
            user = db.get(User, identity.user_id)
            assert user is not None
            self.assertEqual(user.email_normalized, "new-address@example.test")
            self.assertIsNotNone(user.email_confirmed_at)
            consumed = db.scalar(select(AccountEmailToken).where(AccountEmailToken.token_hash == hash_session_token(token)))
            self.assertIsNotNone(consumed)
            assert consumed is not None
            self.assertIsNotNone(consumed.consumed_at)

    def test_password_reset_is_generic_and_invalidates_all_sessions(self) -> None:
        with patch("app.email_accounts.send_account_email") as send:
            begin_registration(username="Cleo", email="cleo@example.test", preferred_language="de")
            identity, first_session = complete_registration(
                raw_token=action_token(send.call_args), password="first-secure-password"
            )
            _, second_session = login(request_for(), "Cleo", "first-secure-password")
            send.reset_mock()
            self.assertEqual(begin_password_reset(email="missing@example.test", preferred_language="de"), {"accepted": True})
            send.assert_not_called()
            self.assertEqual(begin_password_reset(email="cleo@example.test", preferred_language="de"), {"accepted": True})
            reset_token = action_token(send.call_args)
            complete_password_reset(raw_token=reset_token, password="second-secure-password")

        self.assertIsNone(resolve_session(request_for(cookie=f"rollthedice_session={first_session}")))
        self.assertIsNone(resolve_session(request_for(cookie=f"rollthedice_session={second_session}")))
        new_identity, _ = login(request_for(), "cleo@example.test", "second-secure-password")
        self.assertEqual(new_identity.user_id, identity.user_id)

    def test_disabled_delivery_creates_no_pending_registration_state(self) -> None:
        with patch.dict(os.environ, {"ROLLTHEDICE_EMAIL_ENABLED": "0"}):
            with self.assertRaises(EmailDeliveryUnavailable):
                begin_registration(username="Dora", email="dora@example.test", preferred_language="de")
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(PendingEmailRegistration))), [])

    def registered(self, name="Owner", email="owner@example.test"):
        return create_user(name, "first-secure-password", must_change_password=False, email=email, email_confirmed=True)

    def test_unconfirmed_requests_cannot_reserve_another_persons_name_or_mailbox(self) -> None:
        with patch("app.email_accounts.send_account_email") as send:
            begin_registration(username="Wanted", email="attacker@example.test", preferred_language="de")
            begin_registration(username="Unwanted", email="owner@example.test", preferred_language="de")
            begin_registration(username="Wanted", email="owner@example.test", preferred_language="de")
            owner_token = action_token(send.call_args)
            owner, _ = complete_registration(raw_token=owner_token, password="first-secure-password")
        self.assertEqual(owner.username, "Wanted")
        with session_scope() as db:
            self.assertEqual(db.get(User, owner.user_id).email_normalized, "owner@example.test")

    def test_resending_registration_and_reset_keeps_existing_links_usable(self) -> None:
        with patch("app.email_accounts.send_account_email") as send:
            begin_registration(username="Retry", email="retry@example.test", preferred_language="en")
            registration_token = action_token(send.call_args)
            self.assertEqual(urlsplit(send.call_args.kwargs["action_url"]).query, "lang=en")
            begin_registration(username="Retry", email="retry@example.test", preferred_language="en")
            complete_registration(raw_token=registration_token, password="first-secure-password")
            begin_password_reset(email="retry@example.test", preferred_language="en")
            reset_token = action_token(send.call_args)
            begin_password_reset(email="retry@example.test", preferred_language="en")
            complete_password_reset(raw_token=reset_token, password="second-secure-password")

    def test_inspection_does_not_consume_links_and_rejects_expiry_or_wrong_purpose(self) -> None:
        self.registered()
        with patch("app.email_accounts.send_account_email") as send:
            begin_password_reset(email="owner@example.test", preferred_language="de")
            token = action_token(send.call_args)
        for _ in range(2):
            self.assertEqual(inspect_account_email_token(raw_token=token, purpose="password_reset"), {"valid": True})
        self.assertEqual(inspect_account_email_token(raw_token=token, purpose="email_verify"), {"valid": False})
        with session_scope() as db:
            db.scalar(select(AccountEmailToken)).expires_at = utcnow() - timedelta(seconds=1)
        self.assertEqual(inspect_account_email_token(raw_token=token, purpose="password_reset"), {"valid": False})
        with self.assertRaisesRegex(ValueError, "password_reset_token_invalid"):
            complete_password_reset(raw_token=token, password="second-secure-password")

    def test_concurrent_registration_confirmation_creates_only_one_session(self) -> None:
        with patch("app.email_accounts.send_account_email") as send:
            begin_registration(username="Concurrent", email="concurrent@example.test", preferred_language="de")
            token = action_token(send.call_args)
        barrier = Barrier(2)

        def confirm():
            barrier.wait(timeout=5)
            try:
                complete_registration(raw_token=token, password="first-secure-password")
                return "ok"
            except ValueError as error:
                return str(error)

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(lambda _: confirm(), range(2)))
        self.assertCountEqual(outcomes, ["ok", "registration_token_invalid"])
        self.assertEqual(inspect_registration(token), {"valid": False})

    def test_concurrent_password_reset_consumes_link_only_once(self) -> None:
        self.registered()
        with patch("app.email_accounts.send_account_email") as send:
            begin_password_reset(email="owner@example.test", preferred_language="de")
            token = action_token(send.call_args)
            barrier = Barrier(2)

            def reset():
                barrier.wait(timeout=5)
                try:
                    complete_password_reset(raw_token=token, password="second-secure-password")
                    return "ok"
                except ValueError as error:
                    return str(error)

            with ThreadPoolExecutor(max_workers=2) as pool:
                outcomes = list(pool.map(lambda _: reset(), range(2)))
        self.assertCountEqual(outcomes, ["ok", "password_reset_token_invalid"])

    def test_confirming_new_email_invalidates_old_mailbox_reset_links(self) -> None:
        self.registered()
        identity, _ = login(request_for(), "Owner", "first-secure-password")
        with patch("app.email_accounts.send_account_email") as send:
            begin_password_reset(email="owner@example.test", preferred_language="de")
            reset_token = action_token(send.call_args)
            begin_email_verification(identity=identity, email="new@example.test", current_password="first-secure-password")
            verify_token = action_token(send.call_args)
            confirm_email(raw_token=verify_token)
            with self.assertRaisesRegex(ValueError, "password_reset_token_invalid"):
                complete_password_reset(raw_token=reset_token, password="second-secure-password")
            with self.assertRaisesRegex(ValueError, "email_verification_token_invalid"):
                confirm_email(raw_token=verify_token)

    def test_recovery_removes_intruder_passkeys_and_pending_email_changes(self) -> None:
        owner = self.registered()
        identity, _ = login(request_for(), "Owner", "first-secure-password")
        with session_scope() as db:
            db.add(PasskeyCredential(
                user_id=owner.id, credential_id=b"credential", credential_public_key=b"public-key",
                sign_count=0, label="Old device", created_at=utcnow(),
            ))
        with patch("app.email_accounts.send_account_email") as send:
            begin_email_verification(identity=identity, email="intruder@example.test", current_password="first-secure-password")
            verify_token = action_token(send.call_args)
            begin_password_reset(email="owner@example.test", preferred_language="de")
            complete_password_reset(raw_token=action_token(send.call_args), password="second-secure-password")
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(PasskeyCredential))), [])
            self.assertEqual(list(db.scalars(select(AccountEmailToken))), [])
        self.assertEqual(inspect_account_email_token(raw_token=verify_token, purpose="email_verify"), {"valid": False})

    def test_http_legacy_registration_still_works_when_email_feature_is_disabled(self) -> None:
        with patch.dict(os.environ, {"ROLLTHEDICE_EMAIL_ENABLED": "0"}), patch("app.email_delivery.send_account_email") as send:
            response = self.client.post("/api/auth/register", json={"username": "Legacy", "password": "first-secure-password"})
        self.assertEqual(response.status_code, 201, response.text)
        self.assertTrue(response.json()["authenticated"])
        self.assertIn("rollthedice_session", response.cookies)
        send.assert_not_called()

    def test_http_enabled_registration_requires_email_and_never_directly_logs_in(self) -> None:
        with patch("app.email_delivery.send_account_email") as send:
            response = self.client.post("/api/auth/register", json={"username": "NewUser", "email": "new@example.test", "password": "ignored-password"})
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(response.json(), {"accepted": True})
        self.assertNotIn("rollthedice_session", response.cookies)
        send.assert_called_once()
        token = action_token(send.call_args)
        response = self.client.post("/api/auth/registration/complete", json={"token": token, "password": "chosen-secure-password"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["authenticated"])
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_http_registration_does_not_disclose_whether_email_already_owns_an_account(self) -> None:
        self.registered()
        with patch("app.email_delivery.send_account_email") as send:
            response = self.client.post("/api/auth/register", json={"username": "AnotherName", "email": "owner@example.test"})
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json(), {"accepted": True})
        send.assert_not_called()

    def test_http_password_only_registration_cannot_bypass_enabled_confirmation(self) -> None:
        response = self.client.post("/api/auth/register", json={"username": "Bypass", "password": "first-secure-password"})
        self.assertEqual(response.status_code, 422)
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(User))), [])

    def test_http_disabled_feature_rejects_every_token_action(self) -> None:
        endpoints = ["registration/inspect", "registration/complete", "email/inspect", "email/confirm", "password-reset/inspect", "password-reset/complete"]
        with patch.dict(os.environ, {"ROLLTHEDICE_EMAIL_ENABLED": "0"}):
            for endpoint in endpoints:
                with self.subTest(endpoint=endpoint):
                    response = self.client.post(f"/api/auth/{endpoint}", json={"token": "x" * 43, "password": "secure-new-password"})
                    self.assertEqual(response.status_code, 503)

    def test_http_rejects_cross_origin_token_actions_and_missing_csrf_for_email_change(self) -> None:
        owner = self.registered()
        _, raw_session = login(request_for(), owner.username, "first-secure-password")
        self.client.cookies.set("rollthedice_session", raw_session)
        response = self.client.post("/api/auth/email", json={"email": "new@example.test", "current_password": "first-secure-password"})
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/auth/email/confirm", headers={"Origin": "https://evil.example"}, json={"token": "x" * 43})
        self.assertEqual(response.status_code, 403)

    def test_http_login_accepts_confirmed_email_longer_than_64_characters(self) -> None:
        address = f"{'a' * 64}@example.test"
        owner = self.registered(email=address)
        response = self.client.post("/api/auth/login", json={"username": address, "password": "first-secure-password"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["user"]["id"], owner.id)

    def test_reset_lookup_and_delivery_are_deferred_until_after_http_response(self) -> None:
        for email in ["owner@example.test", "missing@example.test"]:
            tasks = BackgroundTasks()
            with patch("app.api_auth.begin_password_reset") as reset:
                result = auth_password_reset_request(PasswordResetRequest(email=email), request_for(), Response(), tasks)
                self.assertEqual(result, {"accepted": True})
                reset.assert_not_called()
            self.assertEqual(len(tasks.tasks), 1)
            self.assertEqual(tasks.tasks[0].kwargs["email"], email)

    def test_email_request_rate_limit_applies_to_unknown_mailboxes_too(self) -> None:
        with patch("app.api_auth.begin_password_reset"):
            statuses = [self.client.post("/api/auth/password-reset", json={"email": f"missing{index}@example.test"}).status_code for index in range(4)]
        self.assertEqual(statuses, [202, 202, 202, 429])

    def test_parallel_email_requests_cannot_overrun_the_shared_limit(self) -> None:
        barrier = Barrier(6)

        def reserve(_):
            barrier.wait(timeout=5)
            try:
                enforce_email_request_rate_limit(request_for(), "password_reset", "owner@example.test")
                return 202
            except HTTPException as error:
                return error.status_code

        with ThreadPoolExecutor(max_workers=6) as pool:
            statuses = list(pool.map(reserve, range(6)))
        self.assertCountEqual(statuses, [202, 202, 202, 429, 429, 429])

    def test_password_recovery_cannot_be_undone_by_an_in_flight_old_password_login(self) -> None:
        self.registered()
        with patch("app.email_accounts.send_account_email") as send:
            begin_password_reset(email="owner@example.test", preferred_language="de")
            token = action_token(send.call_args)
            verified = Event()
            finish_login = Event()
            original_verify = auth_service.verify_password

            def pause_after_verification(*args):
                result = original_verify(*args)
                verified.set()
                if not finish_login.wait(timeout=10):
                    raise AssertionError("Recovery did not finish")
                return result

            with patch("app.auth.verify_password", side_effect=pause_after_verification), ThreadPoolExecutor(max_workers=1) as pool:
                attempt = pool.submit(login, request_for(), "Owner", "first-secure-password")
                self.assertTrue(verified.wait(timeout=10))
                try:
                    complete_password_reset(raw_token=token, password="second-secure-password")
                finally:
                    finish_login.set()
                with self.assertRaises(HTTPException) as rejected:
                    attempt.result(timeout=10)
                self.assertEqual(rejected.exception.status_code, 401)
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(LoginSession))), [])

    def test_email_validation_rejects_header_injection_and_unsupported_mailboxes(self) -> None:
        for address in ["a@example.test\r\nBcc: victim@example.test", "a..b@example.test", ".a@example.test", 'a"b@example.test', "a\x01b@example.test"]:
            with self.subTest(address=address), self.assertRaises(ValueError):
                validate_email_address(address)

    def test_enabled_email_config_rejects_insecure_remote_action_links(self) -> None:
        with patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": "http://example.test"}):
            with self.assertRaisesRegex(RuntimeError, "HTTPS"):
                validate_account_email_config()

    def test_provider_failure_never_reveals_existing_mailbox(self) -> None:
        self.registered()
        with patch("app.email_accounts.send_account_email", side_effect=EmailDeliveryFailed("unavailable")):
            self.assertEqual(begin_password_reset(email="owner@example.test", preferred_language="de"), {"accepted": True})

    def test_provider_retry_uses_one_idempotency_key_and_fixed_destination(self) -> None:
        with patch("app.email_delivery.urlopen", side_effect=TimeoutError) as send:
            with self.assertRaises(EmailDeliveryFailed):
                send_account_email(recipient="owner@example.test", kind="password_reset", language="de", action_url="https://example.test/#token=test", idempotency_key="retry-key")
        self.assertEqual(send.call_count, 2)
        for call in send.call_args_list:
            request = call.args[0]
            self.assertEqual(request.full_url, "https://api.resend.com/emails")
            self.assertEqual(request.get_header("Idempotency-key"), "retry-key")
