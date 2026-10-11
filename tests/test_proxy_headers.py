"""Visitor limits and country hints share an authenticated ingress boundary."""
import os
import unittest
from unittest.mock import patch

from starlette.requests import Request
from starlette.websockets import WebSocket

from app.api_analytics import trusted_country
from app.asgi import create_application
from app.auth_protection import _client_address
from app.proxy_headers import TrustedProxyHeadersMiddleware


class ProxyHeadersTests(unittest.IsolatedAsyncioTestCase):
    async def resolve(self, *, peer="172.18.0.1", visitor="192.0.2.42", edge="104.16.4.1",
                      trusted_hosts="172.18.0.1", kind="http", headers=None, state=None):
        scope = {"type": kind, "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET",
                 "scheme": "ws" if kind == "websocket" else "http", "path": "/", "raw_path": b"/",
                 "query_string": b"", "server": ("origin", 8000), "client": (peer, 12345),
                 "headers": headers if headers is not None else [
                     (b"x-forwarded-for", visitor.encode()), (b"x-forwarded-proto", b"https"),
                     (b"x-rtd-cloudflare-peer", edge.encode()), (b"cf-ipcountry", b"CH")],
                 "state": state if state is not None else {}}
        result = {}

        async def app(resolved, _receive, _send):
            request = Request({**resolved, "type": "http"})
            result.update(client=resolved["client"], scheme=resolved["scheme"],
                          country=trusted_country(request), auth_address=_client_address(request),
                          state=resolved["state"])
            if kind == "websocket":
                # The room limit reads this same WebSocket.client address.
                from app.main import _websocket_address
                result["websocket_address"] = _websocket_address(WebSocket(resolved, _receive, _send))

        async def receive():
            return {"type": f"{kind}.disconnect"}

        async def send(_message):
            pass

        await TrustedProxyHeadersMiddleware(app, trusted_hosts)(scope, receive, send)
        return result

    async def test_trusted_proxy_resolves_each_http_visitor_and_preserves_country(self):
        for visitor in ("192.0.2.42", "198.51.100.9", "2001:db8::42"):
            with self.subTest(visitor=visitor):
                result = await self.resolve(visitor=visitor)
                self.assertEqual(result["client"], (visitor, 0))
                self.assertEqual(result["auth_address"], visitor)
                self.assertEqual(result["scheme"], "https")
                self.assertEqual(result["country"], "CH")

    async def test_websocket_uses_visitor_for_limit_and_secure_scheme(self):
        result = await self.resolve(kind="websocket", visitor="2001:db8::7", edge="2606:4700::1")
        self.assertEqual(result["websocket_address"], "2001:db8::7")
        self.assertEqual(result["client"], ("2001:db8::7", 0))
        self.assertEqual(result["scheme"], "wss")
        self.assertEqual(result["country"], "CH")

    async def test_untrusted_transport_cannot_forge_visitor_scheme_or_country(self):
        for kind in ("http", "websocket"):
            for peer in ("192.0.2.1", "127.0.0.1", "testclient"):
                with self.subTest(kind=kind, peer=peer):
                    result = await self.resolve(peer=peer, visitor="104.16.4.1", kind=kind)
                    self.assertEqual(result["client"], (peer, 12345))
                    self.assertEqual(result["scheme"], "ws" if kind == "websocket" else "http")
                    self.assertEqual(result["country"], "ZZ")

    async def test_original_edge_must_be_one_valid_cloudflare_ip(self):
        for edge in ("", "192.0.2.1", "104.16.4.1, 192.0.2.1", "104.16.4.1:443", "[2606:4700::1]",
                     "not-an-ip", "104.16.4.999"):
            with self.subTest(edge=edge):
                # Even a visitor address in a CF network cannot revive the
                # direct-ingress fallback after an invalid edge header.
                result = await self.resolve(visitor="104.16.4.2", edge=edge)
                self.assertEqual(result["client"], ("104.16.4.2", 0))
                self.assertEqual(result["country"], "ZZ")
        for values in ([], [(b"x-rtd-cloudflare-peer", b"104.16.4.1"),
                           (b"x-rtd-cloudflare-peer", b"104.16.4.1")]):
            with self.subTest(values=values):
                result = await self.resolve(headers=[(b"x-forwarded-for", b"104.16.4.2"),
                                                    (b"cf-ipcountry", b"CH"), *values])
                self.assertEqual(result["country"], "ZZ")

    async def test_country_value_remains_allowlisted(self):
        for value, expected in ((b"ch", "CH"), (b"INVALID", "ZZ"), (b"CH, DE", "ZZ")):
            with self.subTest(value=value):
                result = await self.resolve(headers=[(b"x-forwarded-for", b"192.0.2.42"),
                                                    (b"x-rtd-cloudflare-peer", b"104.16.4.1"),
                                                    (b"cf-ipcountry", value)])
                self.assertEqual(result["country"], expected)

    async def test_exact_and_cidr_trust_apply_to_raw_peer(self):
        for hosts, peer in (("127.0.0.1, 172.18.0.1", "172.18.0.1"), ("172.18.0.0/24", "172.18.0.8"),
                            (["::1"], "::1"), ("fd00::/64", "fd00::42")):
            with self.subTest(hosts=hosts, peer=peer):
                result = await self.resolve(peer=peer, trusted_hosts=hosts)
                self.assertEqual(result["client"], ("192.0.2.42", 0))
                self.assertEqual(result["country"], "CH")
        result = await self.resolve(peer="172.18.1.8", trusted_hosts="172.18.0.0/24")
        self.assertEqual(result["client"], ("172.18.1.8", 12345))
        self.assertEqual(result["country"], "ZZ")

    async def test_wildcard_forwarding_never_authenticates_country_header(self):
        result = await self.resolve(peer="192.0.2.1", trusted_hosts="*")
        self.assertEqual(result["client"], ("192.0.2.42", 0))
        self.assertEqual(result["country"], "ZZ")

    async def test_direct_cloudflare_peer_keeps_existing_country_behavior(self):
        result = await self.resolve(peer="2606:4700::1", visitor="192.0.2.42", edge="192.0.2.1")
        self.assertEqual(result["client"], ("2606:4700::1", 12345))
        self.assertEqual(result["country"], "CH")

    async def test_ingress_state_does_not_bleed_into_later_requests(self):
        accepted = await self.resolve()
        rejected = await self.resolve(peer="192.0.2.1", state=accepted["state"])
        self.assertEqual(rejected["country"], "ZZ")
        self.assertIsNot(rejected["state"], accepted["state"])
        self.assertEqual(trusted_country(Request({"type": "http", "client": ("192.0.2.1", 9),
                                                "headers": [(b"cf-ipcountry", b"CH")],
                                                "state": {"_rollthedice_verified_ingress": {
                                                    "cloudflare_peer": "104.16.4.1"}}})), "ZZ")

    async def test_lifespan_reaches_inner_application_unchanged(self):
        scope = {"type": "lifespan", "state": {"existing": True}}
        received = []

        async def app(resolved, receive, send):
            received.append(resolved)

        await TrustedProxyHeadersMiddleware(app)(scope, None, None)
        self.assertEqual(received, [scope])
        self.assertEqual(scope["state"], {"existing": True})

    async def test_factory_keeps_fastapi_lifespan_and_explicit_environment_trust(self):
        from app import main

        for env, expected in (({}, "127.0.0.1"), ({"FORWARDED_ALLOW_IPS": "172.18.0.1"}, "172.18.0.1")):
            with self.subTest(env=env), patch.dict(os.environ, env, clear=True):
                wrapper = create_application()
                self.assertIs(wrapper.app.app, main.app)
                self.assertIn(expected, wrapper.app.trusted_hosts)
                self.assertNotIn("192.0.2.1", wrapper.app.trusted_hosts)


if __name__ == "__main__":
    unittest.main()
