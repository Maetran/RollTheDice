"""Public artwork caches independently of private card state and accounts."""

import unittest
from pathlib import Path

import httpx
from PIL import Image, ImageChops, ImageStat

from app import main
from scripts.build_hausdepp_lobby_cards import CELL, COLUMNS, OUTPUT, ROWS, SOURCE, render


class HausdeppAssetCacheTests(unittest.IsolatedAsyncioTestCase):
    async def test_versioned_artwork_and_icons_are_public_immutable_but_private_documents_never_cache(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="https://hausdepp.zockdiewandan.online") as client:
            for path in ("hausdepp/cards-atlas.webp", "hausdepp/cards-lobby-atlas.webp", "hausdepp/card-back.webp",
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

    async def test_lobby_preloads_only_its_smaller_faces_and_table_keeps_the_full_deck(self):
        lobby = (Path(main.STATIC_DIR) / "hausdepp-lobby.html").read_text()
        self.assertIn('/static/hausdepp/cards-lobby-atlas.webp?', lobby)
        self.assertNotIn('/static/hausdepp/cards-atlas.webp?', lobby)
        self.assertNotIn('/static/hausdepp/card-back.webp?', lobby)
        table = (Path(main.STATIC_DIR) / "hausdepp.html").read_text()
        self.assertIn('/static/hausdepp/cards-atlas.webp?', table)
        self.assertIn('/static/hausdepp/card-back.webp?', table)


class HausdeppLobbyArtworkTests(unittest.TestCase):
    def test_committed_lobby_atlas_is_reproducible_and_saves_at_least_forty_percent(self):
        self.assertEqual(OUTPUT.read_bytes(), render(), "Rebuild the lobby derivative after updating the playing deck")
        self.assertLess(OUTPUT.stat().st_size, SOURCE.stat().st_size * .6)

    def test_all_thirty_six_cells_keep_the_source_motif_order_and_crop(self):
        with Image.open(SOURCE) as source, Image.open(OUTPUT) as lobby:
            self.assertEqual(lobby.size, (COLUMNS * CELL[0], ROWS * CELL[1]))
            source_width, source_height = source.width // COLUMNS, source.height // ROWS
            for row in range(ROWS):
                for column in range(COLUMNS):
                    with self.subTest(row=row, column=column):
                        original = source.crop((column * source_width, row * source_height,
                                                (column + 1) * source_width, (row + 1) * source_height))
                        expected = original.resize(CELL, Image.Resampling.LANCZOS)
                        actual = lobby.crop((column * CELL[0], row * CELL[1],
                                             (column + 1) * CELL[0], (row + 1) * CELL[1]))
                        # Re-encoding introduces small differences; changing a
                        # motif, crop or cell order must not pass that tolerance.
                        error = ImageStat.Stat(ImageChops.difference(expected, actual)).rms
                        self.assertLess(max(error), 12)
