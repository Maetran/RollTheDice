"""Public discovery stays useful while the card-game preview stays private."""

from __future__ import annotations

import os
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

import httpx

from app import main
from app.site_seo import HAUSDEPP_ORIGIN, PRIVATE_HAUSDEPP_DOCUMENTS, PUBLIC_SEO_PAGES, SITE_ORIGIN, ZILCH_ORIGIN
from tests.test_zilch_seo import _PublicDocument


class SuiteSearchDiscoveryTests(IsolatedAsyncioTestCase):
    async def test_public_documents_and_ai_search_crawlers_share_the_same_clean_discovery(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
                                     "ROLLTHEDICE_SITE_ORIGIN": SITE_ORIGIN}):
            for origin in (SITE_ORIGIN, ZILCH_ORIGIN):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=origin) as client:
                    robots = RobotFileParser()
                    robots.parse((await client.get("/robots.txt")).text.splitlines())
                    for page in (item for item in PUBLIC_SEO_PAGES if item.origin == origin):
                        response = await client.get(f"{page.path}?utm_source=discovery-test")
                        document = _PublicDocument(response.text)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(document.canonical, page.canonical_url)
                        self.assertEqual(response.headers["link"], f'<{page.canonical_url}>; rel="canonical"')
                        self.assertNotIn("noindex", response.headers.get("x-robots-tag", ""))
                        for agent in ("Googlebot", "bingbot", "OAI-SearchBot", "GPTBot"):
                            self.assertTrue(robots.can_fetch(agent, page.canonical_url))
                            self.assertFalse(robots.can_fetch(agent, f"{origin}/api/hausdepp/account"))
                        self.assertNotIn("Hausdepp", document.meta.get("description", ""))
                        for link in document.links:
                            self.assertNotIn("nofollow", link.get("rel", "").split())
                    sitemap = ElementTree.fromstring((await client.get("/sitemap.xml")).text)
                    locations = [node.text for node in sitemap.findall(".//{*}loc")]
                    self.assertEqual(set(locations), {page.canonical_url for page in PUBLIC_SEO_PAGES if page.origin == origin})
                    self.assertTrue(all("hausdepp" not in value for value in locations))

    async def test_homepages_and_rules_have_truthful_structured_data_without_fabricated_ratings(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"}):
            for origin, maximum in ((SITE_ORIGIN, 4), (ZILCH_ORIGIN, 2)):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=origin) as client:
                    document = _PublicDocument((await client.get("/")).text)
                    nodes = [node for payload in document.structured_data for node in payload.get("@graph", [payload])]
                    game = next(node for node in nodes if node.get("@type") == "VideoGame")
                    self.assertEqual(game["url"], f"{origin}/")
                    self.assertEqual(game["numberOfPlayers"], {"@type": "QuantitativeValue", "minValue": 1, "maxValue": maximum})
                    self.assertTrue(game["isAccessibleForFree"])
                    self.assertEqual(game["inLanguage"], ["de", "en"])
                    self.assertNotIn("aggregateRating", game)
                    self.assertNotIn("review", game)
                    rules = _PublicDocument((await client.get("/regeln")).text)
                    self.assertTrue(any(node.get("@type") == "WebPage" and node["url"] == f"{origin}/regeln"
                                        for node in rules.structured_data))

    async def test_reserved_hausdepp_host_has_no_indexable_alias_and_an_empty_linked_sitemap(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=HAUSDEPP_ORIGIN) as client:
            robots_response = await client.get("/robots.txt")
            self.assertIn(f"Sitemap: {HAUSDEPP_ORIGIN}/sitemap.xml", robots_response.text)
            robots = RobotFileParser()
            robots.parse(robots_response.text.splitlines())
            self.assertTrue(robots.can_fetch("Googlebot", f"{HAUSDEPP_ORIGIN}/hausdepp"))
            self.assertFalse(robots.can_fetch("OAI-SearchBot", f"{HAUSDEPP_ORIGIN}/api/hausdepp/account"))
            sitemap = ElementTree.fromstring((await client.get("/sitemap.xml")).text)
            self.assertEqual(sitemap.findall(".//{*}loc"), [])
            root = await client.get("/")
            self.assertEqual(root.status_code, 308)
            self.assertEqual(root.headers["location"], "/hausdepp")
            self.assertEqual(root.headers["x-robots-tag"], "noindex, nofollow")
            for path in ("/hausdepp", "/hausdepp/regeln", "/hausdepp/konto", "/hausdepp/rangliste",
                         "/hausdepp/spiel/private-table", "/api/hausdepp/leaderboard"):
                response = await client.get(path)
                self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
                self.assertEqual(response.headers["cache-control"], "no-store")

    async def test_all_private_artifacts_are_registered_noindex_and_unreachable_as_static_entries(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=SITE_ORIGIN) as client:
            for filename in set(PRIVATE_HAUSDEPP_DOCUMENTS.values()):
                source = (Path(main.STATIC_DIR) / filename).read_text(encoding="utf-8")
                self.assertEqual(_PublicDocument(source).meta["robots"], "noindex, nofollow")
                response = await client.get(f"/static/{filename}")
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
            rules = (Path(main.STATIC_DIR) / "hausdepp-rules.html").read_text(encoding="utf-8")
            self.assertIn("data-hausdepp-rule-summary", rules)
            self.assertIn("HAUSDEP, HAUSDEPP", rules)
            self.assertIn('lang="en"', rules)
