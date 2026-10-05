"""Sitewide HTTP demand stays aggregate, bounded and independent of visits."""
import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from sqlalchemy import func, select
from starlette.responses import Response
from starlette.testclient import TestClient

from app import analytics, main
from app.analytics import AnalyticsEvent, AnalyticsRequestBucket, AnalyticsSession, dashboard_stats, persist_batches
from app.database import configure_database, get_engine, session_scope, upgrade_database


class RequestAnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/request-analytics.sqlite",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        self.buckets = patch.object(analytics, "_request_buckets", {})
        self.buckets.start()
        self.dropped = patch.object(analytics, "_request_dropped", 0)
        self.dropped.start()

    def tearDown(self):
        if analytics._queue is not None:
            asyncio.run(analytics.stop_analytics())
        self.dropped.stop()
        self.buckets.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def test_agent_claims_prioritize_bots_and_api_clients_before_shared_browser_tokens(self):
        examples = {
            "Mozilla/5.0 Chrome/145.0 Safari/537.36 Googlebot/2.1": "googlebot",
            "Mozilla/5.0 Google-InspectionTool/1.0": "googlebot", "GoogleOther": "google_other",
            "AdsBot-Google (+https://google.com)": "google_other", "bingbot/2.0": "bingbot",
            "Mozilla/5.0 Safari/605.1 Applebot/0.1": "applebot", "DuckDuckBot/1.1": "duckduckbot",
            "YandexBot/3.0": "yandexbot", "Baiduspider/2.0": "baiduspider",
            "facebookexternalhit/1.1": "meta_bot", "meta-externalagent/1.1": "meta_bot",
            "GPTBot/1.2": "openai_bot", "OAI-SearchBot/1.0": "openai_bot", "ChatGPT-User/1.0": "openai_bot",
            "ClaudeBot/1.0": "anthropic_bot", "Claude-SearchBot/1.0": "anthropic_bot",
            "UptimeRobot/2.0": "uptime_bot", "curl/8.0": "curl", "python-requests/2.32": "python_client",
            "Python-urllib/3.13": "python_client", "python-httpx/0.28": "python_client", "aiohttp/3.11": "python_client",
            "node-fetch/3.0": "node_client", "axios/1.8": "node_client", "node": "node_client",
            "Go-http-client/1.1": "go_client", "MysterySpider/1.0": "other_bot",
            "Chrome/145.0 HeadlessChrome/145.0 Safari/537.36": "other_bot",
            "Mozilla/5.0 iPhone CriOS/145.0 Safari/605.1": "browser", "Mozilla/5.0 Firefox/145.0": "browser",
            "PRIVATE_UNRECOGNIZED_UA": "unknown", "": "unknown", "x" * 512 + "Googlebot": "unknown",
        }
        for hint, family in examples.items():
            with self.subTest(hint=hint):
                self.assertEqual(analytics.request_agent_family(hint), family)
        self.assertEqual(analytics.request_agent_family(None), "unknown")

    def test_channels_discard_private_paths_and_queries(self):
        examples = {"/api/games/PRIVATE": "api", "/api": "api", "/static/script.js": "asset",
                    "/manifest-en.webmanifest": "asset", "/sw.js": "asset", "/favicon.ico": "asset",
                    "/": "page", "/admin": "page", "/spiel/PRIVATE": "page", "/spieler/PRIVATE": "page",
                    "/zilch/ergebnis/PRIVATE": "page", "/zdwa/spiel/PRIVATE": "page", "/anmelden": "page",
                    "/.env": "other", "/wp-login.php": "other", "/robots.txt": "other"}
        for path, channel in examples.items():
            with self.subTest(path=path):
                self.assertEqual(analytics.request_channel(path), channel)
        for path in ("/health", "/api/health/", "/admin/dashboard", "/api/admin/analytics/", "/static/dashboard.html"):
            self.assertTrue(analytics.request_traffic_excluded(path))
        self.assertFalse(analytics.request_traffic_excluded("/api/admin/users"))

    def test_outer_middleware_counts_redirects_errors_assets_and_privacy_opt_outs_without_identity(self):
        app = FastAPI()
        app.middleware("http")(main.response_cache_policy)
        app.middleware("http")(main.response_request_traffic)

        @app.get("/api/ok")
        def ok():
            return {"ok": True}

        @app.get("/api/fail")
        def fail():
            raise RuntimeError("PRIVATE_FAILURE")

        @app.post("/api/analytics/events")
        def privacy_opt_out():
            return Response(status_code=204)

        with TestClient(app, client=("104.16.4.1", 1234), raise_server_exceptions=False) as client:
            headers = {"cf-ipcountry": "CH", "user-agent": "Chrome/145.0 Googlebot/2.1 PRIVATE_UA",
                       "cookie": "private_account=PRIVATE_USER", "x-forwarded-for": "192.0.2.1"}
            self.assertEqual(client.get("/api/ok?secret=PRIVATE_QUERY", headers=headers).status_code, 200)
            self.assertEqual(client.get("/api/fail", headers=headers).status_code, 500)
            self.assertEqual(client.get("/api/missing", headers=headers).status_code, 404)
            self.assertEqual(client.get("/static/index.html", headers=headers, follow_redirects=False).status_code, 308)
            self.assertEqual(client.get("/static/zilch.html", headers=headers).status_code, 404)
            self.assertEqual(client.post("/api/analytics/events", headers={**headers, "dnt": "1", "sec-gpc": "1"}).status_code, 204)
            for path in ("/api/health", "/health", "/admin/dashboard", "/api/admin/analytics?days=7"):
                client.get(path, headers=headers, follow_redirects=False)
        with TestClient(app, client=("192.0.2.1", 1234)) as client:
            self.assertEqual(client.get("/api/ok", headers={"cf-ipcountry": "FR", "x-forwarded-for": "104.16.4.1",
                                                          "user-agent": "curl/8.0"}).status_code, 200)
        with TestClient(app, client=("104.16.4.1", 1234)) as client:
            self.assertEqual(client.get("/api/ok", headers={"cf-ipcountry": "PRIVATE", "user-agent": "python-requests/2.32"}).status_code, 200)
        snapshot = analytics._drain_request_buckets()
        self.assertEqual(sum(snapshot.values()), 8)
        self.assertNotIn("PRIVATE", json.dumps(list(snapshot)))
        persist_batches([], request_counts=snapshot)
        stats = dashboard_stats(1)
        traffic = stats["request_traffic"]
        self.assertEqual(traffic["total"], 8)
        self.assertEqual(traffic["countries"], [{"country": "CH", "requests": 6}, {"country": "ZZ", "requests": 2}])
        self.assertEqual({row["status_class"]: row["requests"] for row in traffic["statuses"]}, {"2xx": 4, "3xx": 1, "4xx": 2, "5xx": 1})
        self.assertEqual({row["agent_family"]: row["requests"] for row in traffic["agents"]}, {"googlebot": 6, "curl": 1, "python_client": 1})
        self.assertEqual({row["channel"]: row["requests"] for row in traffic["channels"]}, {"api": 6, "asset": 2})
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(AnalyticsSession)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(AnalyticsEvent)), 0)
            rows = [dict(row.__dict__) for row in db.scalars(select(AnalyticsRequestBucket))]
        text = json.dumps(rows, default=str)
        for secret in ("PRIVATE", "192.0.2.1", "104.16.4.1", "user-agent", "session_id", "query", "cookie", "/api/"):
            self.assertNotIn(secret, text)

    def test_request_totals_are_sitewide_atomic_and_follow_utc_days(self):
        counts = {("2026-10-05", "CH", "2xx", "browser", "page"): 4,
                  ("2026-10-05", "DE", "4xx", "googlebot", "api"): 2,
                  ("2026-10-04", "CH", "3xx", "unknown", "other"): 10,
                  ("2026-10-06", "FR", "2xx", "browser", "page"): 100}
        persist_batches([], request_counts=counts)
        persist_batches([], request_counts={("2026-10-05", "CH", "2xx", "browser", "page"): 3})
        one_day = dashboard_stats(1, now=self.now)["request_traffic"]
        self.assertEqual(one_day["total"], 9)
        self.assertEqual(one_day["first_recorded_at"], "2026-10-04T00:00:00+00:00")
        self.assertEqual(dashboard_stats(7, now=self.now)["request_traffic"]["total"], 19)
        for game in ("zdwa", "zilch"):
            self.assertEqual(dashboard_stats(1, game, now=self.now)["request_traffic"], one_day)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(AnalyticsRequestBucket)), 4)

    def test_pending_and_storage_caps_preserve_existing_counters_and_report_rejections(self):
        with patch.object(analytics, "get_engine", side_effect=AssertionError("Response path must not access SQLite")), \
                patch.object(analytics, "MAX_PENDING_REQUEST_BUCKETS", 2):
            for _ in range(1000):
                self.assertTrue(analytics.record_http_request("CH", 200, agent_family="browser", channel="api", now=self.now))
            self.assertTrue(analytics.record_http_request("DE", 404, now=self.now))
            self.assertFalse(analytics.record_http_request("FR", 500, now=self.now))
            self.assertEqual(len(analytics._request_buckets), 2)
            with analytics._request_lock:
                self.assertFalse(analytics.record_http_request("CH", 200, now=self.now))
        self.assertEqual(analytics._request_dropped, 2)
        with patch.object(analytics, "MAX_STORED_REQUEST_BUCKETS", 1):
            persist_batches([], request_counts=analytics._drain_request_buckets())
            persist_batches([], request_counts={("2026-10-05", "CH", "2xx", "browser", "api"): 5,
                                               ("2026-10-05", "IT", "2xx", "browser", "page"): 3})
        stats = dashboard_stats(1, now=self.now)["request_traffic"]
        self.assertEqual(stats["total"], 1005)
        self.assertEqual(stats["dropped"], 6)
        self.assertEqual(stats["countries"], [{"country": "CH", "requests": 1005}])

    def test_retention_removes_old_daily_buckets_and_empty_collection_is_unknown(self):
        empty = dashboard_stats(1, now=self.now)["request_traffic"]
        self.assertEqual(empty, {"total": 0, "dropped": 0, "countries": [], "statuses": [], "agents": [], "channels": [], "first_recorded_at": None})
        oldest_kept = (self.now - timedelta(days=89)).date().isoformat()
        expired = (self.now - timedelta(days=90)).date().isoformat()
        persist_batches([], request_counts={(oldest_kept, "CH", "2xx", "browser", "page"): 4,
                                           (expired, "DE", "2xx", "browser", "page"): 20})
        persist_batches([], now=self.now, sweep=True)
        stats = dashboard_stats(90, now=self.now)["request_traffic"]
        self.assertEqual(stats["total"], 4)
        self.assertEqual(stats["first_recorded_at"], oldest_kept + "T00:00:00+00:00")

    def test_locked_sqlite_drops_background_counts_and_restores_game_timeout(self):
        async def scenario():
            await analytics.start_analytics()
            self.assertTrue(analytics.record_http_request("CH", 200, agent_family="browser", channel="api", now=self.now))
            self.assertTrue(analytics.record_http_request("CH", 200, agent_family="browser", channel="api", now=self.now))
            await analytics.stop_analytics()

        engine = get_engine()
        with engine.connect() as locked:
            locked.exec_driver_sql("BEGIN IMMEDIATE")
            asyncio.run(scenario())
            locked.rollback()
        self.assertEqual(analytics._request_dropped, 2)
        self.assertEqual(analytics._dropped, 0)
        with engine.connect() as connection:
            self.assertEqual(connection.exec_driver_sql("PRAGMA busy_timeout").scalar(), 30000)
            self.assertEqual(connection.scalar(select(func.count()).select_from(AnalyticsRequestBucket)), 0)
