"""Browser-cookie rotation across real sibling-host cookie scopes."""

from __future__ import annotations

import os
import tempfile
import time
from http.cookies import SimpleCookie
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.websockets import WebSocket

from app import main
from app.api_auth import router
from app.auth import (
    LEGACY_SESSION_COOKIE,
    SESSION_DAYS,
    SHARED_SESSION_COOKIE,
    create_user,
    resolve_session,
    session_token_from_connection,
)
from app.database import configure_database, upgrade_database

DOMAIN = "session-suite.test"
HOST_A = f"https://hausdepp.{DOMAIN}"
HOST_B = f"https://zilch.{DOMAIN}"
HOST_C = f"https://watten.{DOMAIN}"
HOST_D = f"https://{DOMAIN}"
HOSTS = (HOST_A, HOST_B, HOST_C, HOST_D)
PASSWORD = "local-session-rotation-password"


class CrossHostSessionRotationTests(TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.environment = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temporary.name}/sessions.sqlite3",
            "ROLLTHEDICE_SITE_ORIGIN": f"https://{DOMAIN}",
            "ROLLTHEDICE_ZILCH_ORIGIN": HOST_B,
            "ROLLTHEDICE_COOKIE_DOMAIN": DOMAIN,
            "ROLLTHEDICE_COOKIE_SECURE": "1",
            "ROLLTHEDICE_PASSKEYS_ENABLED": "0",
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
            "ROLLTHEDICE_TURNSTILE_SECRET": "",
        })
        self.environment.start()
        configure_database(Path(self.temporary.name))
        upgrade_database(main.BASE)
        self.alice = create_user("RotationAlice", PASSWORD, must_change_password=False)
        self.bob = create_user("RotationBob", PASSWORD, must_change_password=False)
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app, base_url=HOST_A)
        self.other_browser = TestClient(app, base_url=HOST_A)

    def tearDown(self):
        self.client.close()
        self.other_browser.close()
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary.cleanup()

    def login(self, client, host, username):
        response = client.post(f"{host}/api/auth/login", headers={"Origin": host},
                               json={"username": username, "password": PASSWORD})
        self.assertEqual(response.status_code, 200)
        return response.json()

    def me(self, client, host):
        response = client.get(f"{host}/api/auth/me")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def logout(self, client, host, identity):
        response = client.post(f"{host}/api/auth/logout", headers={
            "Origin": host, "X-CSRF-Token": identity["user"]["csrf_token"],
        })
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["authenticated"])
        return response

    def assert_shared_marker(self, response):
        headers = [header for header in response.headers.get_list("set-cookie")
                   if header.startswith(f"{SHARED_SESSION_COOKIE}=")]
        self.assertEqual(len(headers), 1)
        marker = SimpleCookie(headers[0])[SHARED_SESSION_COOKIE]
        self.assertEqual(marker.value, "")
        self.assertEqual(marker["max-age"], str(SESSION_DAYS * 24 * 60 * 60))
        self.assertEqual(marker["domain"], DOMAIN)
        self.assertEqual(marker["path"], "/")
        self.assertTrue(marker["secure"])
        self.assertTrue(marker["httponly"])
        self.assertEqual(marker["samesite"], "lax")
        self.assertNotIn("Max-Age=0", headers[0])

    def legacy_cookie(self, host):
        hostname = host.removeprefix("https://")
        cookies = [cookie for cookie in self.client.cookies.jar
                   if cookie.name == LEGACY_SESSION_COOKIE and cookie.domain == hostname]
        self.assertEqual(len(cookies), 1)
        self.assertFalse(cookies[0].domain_specified)
        self.assertTrue(cookies[0].secure)
        return cookies[0].value

    def test_one_shared_login_logs_out_on_a_sibling_host(self):
        identity = self.login(self.client, HOST_A, self.alice.username)
        self.assertEqual(self.me(self.client, HOST_B)["user"]["id"], self.alice.id)
        self.logout(self.client, HOST_B, identity)
        self.assertFalse(self.me(self.client, HOST_A)["authenticated"])

    def rotated_logout(self, next_username):
        first = self.login(self.client, HOST_A, self.alice.username)
        first_legacy = self.legacy_cookie(HOST_A)
        # A separate browser's login must survive this browser's rotation.
        independent = self.login(self.other_browser, HOST_A, self.alice.username)
        second = self.login(self.client, HOST_B, next_username)
        self.assertNotEqual(first["user"]["csrf_token"], second["user"]["csrf_token"])
        self.assertTrue(first_legacy != self.legacy_cookie(HOST_B))
        self.assertTrue(first_legacy == self.legacy_cookie(HOST_A))
        # At B, both presented cookies contain the new token. T1 from A is
        # absent, so merely deleting both cookie values on logout cannot fix it.
        request = self.client.build_request("POST", f"{HOST_B}/api/auth/logout")
        self.assertFalse(first_legacy in request.headers.get("cookie", ""))
        self.assert_shared_marker(self.logout(self.client, HOST_B, second))
        self.assertEqual(self.me(self.other_browser, HOST_A)["user"]["id"], independent["user"]["id"])
        self.assertFalse(self.me(self.client, HOST_A)["authenticated"],
                         "The stale host-only token must not restore an account after suite logout")

    def test_repeated_login_then_logout_cannot_restore_the_previous_host_session(self):
        self.rotated_logout(self.alice.username)

    def test_account_switch_then_logout_cannot_restore_the_previous_account(self):
        self.rotated_logout(self.bob.username)

    def test_empty_shared_cookie_suppresses_four_historical_hosts_until_fresh_login(self):
        self.assertFalse(self.me(self.client, HOST_A)["authenticated"])
        self.assertFalse(any(cookie.name == SHARED_SESSION_COOKIE for cookie in self.client.cookies.jar))
        self.login(self.other_browser, HOST_A, self.alice.username)
        self.login(self.client, HOST_D, self.bob.username)
        self.login(self.client, HOST_A, self.alice.username)
        self.login(self.client, HOST_B, self.bob.username)
        final = self.login(self.client, HOST_C, self.alice.username)
        current_token = self.legacy_cookie(HOST_C)
        self.assert_shared_marker(self.logout(self.client, HOST_C, final))
        shared = [cookie for cookie in self.client.cookies.jar if cookie.name == SHARED_SESSION_COOKIE]
        self.assertEqual(len(shared), 1)
        # Starlette quotes an empty value on the wire; CookieJar stores those
        # quotes. Verify the parsed request cookie, as the server receives it.
        request = self.client.build_request("GET", f"{HOST_A}/api/auth/me")
        self.assertEqual(SimpleCookie(request.headers["cookie"])[SHARED_SESSION_COOKIE].value, "")
        self.assertEqual(shared[0].domain, f".{DOMAIN}")
        self.assertEqual(shared[0].path, "/")
        self.assertTrue(shared[0].secure)
        self.assertIn("HttpOnly", shared[0]._rest)
        self.assertEqual(shared[0]._rest.get("SameSite"), "lax")
        self.assertGreater(shared[0].expires, time.time() + (SESSION_DAYS - 1) * 24 * 60 * 60)
        for host in HOSTS:
            response = self.client.get(f"{host}/api/auth/me")
            self.assertFalse(response.json()["authenticated"])
            self.assertFalse(any(header.startswith(f"{SHARED_SESSION_COOKIE}=")
                                 for header in response.headers.get_list("set-cookie")))
        # The current session is revoked in the DB too, independently of the
        # browser marker. No old host token is involved in this check.
        revoked = self.client.get(f"{HOST_C}/api/auth/me", headers={"Cookie": f"{LEGACY_SESSION_COOKIE}={current_token}"})
        self.assertFalse(revoked.json()["authenticated"])
        self.assertEqual(self.me(self.other_browser, HOST_A)["user"]["id"], self.alice.id)
        fresh = self.login(self.client, HOST_B, self.bob.username)
        for host in HOSTS:
            self.assertEqual(self.me(self.client, host)["user"]["id"], self.bob.id)
        self.assert_shared_marker(self.logout(self.client, HOST_B, fresh))
        for host in HOSTS:
            self.assertFalse(self.me(self.client, host)["authenticated"])

    def test_quoted_and_unquoted_empty_shared_cookie_block_http_and_websocket_fallback(self):
        self.login(self.client, HOST_A, self.alice.username)
        old_token = self.legacy_cookie(HOST_A)

        async def unused(*_args):
            raise AssertionError("Only native WebSocket cookie parsing is needed")

        for host in HOSTS:
            for empty in ('', '""'):
                with self.subTest(host=host, empty=empty):
                    cookie = f"{LEGACY_SESSION_COOKIE}={old_token}; {SHARED_SESSION_COOKIE}={empty}"
                    response = self.client.get(f"{host}/api/auth/me", headers={"Cookie": cookie})
                    self.assertFalse(response.json()["authenticated"])
                    websocket = WebSocket({
                        "type": "websocket", "scheme": "wss", "path": "/ws/local-cookie-test",
                        "headers": [(b"host", host.removeprefix("https://").encode()), (b"cookie", cookie.encode())],
                        "query_string": b"", "client": ("127.0.0.1", 1234),
                        "server": (host.removeprefix("https://"), 443),
                    }, unused, unused)
                    self.assertEqual(session_token_from_connection(websocket), (None, SHARED_SESSION_COOKIE))
                    self.assertIsNone(resolve_session(websocket))

    def test_without_shared_domain_logout_still_deletes_only_the_host_cookie(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_COOKIE_DOMAIN": ""}):
            identity = self.login(self.client, HOST_A, self.alice.username)
            response = self.logout(self.client, HOST_A, identity)
        cookies = response.headers.get_list("set-cookie")
        self.assertEqual(len(cookies), 1)
        self.assertTrue(cookies[0].startswith(f"{LEGACY_SESSION_COOKIE}="))
        self.assertIn("Max-Age=0", cookies[0])
        self.assertFalse(self.me(self.client, HOST_A)["authenticated"])
