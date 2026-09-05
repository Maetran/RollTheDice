"""HTTP contracts for the private Zilch product routes.

These checks keep the browser shell routes behind the same central preview
policy as gameplay and ensure that the UI reads numeric rule facts from the
server instead of carrying an independent rules copy.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

import httpx
from starlette.requests import Request

from app import main
from app.auth import LEGACY_SESSION_COOKIE, SHARED_SESSION_COOKIE, create_user, login
from app.database import configure_database, upgrade_database
from app.game_state import games
from app.product_hosts import safe_zilch_path, validate_product_host_config
from app.zilch_engine import (
    ZILCH_BANK_MINIMUM,
    ZILCH_CONFIRMATION_MINIMUM,
    ZILCH_DICE_COUNT,
    ZILCH_RULESET_VERSION,
    ZILCH_TARGET_SCORE,
    ZILCH_THIRD_ROLL_MINIMUM,
    ZILCH_ZILCH_STREAK_PENALTY,
)
from app.zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    validate_zilch_solo_objective_definition,
)
from app.zilch_state import (
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)


def request_for(*, cookie: str = "") -> Request:
    headers = [(b"host", b"testserver")]
    if cookie:
        headers.append((b"cookie", cookie.encode("ascii")))
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "http",
            "path": "/",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("testserver", 80),
        }
    )


class ZilchProductRoutesTestCase(TestCase):
    """Zilch audience, SEO, rules-projection and lobby-summary boundaries."""

    def setUp(self) -> None:
        self.game_ids: list[str] = []
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-product-routes.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_COOKIE_DOMAIN": "",
                "ROLLTHEDICE_SITE_ORIGIN": "https://zockdiewandan.online",
                "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.zockdiewandan.online",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_ACCESS_MODE": "preview",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)

    def tearDown(self) -> None:
        for game_id in self.game_ids:
            games.pop(game_id, None)
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    @staticmethod
    def _get(
        path: str,
        token: str | None = None,
        *,
        host: str = "testserver",
        cookie_name: str = LEGACY_SESSION_COOKIE,
        follow_redirects: bool = False,
    ) -> httpx.Response:
        async def request() -> httpx.Response:
            transport = httpx.ASGITransport(app=main.app)
            cookies = {cookie_name: token} if token else None
            async with httpx.AsyncClient(transport=transport, base_url=f"https://{host}") as client:
                return await client.get(path, cookies=cookies, follow_redirects=follow_redirects)

        return asyncio.run(request())

    @staticmethod
    def _identity(username: str, *, role: str = "user") -> tuple[int, str]:
        password = f"{username}-secure-password-123"
        user = create_user(username, password, role=role, must_change_password=False)
        _identity, token = login(request_for(), username, password)
        return user.id, token

    def test_history_rules_shells_and_rules_api_use_the_central_preview_policy(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")
        _normal_id, normal_token = self._identity("Normal")

        for path in (
            "/zilch/historie",
            "/zilch/statistiken",
            "/zilch/bestenlisten",
            "/zilch/konto",
            "/zilch/regeln",
            "/api/zilch/rules",
        ):
            with self.subTest(path=path, identity="anonymous"):
                self.assertEqual(self._get(path).status_code, 401)
            with self.subTest(path=path, identity="normal"):
                self.assertEqual(self._get(path, normal_token).status_code, 403)

        for path in ("/zilch/historie", "/zilch/statistiken", "/zilch/bestenlisten", "/zilch/konto", "/zilch/regeln"):
            with self.subTest(path=path):
                response = self._get(path, mani_token)
                self.assertEqual(response.status_code, 200)
                self.assertIn('name="robots" content="noindex, nofollow"', response.text)
                self.assertIn("no-cache", response.headers.get("cache-control", ""))

        rules = self._get("/api/zilch/rules", mani_token)
        self.assertEqual(rules.status_code, 200)
        self.assertEqual(
            rules.json(),
            {
                "ruleset": ZILCH_RULESET_VERSION,
                "dice_count": ZILCH_DICE_COUNT,
                "target_score": ZILCH_TARGET_SCORE,
                "bank_minimum": ZILCH_BANK_MINIMUM,
                "third_roll_minimum": ZILCH_THIRD_ROLL_MINIMUM,
                "confirmation_minimum": ZILCH_CONFIRMATION_MINIMUM,
                "third_zilch_penalty": ZILCH_ZILCH_STREAK_PENALTY,
                "solo_objective": validate_zilch_solo_objective_definition(
                    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
                    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
                ).payload(),
                "scoring": {
                    "single_one": 100,
                    "single_five": 50,
                    "three_ones": 1_000,
                    "straight": 2_000,
                    "three_pairs": 500,
                    "nothing_bonus": 500,
                },
            },
        )
        self.assertEqual(self._get("/static/zilch.html", mani_token).status_code, 404)

    def test_login_entry_is_public_but_the_private_shell_stays_protected(self) -> None:
        login_page = self._get("/zilch/anmelden?return_to=/zilch/statistiken")
        self.assertEqual(login_page.status_code, 200)
        self.assertIn('name="robots" content="noindex, nofollow"', login_page.text)
        self.assertIn("zilchLoginForm", login_page.text)
        self.assertIn("no-cache", login_page.headers.get("cache-control", ""))
        self.assertEqual(self._get("/static/zilch-login.html").status_code, 404)
        self.assertEqual(self._get("/zilch").status_code, 401)

    def test_product_handoff_accepts_only_fixed_zilch_destinations(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")

        with patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_COOKIE_DOMAIN": "zockdiewandan.online",
                "ROLLTHEDICE_COOKIE_SECURE": "1",
            },
        ):
            valid = self._get(
                "/auth/continue?app=zilch&path=%2Fstatistiken%3Fscope%3Dmine",
                mani_token,
                host="zockdiewandan.online",
            )
        self.assertEqual(valid.status_code, 303)
        self.assertEqual(valid.headers["location"], "https://zilch.zockdiewandan.online/statistiken?scope=mine")
        self.assertEqual(valid.headers["cache-control"], "no-store")
        promoted_cookie = valid.headers["set-cookie"]
        self.assertIn(f"{SHARED_SESSION_COOKIE}={mani_token}", promoted_cookie)
        self.assertIn("Domain=zockdiewandan.online", promoted_cookie)
        self.assertIn("HttpOnly", promoted_cookie)
        self.assertIn("Secure", promoted_cookie)

        async def follow_shared_cookie() -> httpx.Response:
            transport = httpx.ASGITransport(app=main.app)
            async with httpx.AsyncClient(transport=transport, follow_redirects=True) as client:
                client.cookies.set(
                    SHARED_SESSION_COOKIE,
                    mani_token,
                    domain="zockdiewandan.online",
                    path="/",
                )
                return await client.get(
                    "https://zockdiewandan.online/auth/continue?app=zilch&path=%2Fstatistiken"
                )

        followed = asyncio.run(follow_shared_cookie())
        self.assertEqual(followed.status_code, 200)
        self.assertEqual(str(followed.url), "https://zilch.zockdiewandan.online/statistiken")
        self.assertIn("data-zilch-root", followed.text)

        for malicious_path in (
            "https%3A%2F%2Fevil.example%2Fsteal",
            "%2F%2Fevil.example%2Fsteal",
            "%2Fnot-a-zilch-route",
        ):
            with self.subTest(path=malicious_path):
                rejected = self._get(
                    f"/auth/continue?app=zilch&path={malicious_path}",
                    mani_token,
                    host="zockdiewandan.online",
                )
                self.assertEqual(rejected.status_code, 303)
                self.assertEqual(rejected.headers["location"], "https://zilch.zockdiewandan.online/")

        unknown_product = self._get(
            "/auth/continue?app=outside&path=%2F",
            mani_token,
            host="zockdiewandan.online",
        )
        self.assertEqual(unknown_product.status_code, 404)

        for wrong_host in (
            "www.zockdiewandan.online",
            "zilch.zockdiewandan.online",
            "unknown.zockdiewandan.online",
        ):
            with self.subTest(wrong_host=wrong_host):
                wrong_host_response = self._get(
                    "/auth/continue?app=zilch&path=%2F",
                    mani_token,
                    host=wrong_host,
                )
                self.assertEqual(wrong_host_response.status_code, 404)

        _normal_id, normal_token = self._identity("NormalHandoff")
        denied = self._get(
            "/auth/continue?app=zilch&path=%2Fstatistiken",
            normal_token,
            host="zockdiewandan.online",
        )
        self.assertEqual(denied.status_code, 303)
        self.assertEqual(denied.headers["location"], "https://zockdiewandan.online/zilch/anmelden")

        anonymous = self._get(
            "/auth/continue?app=zilch&path=https%3A%2F%2Fevil.example%2Fsteal",
            host="zockdiewandan.online",
        )
        self.assertEqual(anonymous.status_code, 303)
        self.assertTrue(anonymous.headers["location"].startswith("https://zockdiewandan.online/zilch/anmelden?"))
        self.assertNotIn("evil.example", anonymous.headers["location"])

    def test_product_origin_configuration_is_fixed_to_the_shared_cookie_site(self) -> None:
        self.assertEqual(safe_zilch_path("/spiel/abc?resume=1"), "/spiel/abc?resume=1")
        self.assertEqual(safe_zilch_path("https://evil.example/spiel/abc"), "/")
        for unsafe_path in (
            "/spiel/../admin",
            "/spiel/%2e%2e/admin",
            "/spiel/%252e%252e%252fadmin",
            "/spiel/one/two",
            "/spieler/name/extra",
            "/ergebnis/",
        ):
            with self.subTest(unsafe_path=unsafe_path):
                self.assertEqual(safe_zilch_path(unsafe_path), "/")
        validate_product_host_config()

        with patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_COOKIE_DOMAIN": "zockdiewandan.online",
                "ROLLTHEDICE_ZILCH_ORIGIN": "https://zilch.unrelated.example",
            },
        ):
            with self.assertRaisesRegex(RuntimeError, "ROLLTHEDICE_COOKIE_DOMAIN"):
                validate_product_host_config()

        for invalid_zilch_origin in (
            "https://zockdiewandan.online:444",
            "https://zilch.zockdiewandan.online:not-a-port",
            "https://zilch.zockdiewandan.online:70000",
        ):
            with self.subTest(invalid_zilch_origin=invalid_zilch_origin):
                with patch.dict(
                    os.environ,
                    {"ROLLTHEDICE_ZILCH_ORIGIN": invalid_zilch_origin},
                ):
                    with self.assertRaises(RuntimeError):
                        validate_product_host_config()

    def test_zilch_host_serves_clean_private_routes_with_noindex_headers(self) -> None:
        _mani_id, mani_token = self._identity("Mani", role="admin")
        for path in (
            "/",
            "/historie",
            "/statistiken",
            "/bestenlisten",
            "/erfolge",
            "/konto",
            "/regeln",
            "/spieler/Mani",
        ):
            with self.subTest(path=path):
                response = self._get(
                    path,
                    mani_token,
                    host="zilch.zockdiewandan.online",
                    cookie_name=SHARED_SESSION_COOKIE,
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")
                self.assertIn('name="robots" content="noindex, nofollow"', response.text)
                self.assertIn("data-zilch-root", response.text)

        prefixed = self._get(
            "/zilch/statistiken?scope=mine",
            mani_token,
            host="zilch.zockdiewandan.online",
            cookie_name=SHARED_SESSION_COOKIE,
        )
        self.assertEqual(prefixed.status_code, 308)
        self.assertEqual(prefixed.headers["location"], "/statistiken?scope=mine")
        self.assertEqual(prefixed.headers["x-robots-tag"], "noindex, nofollow")

        for malicious_path in ("/zilch//evil.example", "/zilch/%2F%2Fevil.example"):
            with self.subTest(path=malicious_path):
                malicious_redirect = self._get(
                    malicious_path,
                    mani_token,
                    host="zilch.zockdiewandan.online",
                    cookie_name=SHARED_SESSION_COOKIE,
                )
                self.assertEqual(malicious_redirect.status_code, 308)
                self.assertEqual(malicious_redirect.headers["location"], "/")

    def test_anonymous_zilch_host_routes_return_only_to_the_fixed_apex_handoff(self) -> None:
        root = self._get("/", host="zilch.zockdiewandan.online")
        self.assertEqual(root.status_code, 303)
        self.assertEqual(
            root.headers["location"],
            "https://zockdiewandan.online/auth/continue?app=zilch&path=%2F",
        )

        malicious_login_return = self._get(
            "/anmelden?return_to=https%3A%2F%2Fevil.example%2Fsteal",
            host="zilch.zockdiewandan.online",
        )
        self.assertEqual(malicious_login_return.status_code, 303)
        self.assertEqual(
            malicious_login_return.headers["location"],
            "https://zockdiewandan.online/auth/continue?app=zilch&path=%2F",
        )

    def test_private_zilch_host_blocks_the_zdwa_pwa_and_crawler_discovery(self) -> None:
        host = "zilch.zockdiewandan.online"
        robots = self._get("/robots.txt", host=host)
        self.assertEqual(robots.status_code, 200)
        self.assertEqual(robots.text, "User-agent: *\nDisallow: /\n")
        self.assertNotIn("x-robots-tag", robots.headers)

        for path in ("/manifest.webmanifest", "/manifest-en.webmanifest", "/sw.js"):
            with self.subTest(path=path):
                response = self._get(path, host=host)
                self.assertEqual(response.status_code, 404)
                self.assertIn("no-store", response.headers["cache-control"])
                self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")

        sitemap = self._get("/sitemap.xml", host=host)
        self.assertEqual(sitemap.status_code, 404)
        self.assertIn("no-store", sitemap.headers["cache-control"])
        self.assertNotIn("x-robots-tag", sitemap.headers)

    def test_explicit_allowlist_uses_the_same_private_rules_route_policy(self) -> None:
        _preview_id, preview_token = self._identity("PreviewFriend")

        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "previewfriend"}):
            self.assertEqual(self._get("/zilch/historie", preview_token).status_code, 200)
            self.assertEqual(self._get("/zilch/statistiken", preview_token).status_code, 200)
            self.assertEqual(self._get("/zilch/bestenlisten", preview_token).status_code, 200)
            self.assertEqual(self._get("/zilch/regeln", preview_token).status_code, 200)
            self.assertEqual(self._get("/api/zilch/rules", preview_token).status_code, 200)

    def test_public_mode_admits_guests_but_keeps_account_data_private(self) -> None:
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"}):
            auth = self._get("/api/auth/me")
            self.assertEqual(auth.status_code, 200)
            self.assertFalse(auth.json()["authenticated"])
            self.assertEqual(auth.json()["game_access"], {"zilch_preview": True, "zilch_public": True})

            for path in ("/", "/regeln"):
                with self.subTest(path=path):
                    response = self._get(path, host="zilch.zockdiewandan.online")
                    self.assertEqual(response.status_code, 200)
                    self.assertNotIn("noindex", response.headers.get("x-robots-tag", ""))
                    self.assertNotIn('name="robots" content="noindex, nofollow"', response.text)
                    self.assertEqual(
                        response.headers["link"],
                        f"<https://zilch.zockdiewandan.online{path}>; rel=\"canonical\"",
                    )
                    self.assertIn("data-zilch-root", response.text)

            robots = self._get("/robots.txt", host="zilch.zockdiewandan.online")
            self.assertEqual(robots.status_code, 200)
            self.assertIn("Allow: /", robots.text)
            self.assertIn("Sitemap: https://zilch.zockdiewandan.online/sitemap.xml", robots.text)
            sitemap = self._get("/sitemap.xml", host="zilch.zockdiewandan.online")
            self.assertEqual(sitemap.status_code, 200)
            self.assertIn("https://zilch.zockdiewandan.online/</loc>", sitemap.text)
            self.assertIn("https://zilch.zockdiewandan.online/regeln</loc>", sitemap.text)

            for path in ("/bestenlisten", "/spieler/does-not-matter"):
                with self.subTest(path=path):
                    response = self._get(path, host="zilch.zockdiewandan.online")
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.headers["x-robots-tag"], "noindex, nofollow")

            self.assertEqual(self._get("/api/zilch/rules").status_code, 200)
            self.assertEqual(self._get("/api/zilch/leaderboards/categories").status_code, 200)
            self.assertEqual(self._get("/api/zilch/leaderboards?category=solo_sprint").status_code, 200)
            self.assertEqual(self._get("/api/zilch/statistics").status_code, 401)
            self.assertEqual(self._get("/statistiken", host="zilch.zockdiewandan.online").status_code, 401)

            create = main.CreateReq.model_validate(
                {
                    "name": "Gast gegen CPU",
                    "mode": "2",
                    "game_type": "zilch",
                    "play_mode": "cpu",
                    "cpu_strategy": "normal",
                }
            )
            with patch("app.main.enforce_game_creation_rate_limit"):
                created = asyncio.run(main.api_games_create(create, request_for()))
            game_id = created["game_id"]
            self.game_ids.append(game_id)
            self.assertRegex(created["host_token"], r"^[A-Za-z0-9_-]{32,}$")
            self.assertIsNone(games[game_id]["_zilch_cpu_host_user_id"])
            self.assertNotIn(created["host_token"], repr(games[game_id]))

    def test_private_zilch_routes_are_not_globally_precached_by_the_shared_pwa(self) -> None:
        service_worker = (main.STATIC_DIR / "sw.js").read_text(encoding="utf-8")
        self.assertNotIn("'/static/zilch.js'", service_worker)
        self.assertNotIn("'/static/zilch.css'", service_worker)
        self.assertIn("url.pathname === '/zilch' || url.pathname.startsWith('/zilch/')", service_worker)

        manifest = (main.BASE / "manifest.webmanifest").read_text(encoding="utf-8")
        self.assertIn('"short_name": "ZDWA"', manifest)
        self.assertNotIn('"url": "/zilch', manifest)
        for shell_name in ("zilch.html", "zilch-login.html"):
            with self.subTest(shell_name=shell_name):
                shell = (main.STATIC_DIR / shell_name).read_text(encoding="utf-8")
                self.assertNotIn('rel="manifest"', shell)

    def test_zilch_lobby_exposes_only_safe_turn_and_final_round_hints(self) -> None:
        mani_id, mani_token = self._identity("Mani", role="admin")
        preview_id, _preview_token = self._identity("PreviewFriend")
        game_id = "zilch-lobby-product-summary"
        self.game_ids.append(game_id)
        game = new_zilch_game(game_id, "Final stretch", 2)
        join_zilch_player(game, {"id": "p1", "name": "Mani", "user_id": mani_id, "ws": None})
        join_zilch_player(game, {"id": "p2", "name": "PreviewFriend", "user_id": preview_id, "ws": None})
        start_zilch_game(game)
        record_zilch_start_roll(game, "p1", 6)
        record_zilch_start_roll(game, "p2", 2)
        game["_zilch_final_round"] = {"triggered_by": "p1", "pending_player_ids": ["p2"]}

        response = self._get("/api/games?game_type=zilch", mani_token)
        self.assertEqual(response.status_code, 200)
        entry = next(item for item in response.json()["games"] if item["id"] == game_id)
        self.assertEqual(entry["current_player_id"], "p1")
        self.assertEqual(entry["current_player_name"], "Mani")
        self.assertEqual(entry["final_round"], {"triggered_by": "p1", "pending_player_ids": ["p2"]})
        self.assertNotIn("target_score", entry["final_round"])
