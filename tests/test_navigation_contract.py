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
from app.product_hosts import WATTEN_ORIGIN
from app.site_seo import HAUSDEPP_ORIGIN, PUBLIC_SEO_PAGES, SITE_ORIGIN, ZILCH_ORIGIN

ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class RouteCoverage:
    paths: tuple[str, ...]
    test_file: str
    test_name: str | None = None
    browser_tests: tuple[str, ...] = ()


# Include aliases, personal/token pages and parameterized paths: leaving them
# out because they are noindex would miss the navigation bugs this guards.
DOCUMENT_ROUTES = (
    RouteCoverage(("/",), "tests/test_http_shell.py", "test_shell_and_service_worker_are_revalidated",
                  ("tests/browser/passkey-signup.spec.js", "tests/browser/game-picker.spec.js",
                   "tests/browser/game-tours.spec.js")),
    RouteCoverage(
        ("/regeln", "/spieler/{username}", "/rangabzeichen",
         "/ergebnis/{game_id}", "/offline"),
        "tests/test_http_shell.py", "test_clean_page_routes_and_legacy_redirects",
        ("tests/browser/account-settings-layout.spec.js", "tests/browser/game-picker.spec.js"),
    ),
    RouteCoverage(
        ("/konto",), "tests/test_http_shell.py", "test_clean_page_routes_and_legacy_redirects",
        ("tests/browser/account-settings-layout.spec.js", "tests/browser/game-picker.spec.js",
         "tests/browser/game-tours.spec.js"),
    ),
    RouteCoverage(
        ("/spiel/{game_id}",), "tests/browser/zdwa-device-switch.spec.js",
        browser_tests=("tests/browser/zdwa-forced-scratch.spec.js", "tests/browser/zdwa-convenience.spec.js",
                       "tests/browser/game-tours.spec.js"),
    ),
    RouteCoverage(("/spiel/{game_id}/zuschauen",), "tests/browser/admin-help-ui.spec.js"),
    # Ownership adds a real signed-in browser flow; existing restriction tests
    # continue covering ordinary moderation on the same page.
    RouteCoverage(("/admin",), "tests/browser/admin-ownership.spec.js"),
    RouteCoverage(("/admin/dashboard",), "tests/browser/analytics-dashboard.spec.js"),
    RouteCoverage(("/ergebnis",), "tests/browser/navigation-destinations.spec.js"),
    RouteCoverage(
        ("/spieler", "/zilch/bestenlisten"), "tests/browser/achievement-feed.spec.js",
    ),
    RouteCoverage(
        ("/offline-spielen", "/zilch/offline-spielen"), "tests/test_offline_routes.py",
        "test_offline_entries_are_anonymous_noindex_and_keep_the_correct_game_and_home",
        ("tests/browser/offline-play.spec.js",),
    ),
    RouteCoverage(
        ("/registrierung/bestaetigen", "/passwort-vergessen", "/passwort-zuruecksetzen", "/email-bestaetigen"),
        "tests/browser/email-navigation.spec.js",
        browser_tests=("tests/browser-passkeys/watten-account.spec.js",),
    ),
    RouteCoverage(
        ("/zdwa", "/zdwa/{path:path}"), "tests/test_zilch_product_routes.py",
        "test_zilch_pwa_hosts_a_noindex_zdwa_bridge_without_exposing_zilch_routes",
    ),
    RouteCoverage(
        ("/zilch",), "tests/test_zilch_product_routes.py", "test_only_public_lobby_documents_can_render_before_auth",
        ("tests/browser/passkey-signup.spec.js",),
    ),
    RouteCoverage(
        ("/zilch/anmelden",), "tests/test_zilch_product_routes.py",
        "test_login_entry_is_public_but_the_private_shell_stays_protected",
        ("tests/browser/passkey-signup.spec.js",),
    ),
    RouteCoverage(
        ("/zilch/historie", "/zilch/statistiken", "/zilch/erfolge", "/zilch/regeln"),
        "tests/test_zilch_product_routes.py", "test_history_rules_shells_and_rules_api_use_the_central_preview_policy",
        ("tests/browser/zdwa-game-switcher.spec.js",),
    ),
    RouteCoverage(
        ("/zilch/konto",), "tests/test_zilch_product_routes.py",
        "test_history_rules_shells_and_rules_api_use_the_central_preview_policy",
        ("tests/browser/zdwa-game-switcher.spec.js", "tests/browser/account-settings-layout.spec.js"),
    ),
    RouteCoverage(("/zilch/spieler/{username}",), "tests/browser/player-search-flow.spec.js"),
    RouteCoverage(
        ("/zilch/spieler",), "tests/test_zilch_product_routes.py",
        "test_player_directory_aliases_reach_search_in_the_same_product",
    ),
    RouteCoverage(
        ("/zilch/spiel/{game_id}",),
        "tests/test_zilch_unavailable.py", "test_html_links_have_recovery_and_keep_the_404_status",
        ("tests/browser/game-tours.spec.js",),
    ),
    RouteCoverage(
        ("/zilch/ergebnis/{game_id}",),
        "tests/test_zilch_unavailable.py", "test_html_links_have_recovery_and_keep_the_404_status",
    ),
    RouteCoverage(
        ("/zilch/spiel/{game_id}/zuschauen",), "tests/test_zilch_product_routes.py",
        "test_zilch_spectator_route_is_noindex_and_legacy_bridge_keeps_the_suffix",
        ("tests/browser/game-tours.spec.js",),
    ),
    RouteCoverage(
        ("/hausdepp", "/hausdepp/regeln"),
        "tests/test_hausdepp_integration.py", "test_founder_product_pages_and_game_type_routes",
        ("tests/browser/hausdepp.spec.js", "tests/browser/hausdepp-public.spec.js",
         "tests/browser/hausdepp-card-reload.spec.js", "tests/browser/hausdepp-rematch.spec.js",
         "tests/browser/hausdepp-flex-lobby.spec.js"),
    ),
    RouteCoverage(
        ("/hausdepp/spiel/{game_id}", "/hausdepp/spiel/{game_id}/zuschauen"),
        "tests/test_hausdepp_integration.py", "test_founder_product_pages_and_game_type_routes",
        ("tests/browser/hausdepp.spec.js", "tests/browser/hausdepp-public.spec.js",
         "tests/browser/game-tours.spec.js", "tests/browser/hausdepp-hand-selection.spec.js",
         "tests/browser/hausdepp-rematch.spec.js", "tests/browser/hausdepp-rematch-real.spec.js",
         "tests/browser/hausdepp-flex-lobby.spec.js", "tests/browser/hausdepp-reactions.spec.js"),
    ),
    RouteCoverage(
        ("/hausdepp/anmelden", "/hausdepp/konto/einstellungen"), "tests/test_hausdepp_auth_flow.py",
        "test_house_auth_pages_keep_product_identity_and_protected_settings",
        ("tests/browser-hausdepp-passkeys/in-origin.spec.js", "tests/browser-hausdepp-passkeys/account-flow.spec.js"),
    ),
    RouteCoverage(
        ("/hausdepp/konto",), "tests/test_hausdepp_integration.py",
        "test_founder_product_pages_and_game_type_routes",
        ("tests/browser/hausdepp-product.spec.js", "tests/browser/game-picker.spec.js",
         "tests/browser/hausdepp-achievements.spec.js", "tests/browser/hausdepp-rematch.spec.js"),
    ),
    RouteCoverage(
        ("/hausdepp/rangliste",), "tests/test_hausdepp_progress_api.py",
        "test_private_leaderboard_page_and_api_keep_founder_and_search_boundaries",
        ("tests/browser/hausdepp-leaderboard.spec.js",),
    ),
    RouteCoverage(
        ("/watten", "/watten/anmelden", "/watten/konto", "/watten/konto/einstellungen"),
        "tests/test_watten_accounts.py", "test_native_routes_protect_settings_and_keep_static_templates_private",
        ("tests/browser-passkeys/watten-account.spec.js",),
    ),
    RouteCoverage(
        ("/watten/konto/fortschritt", "/watten/konto/verlauf", "/watten/rangliste"),
        "tests/test_watten_progress_pages.py", "test_native_progress_pages_protect_identity_and_keep_canonical_return_path",
        ("tests/browser/watten-progress.spec.js",),
    ),
    RouteCoverage(
        ("/watten/regeln",), "tests/test_watten_pages.py",
        "test_local_public_lobby_and_rules_serve_actual_game_documents",
        ("tests/browser/watten-game.spec.js",),
    ),
    RouteCoverage(
        ("/watten/spiel/{game_id}", "/watten/spiel/{game_id}/zuschauen"), "tests/test_watten_pages.py",
        "test_authenticated_player_and_spectator_documents_keep_canonical_context",
        ("tests/browser/watten-game.spec.js", "tests/browser/watten-rematch.spec.js"),
    ),
    RouteCoverage(
        ("/anmelden",), "tests/test_zilch_product_routes.py",
        "test_public_guest_explicit_login_reaches_apex_form_with_safe_continuation",
        ("tests/browser/passkey-signup.spec.js",),
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

# Existing path names must also keep the new, reserved product host closed.
# There is no Watten document or installable app yet, so this host contract
# deliberately has no browser journey or public SEO registration.
RESERVED_HOST_DOCUMENT_ROUTES = {
    WATTEN_ORIGIN: (
        RouteCoverage(
            ("/", "/watten", "/watten/regeln", "/konto", "/hausdepp", "/zilch/anmelden",
             "/spiel/example", "/watten/spiel/example/zuschauen", "/auth/continue"),
            "tests/test_watten_readiness.py",
            "test_all_documents_private_apis_and_static_aliases_are_closed_before_routing",
        ),
    ),
}

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
    "/hausdepp-manifest.webmanifest": "Public Hausdepp installation; test_hausdepp_pwa and browser/hausdepp-pwa.spec.js.",
    "/hausdepp-manifest-en.webmanifest": "English public Hausdepp installation; test_hausdepp_pwa.",
    "/watten-manifest.webmanifest": "Opt-in local account PWA metadata; test_watten_pwa and browser-passkeys/watten-pwa.spec.js.",
    "/watten-manifest-en.webmanifest": "English opt-in local PWA metadata; test_watten_pwa and browser-passkeys/watten-pwa.spec.js.",
    "/sw.js": "ZDWA service worker; test_http_shell.",
    "/zilch-sw.js": "Zilch service worker; test_zilch_product_routes.",
    "/hausdepp-sw.js": "Narrow, network-only Hausdepp service worker; test_hausdepp_pwa and browser/hausdepp-pwa.spec.js.",
    "/watten-sw.js": "Guarded local network-only worker; test_watten_pwa and browser-passkeys/watten-pwa.spec.js; production remains closed.",
    "/favicon.ico": "Product artwork; test_http_shell.",
    "/apple-touch-icon.png": "Anonymous GET/HEAD Apple icon discovery; host-specific public 180px PNG, test_hausdepp_pwa.",
    "/apple-touch-icon-precomposed.png": "Legacy Apple GET/HEAD icon discovery; same public product artwork, test_hausdepp_pwa.",
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
        host_groups = tuple(group for groups in RESERVED_HOST_DOCUMENT_ROUTES.values() for group in groups)
        for group in (*DOCUMENT_ROUTES, *host_groups):
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
                for browser_test in group.browser_tests:
                    self.assertTrue(browser_test.startswith(("tests/browser/", "tests/browser-passkeys/",
                                                            "tests/browser-hausdepp-passkeys/")))
                    self.assertIn("test(", (ROOT / browser_test).read_text(encoding="utf-8"))


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
        origins = {SITE_ORIGIN, ZILCH_ORIGIN, HAUSDEPP_ORIGIN}
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
