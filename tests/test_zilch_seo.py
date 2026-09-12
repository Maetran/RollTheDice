"""Search-visible Zilch documents must work before JavaScript or API fetching."""

from __future__ import annotations

import json
import os
import re
import unittest
from html.parser import HTMLParser
from unittest.mock import patch
from urllib.parse import urljoin
from xml.etree import ElementTree

import httpx

from app import main
from app.site_seo import PUBLIC_ZILCH_IMAGE_PATHS, ZILCH_ORIGIN


class _PublicDocument(HTMLParser):
    def __init__(self, source: str):
        super().__init__()
        self.meta: dict[str, str] = {}
        self.canonical = ""
        self.headings: list[str] = []
        self.links: list[dict[str, str]] = []
        self.structured_data: list[dict] = []
        self.scoring: dict[str, str] = {}
        self._heading = False
        self._json = False
        self._row = None
        self._cell = None
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "meta":
            self.meta[attributes.get("name", attributes.get("property", ""))] = attributes.get("content", "")
        elif tag == "link" and attributes.get("rel") == "canonical":
            self.canonical = attributes["href"]
        elif tag == "a":
            self.links.append(attributes)
        elif tag == "h1":
            self._heading = True
        elif tag == "script" and attributes.get("type") == "application/ld+json":
            self._json = True
        elif tag == "tr":
            self._row = {"th": "", "strong": ""}
        elif tag in {"th", "strong"} and self._row is not None:
            self._cell = tag

    def handle_data(self, data):
        if self._heading and data.strip():
            self.headings.append(data.strip())
        if self._json and data.strip():
            self.structured_data.append(json.loads(data))
        if self._cell:
            self._row[self._cell] += data

    def handle_endtag(self, tag):
        if tag == "h1":
            self._heading = False
        elif tag == "script":
            self._json = False
        elif tag in {"th", "strong"}:
            self._cell = None
        elif tag == "tr" and self._row is not None:
            self.scoring[self._row["th"]] = self._row["strong"]
            self._row = None


class ZilchSeoTestCase(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        environment = patch.dict(os.environ, {
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
            "ROLLTHEDICE_SITE_ORIGIN": "https://zockdiewandan.online",
            "ROLLTHEDICE_ZILCH_ORIGIN": ZILCH_ORIGIN,
        })
        environment.start()
        self.addCleanup(environment.stop)

    def client(self):
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=ZILCH_ORIGIN)

    async def test_canonical_public_documents_have_real_initial_content_and_site_identity(self):
        async with self.client() as client:
            for path, heading in (("/", "Zilch die Wand an – Würfelspiel online"), ("/regeln", "Zilch-Regeln")):
                with self.subTest(path=path):
                    response = await client.get(path)
                    document = _PublicDocument(response.text)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(document.headings, [heading])
                    self.assertEqual(document.canonical, f"{ZILCH_ORIGIN}{path}")
                    self.assertEqual(document.meta["og:url"], document.canonical)
                    self.assertEqual(response.headers["link"], f'<{document.canonical}>; rel="canonical"')
                    self.assertNotIn("noindex", response.headers.get("x-robots-tag", ""))
                    self.assertNotIn("noindex", document.meta.get("robots", ""))
                    self.assertIn("Zilch", document.meta["description"])
                    self.assertNotIn("werden geladen", response.text)
                    if path == "/":
                        self.assertEqual(document.structured_data, [{
                            "@context": "https://schema.org", "@type": "WebSite",
                            "name": "Zilch die Wand an", "url": f"{ZILCH_ORIGIN}/",
                        }])
                        self.assertIn("Direkt im Browser, auch als Gast ohne Anmeldung.", response.text)
                    else:
                        self.assertIn("data-zilch-rules-summary", response.text)
                        self.assertIn("Zilch-Serie", response.text)
                        self.assertIn("Freier Wurf und Bestätigungswurf", response.text)

    async def test_initial_scoring_table_and_thresholds_match_the_authoritative_rules(self):
        async with self.client() as client:
            response = await client.get("/regeln")
            facts_response = await client.get("/api/zilch/rules")
        self.assertEqual(facts_response.status_code, 200)
        facts = facts_response.json()
        document = _PublicDocument(response.text)
        self.assertEqual(len(document.scoring), 12)
        for label, key in {
            "Einzelne Einsen": "single_one", "Einzelne Fünfen": "single_five",
            "Drei Einsen": "three_ones", "Straße 1–6": "straight",
            "Drei Paare": "three_pairs", "500 für nichts": "nothing_bonus",
        }.items():
            with self.subTest(label=label):
                number = int(re.sub(r"\D", "", document.scoring[label]))
                self.assertEqual(number, facts["scoring"][key])
        target = f'{facts["target_score"]:,}'.replace(",", "’")
        for expected in (
            f"Erreiche {target} Punkte.",
            f"mindestens {facts['third_roll_minimum']} Rundenpunkte",
            f"Sichern ist ab {facts['bank_minimum']} Punkten möglich",
            f"mindestens {facts['confirmation_minimum']} Punkten bestätigt",
            f"werden {facts['third_zilch_penalty']} Punkte abgezogen",
        ):
            self.assertIn(expected, response.text)
        self.assertIn(f"Im Solo-Sprint erreichst du mindestens {target} Punkte", response.text)
        self.assertIn("ohne Startwurf, Gegner, Schlussrunde oder Gegenzug", response.text)

    async def test_lobby_rules_link_works_before_javascript_on_both_product_routes(self):
        async with self.client() as client:
            for url, rules_path in (
                (f"{ZILCH_ORIGIN}/", "/regeln"),
                ("https://zockdiewandan.online/zilch", "/zilch/regeln"),
            ):
                with self.subTest(url=url):
                    response = await client.get(url)
                    intro = response.text.split("<!-- zilch-public-intro:start -->")[-1].split(
                        "<!-- zilch-public-intro:end -->",
                    )[0]
                    links = [link for link in _PublicDocument(intro).links if link.get("data-zilch-path") == "/regeln"]
                    self.assertTrue(links)
                    self.assertTrue(all(link["href"] == rules_path for link in links))
                    rules = await client.get(urljoin(url, links[-1]["href"]))
                    self.assertEqual(rules.status_code, 200)

    async def test_only_public_product_artwork_is_exempt_from_private_asset_noindex(self):
        async with self.client() as client:
            for path in sorted(PUBLIC_ZILCH_IMAGE_PATHS):
                with self.subTest(path=path):
                    image = await client.get(f"{path}?v=seo-check")
                    self.assertEqual(image.status_code, 200)
                    self.assertTrue(image.headers["content-type"].startswith("image/"))
                    self.assertNotIn("noindex", image.headers.get("x-robots-tag", ""))
                    self.assertNotIn("link", image.headers)
            for path in ("/static/zilch-rules.html", "/static/zilch.html", "/static/icons/unknown.png", "/api/zilch/rules"):
                with self.subTest(private_path=path):
                    response = await client.get(path)
                    self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
            icon = await client.get("/static/icons/zilch-icon-512.png")
            unchanged = await client.get("/static/icons/zilch-icon-512.png", headers={"If-None-Match": icon.headers["etag"]})
            self.assertEqual(unchanged.status_code, 304)
            self.assertNotIn("noindex", unchanged.headers.get("x-robots-tag", ""))
            partial = await client.get("/static/icons/zilch-icon-512.png", headers={"Range": "bytes=0-31"})
            self.assertEqual(partial.status_code, 206)
            self.assertNotIn("noindex", partial.headers.get("x-robots-tag", ""))
            with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "preview"}):
                image = await client.get("/static/icons/zilch-icon-512.png")
                self.assertEqual(image.headers["x-robots-tag"], "noindex, nofollow")

    async def test_discovery_keeps_api_private_and_only_advertises_the_two_canonical_pages(self):
        async with self.client() as client:
            robots = await client.get("/robots.txt")
            sitemap = await client.get("/sitemap.xml")
            missing = await client.get("/seo-test-missing-page")
        # Google selects the longest matching rule, so Disallow: /api/ wins
        # over Allow: /. urllib.robotparser instead picks the first match.
        lines = robots.text.splitlines()
        self.assertIn("User-agent: *", lines)
        self.assertIn("Allow: /", lines)
        self.assertIn("Disallow: /api/", lines)
        self.assertNotIn("Disallow: /", lines)
        self.assertNotIn("Disallow: /regeln", lines)
        self.assertNotIn("Disallow: /static/", lines)
        self.assertIn(f"Sitemap: {ZILCH_ORIGIN}/sitemap.xml", lines)
        locations = ElementTree.fromstring(sitemap.text).findall("{*}url/{*}loc")
        self.assertEqual({location.text for location in locations}, {f"{ZILCH_ORIGIN}/", f"{ZILCH_ORIGIN}/regeln"})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.headers["x-robots-tag"], "noindex, nofollow")
