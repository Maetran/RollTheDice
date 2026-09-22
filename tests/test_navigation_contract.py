"""Keep new document routes and public links inside the navigation test suite.

The detailed browser/login/game contracts already live in the linked tests.
This inventory deliberately references those checks instead of copying them.
A new GET route outside /api must be assigned coverage here; a new indexable
page is automatically crawled and must have a link from another public page.
See docs/NAVIGATION_AUDIT.md for the maintenance workflow.
"""

from __future__ import annotations

import ast
import os
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from unittest import IsolatedAsyncioTestCase, TestCase
from unittest.mock import patch
from urllib.parse import unquote, urljoin, urlsplit, urlunsplit

import httpx
from fastapi.routing import iter_route_contexts

from app import main
from app.site_seo import PUBLIC_SEO_PAGES, SITE_ORIGIN, ZILCH_ORIGIN

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class RouteCoverage:
    paths: tuple[str, ...]
    test_file: str
    test_name: str | None = None


# Include aliases, personal/token pages and parameterized paths: leaving them
# out because they are noindex would miss the navigation bugs this guards.
DOCUMENT_ROUTES = (
    RouteCoverage(("/",), "tests/test_http_shell.py", "test_shell_and_service_worker_are_revalidated"),
    RouteCoverage(
        ("/regeln", "/spieler/{username}", "/rangabzeichen", "/konto", "/admin",
         "/ergebnis/{game_id}", "/offline"),
        "tests/test_http_shell.py", "test_clean_page_routes_and_legacy_redirects",
    ),
    RouteCoverage(
        ("/spiel/{game_id}", "/spiel/{game_id}/zuschauen"), "tests/browser/zdwa-device-switch.spec.js",
    ),
    RouteCoverage(("/ergebnis",), "tests/browser/navigation-destinations.spec.js"),
    RouteCoverage(
        ("/spieler", "/zilch/bestenlisten"), "tests/browser/achievement-feed.spec.js",
    ),
    RouteCoverage(
        ("/offline-spielen", "/zilch/offline-spielen"), "tests/test_offline_routes.py",
        "test_offline_entries_are_anonymous_noindex_and_keep_the_correct_game_and_home",
    ),
    RouteCoverage(
        ("/registrierung/bestaetigen", "/passwort-vergessen", "/passwort-zuruecksetzen", "/email-bestaetigen"),
        "tests/browser/email-navigation.spec.js",
    ),
    RouteCoverage(
        ("/zdwa", "/zdwa/{path:path}"), "tests/test_zilch_product_routes.py",
        "test_zilch_pwa_hosts_a_noindex_zdwa_bridge_without_exposing_zilch_routes",
    ),
    RouteCoverage(
        ("/zilch",), "tests/test_zilch_product_routes.py", "test_only_public_lobby_documents_can_render_before_auth",
    ),
    RouteCoverage(
        ("/zilch/anmelden",), "tests/test_zilch_product_routes.py",
        "test_login_entry_is_public_but_the_private_shell_stays_protected",
    ),
    RouteCoverage(
        ("/zilch/historie", "/zilch/statistiken", "/zilch/erfolge", "/zilch/konto", "/zilch/regeln"),
        "tests/test_zilch_product_routes.py", "test_history_rules_shells_and_rules_api_use_the_central_preview_policy",
    ),
    RouteCoverage(("/zilch/spieler/{username}",), "tests/browser/player-search-flow.spec.js"),
    RouteCoverage(
        ("/zilch/spieler",), "tests/test_zilch_product_routes.py",
        "test_player_directory_aliases_reach_search_in_the_same_product",
    ),
    RouteCoverage(
        ("/zilch/spiel/{game_id}", "/zilch/ergebnis/{game_id}"),
        "tests/test_zilch_unavailable.py", "test_html_links_have_recovery_and_keep_the_404_status",
    ),
    RouteCoverage(
        ("/zilch/spiel/{game_id}/zuschauen",), "tests/test_zilch_product_routes.py",
        "test_zilch_spectator_route_is_noindex_and_legacy_bridge_keeps_the_suffix",
    ),
    RouteCoverage(
        ("/anmelden",), "tests/test_zilch_product_routes.py",
        "test_public_guest_explicit_login_reaches_apex_form_with_safe_continuation",
    ),
    RouteCoverage(
        ("/historie", "/statistiken", "/bestenlisten", "/erfolge"), "tests/test_zilch_product_routes.py",
        "test_zilch_host_serves_clean_private_routes_with_noindex_headers",
    ),
    RouteCoverage(
        ("/auth/continue",), "tests/test_zilch_product_routes.py", "test_product_handoff_accepts_only_fixed_zilch_destinations",
    ),
    RouteCoverage(
        ("/go/github/{destination}",), "tests/test_github_engagement.py",
        "test_requires_a_new_authenticated_click_and_preserves_redirect_fallback",
    ),
)

# Finite exclusions, not a suffix filter: a new route must be reviewed even if
# it happens to end in .json or resembles an infrastructure endpoint.
TECHNICAL_ROUTES = {
    "/openapi.json": "Generated API schema; no player navigation.",
    "/docs": "Generated API documentation; no player navigation.",
    "/docs/oauth2-redirect": "Generated API authorization callback.",
    "/redoc": "Generated API documentation; no player navigation.",
    "/manifest.webmanifest": "ZDWA PWA metadata; test_http_shell and test_zilch_product_routes.",
    "/manifest-en.webmanifest": "English ZDWA PWA metadata; test_zilch_product_routes.",
    "/zilch-manifest.webmanifest": "Zilch PWA metadata; test_zilch_product_routes.",
    "/zilch-manifest-en.webmanifest": "English Zilch PWA metadata; test_zilch_product_routes.",
    "/sw.js": "ZDWA service worker; test_http_shell.",
    "/zilch-sw.js": "Zilch service worker; test_zilch_product_routes.",
    "/favicon.ico": "Product artwork; test_http_shell.",
    "/robots.txt": "Crawler policy; test_http_shell and test_zilch_seo.",
    "/sitemap.xml": "Crawler discovery; test_http_shell and test_zilch_seo.",
    "/.well-known/appspecific/com.chrome.devtools": "Browser developer-tools probe.",
}


class NavigationInventoryTests(TestCase):
    def test_every_document_route_has_explicit_navigation_coverage(self):
        registered = {
            route.path for route in iter_route_contexts(main.app.routes)
            if "GET" in (route.methods or ()) and not route.path.startswith("/api/")
        }
        covered = [path for group in DOCUMENT_ROUTES for path in group.paths]
        self.assertEqual(len(covered), len(set(covered)), "Duplicate navigation contract")
        self.assertFalse(set(covered) & TECHNICAL_ROUTES.keys())
        expected = set(covered) | TECHNICAL_ROUTES.keys()
        self.assertEqual(
            registered, expected,
            "New or removed page route: update DOCUMENT_ROUTES in tests/test_navigation_contract.py "
            "and add/update its useful destination, authorization and browser-flow tests. "
            "Technical exclusions need an explicit reason.",
        )

    def test_inventory_references_existing_regression_tests(self):
        for group in DOCUMENT_ROUTES:
            with self.subTest(paths=group.paths):
                test_file = ROOT / group.test_file
                self.assertTrue(test_file.is_file(), group.test_file)
                source = test_file.read_text(encoding="utf-8")
                if group.test_name:
                    names = {
                        node.name for node in ast.walk(ast.parse(source))
                        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
                    }
                    self.assertIn(group.test_name, names, "Update the route contract after moving a test")
                else:
                    self.assertTrue(group.test_file.startswith("tests/browser/"))
                    self.assertIn("test(", source, "Browser coverage must contain executable tests")


class _NavigationDocument(HTMLParser):
    def __init__(self, source: str):
        super().__init__()
        self.links: list[str] = []
        self.ids: set[str] = set()
        self.heading_count = 0
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.add(attributes["id"])
        if tag == "h1":
            self.heading_count += 1
        if tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"])


class PublicNavigationLinkTests(IsolatedAsyncioTestCase):
    async def test_public_page_links_and_fragments_reach_documents_and_no_page_is_orphaned(self):
        # No external requests, accounts, token actions or writes. The public
        # registry makes this grow automatically when a new SEO page is added.
        origins = {SITE_ORIGIN, ZILCH_ORIGIN}
        pages = {page.canonical_url for page in PUBLIC_SEO_PAGES}
        inbound: dict[str, set[str]] = {page: set() for page in pages}
        documents: dict[str, _NavigationDocument] = {}
        environment = {
            "ROLLTHEDICE_SITE_ORIGIN": SITE_ORIGIN,
            "ROLLTHEDICE_ZILCH_ORIGIN": ZILCH_ORIGIN,
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public",
        }
        with patch.dict(os.environ, environment):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=main.app), base_url=SITE_ORIGIN,
                headers={"Accept": "text/html"}, follow_redirects=True, max_redirects=5,
            ) as client:
                async def document(url: str) -> _NavigationDocument:
                    if url not in documents:
                        response = await client.get(url)
                        self.assertEqual(response.status_code, 200, url)
                        self.assertTrue(response.headers.get("content-type", "").startswith("text/html"), url)
                        parsed = _NavigationDocument(response.text)
                        self.assertEqual(parsed.heading_count, 1, f"No useful document at {url}")
                        documents[url] = parsed
                    return documents[url]

                for source in sorted(pages):
                    page = await document(source)
                    for href in page.links:
                        target = urlsplit(urljoin(source, href))
                        origin = f"{target.scheme}://{target.netloc}"
                        if origin not in origins:
                            continue
                        url = urlunsplit((target.scheme, target.netloc, target.path, target.query, ""))
                        canonical = urlunsplit((target.scheme, target.netloc, target.path, "", ""))
                        with self.subTest(source=source, href=href):
                            destination = await document(url)
                            if target.fragment:
                                self.assertIn(unquote(target.fragment), destination.ids, f"Broken anchor: {source} -> {href}")
                            if canonical in inbound and canonical != source:
                                inbound[canonical].add(source)

        for page, sources in inbound.items():
            self.assertTrue(sources, f"Orphaned public page: add a useful link to {page} from another public page")
