"""Local native account and mailed recovery journeys, never real recipients."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.account_context import account_action_url, account_app_context
from app.auth import create_user
from app.database import configure_database, upgrade_database
from app.product_hosts import WATTEN_ORIGIN, safe_watten_account_path
from app.watten_readiness import watten_account_preview_enabled
from tests.test_user_accounts import request_for

LOCAL = "http://rollthedice.localhost:8057"


class WattenAccountsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/accounts.sqlite3",
            "ROLLTHEDICE_SITE_ORIGIN": LOCAL, "ROLLTHEDICE_ZILCH_ORIGIN": "http://zilch.rollthedice.localhost:8057",
            "ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "1", "ROLLTHEDICE_COOKIE_DOMAIN": "",
            "ROLLTHEDICE_COOKIE_SECURE": "0", "ROLLTHEDICE_PASSKEYS_ENABLED": "0",
            "ROLLTHEDICE_EMAIL_ENABLED": "1", "ROLLTHEDICE_RESEND_API_KEY": "test-only",
            "ROLLTHEDICE_EMAIL_FROM": "account@example.test", "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
            "ROLLTHEDICE_TURNSTILE_SECRET": "",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.client = TestClient(main.app, base_url=LOCAL, follow_redirects=False)
        self.mail_patch = patch("app.email_delivery.send_account_email")
        self.mail = self.mail_patch.start()
        self.direct_patch = patch("app.email_accounts.send_account_email", self.mail)
        self.direct_patch.start()

    def tearDown(self):
        self.client.close()
        self.direct_patch.stop()
        self.mail_patch.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def post(self, path, data, csrf=None):
        return self.client.post(path, json=data, headers={"Origin": LOCAL,
                                **({"X-CSRF-Token": csrf} if csrf else {})})

    def mailed_action(self):
        target = urlsplit(self.mail.call_args.kwargs["action_url"])
        self.assertEqual(f"{target.scheme}://{target.netloc}", LOCAL)
        self.assertEqual(parse_qs(target.query)["app"], ["watten"])
        self.assertNotIn("token", parse_qs(target.query))
        return target, parse_qs(target.fragment)["token"][0]

    def signup(self, username="WattenEmail", email="watten@example.test"):
        response = self.post("/api/auth/register", {"username": username, "email": email,
                             "account_app": "watten", "return_to": "/watten/konto/einstellungen"})
        self.assertEqual(response.status_code, 202, response.text)
        target, token = self.mailed_action()
        self.assertEqual(target.path, "/registrierung/bestaetigen")
        completed = self.post("/api/auth/registration/complete", {"token": token, "password": "first-password-123"})
        self.assertEqual(completed.status_code, 200, completed.text)
        return completed.json()["user"]

    def test_native_routes_protect_settings_and_keep_static_templates_private(self):
        for path in ("/watten", "/watten/anmelden"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn('data-game="watten"', response.text)
            self.assertIn('noindex', response.headers["x-robots-tag"])
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("/static/shell.js", response.text)
            self.assertNotIn('rel="manifest"', response.text)
        for path in ("/watten/konto", "/watten/konto/einstellungen"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen")
        self.signup()
        self.assertEqual(self.client.get("/watten/konto/einstellungen").status_code, 200)
        self.assertEqual(self.client.get("/watten/konto").headers["location"], "/watten/konto/einstellungen")
        for path in ("/static/watten-account.html", "/static/watten-email-action.html", "/static//watten-account.html"):
            self.assertEqual(self.client.get(path).status_code, 404)
        for path in ("/watten/regeln", "/watten/spiel/one", "/watten/unknown"):
            self.assertEqual(self.client.get(path).status_code, 503)
        with self.assertRaises(WebSocketDisconnect) as rejected:
            with self.client.websocket_connect(LOCAL.replace("http:", "ws:") + "/watten/konto"):
                self.fail("The local account preview has no WebSockets")
        self.assertEqual(rejected.exception.code, 1008)

    def test_opt_in_is_local_only_for_both_configuration_and_request_host(self):
        for origin in ("http://localhost:8057", "http://a.localhost:8057", "http://127.0.0.1:8057", "http://[::1]:8057"):
            with self.subTest(origin=origin), patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": origin}):
                self.assertTrue(watten_account_preview_enabled())
                # TestClient cannot parse an IPv6 URL authority; the real Host
                # still exercises HTTPConnection's IPv6 product validation.
                self.assertEqual(self.client.get("/watten", headers={"Host": urlsplit(origin).netloc}).status_code, 200)
        for origin in ("https://zockdiewandan.online", "http://localhost.evil.test", "http://a.localhost.evil.test",
                       "http://192.168.1.1", "http://127.0.0.1.evil.test"):
            with self.subTest(origin=origin), patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": origin}):
                self.assertFalse(watten_account_preview_enabled())
                self.assertEqual(self.client.get("/watten").status_code, 503)
                with self.assertRaises(RuntimeError):
                    account_action_url("/passwort-zuruecksetzen", "local-token", "de", app="watten")
        for origin in (WATTEN_ORIGIN, "https://zockdiewandan.online", "https://evil.invalid"):
            self.assertEqual(self.client.get(origin + "/watten").status_code, 503)
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "0"}):
            self.assertEqual(self.client.get("/watten").status_code, 503)
            for path in ("/api/auth/register", "/api/auth/password-reset"):
                response = self.post(path, {"username": "ClosedWatten", "email": "closed@example.test",
                                     "password": "test-password-123", "account_app": "watten"})
                self.assertEqual(response.status_code, 503)
            with self.assertRaises(HTTPException):
                account_app_context(request_for(host="rollthedice.localhost:8057"), "watten")
        self.mail.assert_not_called()

    def test_production_host_remains_closed_with_local_opt_in(self):
        for path in ("/watten", "/watten/anmelden", "/api/auth/me", "/registrierung/bestaetigen?app=watten"):
            self.assertEqual(self.client.get(WATTEN_ORIGIN + path).status_code, 503)
        with self.assertRaises(HTTPException):
            account_app_context(request_for(host="watten.zockdiewandan.online"), "watten")

    def test_registration_reset_and_other_suite_login_keep_one_shared_account(self):
        user = self.signup()
        self.assertEqual(self.client.get("/api/auth/me").json()["user"]["id"], user["id"])
        response = self.post("/api/auth/password-reset", {"email": "watten@example.test", "account_app": "watten",
                             "return_to": "//evil.invalid/steal"})
        self.assertEqual(response.status_code, 202)
        target, token = self.mailed_action()
        self.assertEqual(target.path, "/passwort-zuruecksetzen")
        mailed_page = self.client.get(target.geturl())
        self.assertEqual(mailed_page.status_code, 200)
        self.assertIn('data-email-action="reset"', mailed_page.text)
        self.assertEqual(parse_qs(target.query)["return_to"], ["/watten"])
        reset = self.post("/api/auth/password-reset/complete", {"token": token, "password": "second-password-123"})
        self.assertEqual(reset.status_code, 200)
        self.assertFalse(self.client.get("/api/auth/me").json()["authenticated"])
        self.assertEqual(self.post("/api/auth/password-reset/complete", {"token": token, "password": "third-password-123"}).status_code, 400)
        logged = self.post("/api/auth/login", {"username": "WattenEmail", "password": "second-password-123"})
        self.assertEqual(logged.json()["user"]["id"], user["id"])

    def test_email_settings_require_current_account_proof_and_keep_watten_recovery_context(self):
        create_user("WattenSettings", "test-password-123", must_change_password=False)
        user = self.post("/api/auth/login", {"username": "WattenSettings", "password": "test-password-123"}).json()["user"]
        payload = {"email": "settings@example.test", "current_password": "test-password-123", "account_app": "watten"}
        self.assertEqual(self.post("/api/auth/email", payload).status_code, 403)
        self.assertEqual(self.post("/api/auth/email", {**payload, "current_password": "wrong-password"}, user["csrf_token"]).status_code, 400)
        self.mail.assert_not_called()
        self.assertEqual(self.post("/api/auth/email", payload, user["csrf_token"]).status_code, 202)
        target, token = self.mailed_action()
        self.assertEqual(parse_qs(target.query)["return_to"], ["/watten/konto/einstellungen"])
        self.assertEqual(self.post("/api/auth/email/confirm", {"token": token}).status_code, 200)
        self.assertTrue(self.client.get("/api/auth/email").json()["email_confirmed"])

    def test_recovery_pages_and_invalid_links_stay_in_local_watten(self):
        for path in ("/registrierung/bestaetigen", "/passwort-vergessen", "/passwort-zuruecksetzen", "/email-bestaetigen"):
            response = self.client.get(path + "?app=watten&return_to=%2Fwatten%2Fkonto%2Feinstellungen")
            self.assertEqual(response.status_code, 200)
            self.assertIn('data-game="watten"', response.text)
            self.assertIn("/static/email-action.js", response.text)
            self.assertNotIn("/static/shell.js", response.text)
            self.assertEqual(response.headers["referrer-policy"], "no-referrer")
        for query in ("app=watten&app=zdwa", "app=zdwa&app=watten", "app=watten&return_to=/watten&return_to=//evil.invalid"):
            self.assertEqual(self.client.get("/passwort-vergessen?" + query).status_code, 400)
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "0"}):
            self.assertEqual(self.client.get("/passwort-vergessen?app=watten").status_code, 503)

    def test_return_paths_reject_foreign_games_queries_duplicates_and_nested_handoffs(self):
        for candidate in ("https://evil.invalid/", "//evil.invalid/", "/watten/spiel/one", "/watten/anmelden",
                          "/watten/../konto", "/watten%2fkonto", "/watten/konto?return_to=//evil.invalid",
                          "/auth/continue?app=watten&path=/watten", "/hausdepp/konto", "/watten#token=secret"):
            self.assertEqual(safe_watten_account_path(candidate), "/watten")
            response = self.client.get("/watten/anmelden", params={"return_to": candidate})
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/watten/anmelden?return_to=%2Fwatten")
        self.assertEqual(self.client.get("/watten/anmelden?return_to=/watten&return_to=/watten/konto").status_code, 303)
        for candidate in ("/watten", "/watten/konto", "/watten/konto/einstellungen"):
            self.assertEqual(safe_watten_account_path(candidate), candidate)


if __name__ == "__main__":
    unittest.main()
