"""HTTP smoke inside the built production image, with disposable data only.

CI passes this file on stdin to an isolated container. Only loopback GETs are
made; the container has no external network, credentials or persistent mounts.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from http.client import HTTPMessage
from urllib.parse import urlsplit

ORIGIN = "http://127.0.0.1:8000"
PRODUCTS = (
    ("zockdiewandan.online", "/manifest"),
    ("zilch.zockdiewandan.online", "/zilch-manifest"),
    ("hausdepp.zockdiewandan.online", "/hausdepp-manifest"),
)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError(f"Unexpected redirect from a production image route: {newurl}")


def fetch(path: str, host: str) -> tuple[bytes, HTTPMessage]:
    if not path.startswith("/") or path.startswith("//"):
        raise ValueError("Container smoke permits local paths only")
    request = urllib.request.Request(ORIGIN + path, headers={"Host": host})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=3) as response:
        body = response.read(2_000_001)
        assert response.status == 200 and len(body) <= 2_000_000, path
        return body, response.headers


def verify_http() -> None:
    deadline = time.monotonic() + 30
    while True:
        try:
            body, _ = fetch("/api/health", "zockdiewandan.online")
            assert json.loads(body)["status"] == "ok"
            break
        except (urllib.error.URLError, ConnectionError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.25)
    for host, prefix in PRODUCTS:
        for suffix in (".webmanifest", "-en.webmanifest"):
            path = prefix + suffix
            body, headers = fetch(path, host)
            assert headers.get_content_type() == "application/manifest+json", path
            manifest = json.loads(body)
            assert manifest["lang"] == ("en" if suffix.startswith("-en") else "de"), path
            icons = list(manifest["icons"])
            for shortcut in manifest.get("shortcuts", []):
                icons.extend(shortcut.get("icons", []))
            for icon in icons:
                parsed = urlsplit(icon["src"])
                assert not parsed.scheme and not parsed.netloc, icon["src"]
                image, image_headers = fetch(icon["src"], host)
                assert image_headers.get_content_type() == "image/png", icon["src"]
                assert image.startswith(b"\x89PNG\r\n\x1a\n"), icon["src"]
            print(f"PASS production image: {host}{path} and its icons", flush=True)
    for path in ("/hausdepp", "/hausdepp/regeln"):
        body, headers = fetch(path, "hausdepp.zockdiewandan.online")
        assert headers.get_content_type() == "text/html" and b"Hausdepp" in body, path
    _, headers = fetch("/hausdepp-sw.js", "hausdepp.zockdiewandan.online")
    assert headers["Service-Worker-Allowed"] == "/hausdepp"
    print("PASS production image: public Hausdepp pages and isolated service worker", flush=True)


def main() -> None:
    if not os.path.isfile("/app/alembic.ini") or not os.path.isdir("/app/app"):
        raise SystemExit("Run this smoke inside the production image only")
    with tempfile.TemporaryFile(mode="w+t") as logs:
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.asgi:create_application", "--factory",
             "--host", "127.0.0.1", "--port", "8000"],
            stdout=logs, stderr=subprocess.STDOUT,
        )
        try:
            verify_http()
        except BaseException:
            logs.seek(0)
            print(logs.read(), file=sys.stderr)
            raise
        finally:
            server.terminate()
            try:
                server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait(timeout=5)


if __name__ == "__main__":
    main()
