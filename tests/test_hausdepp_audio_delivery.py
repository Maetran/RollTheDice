"""Opt-in ambience is a bounded, public HTTP asset rather than voice traffic."""

import hashlib
import json
import unittest
from pathlib import Path

import httpx

from app import main
from scripts.sync_static_versions import content_version

ROOT = Path(__file__).resolve().parents[1]


class HausdeppAudioDeliveryTestCase(unittest.IsolatedAsyncioTestCase):
    async def test_local_clips_have_versioned_cache_and_work_with_conditional_and_range_requests(self):
        version = content_version()
        transport = httpx.ASGITransport(app=main.app)
        room_names = ["tavern-room", *(f"tavern-room-{index:02d}" for index in range(2, 11))]
        asset_bytes = {}
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            for name in (*room_names, "glasses", "dishwasher", "laughter"):
                path = f"/static/audio/hausdepp/{name}.mp3"
                url = f"{path}?v={version}"
                response = await client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "audio/mpeg")
                self.assertEqual(response.headers["cache-control"], "public, max-age=31536000, immutable")
                asset_bytes[name] = len(response.content)
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
        detail_bytes = sum(asset_bytes[name] for name in ("glasses", "dishwasher", "laughter"))
        for name in room_names:
            # One opt-in downloads one random room and the shared details; the
            # browser never needs all ten room recordings at the same time.
            self.assertGreater(asset_bytes[name], 500_000)
            self.assertLess(asset_bytes[name] + detail_bytes, 1_800_000)

    async def test_new_recordings_match_provenance_and_are_public_lazy_assets(self):
        manifest = json.loads((ROOT / "docs/references/tavern-recordings.json").read_text())
        sources = manifest["sources"]
        assets = manifest["assets"]
        self.assertGreaterEqual(len(sources), 4)
        self.assertEqual(len(sources), len(assets))
        self.assertEqual(len({source["page"] for source in sources}), len(sources))
        self.assertEqual(len({asset["sha256"] for asset in assets}), len(assets))
        version = content_version()
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            for source, asset in zip(sources, assets, strict=True):
                self.assertEqual(source["license"], "CC0 1.0 Universal")
                self.assertEqual(source["file"], asset["file"])
                response = await client.get(f"/{asset['file'].removeprefix('app/')}?v={version}")
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["content-type"], "audio/mpeg")
                self.assertEqual(response.headers["cache-control"], "public, max-age=31536000, immutable")
                self.assertEqual(len(response.content), asset["size_bytes"])
                self.assertEqual(hashlib.sha256(response.content).hexdigest(), asset["sha256"])
                self.assertLess(asset["size_bytes"], 1_850_000)
                self.assertGreaterEqual(asset["duration_seconds"], 60)
                partial = await client.get(f"/{asset['file'].removeprefix('app/')}", headers={"Range": "bytes=0-31"})
                self.assertEqual(partial.status_code, 206)
                self.assertEqual(partial.content, response.content[:32])
