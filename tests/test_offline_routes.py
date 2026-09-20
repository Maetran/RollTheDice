"""Anonymous offline entries have no account data or ranking endpoints."""

import os
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx

from app import main
from app.product_hosts import safe_zilch_path
from app.site_seo import PUBLIC_SEO_PAGES


class OfflineRouteTests(IsolatedAsyncioTestCase):
    async def test_offline_entries_are_anonymous_noindex_and_keep_the_correct_game_and_home(self):
        cases = (
            ("https://zockdiewandan.online/offline-spielen", "zdwa", "/", "/manifest.webmanifest"),
            ("https://zockdiewandan.online/zilch/offline-spielen", "zilch", "/zilch", "/manifest.webmanifest"),
            ("https://zilch.zockdiewandan.online/offline-spielen", "zilch", "/", "/zilch-manifest.webmanifest"),
            ("https://zilch.zockdiewandan.online/zdwa/offline-spielen", "zdwa", "/zdwa", "/zilch-manifest.webmanifest"),
        )
        environment = {
            "ROLLTHEDICE_SITE_ORIGIN": "https://zockdiewandan.online",
            "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.zockdiewandan.online",
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "private",
        }
        with patch.dict(os.environ, environment), patch("app.main._resolve_zilch_access", side_effect=AssertionError("offline entry must not require login")):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
                for url, game, home, manifest in cases:
                    with self.subTest(url=url):
                        response = await client.get(url)
                        self.assertEqual(response.status_code, 200)
                        self.assertIn(f'data-game="{game}"', response.text)
                        self.assertIn(f'data-online-home="{home}"', response.text)
                        self.assertIn(f'href="{manifest}', response.text)
                        self.assertIn("noindex", response.headers["x-robots-tag"])
                        self.assertIn('name="robots" content="noindex', response.text)
                        self.assertNotIn("__OFFLINE_", response.text)
                        self.assertNotIn("/static/shell.js", response.text)
                        self.assertNotIn("/static/auth.js", response.text)
                alias = await client.get("https://zilch.zockdiewandan.online/zilch/offline-spielen")
                self.assertEqual(alias.status_code, 308)
                self.assertEqual(alias.headers["location"], "/offline-spielen")
                raw = await client.get("https://zockdiewandan.online/static/offline-play.html")
                self.assertEqual(raw.status_code, 404)
        self.assertEqual(safe_zilch_path("/offline-spielen"), "/offline-spielen")
        self.assertFalse(any("offline-spielen" in page.canonical_url for page in PUBLIC_SEO_PAGES))
