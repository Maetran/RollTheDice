"""Public suite discovery exposes evergreen pages and protects personal data."""

from __future__ import annotations

import os
from pathlib import Path
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.robotparser import RobotFileParser
from xml.etree import ElementTree

import httpx

from app import main
from app.achievements import achievement_rank_legend_payload
from app.site_seo import (
    HAUSDEPP_ORIGIN,
    PRIVATE_HAUSDEPP_DOCUMENTS,
    PUBLIC_SEO_PAGES,
    SITE_ORIGIN,
    WATTEN_ORIGIN,
    ZILCH_ORIGIN,
)
from tests.test_zilch_seo import _PublicDocument


class SuiteSearchDiscoveryTests(IsolatedAsyncioTestCase):
    async def test_game_lobbies_describe_how_to_play_before_javascript(self):
        cases = (
            (SITE_ORIGIN, "/", ("Würfelspiel mit fünf Würfeln", "Fülle dein Punkteblatt mit fünf Würfeln",
                                 "kostenlos im Browser und ohne Konto")),
            (HAUSDEPP_ORIGIN, "/hausdepp", ("Hausdepp online spielen", "Kartenspiel für zwei bis sechs Spieler",
                                             "Computer-Mitspielern", "card game for two to six players")),
        )
        for origin, path, snippets in cases:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=origin) as client:
                response = await client.get(path)
                self.assertEqual(response.status_code, 200)
                for snippet in snippets:
                    self.assertIn(snippet, response.text)

    async def test_public_game_schema_states_real_rules_and_links_the_available_four_game_suite(self):
        lobby_url = f"{HAUSDEPP_ORIGIN}/hausdepp"
        rules_url = f"{lobby_url}/regeln"
        expected_games = {f"{SITE_ORIGIN}/", f"{ZILCH_ORIGIN}/", lobby_url, f"{WATTEN_ORIGIN}/watten"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for url in expected_games:
                with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public", "ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1"}):
                    response = await client.get(url)
                document = _PublicDocument(response.text)
                nodes = [node for payload in document.structured_data for node in payload.get("@graph", [payload])]
                game = next(node for node in nodes if node.get("@type") == "VideoGame")
                suite = game["isPartOf"]
                self.assertEqual(suite["@type"], "CreativeWorkSeries")
                self.assertEqual(suite["@id"], f"{SITE_ORIGIN}/#game-suite")
                self.assertEqual({part["url"] for part in suite["hasPart"]}, expected_games)
                self.assertEqual({part["@id"] for part in suite["hasPart"]}, {item + "#game" for item in expected_games})
                self.assertNotIn("aggregateRating", game)
                self.assertNotIn("review", game)
                if url == lobby_url:
                    self.assertEqual(game["numberOfPlayers"], {"@type": "QuantitativeValue", "minValue": 2, "maxValue": 6})
                    self.assertEqual(game["playMode"], ["https://schema.org/MultiPlayer"])
                    self.assertTrue(game["isAccessibleForFree"])
                    self.assertEqual(game["inLanguage"], ["de", "en"])
                    self.assertEqual(game["gameItem"], {"@type": "Thing", "name": "36 doppeldeutsche Spielkarten",
                                                       "alternateName": "36 double-headed German playing cards"})
                    self.assertEqual(document.canonical, lobby_url)
                    self.assertNotIn("hreflang=", response.text)
            response = await client.get(rules_url)
            rules = _PublicDocument(response.text)
            page = next(node for node in rules.structured_data if node.get("@type") == "WebPage")
            self.assertEqual(page["url"], rules_url)
            self.assertEqual(page["about"], {"@id": lobby_url + "#game"})
            self.assertEqual(page["isPartOf"], {"@id": lobby_url + "#website"})
            self.assertEqual(page["inLanguage"], ["de", "en"])
            self.assertNotIn("hreflang=", response.text)

    async def test_public_documents_and_ai_search_crawlers_share_the_same_clean_discovery(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
                                     "ROLLTHEDICE_SITE_ORIGIN": SITE_ORIGIN}):
            for origin in (SITE_ORIGIN, ZILCH_ORIGIN, HAUSDEPP_ORIGIN):
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
                        self.assertEqual("Hausdepp" in document.meta.get("description", ""), origin == HAUSDEPP_ORIGIN)
                        for link in document.links:
                            self.assertNotIn("nofollow", link.get("rel", "").split())
                    sitemap = ElementTree.fromstring((await client.get("/sitemap.xml")).text)
                    locations = [node.text for node in sitemap.findall(".//{*}loc")]
                    self.assertEqual(set(locations), {page.canonical_url for page in PUBLIC_SEO_PAGES if page.origin == origin})
                    self.assertTrue(all(value.startswith(origin) for value in locations))

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

    async def test_public_hausdepp_host_exposes_only_its_two_canonical_documents(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=HAUSDEPP_ORIGIN) as client:
            robots_response = await client.get("/robots.txt")
            self.assertIn(f"Sitemap: {HAUSDEPP_ORIGIN}/sitemap.xml", robots_response.text)
            robots = RobotFileParser()
            robots.parse(robots_response.text.splitlines())
            self.assertTrue(robots.can_fetch("Googlebot", f"{HAUSDEPP_ORIGIN}/hausdepp"))
            self.assertFalse(robots.can_fetch("OAI-SearchBot", f"{HAUSDEPP_ORIGIN}/api/hausdepp/account"))
            sitemap = ElementTree.fromstring((await client.get("/sitemap.xml")).text)
            self.assertEqual({node.text for node in sitemap.findall(".//{*}loc")}, {f"{HAUSDEPP_ORIGIN}/hausdepp", f"{HAUSDEPP_ORIGIN}/hausdepp/regeln"})
            root = await client.get("/")
            self.assertEqual(root.status_code, 308)
            self.assertEqual(root.headers["location"], "/hausdepp")
            self.assertEqual(root.headers["x-robots-tag"], "noindex, nofollow")
            for path in ("/hausdepp/konto", "/hausdepp/rangliste",
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


class _InitialDiscoveryDocument(_PublicDocument):
    def __init__(self, source: str):
        self.rank_rows = {}
        self.footer_links = []
        self._footer = False
        super().__init__(source)

    def handle_starttag(self, tag, attrs):
        super().handle_starttag(tag, attrs)
        attributes = dict(attrs)
        if tag == "footer" and "data-public-suite-links" in attributes:
            self._footer = True
        elif tag == "a" and self._footer:
            self.footer_links.append(attributes["href"])
        elif tag == "li" and "data-rank-key" in attributes:
            self.rank_rows[attributes["data-rank-key"]] = int(attributes["data-rank-minimum"])

    def handle_endtag(self, tag):
        super().handle_endtag(tag)
        if tag == "footer":
            self._footer = False


class InitialPublicDiscoveryTests(IsolatedAsyncioTestCase):
    async def test_rank_guide_contains_the_real_catalogue_without_api_or_account_reads(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=SITE_ORIGIN) as client:
            with patch("app.main.resolve_session", side_effect=AssertionError("The public rank guide is not personal")):
                response = await client.get("/rangabzeichen?punkte=999999&spieler=private-account-name")
            document = _InitialDiscoveryDocument(response.text)
            catalogue = achievement_rank_legend_payload()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(document.rank_rows, {rank["key"]: rank["minimum_points"] for rank in catalogue["ranks"]})
            self.assertIn(f'<strong>{catalogue["points_possible"]} Ehrenberg-Marken</strong>', response.text)
            self.assertNotIn("private-account-name", response.text)
            self.assertNotIn("<!-- public-rank-", response.text)
            self.assertNotIn('aria-busy="true"', response.text)
            self.assertNotIn("noindex", response.headers.get("x-robots-tag", ""))
            robots = RobotFileParser()
            robots.parse((await client.get("/robots.txt")).text.splitlines())
            self.assertFalse(robots.can_fetch("Googlebot", SITE_ORIGIN + "/api/achievement-ranks"))

    async def test_player_directory_explains_rankings_without_adding_personal_rows(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=SITE_ORIGIN) as client:
            response = await client.get("/spieler")
        self.assertEqual(response.status_code, 200)
        self.assertIn("So liest du das ZDWA-Ranking", response.text)
        self.assertIn("Normal und Hardcore haben eigene Ranglisten.", response.text)
        self.assertIn("letzten drei abgeschlossenen Spiele", response.text)
        self.assertIn("von den Punkten auf dem Spielblatt getrennt", response.text)
        self.assertIn('href="/rangabzeichen"', response.text)
        self.assertIn('<tbody id="rankingBody"></tbody>', response.text)

    async def test_suite_links_and_schema_follow_the_actual_anonymous_rollout_flags(self):
        always = {SITE_ORIGIN + "/", HAUSDEPP_ORIGIN + "/hausdepp"}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
            for zilch_public, watten_public in ((False, False), (True, False), (False, True), (True, True)):
                expected = always | ({ZILCH_ORIGIN + "/"} if zilch_public else set()) | (
                    {WATTEN_ORIGIN + "/watten"} if watten_public else set())
                environment = {"ROLLTHEDICE_SITE_ORIGIN": SITE_ORIGIN, "ROLLTHEDICE_ZILCH_ORIGIN": ZILCH_ORIGIN,
                               "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public" if zilch_public else "preview",
                               "ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1" if watten_public else "0"}
                with patch.dict(os.environ, environment):
                    for source in expected:
                        with self.subTest(zilch=zilch_public, watten=watten_public, source=source):
                            response = await client.get(source)
                            self.assertEqual(response.status_code, 200)
                            document = _InitialDiscoveryDocument(response.text)
                            self.assertEqual(set(document.footer_links), expected)
                            nodes = [node for payload in document.structured_data for node in payload.get("@graph", [payload])]
                            game = next(node for node in nodes if node.get("@type") == "VideoGame")
                            self.assertEqual({member["url"] for member in game["isPartOf"]["hasPart"]}, expected)
                            self.assertEqual(len(game["isPartOf"]["hasPart"]), len(expected))

    async def test_watten_footer_and_navigation_are_initially_english_without_javascript(self):
        environment = {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1", "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"}
        with patch.dict(os.environ, environment):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url=WATTEN_ORIGIN) as client:
                for path in ("/watten", "/watten/regeln"):
                    response = await client.get(path + "?lang=en")
                    document = _InitialDiscoveryDocument(response.text)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('aria-label="Games in this suite"', response.text)
                    self.assertIn("Players &amp; rankings</a>", response.text)
                    self.assertIn(">Rules</a>", response.text)
                    self.assertIn(">Account</a>", response.text)
                    self.assertNotIn(">Regeln</a>", response.text)
                    self.assertNotIn(">Konto</a>", response.text)
                    self.assertIn('<option value="en" selected>', response.text)
                    self.assertIn(WATTEN_ORIGIN + "/watten?lang=en", document.footer_links)

    async def test_untrusted_forwarding_headers_cannot_advertise_closed_watten(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1"}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="https://unknown.invalid") as client:
                response = await client.get("/", headers={"X-Forwarded-Host": "watten.zockdiewandan.online"})
        document = _InitialDiscoveryDocument(response.text)
        self.assertEqual(response.status_code, 200)
        self.assertNotIn(WATTEN_ORIGIN + "/watten", document.footer_links)

    async def test_public_link_graph_connects_every_registered_page_from_each_game(self):
        environment = {"ROLLTHEDICE_SITE_ORIGIN": SITE_ORIGIN, "ROLLTHEDICE_ZILCH_ORIGIN": ZILCH_ORIGIN,
                       "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public", "ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1"}
        pages = {page.canonical_url for page in PUBLIC_SEO_PAGES}
        graph = {}
        with patch.dict(os.environ, environment):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
                for url in pages:
                    response = await client.get(url)
                    self.assertEqual(response.status_code, 200)
                    document = _InitialDiscoveryDocument(response.text)
                    self.assertEqual(len(document.footer_links), 4, url)
                    destinations = [urlsplit(urljoin(url, link["href"])) for link in document.links if link.get("href")]
                    graph[url] = {urlunsplit((part.scheme, part.netloc, part.path, "", "")) for part in destinations} & pages
        for start in (SITE_ORIGIN + "/", ZILCH_ORIGIN + "/", HAUSDEPP_ORIGIN + "/hausdepp", WATTEN_ORIGIN + "/watten"):
            reached, pending = set(), {start}
            while pending:
                current = pending.pop()
                reached.add(current)
                pending.update(graph[current] - reached)
            self.assertEqual(reached, pages, start)

    async def test_private_pages_and_pwa_bridges_keep_noindex_without_public_footer(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1", "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app)) as client:
                for origin, path in ((SITE_ORIGIN, "/konto"), (SITE_ORIGIN, "/spieler/private-account"),
                                     (ZILCH_ORIGIN, "/konto"), (HAUSDEPP_ORIGIN, "/hausdepp/konto"),
                                     (WATTEN_ORIGIN, "/watten/anmelden"), (WATTEN_ORIGIN, "/zdwa/rangabzeichen")):
                    response = await client.get(origin + path)
                    self.assertNotIn("<footer data-public-suite-links", response.text)
                    self.assertTrue("noindex" in response.headers.get("x-robots-tag", "") or
                                    "noindex" in _PublicDocument(response.text).meta.get("robots", ""), origin + path)
