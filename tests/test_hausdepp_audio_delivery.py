"""Opt-in ambience is a bounded, public HTTP asset rather than voice traffic."""

import unittest

import httpx

from app import main
from scripts.sync_static_versions import content_version


class HausdeppAudioDeliveryTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_local_clips_have_versioned_cache_and_work_with_conditional_and_range_requests(self):
        version = content_version()
        transport = httpx.ASGITransport(app=main.app)
        total_bytes = 0
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            for name in ("tavern-room", "glasses", "dishwasher", "laughter"):
                path = f"/static/audio/hausdepp/{name}.mp3"
                url = f"{path}?v={version}"
                response = await client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "audio/mpeg")
                self.assertEqual(response.headers["cache-control"], "public, max-age=31536000, immutable")
                total_bytes += len(response.content)
                cached = await client.get(url, headers={"If-None-Match": response.headers["etag"]})
                self.assertEqual(cached.status_code, 304)
                self.assertIn("immutable", cached.headers["cache-control"])
                partial = await client.get(url, headers={"Range": "bytes=0-31"})
                self.assertEqual(partial.status_code, 206)
                self.assertEqual(partial.content, response.content[:32])
                self.assertIn("immutable", partial.headers["cache-control"])
                unversioned = await client.get(path)
                stale = await client.get(f"{path}?v=stale")
                self.assertIn("no-cache", unversioned.headers["cache-control"])
                self.assertIn("no-cache", stale.headers["cache-control"])
        self.assertGreater(total_bytes, 1_000_000)
        self.assertLess(total_bytes, 1_800_000)
