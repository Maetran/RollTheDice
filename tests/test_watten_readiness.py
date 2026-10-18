"""The reserved Watten host cannot expose another product or private APIs."""

from __future__ import annotations

import unittest
from unittest.mock import patch

from starlette.requests import HTTPConnection
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.product_hosts import WATTEN_HOST, WATTEN_ORIGIN, is_watten_host
from app.proxy_headers import TrustedProxyHeadersMiddleware
from app.watten_readiness import WattenReadinessMiddleware


class WattenReadinessTests(unittest.TestCase):
    def setUp(self):
        # No lifespan or database is started. Real assembled application routing
        # runs only where the gate allows it; health readiness is patched below.
        self.client = TestClient(main.app, base_url=WATTEN_ORIGIN, follow_redirects=False)
        self.addCleanup(self.client.close)

    def assert_closed_headers(self, response):
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
        self.assertNotIn("set-cookie", response.headers)
        self.assertNotIn("location", response.headers)
        self.assertNotIn("link", response.headers)

    def test_all_documents_private_apis_and_static_aliases_are_closed_before_routing(self):
        paths = (
            "/", "/watten", "/watten/regeln", "/konto", "/hausdepp", "/zilch/anmelden",
            "/spiel/example", "/watten/spiel/example/zuschauen", "/auth/continue?app=zilch&path=/",
            "/api/auth/me", "/api/auth/login", "/api/games", "/api/web-push/subscription",
            "/api/analytics/events", "/static/index.html", "/static/room.html?game_id=example",
            "/static/hausdepp.html", "/static//index.html", "/favicon.ico", "/apple-touch-icon.png",
            "/passwort-zuruecksetzen?token=private-token", "/docs", "/openapi.json", "/ws/presence",
        )
        with (
            patch("app.main.resolve_session", side_effect=AssertionError("Must not resolve accounts")),
            patch("app.main._legacy_page_target", side_effect=AssertionError("Must gate before redirects")),
        ):
            for path in paths:
                for method in ("GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
                    with self.subTest(path=path, method=method):
                        response = self.client.request(method, path)
                        self.assertEqual(response.status_code, 503)
                        self.assert_closed_headers(response)
                        if method == "HEAD":
                            self.assertEqual(response.content, b"")
                        else:
                            self.assertIn("Watten ist noch nicht verfügbar.", response.text)
                            self.assertIn("Watten is not available yet.", response.text)
                            self.assertNotIn("private-token", response.text)

    def test_unpublished_sitemap_and_all_known_suite_workers_and_manifests_are_missing(self):
        paths = ["/sitemap.xml"]
        for product in ("", "zilch-", "hausdepp-", "watten-"):
            paths.extend((f"/{product}manifest.webmanifest", f"/{product}manifest-en.webmanifest",
                          f"/{product}sw.js"))
        for path in paths:
            for method in ("GET", "HEAD", "POST"):
                with self.subTest(path=path, method=method):
                    response = self.client.request(method, path)
                    self.assertEqual(response.status_code, 404)
                    self.assert_closed_headers(response)
                    self.assertNotIn("service-worker-allowed", response.headers)

    def test_robots_disallows_everything_without_advertising_a_sitemap(self):
        response = self.client.get("/robots.txt")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.text, "User-agent: *\nDisallow: /\n")
        self.assert_closed_headers(response)
        head = self.client.head("/robots.txt")
        self.assertEqual(head.status_code, 200)
        self.assertEqual(head.content, b"")
        self.assertEqual(head.headers["content-length"], response.headers["content-length"])
        self.assertEqual(self.client.post("/robots.txt").status_code, 503)

    def test_health_get_and_head_use_the_existing_database_readiness_check(self):
        for ready, status in ((True, 200), (False, 503)):
            with self.subTest(ready=ready), patch("app.main.database_schema_ready", return_value=ready) as check:
                response = self.client.get("/api/health")
                head = self.client.head("/api/health")
                self.assertEqual(response.status_code, status)
                self.assertEqual(head.status_code, status)
                self.assertEqual(check.call_count, 2)
                self.assertEqual(head.content, b"")
                self.assertEqual(head.headers["content-length"], response.headers["content-length"])
                self.assert_closed_headers(response)
                self.assert_closed_headers(head)
                self.assertEqual(response.json(), {"status": "ok", "database": "ready"} if ready
                                 else {"detail": "database_not_ready"})

    def test_health_other_methods_and_nearby_paths_never_reach_the_database(self):
        with patch("app.main.database_schema_ready", side_effect=AssertionError("Must not check database")):
            for method in ("POST", "PUT", "PATCH", "DELETE", "OPTIONS"):
                self.assertEqual(self.client.request(method, "/api/health").status_code, 503)
            for path in ("/api/health/", "/api/health/more", "/api/healthz"):
                self.assertEqual(self.client.get(path).status_code, 503)

    def test_every_websocket_path_is_rejected_before_accept_or_presence_changes(self):
        before = dict(main.presence_connections)
        sockets_before = dict(main.websocket_connections_by_address)
        for path in ("/ws/presence?client_id=watten", "/ws/lobby-chat", "/ws/friend-activity",
                     "/ws/example", "/api/health", "/"):
            with self.subTest(path=path):
                with self.assertRaises(WebSocketDisconnect) as rejected:
                    # TestClient's relative WebSocket default is testserver,
                    # independently of its HTTP base_url. Exercise the real host.
                    with self.client.websocket_connect(WATTEN_ORIGIN.replace("https:", "wss:") + path):
                        self.fail("Staged Watten must not accept a WebSocket")
                self.assertEqual(rejected.exception.code, 1008)
        self.assertEqual(main.presence_connections, before)
        self.assertEqual(main.websocket_connections_by_address, sockets_before)

    def test_existing_origins_keep_their_product_documents_and_pwa_metadata(self):
        for origin, path, expected in (
            ("https://zockdiewandan.online", "/", 200),
            ("https://zockdiewandan.online", "/manifest.webmanifest", 200),
            ("https://zilch.zockdiewandan.online", "/zilch-manifest.webmanifest", 200),
            ("https://hausdepp.zockdiewandan.online", "/", 308),
            ("https://hausdepp.zockdiewandan.online", "/hausdepp-manifest.webmanifest", 200),
            ("http://localhost:8000", "/", 200),
        ):
            with self.subTest(origin=origin, path=path):
                response = self.client.get(origin + path)
                self.assertEqual(response.status_code, expected)
                self.assertNotIn("Watten is not available yet.", response.text)
                if expected == 308:
                    self.assertEqual(response.headers["location"], "/hausdepp")

    def test_host_variants_and_duplicate_fields_cannot_bypass_the_gate(self):
        for host in (WATTEN_HOST, WATTEN_HOST.upper(), WATTEN_HOST + ".", WATTEN_HOST + ":443",
                     WATTEN_HOST + ".:443", WATTEN_HOST + ", zockdiewandan.online"):
            with self.subTest(host=host):
                self.assertEqual(self.client.get("/", headers={"Host": host}).status_code, 503)
        for hosts in ((WATTEN_HOST, "zockdiewandan.online"), ("zockdiewandan.online", WATTEN_HOST)):
            with self.subTest(hosts=hosts):
                self.assertEqual(self.client.get("/", headers=[("Host", host) for host in hosts]).status_code, 503)

    def test_forwarded_host_does_not_change_identity_even_for_a_trusted_proxy(self):
        wrapped = TrustedProxyHeadersMiddleware(main.app, trusted_hosts="testclient")
        client = TestClient(wrapped, base_url=WATTEN_ORIGIN, follow_redirects=False)
        self.addCleanup(client.close)
        for host in ("zockdiewandan.online", "evil.invalid"):
            headers = {"X-Forwarded-Host": host, "Forwarded": f"host={host};proto=https",
                       "X-Forwarded-Proto": "https"}
            self.assertEqual(client.get("/", headers=headers).status_code, 503)
        response = client.get("https://zockdiewandan.online/", headers={"X-Forwarded-Host": WATTEN_HOST})
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("Watten is not available yet.", response.text)

    def test_lookalike_and_forwarded_only_hosts_are_not_the_fixed_product(self):
        for host in ("evil." + WATTEN_HOST, WATTEN_HOST + ".evil.invalid", "watten.localhost",
                     "zockdiewandan.online", "[invalid"):
            scope = {"type": "http", "headers": [(b"host", host.encode("ascii")),
                     (b"x-forwarded-host", WATTEN_HOST.encode("ascii"))]}
            with self.subTest(host=host):
                self.assertFalse(is_watten_host(HTTPConnection(scope)))

    def test_other_hosts_websockets_and_lifespan_pass_through_unchanged(self):
        # A tiny downstream app proves pass-through without touching real
        # account or room state. The assembled main app is exercised above.
        from starlette.applications import Starlette
        from starlette.routing import WebSocketRoute

        async def echo(websocket):
            await websocket.accept()
            await websocket.send_text("existing product")
            await websocket.close()

        with TestClient(WattenReadinessMiddleware(Starlette(routes=[WebSocketRoute("/ws", echo)])),
                        base_url="https://zockdiewandan.online") as client:
            with client.websocket_connect("/ws") as websocket:
                self.assertEqual(websocket.receive_text(), "existing product")
