"""Close the reserved Watten origin until its product is ready to open."""

from __future__ import annotations

from starlette.requests import HTTPConnection
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .product_hosts import is_watten_host

_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}
_UNAVAILABLE = (
    "Watten ist noch nicht verfügbar. Bitte versuche es später erneut.\n"
    "Watten is not available yet. Please try again later.\n"
)
_UNPUBLISHED_PATHS = frozenset({
    "/sitemap.xml",
    "/manifest.webmanifest", "/manifest-en.webmanifest",
    "/zilch-manifest.webmanifest", "/zilch-manifest-en.webmanifest",
    "/hausdepp-manifest.webmanifest", "/hausdepp-manifest-en.webmanifest",
    "/watten-manifest.webmanifest", "/watten-manifest-en.webmanifest",
    "/sw.js", "/zilch-sw.js", "/hausdepp-sw.js", "/watten-sw.js",
})


class WattenReadinessMiddleware:
    """Deny HTTP and WebSocket entry before any legacy or account routing.

    This is a closed staging boundary, not a game adapter or an access grant.
    Only the existing database readiness probe is forwarded to the app.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"} or not is_watten_host(HTTPConnection(scope)):
            await self.app(scope, receive, send)
            return
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008, "reason": "Watten is not available yet."})
            return

        method = scope["method"]
        path = scope["path"]
        if method in {"GET", "HEAD"} and path == "/api/health":
            async def send_health(message: Message) -> None:
                if message["type"] == "http.response.start":
                    headers = [(key, value) for key, value in message["headers"]
                               if key.lower() not in {b"cache-control", b"x-robots-tag"}]
                    headers.extend((key.lower().encode("ascii"), value.encode("ascii"))
                                   for key, value in _HEADERS.items())
                    message = {**message, "headers": headers}
                elif method == "HEAD" and message["type"] == "http.response.body":
                    message = {**message, "body": b""}
                await send(message)

            # FastAPI's explicit GET route does not automatically handle HEAD.
            # Use the same readiness check, status and headers without a body.
            await self.app({**scope, "method": "GET"} if method == "HEAD" else scope, receive, send_health)
            return

        robots = method in {"GET", "HEAD"} and path == "/robots.txt"
        response = PlainTextResponse(
            "User-agent: *\nDisallow: /\n" if robots else _UNAVAILABLE,
            status_code=200 if robots else 404 if path in _UNPUBLISHED_PATHS else 503,
            headers=_HEADERS,
        )
        if method == "HEAD":
            response.body = b""
        await response(scope, receive, send)
