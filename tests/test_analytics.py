"""Telemetry privacy, capability boundaries and truthful bounded aggregation."""
import asyncio
import json
import os
import queue
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI, HTTPException
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request
from starlette.responses import Response
from starlette.testclient import TestClient

from app import analytics, main
from app.analytics import AnalyticsEvent, AnalyticsSession, dashboard_stats, normalize_batch, persist_batches
from app.api_analytics import (
    AnalyticsAccessRequest,
    require_analytics,
    router,
    trusted_country,
    update_analytics_access,
)
from app.auth import create_user, login
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.game_results import build_leaderboard_snapshot_fields
from app.game_state import new_game
from app.models import CompletedGame, GameParticipant, User
from app.ownership import bind_founder, grant_ownership
from app.security import utcnow
from tests.test_user_accounts import request_for


def batch(*, sid="a" * 32, page_id="b" * 32, page="/spiel/SECRET?token=PRIVATE", game="zdwa", events=None):
    return {"session_id": sid, "device": "mobile", "referrer": "https://google.ch/search?q=PRIVATE",
            "events": events if events is not None else [
                {"id": "c" * 32, "page_id": page_id, "type": "page_view", "page": page, "game": game},
                {"id": "d" * 32, "page_id": page_id, "type": "engagement", "page": page,
                 "game": game, "active_ms": 15000},
                {"id": "e" * 32, "page_id": page_id, "type": "action", "page": page,
                 "game": game, "action": "roll_dice"},
            ]}


class AnalyticsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/analytics.sqlite",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.now = utcnow()

    def tearDown(self):
        if analytics._queue is not None:
            asyncio.run(analytics.stop_analytics())
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def test_sanitization_never_persists_identifiers_urls_or_private_paths(self):
        raw = batch()
        raw.update(username="SecretName", ip="192.0.2.9", email="private@example.com")
        normalized = normalize_batch(raw, now=self.now)
        self.assertEqual(normalized["session"]["referrer"], "google.ch")
        self.assertNotEqual(normalized["session"]["id"], raw["session_id"])
        self.assertEqual({event["page"] for event in normalized["events"]}, {"/spiel"})
        persist_batches([normalized])
        with session_scope() as db:
            records = [dict(record.__dict__) for record in db.scalars(select(AnalyticsEvent))]
            text = str(records)
            for secret in ("SECRET", "PRIVATE", "SecretName", "192.0.2.9", "private@example.com", "google.ch"):
                self.assertNotIn(secret, text)
        for path in ("/admin", "/admin/dashboard", "/passwort-zuruecksetzen?token=PRIVATE", "/api/games",
                     "/static/script.js", "https://elsewhere.example/"):
            self.assertEqual(normalize_batch(batch(page=path))["events"], [], path)
        self.assertEqual(normalize_batch(batch(page="/spieler/SecretName"))["events"][0]["page"], "/spieler")
        self.assertEqual(normalize_batch(batch(page="/zilch/spiel/SECRET/zuschauen", game="zilch"))["events"][0]["page"],
                         "/zilch/zuschauen")

    def test_duplicate_retry_and_page_view_count_once_but_new_page_counts(self):
        normalized = normalize_batch(batch(), now=self.now)
        self.assertEqual(persist_batches([normalized, normalized]), 3)
        fresh_id_same_page = batch()
        fresh_id_same_page["events"] = [dict(fresh_id_same_page["events"][0], id="f" * 32)]
        self.assertEqual(persist_batches([normalize_batch(fresh_id_same_page, now=self.now)]), 0)
        new_page = batch(page_id="f" * 32)
        new_page["events"] = [dict(new_page["events"][0], id="1" * 32)]
        self.assertEqual(persist_batches([normalize_batch(new_page, now=self.now)]), 1)
        stats = dashboard_stats(7, now=self.now + timedelta(seconds=1))
        self.assertEqual(stats["overview"]["sessions"], 1)
        self.assertEqual(stats["overview"]["page_views"], 2)
        self.assertEqual(stats["overview"]["active_seconds"], 15)
        self.assertEqual(stats["pages"][0]["avg_active_seconds"], 15)
        self.assertEqual(stats["referrers"], [{"source": "google.ch", "sessions": 1}])

    def test_game_filter_daily_buckets_and_live_window(self):
        persist_batches([normalize_batch(batch(), now=self.now - timedelta(minutes=3)),
                         normalize_batch(batch(sid="1" * 32, game="zilch", page="/zilch/spiel"), now=self.now)])
        result = dashboard_stats(7, "zilch", now=self.now + timedelta(seconds=1))
        self.assertEqual(result["overview"]["sessions"], 1)
        self.assertEqual(result["overview"]["live_sessions"], 1)
        self.assertEqual(len(result["daily"]), 7)
        self.assertEqual(sum(day["page_views"] for day in result["daily"]), 1)
        self.assertEqual(result["pages"][0]["game"], "zilch")
        self.assertEqual(dashboard_stats(7, "zdwa", now=self.now)["overview"]["live_sessions"], 0)

    def _track_page(self, sid: int, page_number: int, page: str, when: datetime, *, game="zdwa", country="ZZ", active_ms=15000):
        events = [{"id": f"{page_number * 2:032x}", "page_id": f"{page_number:032x}", "type": "page_view",
                   "page": page, "game": game}]
        if active_ms:
            events.append({**events[0], "id": f"{page_number * 2 + 1:032x}", "type": "engagement", "active_ms": active_ms})
        persist_batches([normalize_batch(batch(sid=f"{sid:032x}", events=events), now=when, country=country)])

    def test_geography_counts_distinct_tab_visits_and_unknown_without_invented_location(self):
        now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        self._track_page(1, 1, "/", now - timedelta(minutes=5), country="CH")
        self._track_page(1, 2, "/zilch", now - timedelta(minutes=4), game="zilch", country="CH", active_ms=30000)
        self._track_page(2, 1, "/regeln", now - timedelta(minutes=3), country="CH")
        self._track_page(3, 1, "/", now - timedelta(minutes=2), country="ZZ")
        self._track_page(4, 1, "/", now + timedelta(minutes=1), country="DE")
        self._track_page(5, 1, "/", now - timedelta(days=1), country="DE")
        stats = dashboard_stats(1, now=now)
        geography = {row["country"]: row for row in stats["geography"]}
        self.assertEqual(set(geography), {"CH", "ZZ"})
        self.assertEqual(geography["CH"]["sessions"], 2)
        self.assertEqual(geography["CH"]["page_views"], 3)
        self.assertEqual(geography["CH"]["active_seconds"], 60)
        self.assertEqual(geography["CH"]["games"], {"zdwa": 2, "zilch": 1})
        self.assertEqual(geography["CH"]["share_percent"], 66.7)
        self.assertEqual(stats["geography_summary"]["known_sessions"], 2)
        self.assertEqual(stats["geography_summary"]["unknown_sessions"], 1)
        self.assertEqual(stats["geography_summary"]["known_countries"], 1)
        self.assertTrue(stats["geography_summary"]["game_visits_can_overlap"])
        filtered = dashboard_stats(1, "zilch", now=now)["geography"]
        self.assertEqual(filtered, [{"country": "CH", "sessions": 1, "page_views": 1, "active_seconds": 30,
                                    "games": {"zdwa": 0, "zilch": 1}, "share_percent": 100.0}])

    def test_heatmap_is_monday_first_utc_distinct_per_slot_and_zero_filled(self):
        now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        self._track_page(1, 1, "/", now.replace(hour=0, minute=1))
        self._track_page(1, 2, "/regeln", now.replace(hour=0, minute=2))
        self._track_page(1, 3, "/spieler", now.replace(hour=1, minute=1))
        self._track_page(2, 1, "/zilch", now - timedelta(hours=12, minutes=1), game="zilch")
        stats = dashboard_stats(7, now=now.astimezone(timezone(timedelta(hours=2))))
        cells = {(cell["weekday"], cell["hour"]): cell for cell in stats["heatmap"]}
        self.assertEqual(len(cells), 7 * 24)
        self.assertEqual(cells[0, 0], {"weekday": 0, "hour": 0, "sessions": 1, "page_views": 2, "active_seconds": 30})
        self.assertEqual(cells[0, 1]["sessions"], 1)
        self.assertEqual(cells[6, 23]["page_views"], 1)
        self.assertEqual(cells[3, 15]["active_seconds"], 0)
        self.assertEqual(sum(cell["page_views"] for cell in cells.values()), stats["overview"]["page_views"])
        filtered = {(cell["weekday"], cell["hour"]): cell for cell in dashboard_stats(7, "zilch", now=now)["heatmap"]}
        self.assertEqual(filtered[6, 23]["page_views"], 1)
        self.assertEqual(filtered[0, 0]["page_views"], 0)

    def test_journeys_keep_real_tab_order_gap_boundaries_and_cross_game_sequence(self):
        now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        for number, page, minute in ((1, "/", 0), (2, "/", 1), (3, "/regeln", 2),
                                     (4, "/spieler", 33), (5, "/rangabzeichen", 63)):
            self._track_page(1, number, page, now.replace(hour=10) + timedelta(minutes=minute), active_ms=0)
        for number, page, product in ((1, "/zilch", "zilch"), (2, "/", "zdwa"),
                                      (3, "/zilch/regeln", "zilch"), (4, "/zilch/spieler", "zilch")):
            self._track_page(2, number, page, now.replace(hour=10) + timedelta(minutes=number), game=product, active_ms=0)
        self._track_page(3, 1, "/spieler", now.replace(hour=10, minute=3), active_ms=0)
        self._track_page(4, 1, "/ergebnis", now + timedelta(minutes=1), active_ms=0)
        self._track_page(1, 6, "/ergebnis", now.replace(hour=0) - timedelta(seconds=1), active_ms=0)
        journeys = dashboard_stats(1, now=now)["journeys"]
        links = {(row["from"], row["to"]): row["count"] for row in journeys["links"]}
        self.assertEqual(links[("/", "/regeln")], 1)
        self.assertEqual(links[("/spieler", "/rangabzeichen")], 1)
        self.assertNotIn(("/regeln", "/spieler"), links)
        self.assertNotIn(("/", "/"), links)
        self.assertNotIn(("/ergebnis", "/"), links)
        self.assertEqual(journeys["sample"]["page_views"], 10)
        self.assertFalse(journeys["sample"]["truncated"])
        filtered = dashboard_stats(1, "zilch", now=now)["journeys"]
        self.assertEqual(filtered["links"], [{"from": "/zilch/regeln", "to": "/zilch/spieler", "from_game": "zilch",
                                               "to_game": "zilch", "count": 1}])
        self.assertEqual(filtered["sample"]["matching_page_views"], 3)
        self.assertEqual(filtered["sample"]["game_filter_applied"], "both_endpoints")
        self.assertNotIn(f"{1:032x}", json.dumps(journeys))

    def test_journeys_sample_latest_ten_thousand_views_and_report_limits(self):
        now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        start = now - timedelta(seconds=10002)
        normalized = normalize_batch(batch(), now=start)
        with session_scope() as db:
            db.add(AnalyticsSession(**normalized["session"]))
            db.flush()
            db.execute(analytics.insert(AnalyticsEvent), [
                {"dedupe_key": f"{index:064x}", "session_id": normalized["session"]["id"],
                 "received_at": start + timedelta(seconds=index), "event_type": "page_view",
                 "page": "/regeln" if index % 2 else "/", "game": "zdwa", "action": "", "active_ms": 0,
                 "mode": "unknown", "source": "client"}
                for index in range(10002)
            ])
        stats = dashboard_stats(1, now=now)
        sample = stats["journeys"]["sample"]
        self.assertEqual(sample["page_views"], 10000)
        self.assertEqual(sample["limit"], 10000)
        self.assertEqual(sample["total_page_views"], 10002)
        self.assertTrue(sample["truncated"])
        self.assertEqual(sample["from"], (start + timedelta(seconds=2)).isoformat())
        self.assertEqual(sum(row["count"] for row in stats["journeys"]["links"]), 9999)
        self.assertEqual(stats["overview"]["page_views"], 10002)

    def test_comparison_has_complete_previous_days_partial_today_and_retained_coverage(self):
        now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        start = now.replace(hour=0)
        self._track_page(1, 1, "/", start - timedelta(days=1), active_ms=30000)
        self._track_page(2, 1, "/", start, active_ms=15000)
        self._track_page(3, 1, "/zilch", start + timedelta(hours=1), game="zilch", active_ms=15000)
        self._track_page(4, 1, "/", start - timedelta(days=1, seconds=1), active_ms=15000)
        self._track_page(5, 1, "/", now + timedelta(seconds=1), active_ms=15000)
        with session_scope() as db:
            for game_id, timestamp in (("previous-result", start - timedelta(seconds=1)), ("current-result", start)):
                db.add(CompletedGame(game_id=game_id, game_type="zdwa", game_name="Private", finished_at=timestamp,
                                     mode="1", hardcore=False, snapshot_json="{}", imported_from_legacy=False,
                                     created_at=timestamp))
        comparison = dashboard_stats(1, now=now)["comparison"]
        self.assertEqual(comparison["overview"]["sessions"], {"current": 2, "previous": 1, "delta": 1, "change_percent": 100})
        self.assertEqual(comparison["overview"]["active_seconds"], {"current": 30, "previous": 30, "delta": 0, "change_percent": 0})
        self.assertEqual(comparison["overview"]["completed_games"]["previous"], 1)
        self.assertTrue(comparison["current_partial_day"])
        self.assertFalse(comparison["previous_partial_day"])
        self.assertEqual(comparison["current_elapsed_seconds"], 43200)
        self.assertEqual(comparison["previous_elapsed_seconds"], 86400)
        self.assertTrue(comparison["previous_period"]["end_exclusive"])
        self.assertEqual(comparison["previous_data_coverage"], "complete")
        self.assertEqual(dashboard_stats(7, now=now)["comparison"]["previous_data_coverage"], "none")
        filtered = dashboard_stats(1, "zilch", now=now)["comparison"]
        self.assertEqual(filtered["overview"]["sessions"]["current"], 1)
        self.assertEqual(filtered["overview"]["sessions"]["previous"], 0)
        self.assertIsNone(filtered["overview"]["sessions"]["change_percent"])
        self._track_page(6, 1, "/", start - timedelta(minutes=30), active_ms=0)
        with session_scope() as db:
            db.execute(analytics.delete(AnalyticsEvent).where(AnalyticsEvent.received_at < start - timedelta(hours=1)))
        self.assertEqual(dashboard_stats(1, now=now)["comparison"]["previous_data_coverage"], "partial")
        with session_scope() as db:
            db.execute(analytics.delete(AnalyticsEvent).where(AnalyticsEvent.received_at < start))
        self.assertEqual(dashboard_stats(1, now=now)["comparison"]["previous_data_coverage"], "none")

    def test_comparison_client_coverage_cannot_be_manufactured_by_older_server_actions(self):
        now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
        older = now - timedelta(days=30)
        server = normalize_batch(batch(), now=older)
        server["session"] = None
        server["events"] = [{**server["events"][2], "session_id": None, "source": "server", "action": "game_created"}]
        persist_batches([server])
        self.assertEqual(dashboard_stats(7, now=now)["comparison"]["previous_data_coverage"], "none")
        self._track_page(1, 1, "/", now - timedelta(minutes=5), active_ms=0)
        stats = dashboard_stats(7, now=now)
        self.assertEqual(stats["collection"]["first_seen_at"], older.isoformat())
        self.assertEqual(stats["comparison"]["traffic_retained_from"], (now - timedelta(minutes=5)).isoformat())
        self.assertEqual(stats["comparison"]["previous_data_coverage"], "none")

    def test_retention_and_hard_event_cap_remove_old_sessions(self):
        persist_batches([normalize_batch(batch(), now=self.now - timedelta(days=91)),
                         normalize_batch(batch(sid="1" * 32), now=self.now)])
        with patch.object(analytics, "MAX_STORED_EVENTS", 2):
            persist_batches([], now=self.now, sweep=True)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(AnalyticsEvent)), 2)
            self.assertEqual(db.scalar(select(func.count()).select_from(AnalyticsSession)), 1)
            self.assertTrue(all(row.session_id is None or row.session_id != normalize_batch(batch())["session"]["id"]
                                for row in db.scalars(select(AnalyticsEvent))))

    def test_event_allowlists_batch_and_duration_bounds(self):
        for payload in ({}, batch(sid="a"), batch(events=[]), batch(events=[{}] * 21)):
            with self.assertRaises(ValueError):
                normalize_batch(payload)
        raw = batch()
        for bad in (60001, -1, True, "15000"):
            raw["events"][1]["active_ms"] = bad
            self.assertEqual(len(normalize_batch(raw)["events"]), 2)
        raw["events"][2]["action"] = "private@example.com"
        self.assertEqual(len(normalize_batch(raw)["events"]), 1)
        raw["events"][2]["action"] = "game_finished"
        self.assertEqual(len(normalize_batch(raw)["events"]), 1)

    def test_completed_games_are_persisted_results_not_client_claims(self):
        raw = batch()
        raw["events"].append({**raw["events"][2], "id": "f" * 32, "action": "game_finished"})
        persist_batches([normalize_batch(raw, now=self.now)])
        with session_scope() as db:
            game = CompletedGame(game_id="private-game-id", game_type="zilch", game_name="Private Game",
                                 finished_at=self.now, mode="solo", hardcore=False,
                                 snapshot_json=json.dumps({"duration_seconds": 90, "username": "Private"}),
                                 imported_from_legacy=False, created_at=self.now)
            db.add(game)
            db.flush()
            db.add(GameParticipant(game_id=game.id, position=0, player_key="private-key", display_name="Private",
                                   points=1000))
        stats = dashboard_stats(now=self.now + timedelta(seconds=1))
        self.assertEqual(stats["overview"]["completed_games"], 1)
        self.assertEqual(stats["games"][1]["participants"], 1)
        self.assertEqual(stats["games"][1]["avg_duration_seconds"], 90)
        self.assertNotIn("Private", json.dumps(stats))
        self.assertNotIn("private-game-id", json.dumps(stats))

    def test_new_zdwa_snapshots_keep_reliable_duration_and_legacy_remains_unknown(self):
        game = new_game("analytics-timing", "Private", 1)
        game["_started_at"] = (utcnow() - timedelta(seconds=90)).isoformat()
        snapshot = build_leaderboard_snapshot_fields(game)
        self.assertEqual(snapshot["duration_seconds"], 90)
        self.assertEqual(analytics._result_duration(json.dumps(snapshot)), 90)
        self.assertIn("started_at", snapshot)
        for start in (None, "invalid", (utcnow() + timedelta(hours=1)).isoformat()):
            game["_started_at"] = start
            old = build_leaderboard_snapshot_fields(game)
            self.assertNotIn("duration_seconds", old)
            self.assertIsNone(analytics._result_duration(json.dumps(old)))

    def test_permissions_founder_explicit_grant_and_immediate_revocation(self):
        founder = create_user("Founder", "password-123", role="admin", must_change_password=False)
        owner = create_user("Owner", "password-123", role="admin", must_change_password=False)
        admin = create_user("Admin", "password-123", role="admin", must_change_password=False)
        player = create_user("Player", "password-123", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, founder.id)
            grant_ownership(db, owner.id, founder.id)
        requests = {}
        for user in (founder, owner, admin, player):
            identity, token = login(request_for(), user.username, "password-123")
            requests[user.id] = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
        self.assertEqual(require_analytics(requests[founder.id]).user_id, founder.id)
        for user in (owner, admin, player):
            with self.assertRaises(HTTPException) as denied:
                require_analytics(requests[user.id])
            self.assertEqual(denied.exception.status_code, 403)
        with self.assertRaises(HTTPException) as denied:
            require_analytics(request_for())
        self.assertEqual(denied.exception.status_code, 401)
        for user in (owner, admin, player):
            with self.assertRaises(HTTPException):
                update_analytics_access(player.id, AnalyticsAccessRequest(enabled=True), requests[user.id], Response())
        with self.assertRaises(HTTPException):
            update_analytics_access(player.id, AnalyticsAccessRequest(enabled=True),
                                    request_for(cookie=requests[founder.id].headers["cookie"]), Response())
        granted = update_analytics_access(player.id, AnalyticsAccessRequest(enabled=True), requests[founder.id], Response())
        self.assertTrue(granted["user"]["can_view_analytics"])
        self.assertEqual(require_analytics(requests[player.id]).user_id, player.id)
        update_analytics_access(player.id, AnalyticsAccessRequest(enabled=False), requests[founder.id], Response())
        with self.assertRaises(HTTPException):
            require_analytics(requests[player.id])
        with self.assertRaises(HTTPException) as denied:
            update_analytics_access(founder.id, AnalyticsAccessRequest(enabled=False), requests[founder.id], Response())
        self.assertEqual(denied.exception.detail, "founder_protected")
        with session_scope() as db:
            db.get(User, player.id).analytics_access = True
            db.get(User, player.id).is_active = False
        with self.assertRaises(HTTPException):
            require_analytics(requests[player.id])

    def test_http_ingestion_origin_privacy_signals_and_body_limit(self):
        app = FastAPI()
        app.include_router(router)
        with TestClient(app) as client:
            with patch("app.api_analytics.enqueue_batch", return_value=True) as enqueue:
                self.assertEqual(client.post("/api/analytics/events", json=batch()).status_code, 202)
                self.assertEqual(client.post("/api/analytics/events", content=json.dumps(batch()),
                                             headers={"content-type": "text/plain"}).status_code, 202)
                for headers in ({"dnt": "1"}, {"sec-gpc": "1"}):
                    self.assertEqual(client.post("/api/analytics/events", json=batch(), headers=headers).status_code, 204)
                self.assertEqual(enqueue.call_count, 2)
                self.assertEqual(client.post("/api/analytics/events", json=batch(),
                                             headers={"origin": "https://evil.example"}).status_code, 403)
                self.assertEqual(client.post("/api/analytics/events", json=batch(),
                                             headers={"sec-fetch-site": "cross-site"}).status_code, 403)
                self.assertEqual(client.post("/api/analytics/events", content="x" * 32769,
                                             headers={"content-type": "text/plain"}).status_code, 413)
                self.assertEqual(client.post("/api/analytics/events", content="bad",
                                             headers={"content-type": "text/plain"}).status_code, 400)
                self.assertEqual(client.post("/api/analytics/events", content="x",
                                             headers={"content-type": "image/jpeg"}).status_code, 415)
            self.assertEqual(client.get("/api/admin/analytics?days=7").status_code, 401)
            with patch("app.api_analytics.require_analytics", return_value=True):
                response = client.get("/api/admin/analytics?days=7")
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(client.get("/api/admin/analytics?days=2").status_code, 422)
                self.assertEqual(client.get("/api/admin/analytics?game=private").status_code, 422)

    def test_country_accepts_verified_cloudflare_peer_only(self):
        def request(peer, country):
            return Request({"type": "http", "headers": [(b"cf-ipcountry", country.encode())],
                            "client": (peer, 1234), "scheme": "http", "path": "/"})
        self.assertEqual(trusted_country(request("104.16.4.1", "CH")), "CH")
        self.assertEqual(trusted_country(request("2606:4700::1", "DE")), "DE")
        for peer in ("127.0.0.1", "192.0.2.1", "testclient"):
            self.assertEqual(trusted_country(request(peer, "CH")), "ZZ")
        for value in ("T1", "XX", "QQ", "Private", ""):
            self.assertEqual(trusted_country(request("104.16.4.1", value)), "ZZ")

    def test_sqlite_pool_restores_game_timeout_after_success_and_failed_write(self):
        engine = get_engine()
        timeouts = []

        def inspect_timeout(connection, _record):
            timeouts.append(connection.execute("PRAGMA busy_timeout").fetchone()[0])

        event.listen(engine, "checkin", inspect_timeout)
        try:
            persist_batches([normalize_batch(batch(), now=self.now)])
            invalid = normalize_batch(batch(sid="1" * 32), now=self.now)
            invalid["session"] = None
            with self.assertRaises(IntegrityError):
                persist_batches([invalid])
            self.assertGreaterEqual(len(timeouts), 2)
            self.assertEqual(set(timeouts), {30000})
        finally:
            event.remove(engine, "checkin", inspect_timeout)

    def test_queue_rate_cap_and_server_metric_scopes(self):
        async def scenario():
            await analytics.start_analytics()
            with patch.object(analytics, "_queue", queue.Queue(maxsize=1)):
                self.assertTrue(analytics.enqueue_batch(normalize_batch(batch())))
                self.assertFalse(analytics.enqueue_batch(normalize_batch(batch(sid="1" * 32))))
            for _ in range(40):
                analytics.enqueue_batch(normalize_batch(batch(sid="2" * 32)))
            self.assertFalse(analytics.enqueue_batch(normalize_batch(batch(sid="2" * 32))))
            await analytics.stop_analytics()
        asyncio.run(scenario())
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory)
            (proc / "stat").write_text("cpu 100 0 100 800 0 0 0 0\n")
            (proc / "loadavg").write_text("0.10 0.20 0.30 1/200 1\n")
            (proc / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 400 kB\n")
            (proc / "uptime").write_text("3600.5 7200.0\n")
            with patch.dict(os.environ, {"ANALYTICS_HOST_PROC": directory, "ANALYTICS_DATA_PATH": directory}), \
                    patch.object(analytics, "_server_cache", None), patch.object(analytics, "_cpu_previous", None):
                analytics._sample_cpu()
                (proc / "stat").write_text("cpu 120 0 120 860 0 0 0 0\n")
                analytics._sample_cpu()
                server = analytics.server_snapshot()
                self.assertEqual(server["cpu"]["percent"], 40)
                self.assertEqual(server["memory"]["percent"], 60)
                self.assertEqual(server["memory"]["scope"], "host")
                self.assertEqual(server["host_uptime_seconds"], 3600)
                self.assertEqual(server["disk"]["scope"], "data_filesystem")
