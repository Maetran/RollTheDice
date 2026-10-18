"""Local-only PWA HTTP, privacy and reproducible own-artwork contracts."""

import io
import os
import unittest
from unittest.mock import patch

from PIL import Image
from starlette.testclient import TestClient

from app import main
from app.product_hosts import WATTEN_ORIGIN
from scripts.build_watten_icons import OUTPUT, rendered_icons

LOCAL = "http://rollthedice.localhost:8057"
RESOURCES = ("/watten-manifest.webmanifest", "/watten-manifest-en.webmanifest", "/watten-sw.js")
ICONS = tuple(f"/static/watten/icons/watten-icon-{size}.png" for size in (32, 180, 192, 512))


class WattenPwaTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_SITE_ORIGIN": LOCAL, "ROLLTHEDICE_ZILCH_ORIGIN": "http://zilch.rollthedice.localhost:8057",
            "ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "1",
        })
        self.env.start()
        self.client = TestClient(main.app, base_url=LOCAL)

    def tearDown(self):
        self.client.close()
        self.env.stop()

    def test_local_manifests_have_same_stable_identity_and_only_real_account_shortcuts(self):
        for suffix, language in (("", "de"), ("-en", "en")):
            path = f"/watten-manifest{suffix}.webmanifest"
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn("application/manifest+json", response.headers["content-type"])
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn("noindex", response.headers["x-robots-tag"])
            data = response.json()
            self.assertEqual(data["id"], "/watten")
            self.assertEqual(data["start_url"], "/watten?pwa=watten")
            # Scope describes the installed window, not the worker's authority:
            # account recovery and existing suite pages live outside /watten.
            self.assertEqual(data["scope"], "/")
            self.assertEqual(data["lang"], language)
            self.assertEqual([item["url"] for item in data["shortcuts"]], ["/watten", "/watten/konto/einstellungen"])
            self.assertEqual(self.client.head(path).content, b"")
            for icon in data["icons"]:
                fetched = self.client.get(icon["src"])
                self.assertEqual(fetched.status_code, 200)
                with Image.open(io.BytesIO(fetched.content)) as image:
                    self.assertEqual(f"{image.width}x{image.height}", icon["sizes"])

    def test_real_worker_is_network_only_with_staged_validated_push_and_no_cache_storage(self):
        response = self.client.get("/watten-sw.js")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["service-worker-allowed"], "/watten")
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertIn("noindex", response.headers["x-robots-tag"])
        self.assertNotIn("caches.", response.text)
        self.assertIn("addEventListener('push'", response.text)
        self.assertIn("addEventListener('notificationclick'", response.text)
        self.assertIn("notificationPayload", response.text)
        self.assertIn("notificationTarget", response.text)
        # Serving a prepared worker does not enable account/device delivery.
        from app.web_push import PUSH_DELIVERY_CONTEXTS

        self.assertNotIn("watten", PUSH_DELIVERY_CONTEXTS)
        self.assertIn("This local account preview needs an internet connection", response.text)
        self.assertEqual(self.client.head("/watten-sw.js").content, b"")

    def test_every_resource_and_icon_requires_both_local_deployment_and_local_request(self):
        paths = (*RESOURCES, *ICONS, "/static/watten/icons/watten-icon.svg")
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "0"}):
            for path in paths:
                with self.subTest(path=path):
                    self.assertIn(self.client.get(path).status_code, {404, 503})
        for configured in ("https://zockdiewandan.online", "http://localhost.evil.test", "http://127.0.0.1.evil.test"):
            with patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": configured}):
                for path in paths:
                    self.assertIn(self.client.get(path).status_code, {404, 503})
        for origin in (WATTEN_ORIGIN, "https://zockdiewandan.online", "http://evil.invalid"):
            for path in paths:
                self.assertIn(self.client.get(origin + path).status_code, {404, 503})

    def test_static_manifest_worker_aliases_and_normalized_icon_aliases_do_not_bypass_guard(self):
        for path in ("/static/watten-manifest.webmanifest", "/static/watten-manifest-en.webmanifest", "/static/watten-sw.js"):
            self.assertEqual(self.client.get(path).status_code, 404)
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "0"}):
            for path in ("/static/watten//icons/watten-icon-192.png", "/static/watten/icons/../icons/watten-icon-192.png",
                         "/static/watten/%69cons/watten-icon-192.png", "/static/WATTEN/icons/watten-icon-192.png"):
                self.assertIn(self.client.get(path).status_code, {404, 503})

    def test_guarded_account_and_recovery_heads_have_owned_icons_without_parent_game_bootstrap(self):
        for path in ("/watten", "/watten/anmelden", "/passwort-vergessen?app=watten"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn('data-watten-pwa-preview="true"', response.text)
            self.assertIn('data-pwa-product="watten"', response.text)
            self.assertIn('/static/watten/icons/watten-icon-180.png?v=', response.text)
            self.assertNotIn('/static/shell.js', response.text)
            self.assertNotIn('/static/hausdepp.js', response.text)
            self.assertNotIn('/static/zilch.js', response.text)
            self.assertNotIn('data-game-switch', response.text)

    def test_generated_icons_match_our_vector_and_decode_at_every_promised_size(self):
        for filename, expected in rendered_icons().items():
            self.assertEqual((OUTPUT / filename).read_bytes(), expected, filename)
            if filename.endswith('.png'):
                size = int(filename.removesuffix('.png').rsplit('-', 1)[-1])
                with Image.open(io.BytesIO(expected)) as image:
                    self.assertEqual(image.size, (size, size))
                    self.assertEqual(image.mode, 'RGB')


if __name__ == "__main__":
    unittest.main()
