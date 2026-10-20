#!/usr/bin/env python3
"""Read-only public release gate, before the durable announcement outbox.

Uses ordinary verified HTTPS and GET requests only. No account, subscription,
game, notification or external search-console state is changed.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

APEX = "https://zockdiewandan.online"
WWW = "https://www.zockdiewandan.online"
ZILCH = "https://zilch.zockdiewandan.online"
HAUSDEPP = "https://hausdepp.zockdiewandan.online"
ALIAS = "https://zdwa.zockdiewandan.online"
WATTEN = "https://watten.zockdiewandan.online"
SECURITY_HEADERS = (
    "strict-transport-security", "x-content-type-options", "x-frame-options",
    "referrer-policy", "permissions-policy", "content-security-policy",
)


class ReleaseDocument(HTMLParser):
    """Read known metadata only, without XML entity expansion or execution."""

    def __init__(self) -> None:
        super().__init__()
        self.canonicals: set[str] = set()
        self.robots = ""
        self.locations: set[str] = set()
        self.in_location = False
        self.versioned_assets: dict[str, str] = {}
        self.manifests: set[str] = set()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "link" and attributes.get("rel") == "canonical" and attributes.get("href"):
            self.canonicals.add(str(attributes["href"]))
        if tag == "meta" and attributes.get("name") == "robots":
            self.robots = str(attributes.get("content", ""))
        if tag == "link" and attributes.get("rel") == "manifest" and attributes.get("href"):
            self.manifests.add(urlsplit(str(attributes["href"])).path)
        if tag == "loc":
            self.in_location = True
        asset = attributes.get("src") if tag == "script" else (
            attributes.get("href") if tag == "link" and attributes.get("rel") == "stylesheet" else None
        )
        if asset:
            parsed = urlsplit(asset)
            versions = parse_qs(parsed.query).get("v")
            if parsed.path.startswith("/static/") and versions:
                self.versioned_assets[parsed.path] = versions[0]

    def handle_endtag(self, tag: str) -> None:
        if tag == "loc":
            self.in_location = False

    def handle_data(self, data: str) -> None:
        if self.in_location:
            self.locations.add(data.strip())


class KnownProductRedirect(urllib.request.HTTPRedirectHandler):
    """A readiness GET may redirect only to its explicitly expected origin."""

    def __init__(self, expected_url: str) -> None:
        super().__init__()
        parsed = urlsplit(expected_url)
        self.expected_origin = (parsed.scheme, parsed.netloc)

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        if (parsed.scheme, parsed.netloc) != self.expected_origin:
            raise ValueError(f"Readiness request would leave its expected product origin: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url: str, *, final_url: str | None = None) -> tuple[str, dict[str, str]]:
    request = urllib.request.Request(url, headers={"User-Agent": "ZDWA-release-readiness/3"})
    opener = urllib.request.build_opener(KnownProductRedirect(final_url or url))
    with opener.open(request, timeout=30) as response:
        if response.status != 200:
            raise ValueError(f"{url}: expected 200, got {response.status}")
        if response.url != (final_url or url):
            raise ValueError(f"{url}: unexpected redirect to {response.url}")
        # No cookies are stored or replayed by this client.
        headers = {key.lower(): value for key, value in response.headers.items()}
        body = response.read(2_000_001)
        if len(body) > 2_000_000:
            raise ValueError(f"{url}: oversized response")
    return body.decode("utf-8"), headers


def verify_release() -> None:
    checkout = Path(__file__).resolve().parents[1]
    expected_version = json.loads((checkout / "app/version.json").read_text(encoding="utf-8"))["version"]
    expected_page = ReleaseDocument()
    expected_page.feed((checkout / "app/static/hausdepp-lobby.html").read_text(encoding="utf-8"))
    if not expected_page.versioned_assets:
        raise ValueError("Local Hausdepp lobby has no versioned script/style assets")
    for origin in (APEX, WWW, ZILCH, HAUSDEPP):
        body, headers = fetch(f"{origin}/api/health")
        if json.loads(body).get("status") != "ok":
            raise ValueError(f"{origin}: unhealthy application")
        missing = [name for name in SECURITY_HEADERS if not headers.get(name)]
        if missing:
            raise ValueError(f"{origin}: missing security headers {', '.join(missing)}")
        print(f"Public TLS, health and headers ready: {origin}")
    fetch(f"{ALIAS}/api/health", final_url=f"{APEX}/api/health")
    fetch(f"{APEX}/")
    fetch(f"{ZILCH}/")
    fetch(f"{HAUSDEPP}/", final_url=f"{HAUSDEPP}/hausdepp")
    version, _ = fetch(f"{HAUSDEPP}/api/releases?game_type=hausdepp")
    if json.loads(version).get("current_version") != expected_version:
        raise ValueError(f"Public application is not running expected version {expected_version}")
    capabilities = {}
    for origin in (APEX, HAUSDEPP):
        body, _ = fetch(f"{origin}/api/auth/me")
        auth = json.loads(body)
        passkeys = auth.get("passkeys", {})
        if (auth.get("authenticated") is not False or auth.get("user") is not None
                or set(passkeys) != {"enabled"} or type(passkeys.get("enabled")) is not bool):
            raise ValueError(f"{origin}: anonymous identity response contains private or invalid account state")
        capabilities[origin] = passkeys["enabled"]
        if origin == HAUSDEPP and auth.get("game_access", {}).get("hausdepp_public") is not True:
            raise ValueError("Hausdepp must advertise public discovery before release")
    if capabilities[HAUSDEPP] != capabilities[APEX]:
        raise ValueError("Hausdepp passkey availability must match the trusted apex origin")
    house_login = f"{HAUSDEPP}/hausdepp/anmelden?return_to=%2Fhausdepp%2Fkonto"
    for destination in (house_login, f"{HAUSDEPP}/hausdepp/konto"):
        body, headers = fetch(destination, final_url=house_login)
        login = ReleaseDocument()
        login.feed(body)
        if (login.manifests != {"/hausdepp-manifest.webmanifest"}
                or 'data-hausdepp-login="true"' not in body
                or "noindex" not in headers.get("x-robots-tag", "").lower()
                or "no-store" not in headers.get("cache-control", "").lower()):
            raise ValueError("Hausdepp private pages must use their uncached, in-origin product sign-in")
    for path in ("/hausdepp", "/hausdepp/regeln"):
        body, headers = fetch(f"{HAUSDEPP}{path}")
        canonical = f"{HAUSDEPP}{path}"
        page = ReleaseDocument()
        page.feed(body)
        if canonical not in page.canonicals or "noindex" in headers.get("x-robots-tag", "").lower():
            raise ValueError(f"{canonical}: public canonical or indexing policy is missing")
        if "noindex" in page.robots.lower():
            raise ValueError(f"{canonical}: public page still contains noindex")
        if path == "/hausdepp" and page.versioned_assets != expected_page.versioned_assets:
            raise ValueError("Public Hausdepp lobby references stale or unexpected script/style asset revisions")
    body, _ = fetch(f"{HAUSDEPP}/sitemap.xml")
    sitemap = ReleaseDocument()
    sitemap.feed(body)
    if sitemap.locations != {f"{HAUSDEPP}/hausdepp", f"{HAUSDEPP}/hausdepp/regeln"}:
        raise ValueError("Hausdepp sitemap must contain exactly its public lobby and rules")
    robots, _ = fetch(f"{HAUSDEPP}/robots.txt")
    if f"Sitemap: {HAUSDEPP}/sitemap.xml" not in robots:
        raise ValueError("Hausdepp robots.txt is missing its own sitemap")
    for suffix in (".webmanifest", "-en.webmanifest"):
        body, _ = fetch(f"{HAUSDEPP}/hausdepp-manifest{suffix}")
        manifest = json.loads(body)
        if not manifest.get("start_url", "").startswith("/hausdepp"):
            raise ValueError("Hausdepp manifest has a foreign start URL")
    _, headers = fetch(f"{HAUSDEPP}/hausdepp-sw.js")
    if headers.get("service-worker-allowed") != "/hausdepp":
        raise ValueError("Hausdepp service worker must remain scoped to /hausdepp")
    # A release with the beta flag disabled retains its closed reservation.
    auth_body, _ = fetch(f"{APEX}/api/auth/me")
    if json.loads(auth_body).get("game_access", {}).get("watten_public") is True:
        verify_watten(checkout)
    print("Public lobbies, rules, canonical sitemaps, in-origin sign-in and isolated PWAs ready")



def verify_watten(checkout: Path) -> None:
    expected = ReleaseDocument()
    expected.feed((checkout / "app/static/watten-game.html").read_text(encoding="utf-8"))
    body, headers = fetch(f"{WATTEN}/api/health")
    if json.loads(body).get("status") != "ok" or any(not headers.get(key) for key in SECURITY_HEADERS):
        raise ValueError("Watten health, TLS or security headers are incomplete")
    body, _ = fetch(f"{WATTEN}/api/auth/me")
    if json.loads(body).get("game_access", {}).get("watten_public") is not True:
        raise ValueError("Watten beta is not publicly discoverable")
    fetch(f"{WATTEN}/", final_url=f"{WATTEN}/watten")
    for path in ("/watten", "/watten/regeln"):
        for suffix in ("", "?lang=en"):
            body, headers = fetch(f"{WATTEN}{path}{suffix}")
            page = ReleaseDocument()
            page.feed(body)
            if f"{WATTEN}{path}{suffix}" not in page.canonicals or "noindex" in page.robots.lower() or "noindex" in headers.get("x-robots-tag", "").lower():
                raise ValueError(f"Watten public metadata/indexing invalid: {path}{suffix}")
            if path == "/watten" and page.versioned_assets != expected.versioned_assets:
                raise ValueError("Watten public lobby references stale assets")
    body, _ = fetch(f"{WATTEN}/sitemap.xml")
    page = ReleaseDocument()
    page.feed(body)
    expected_urls = {f"{WATTEN}{path}{suffix}" for path in ("/watten", "/watten/regeln") for suffix in ("", "?lang=en")}
    if page.locations != expected_urls:
        raise ValueError("Watten sitemap must contain only the public DE/EN lobby and rules")
    robots, _ = fetch(f"{WATTEN}/robots.txt")
    if f"Sitemap: {WATTEN}/sitemap.xml" not in robots:
        raise ValueError("Watten robots.txt lacks its own sitemap")
    for suffix in (".webmanifest", "-en.webmanifest"):
        body, _ = fetch(f"{WATTEN}/watten-manifest{suffix}")
        manifest = json.loads(body)
        if manifest.get("start_url") != "/watten?pwa=watten" or manifest.get("scope") != "/" or "BETA" not in manifest.get("name", ""):
            raise ValueError("Watten install metadata is incomplete")
        for icon in manifest.get("icons", []):
            icon_path = urlsplit(icon["src"]).path
            if not icon_path.startswith("/static/watten/icons/") or not (checkout / "app" / icon_path.lstrip("/")).is_file():
                raise ValueError("Watten icon is missing or belongs to another product")
    _, headers = fetch(f"{WATTEN}/watten-sw.js")
    if headers.get("service-worker-allowed") != "/":
        raise ValueError("The dedicated Watten PWA must keep its suite navigation within its own origin")
    print("Watten [BETA]: canonical DE/EN pages, sitemap, robots, PWA and icons ready")

def main() -> int:
    try:
        verify_release()
    except (urllib.error.URLError, ValueError, KeyError) as error:
        print(f"Public release gate FAILED: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
