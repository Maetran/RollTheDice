"""Founder-only Hausdepp telemetry does not enter delegated dashboard totals."""

from __future__ import annotations

import json
import os
import queue
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from sqlalchemy import select
from starlette.testclient import TestClient

from app import analytics, main
from app.analytics import AnalyticsEvent, AnalyticsSession, dashboard_stats, normalize_batch, persist_batches
from app.api_analytics import router
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.models import CompletedGame, GameParticipant, User
from app.ownership import bind_founder
from app.security import utcnow
from tests.test_user_accounts import request_for


class HausdeppMonitoringTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/monitoring.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        self.registry = patch.dict(main.games, clear=True)
        self.registry.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.now = utcnow()
        self.founder = create_user("MonitorFounder", "test-password-123", role="admin", must_change_password=False)
        self.delegate = create_user("MonitorDelegate", "test-password-123", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
            db.get(User, self.delegate.id).analytics_access = True
        self.tokens = {user.id: login(request_for(), user.username, "test-password-123")[1]
                       for user in (self.founder, self.delegate)}
        app = FastAPI()
        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def tearDown(self):
        self.registry.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def request(self, user, game="all"):
        self.client.cookies.set("rollthedice_session", self.tokens[user.id])
        return self.client.get(f"/api/admin/analytics?days=7&game={game}")

    def completed(self, game_id, game_type, *, duration=None, previous=False, tournament=False):
        at = self.now - timedelta(days=8) if previous else self.now - timedelta(minutes=5)
        payload = {"game_id": game_id, "finished_at": at.isoformat(), "name": "PRIVATE_TABLE_NAME",
                   "hand": ["PRIVATE_CARD"], "achievement_evidence": {"PRIVATE_PEEK": True}}
        if duration is not None:
            payload.update(started_at=(at - timedelta(seconds=duration)).isoformat(), duration_seconds=duration)
        if tournament:
            payload["tournament"] = {"id": "PRIVATE_TOURNAMENT", "completed": True}
        with session_scope() as db:
            row = CompletedGame(game_id=game_id, game_type=game_type, game_name="PRIVATE_TABLE_NAME",
                                finished_at=at, mode="3" if game_type == "hausdepp" else "2", hardcore=False,
                                snapshot_json=json.dumps(payload), created_at=at)
            db.add(row)
            db.flush()
            db.add(GameParticipant(game_id=row.id, position=0, player_key="PRIVATE_SEAT", display_name="PRIVATE_NAME",
                                   points=0, user_id=self.founder.id))

    def live_rooms(self):
        main.games.update({
            "PUBLIC_ROOM": {"_game_type": "zdwa", "_started": True,
                            "_players": [{"ws": object()}, {"ws": object()}]},
            "PRIVATE_PLAYING": {"_game_type": "hausdepp", "_started": True,
                                "_players": [{"ws": object()}], "_participants": [{"is_cpu": True}],
                                "_hausdepp_tournament": {"completed": False}, "hand": "PRIVATE_CARD"},
            "PRIVATE_BREAK": {"_game_type": "hausdepp", "_started": True, "_finished": True,
                              "_players": [{"ws": object()}], "_participants": [{"is_cpu": True}] * 2,
                              "_hausdepp_tournament": {"completed": False}},
            "PRIVATE_FINISHED": {"_game_type": "hausdepp", "_started": True, "_finished": True,
                                 "_players": [{"ws": object()}], "_hausdepp_tournament": {"completed": True}},
        })

    def test_all_and_previous_totals_live_counts_and_options_exclude_private_game_for_delegate(self):
        self.completed("public", "zdwa", duration=90)
        self.completed("private-legacy", "hausdepp")
        self.completed("private-final", "hausdepp", duration=120, tournament=True)
        self.completed("public-old", "zdwa", previous=True)
        self.completed("private-old", "hausdepp", previous=True)
        self.live_rooms()
        delegated = self.request(self.delegate).json()
        self.assertEqual(delegated["available_games"], ["zdwa", "zilch"])
        self.assertEqual(delegated["overview"]["completed_games"], 1)
        self.assertEqual(delegated["comparison"]["overview"]["completed_games"]["previous"], 1)
        self.assertEqual(delegated["server"]["active_rooms"], 1)
        self.assertEqual(delegated["server"]["players_online"], 2)
        self.assertNotIn("hausdepp", json.dumps(delegated))
        founder = self.request(self.founder).json()
        self.assertEqual(founder["available_games"], ["zdwa", "zilch", "hausdepp"])
        self.assertEqual(founder["overview"]["completed_games"], 3)
        self.assertEqual(founder["server"]["active_rooms"], 3)
        self.assertEqual(founder["server"]["players_online"], 4)
        private = self.request(self.founder, "hausdepp").json()
        self.assertEqual(private["overview"]["completed_games"], 2)
        self.assertEqual(private["games"][0]["avg_duration_seconds"], 120)
        self.assertEqual(private["games"][0]["duration_sample_count"], 1)
        self.assertEqual(private["games"][0]["completed_tournaments"], 1)
        self.assertEqual(private["games"][0]["live"], {
            "active_tables": 2, "playing_tables": 1, "waiting_tables": 0, "connected_humans": 2,
            "cpu_seats": 3, "active_tournaments": 2, "interround_tables": 1,
        })
        self.assertNotIn("PRIVATE", json.dumps(founder))
        self.assertNotIn("PRIVATE", json.dumps(private))

    def test_private_filter_is_never_granted_to_delegate_and_dashboard_grant_is_checked_again(self):
        self.assertEqual(self.request(self.delegate, "hausdepp").status_code, 403)
        self.assertEqual(self.request(self.founder, "hausdepp").status_code, 200)
        self.assertEqual(self.request(self.delegate).status_code, 200)
        invalid = self.request(self.delegate, "unrecognized")
        self.assertEqual(invalid.status_code, 422)
        self.assertNotIn("hausdepp", invalid.text)
        with session_scope() as db:
            db.get(User, self.delegate.id).role = "admin"
        self.assertEqual(self.request(self.delegate, "hausdepp").status_code, 403)
        self.assertNotIn("hausdepp", self.request(self.delegate).json()["available_games"])
        with session_scope() as db:
            db.get(User, self.delegate.id).analytics_access = False
        self.assertEqual(self.request(self.delegate).status_code, 403)
        self.assertEqual(self.request(self.delegate, "hausdepp").status_code, 403)
        self.assertEqual(self.request(self.founder, "hausdepp").status_code, 200)
        self.client.cookies.clear()
        self.assertEqual(self.client.get("/api/admin/analytics?game=hausdepp").status_code, 401)

    def test_hidden_traffic_does_not_leak_through_journeys_or_create_false_public_links(self):
        with session_scope() as db:
            db.add(AnalyticsSession(id="a" * 64, first_seen_at=self.now - timedelta(minutes=3), last_seen_at=self.now,
                                    device="desktop", referrer="direct", country="CH"))
            db.flush()
            for index, (game, page) in enumerate((("zdwa", "/"), ("hausdepp", "/hausdepp/spiel"),
                                                 ("zdwa", "/spiel"))):
                db.add(AnalyticsEvent(dedupe_key=str(index) * 64, session_id="a" * 64,
                                      received_at=self.now - timedelta(minutes=3 - index), event_type="page_view",
                                      page=page, game=game, action="", active_ms=0, source="client"))
        public = dashboard_stats(7, now=self.now)
        owner = dashboard_stats(7, now=self.now, include_hausdepp=True)
        self.assertEqual(public["overview"]["page_views"], 2)
        self.assertEqual(public["journeys"]["links"], [])
        self.assertEqual(public["journeys"]["sample"]["total_page_views"], 2)
        self.assertEqual(public["collection"]["stored_events"], 2)
        self.assertNotIn("hausdepp", json.dumps(public))
        self.assertEqual(owner["overview"]["page_views"], 3)
        self.assertEqual(len(owner["journeys"]["links"]), 2)
        self.assertIn("hausdepp", owner["geography"][0]["games"])

    def test_abort_hook_is_deduplicated_coarse_and_not_forgeable_by_browser(self):
        game = {"_id": "PRIVATE_ROOM", "_name": "PRIVATE_NAME", "_game_type": "hausdepp", "_aborted": True,
                "_abort_reason": "manual", "_started_at": (self.now - timedelta(minutes=2)).isoformat(),
                "_finished_at": (self.now - timedelta(seconds=1)).isoformat(), "hand": "PRIVATE_CARD"}
        events = queue.Queue()
        with patch.object(analytics, "_queue", events):
            self.assertTrue(analytics.record_hausdepp_abort(game))
            self.assertTrue(analytics.record_hausdepp_abort(game))
            self.assertFalse(analytics.record_hausdepp_abort({**game, "_started_at": None}))
            self.assertFalse(analytics.record_hausdepp_abort({**game, "_game_type": "zilch"}))
        self.assertEqual(persist_batches([events.get_nowait(), events.get_nowait()]), 1)
        with session_scope() as db:
            row = db.scalar(select(AnalyticsEvent))
            self.assertEqual((row.action, row.source, row.page), ("game_aborted", "server", "/hausdepp/spiel"))
            self.assertNotIn("PRIVATE", json.dumps({key: value for key, value in row.__dict__.items()
                                                    if key not in {"_sa_instance_state", "received_at"}}))
        self.assertEqual(dashboard_stats(7, "hausdepp", now=self.now, include_hausdepp=True)["games"][0]["abandoned_games"], 1)
        self.assertNotIn("hausdepp", json.dumps(dashboard_stats(7, now=self.now)))
        forged = {"session_id": "a" * 32, "events": [{"id": "b" * 32, "page_id": "c" * 32,
                  "type": "action", "game": "hausdepp", "page": "/hausdepp/spiel/PRIVATE", "action": "game_aborted"}]}
        self.assertEqual(normalize_batch(forged)["events"], [])

    def test_bad_legacy_duration_is_unknown_without_breaking_other_metrics(self):
        self.completed("bad-duration", "hausdepp")
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "bad-duration"))
            payload = json.loads(row.snapshot_json)
            payload["started_at"] = "0001-01-01T00:00:00+01:00"
            row.snapshot_json = json.dumps(payload)
        response = self.request(self.founder, "hausdepp")
        self.assertEqual(response.status_code, 200)
        game = response.json()["games"][0]
        self.assertEqual(game["completed_games"], 1)
        self.assertIsNone(game["avg_duration_seconds"])
        self.assertEqual(game["duration_sample_count"], 0)
