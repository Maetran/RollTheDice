"""Real local Watten documents and their account/host/static-entry boundaries.

These checks load the product templates; they never replace them with fixture
HTML. Table documents test routing/auth context, not acceptance of a live game.
The actual multiplayer journey belongs to browser/watten-game.spec.js.
"""

import os
import tempfile
from html.parser import HTMLParser
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from starlette.testclient import TestClient

from app import main
from app.auth import create_user
from app.database import configure_database, upgrade_database
from app.product_hosts import WATTEN_ORIGIN

LOCAL = "http://localhost:8127"
GAME_ID = "0123456789abcdef"
TABLE = f"/watten/spiel/{GAME_ID}"
SPECTATOR = f"{TABLE}/zuschauen"
GAME_DOCUMENTS = ("/watten/regeln", TABLE, SPECTATOR)


class _Document(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.html = {}
        self.scripts = []
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "html":
            self.html = attributes
        if tag == "script" and attributes.get("src"):
            self.scripts.append(urlsplit(attributes["src"]).path)


class WattenPagesTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/pages.sqlite3",
            "ROLLTHEDICE_SITE_ORIGIN": LOCAL, "ROLLTHEDICE_ZILCH_ORIGIN": "http://zilch.localhost:8127",
            "ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "1", "ROLLTHEDICE_WATTEN_GAME_PREVIEW": "1",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
            "ROLLTHEDICE_PASSKEYS_ENABLED": "0", "ROLLTHEDICE_EMAIL_ENABLED": "0",
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "", "ROLLTHEDICE_TURNSTILE_SECRET": "",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        # No lifespan/background jobs or game pool: only the real ASGI routes.
        self.client = TestClient(main.app, base_url=LOCAL, follow_redirects=False)

    def tearDown(self):
        self.client.close()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def assert_private_headers(self, response):
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
        self.assertNotIn("link", response.headers)

    def assert_closed(self, response):
        self.assertIn(response.status_code, (404, 503), response.text)
        self.assert_private_headers(response)
        self.assertNotIn("location", response.headers)
        self.assertNotIn('data-watten-page="', response.text)

    def assert_real_templates(self):
        for filename in ("watten-game.html", "watten-rules.html"):
            self.assertTrue((main.STATIC_DIR / filename).is_file(), f"Real product template missing: {filename}")

    def sign_in(self):
        create_user("WattenPageOwner", "local-page-password-123", must_change_password=False)
        response = self.client.post("/api/auth/login", headers={"Origin": LOCAL},
                                    json={"username": "WattenPageOwner", "password": "local-page-password-123"})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()["user"]

    def assert_document(self, path, page, game_id=""):
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, response.text)
        self.assert_private_headers(response)
        self.assertTrue(response.headers["content-type"].startswith("text/html"))
        document = _Document(response.text)
        self.assertEqual(document.html.get("data-game"), "watten")
        self.assertEqual(document.html.get("data-watten-page"), page)
        if page != "rules":
            self.assertEqual(document.html.get("data-game-id"), game_id)
        self.assertIn("/static/watten-game.js", document.scripts)
        self.assertNotIn("/static/shell.js", document.scripts)
        self.assertNotIn("/static/hausdepp.js", document.scripts)
        self.assertNotIn("{watten_page}", response.text)
        self.assertNotIn("{game_id}", response.text)
        self.assertIn('data-pwa-product="watten"', response.text)
        self.assertIn('/static/watten/icons/watten-icon-32.png?v=', response.text)
        self.assertIn('/static/watten/icons/watten-icon-180.png?v=', response.text)
        for foreign_icon in ('/static/favicon.png', '/static/icons/zilch-', '/static/icons/hausdepp-'):
            self.assertNotIn(foreign_icon, response.text)

    def test_local_public_lobby_and_rules_serve_actual_game_documents(self):
        self.assert_real_templates()
        self.assert_document("/watten", "lobby")
        self.assert_document("/watten/regeln", "rules")

    def test_authenticated_player_and_spectator_documents_keep_canonical_context(self):
        self.assert_real_templates()
        user = self.sign_in()
        self.assert_document(TABLE, "table", GAME_ID)
        self.assert_document(SPECTATOR, "spectator", GAME_ID)
        logged_out = self.client.post("/api/auth/logout", headers={"Origin": LOCAL,
                                      "X-CSRF-Token": user["csrf_token"]})
        self.assertEqual(logged_out.status_code, 200, logged_out.text)
        for path in (TABLE, SPECTATOR):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 303)
            self.assertEqual(parse_qs(urlsplit(response.headers["location"]).query), {"return_to": [path]})
            self.assert_private_headers(response)

    def test_table_auth_redirects_keep_only_the_canonical_path_and_no_query(self):
        for path in (TABLE, SPECTATOR):
            with self.subTest(path=path):
                response = self.client.get(path, params={"return_to": "https://evil.invalid/", "token": "private"})
                self.assertEqual(response.status_code, 303, response.text)
                self.assert_private_headers(response)
                destination = urlsplit(response.headers["location"])
                self.assertEqual((destination.scheme, destination.netloc, destination.path, destination.fragment),
                                 ("", "", "/watten/anmelden", ""))
                self.assertEqual(parse_qs(destination.query), {"return_to": [path]})
                login = self.client.get(response.headers["location"])
                self.assertEqual(login.status_code, 200, login.text)
                self.assert_private_headers(login)
                self.assertIn('data-account-page="login"', login.text)

    def test_game_documents_are_closed_when_either_preview_flag_is_off(self):
        for account, game in (("0", "0"), ("1", "0"), ("0", "1")):
            with self.subTest(account=account, game=game), patch.dict(os.environ, {
                "ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": account, "ROLLTHEDICE_WATTEN_GAME_PREVIEW": game,
            }):
                for path in GAME_DOCUMENTS:
                    self.assert_closed(self.client.get(path))

    def test_fixed_and_foreign_request_hosts_never_open_game_documents(self):
        for origin in (WATTEN_ORIGIN, WATTEN_ORIGIN.upper(), WATTEN_ORIGIN + ".",
                       "https://zockdiewandan.online", "https://hausdepp.zockdiewandan.online", "https://evil.invalid"):
            for path in GAME_DOCUMENTS:
                with self.subTest(origin=origin, path=path):
                    self.assert_closed(self.client.get(origin + path, headers={"X-Forwarded-Host": "localhost:8127"}))

    def test_production_deployment_cannot_be_opened_with_a_local_host_header(self):
        for origin in (WATTEN_ORIGIN, "https://zockdiewandan.online", "https://hausdepp.zockdiewandan.online"):
            with self.subTest(origin=origin), patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": origin}):
                for path in GAME_DOCUMENTS:
                    self.assert_closed(self.client.get(path))

    def test_malformed_and_duplicate_raw_hosts_cannot_open_game_routes(self):
        hosts = (
            [("Host", "localhost:8127, evil.invalid")], [("Host", "localhost:8127"), ("Host", "localhost:8127")],
            [("Host", "localhost:8127"), ("Host", "evil.invalid")], [("Host", "user@localhost:8127")],
            [("Host", "localhost:8127@evil.invalid")], [("Host", "localhost:8127/path")],
            [("Host", "localhost:8127?x=1")], [("Host", "localhost:8127#fragment")],
            [("Host", "localhost:not-a-port")], [("Host", "localhost.evil.invalid")],
        )
        for headers in hosts:
            for path in GAME_DOCUMENTS:
                with self.subTest(headers=headers, path=path):
                    self.assert_closed(self.client.get(path, headers=headers))

    def test_local_host_variants_preserve_the_canonical_auth_redirect(self):
        for host in ("localhost:8127", "127.0.0.1:8127", "[::1]:8127", "ROLLTHEDICE.localhost:8127"):
            with self.subTest(host=host):
                response = self.client.get(TABLE, headers={"Host": host})
                self.assertEqual(response.status_code, 303, response.text)
                self.assertEqual(parse_qs(urlsplit(response.headers["location"]).query), {"return_to": [TABLE]})
                self.assert_private_headers(response)

    def test_noncanonical_table_ids_never_redirect_or_mount_a_document(self):
        for game_id in ("one", GAME_ID.upper(), GAME_ID[:-1], GAME_ID + "0", GAME_ID[:-1] + "g",
                        GAME_ID + "%0a", GAME_ID + "%0d", GAME_ID + "%20"):
            for suffix in ("", "/zuschauen"):
                with self.subTest(game_id=game_id, suffix=suffix):
                    self.assert_closed(self.client.get(f"/watten/spiel/{game_id}{suffix}"))

    def test_real_game_templates_stay_private_under_static_path_aliases(self):
        self.assert_real_templates()
        for filename in ("watten-game.html", "watten-rules.html"):
            for path in (f"/static/{filename}", f"/static//{filename}", f"/static/./{filename}",
                         f"/static/%2e/{filename}", f"/static/missing/../{filename}", f"/STATIC/{filename.upper()}"):
                for method in ("GET", "HEAD"):
                    with self.subTest(path=path, method=method):
                        response = self.client.request(method, path)
                        self.assertEqual(response.status_code, 404, response.text)
                        self.assert_private_headers(response)
                        self.assertNotIn('data-watten-page="', response.text)
                        if method == "HEAD":
                            self.assertEqual(response.content, b"")

    def test_local_head_does_not_mount_a_get_only_game_document(self):
        # HEAD support was not added to these GET-only documents. This must
        # stay a bodyless method rejection, never a private template bypass.
        for path in GAME_DOCUMENTS:
            with self.subTest(path=path):
                response = self.client.head(path)
                self.assertEqual(response.status_code, 405)
                self.assertEqual(response.content, b"")
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertNotIn("location", response.headers)
