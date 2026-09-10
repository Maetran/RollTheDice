"""The Classic handwriting stays local, small and safe to cache."""

import re
import unittest

import httpx

from app import main
from scripts.sync_static_versions import content_version, desired_text


class ClassicFontDeliveryTestCase(unittest.IsolatedAsyncioTestCase):
    def test_handwriting_faces_are_optional_local_woff2_with_real_weights(self):
        source = (main.BASE / "frontend/styles/classic-font.css").read_text(encoding="utf-8")
        faces = re.findall(r"@font-face\s*\{([^}]+)\}", source)
        self.assertEqual(len(faces), 2)
        for face, weight in zip(faces, (400, 700), strict=True):
            self.assertIn('font-family: "ZDWA Classic Hand"', face)
            self.assertIn(f"font-weight: {weight};", face)
            self.assertIn("font-display: optional;", face)
            self.assertIn('format("woff2")', face)
            self.assertRegex(face, r'url\("/static/kalam-classic-latin-[a-z]+-v1\.woff2\?v=ASSET_VERSION"\)')
            self.assertNotIn("https://", face)
            self.assertIn("U+0000-00FF", face)  # DE umlauts/ß and EN ASCII.

    async def test_handwriting_has_a_versioned_immutable_cache_and_a_bounded_payload(self):
        version = content_version()
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            for name in ("regular", "bold"):
                path = f"/static/kalam-classic-latin-{name}-v1.woff2"
                url = f"{path}?v={version}"
                response = await client.get(url)
                unversioned = await client.get(path)
                stale = await client.get(f"{path}?v=stale")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content[:4], b"wOF2")
                self.assertLess(len(response.content), 32_768)
                self.assertEqual(response.headers["content-type"], "font/woff2")
                self.assertEqual(response.headers["cache-control"], "public, max-age=31536000, immutable")
                self.assertEqual(response.content, unversioned.content)
                self.assertIn("no-cache", unversioned.headers["cache-control"])
                self.assertIn("no-cache", stale.headers["cache-control"])
                for bundle in ("style.css", "lobby.css"):
                    css_path = main.STATIC_DIR / bundle
                    css = css_path.read_text(encoding="utf-8")
                    self.assertIn(url, css, bundle)
                    self.assertEqual(desired_text(css_path, version), css, bundle)

    async def test_font_license_is_shipped_with_attribution(self):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            response = await client.get("/static/licenses/kalam-OFL.txt")
        self.assertEqual(response.status_code, 200)
        self.assertIn("Copyright (c) 2014, Indian Type Foundry", response.text)
        self.assertIn("SIL OPEN FONT LICENSE Version 1.1", response.text)
        self.assertIn("OTHER DEALINGS IN THE FONT SOFTWARE.", response.text)
