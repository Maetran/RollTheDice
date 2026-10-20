"""Explicit public rollout: stable discovery, normal accounts and rollback gates."""

import os
import unittest
from unittest.mock import patch
from xml.etree import ElementTree

from sqlalchemy import select
from starlette.requests import HTTPConnection
from starlette.testclient import TestClient

from app import main
from app.account_context import account_action_url, account_app_context
from app.database import session_scope
from app.game_access import public_game_access_payload
from app.models import User, WebPushSubscription
from app.product_hosts import WATTEN_HOST, WATTEN_ORIGIN
from app.watten_readiness import watten_account_preview_enabled, watten_public_beta_enabled
from app.web_push import PUSH_DELIVERY_CONTEXTS, push_delivery_contexts
from tests import test_watten_runtime as native
from tests.test_watten_open_seat import claims, setup
from tests.test_watten_push_context import subscription
from tests.test_web_push import TEST_VAPID_PUBLIC_KEY
from tests.test_zilch_seo import _PublicDocument

server = native.server


def test_ordinary_accounts_create_register_and_receive_only_opted_in_public_push(server, monkeypatch):
    from app import web_push

    game, owner = setup(server)
    recipient, no_consent = native.account("PublicPushRecipient"), native.account("PublicPushNoConsent")
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_PUBLIC_BETA", "1")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW", "0")
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY", TEST_VAPID_PUBLIC_KEY)
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY", "isolated-test-only")
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT", "mailto:isolated@example.com")

    def headers(account):
        return {"Cookie": account[1], "Origin": WATTEN_ORIGIN, "X-CSRF-Token": account[0].csrf_token,
                "X-Watten-Expected-Account-Id": str(account[0].user_id)}

    from app.watten_recipe import recipe_to_payload

    created = server.post(WATTEN_ORIGIN + "/api/games", headers=headers(owner), json={
        "name": "Public beta table", "game_type": "watten", "mode": "2",
        "watten_recipe": recipe_to_payload(game["_watten"].room.recipe)})
    assert created.status_code == 200, created.text

    for account in (owner, recipient, no_consent):
        status = server.get(WATTEN_ORIGIN + "/api/auth/me", headers=headers(account))
        assert status.status_code == 200 and status.json()["game_access"]["watten_public"]
        registered = server.put(WATTEN_ORIGIN + "/api/web-push/subscription", headers=headers(account),
            json=subscription(suffix=f"public-{account[0].user_id}").model_dump())
        assert registered.status_code == 200, registered.text
        assert not registered.json()["game_invites_enabled"]
    with session_scope() as db:
        db.get(User, owner[0].user_id).game_invite_push_enabled = True
        db.get(User, recipient[0].user_id).game_invite_push_enabled = True
        assert len(db.scalars(select(WebPushSubscription)).all()) == 3
    sent = []
    monkeypatch.setattr(web_push, "_send_web_push", lambda device, payload: (sent.append((device.user_id, payload)) or True, False))
    path = WATTEN_ORIGIN + f"/api/games/{game['_id']}/notify-open-seat"
    before = claims()
    result = server.post(path, headers=headers(owner), json={"revision": game["_watten"].room.revision})
    assert result.status_code == 200, result.text
    assert result.json()["notified"] is True
    assert [user_id for user_id, _payload in sent] == [recipient[0].user_id]
    assert sent[0][1]["url"] == f"/watten/spiel/{game['_id']}"
    assert claims() != before
    assert server.post(path, headers=headers(owner), json={"revision": game["_watten"].room.revision}).status_code == 429
    assert len(sent) == 1
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_PUBLIC_BETA", "0")
    assert server.post(path, headers=headers(owner), json={"revision": game["_watten"].room.revision}).status_code == 503
    assert len(sent) == 1


class WattenPublicBetaTests(unittest.TestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {
            "ROLLTHEDICE_SITE_ORIGIN": "https://zockdiewandan.online",
            "ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1",
            "ROLLTHEDICE_WATTEN_GAME_PREVIEW": "0",
            "ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "0",
            "ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW": "0",
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.client = TestClient(main.app, base_url=WATTEN_ORIGIN, follow_redirects=False)
        self.addCleanup(self.client.close)

    def test_public_documents_have_real_localized_content_and_private_routes_keep_noindex(self):
        for path, text in (("/watten", "Watten online"), ("/watten/regeln", "Schlag und Farbe")):
            for language in ("de", "en"):
                url = path + ("?lang=en" if language == "en" else "")
                with self.subTest(url=url):
                    response = self.client.get(url)
                    document = _PublicDocument(response.text)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(document.canonical, WATTEN_ORIGIN + url)
                    self.assertEqual(document.meta["robots"], "index, follow")
                    self.assertNotIn("x-robots-tag", response.headers)
                    self.assertEqual(response.headers["content-language"], language)
                    self.assertEqual(response.headers["link"], f'<{WATTEN_ORIGIN}{url}>; rel="canonical"')
                    self.assertEqual(len(document.headings), 1)
                    self.assertIn('[BETA]', document.headings[0])
                    self.assertIn(f'lang="{language}"', response.text)
                    self.assertIn(f'data-watten-seo-language="{language}"', response.text)
                    self.assertIn('data-watten-public-beta="true"', response.text)
                    self.assertIn('hreflang="en"', response.text)
                    self.assertIn('hreflang="x-default"', response.text)
                    self.assertEqual(document.structured_data[0]["inLanguage"], language)
                    self.assertNotIn("aggregateRating", response.text)
                    self.assertNotIn("{watten_", response.text)
                    if language == "de":
                        self.assertIn(text, response.text)
                    elif path.endswith("regeln"):
                        self.assertIn('article lang="en"', response.text)
                        self.assertNotIn('article lang="de"', response.text)
                    else:
                        self.assertIn("Sign in and play", response.text)
        for path in ("/watten/anmelden", "/watten/konto/einstellungen", "/watten/spiel/0123456789abcdef"):
            response = self.client.get(path)
            self.assertIn(response.status_code, (200, 303))
            self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")

    def test_public_host_aliases_sitemap_and_suite_bridges_have_no_route_loop(self):
        self.assertEqual(self.client.get("/?lang=en").headers["location"], "/watten?lang=en")
        self.assertEqual(self.client.get("/regeln?lang=en").headers["location"], "/watten/regeln?lang=en")
        robots = self.client.get("/robots.txt")
        self.assertIn(f"Sitemap: {WATTEN_ORIGIN}/sitemap.xml", robots.text)
        tree = ElementTree.fromstring(self.client.get("/sitemap.xml").text)
        locations = {item.text for item in tree.findall("{*}url/{*}loc")}
        self.assertEqual(locations, {WATTEN_ORIGIN + path + language for path in ("/watten", "/watten/regeln")
                                     for language in ("", "?lang=en")})
        for path in ("/zdwa", "/zdwa/regeln", "/zilch", "/hausdepp"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, (path, response.text))
            self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
            self.assertIn('data-watten-public-beta="true"', response.text)
        for filename in ("watten-lobby.html", "watten-public-rules.html"):
            self.assertEqual(self.client.get("/static/" + filename).status_code, 404)

    def test_strict_host_binding_marker_on_suite_pages_and_rollback(self):
        for host in (WATTEN_HOST, WATTEN_HOST.upper(), WATTEN_HOST + ":443"):
            self.assertEqual(self.client.get("/watten", headers={"Host": host}).status_code, 200)
        for host in (WATTEN_HOST + ".", WATTEN_HOST + ", zockdiewandan.online"):
            self.assertEqual(self.client.get("/watten", headers={"Host": host}).status_code, 503)
        for host in ("evil.invalid", WATTEN_HOST + ".evil.invalid"):
            request = HTTPConnection({"type": "http", "headers": [(b"host", host.encode())]})
            self.assertFalse(watten_public_beta_enabled(request))
        suite = self.client.get("https://zockdiewandan.online/")
        self.assertEqual(suite.status_code, 200)
        self.assertEqual(suite.text.count('data-watten-public-beta="true"'), 1)
        self.assertEqual(len(suite.content), int(suite.headers["content-length"]))
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "0"}):
            self.assertEqual(self.client.get("/watten").status_code, 503)
            self.assertEqual(self.client.get("/sitemap.xml").status_code, 404)
            self.assertNotIn('data-watten-public-beta="true"', self.client.get("https://zockdiewandan.online/").text)
            self.assertEqual(push_delivery_contexts(), PUSH_DELIVERY_CONTEXTS)

    def test_normal_account_context_email_and_opt_in_push_delivery_use_public_watten(self):
        connection = HTTPConnection({"type": "http", "headers": [(b"host", WATTEN_HOST.encode())]})
        self.assertTrue(watten_account_preview_enabled(connection))
        self.assertEqual(account_app_context(connection), "watten")
        self.assertTrue(public_game_access_payload(None, connection)["watten_public"])
        url = account_action_url("/passwort-zuruecksetzen", "private-token", "en", app="watten",
                                 return_to="/watten/konto/einstellungen")
        self.assertTrue(url.startswith(WATTEN_ORIGIN + "/passwort-zuruecksetzen?"), url)
        self.assertIn("app=watten", url)
        self.assertIn("#token=private-token", url)
        self.assertIn("watten", push_delivery_contexts())
