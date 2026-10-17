"""Public artwork caches independently of private card state and accounts."""

import unittest

import httpx

from app import main


class HausdeppAssetCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_versioned_artwork_and_icons_are_public_immutable_but_private_documents_never_cache(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="https://hausdepp.zockdiewandan.online") as client:
            for path in ("hausdepp/cards-atlas.webp", "hausdepp/card-back.png",
                         "icons/hausdepp-icon-192-v2.png", "icons/hausdepp-icon-512-v2.png"):
                with self.subTest(path=path):
                    asset = await client.get(f"/static/{path}?v={main.STATIC_ASSET_VERSION}")
                    self.assertEqual(asset.status_code, 200)
                    self.assertEqual(asset.headers["cache-control"], "public, max-age=31536000, immutable")
                    self.assertNotIn("set-cookie", asset.headers)
                    stale = await client.get(f"/static/{path}?v=old")
                    self.assertEqual(stale.headers["cache-control"], "no-cache, must-revalidate")
                    unversioned = await client.get(f"/static/{path}")
                    self.assertEqual(unversioned.headers["cache-control"], "no-cache, must-revalidate")
            for path in ("/api/auth/me", "/hausdepp/konto", "/hausdepp/anmelden", "/static/hausdepp.html", "/static/hausdepp-missing.png"):
                response = await client.get(path)
                self.assertEqual(response.headers["cache-control"], "no-store")
