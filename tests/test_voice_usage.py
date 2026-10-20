"""Anonymous voice payload persistence and truthful dashboard aggregation."""

from __future__ import annotations

import asyncio
import os
import tempfile
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import create_engine, insert, inspect, select
from sqlalchemy.exc import SQLAlchemyError

from app import analytics, main, voice_usage
from app import hausdepp_voice as voice
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.game_ws_session import GameSocketSession
from app.models import VoiceUsageBucket
from app.security import as_utc
from tests.test_hausdepp_voice import FakeProvider, VoiceSocket, description


class VoiceUsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/voice-usage.sqlite",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def stats(self, start, now=None):
        with session_scope() as db:
            return voice_usage.usage_stats(db, start, now or self.now)

    def test_daily_upserts_persist_across_engine_restart_without_identifiers(self):
        self.assertTrue(voice_usage.record_usage(7, 11, now=self.now + timedelta(minutes=2)))
        self.assertTrue(voice_usage.record_usage(13, 17, now=self.now))
        self.assertTrue(voice_usage.record_usage(0, 0, now=self.now + timedelta(minutes=1)))
        configure_database(Path(self.temp.name))
        schema = inspect(get_engine())
        self.assertEqual({column["name"] for column in schema.get_columns("voice_usage_buckets")}, {
            "day", "received_bytes", "sent_bytes", "reports", "first_reported_at", "last_reported_at",
        })
        self.assertEqual(schema.get_pk_constraint("voice_usage_buckets")["constrained_columns"], ["day"])
        self.assertEqual(schema.get_foreign_keys("voice_usage_buckets"), [])
        with session_scope() as db:
            rows = db.scalars(select(VoiceUsageBucket)).all()
            self.assertEqual(len(rows), 1)
            row = rows[0]
            self.assertEqual((row.day, row.received_bytes, row.sent_bytes, row.reports),
                             ("2026-11-20", 20, 28, 3))
            self.assertEqual(as_utc(row.first_reported_at), self.now)
            self.assertEqual(as_utc(row.last_reported_at), self.now + timedelta(minutes=2))

    def test_bucket_day_and_current_month_use_utc_across_local_midnight(self):
        local_midnight = datetime(2026, 11, 1, 0, 30, tzinfo=timezone(timedelta(hours=2)))
        utc_after = datetime(2026, 11, 1, 0, 15, tzinfo=timezone.utc)
        self.assertTrue(voice_usage.record_usage(10, 20, now=local_midnight))
        self.assertTrue(voice_usage.record_usage(30, 40, now=utc_after))
        result = self.stats(datetime(2026, 10, 31, tzinfo=timezone.utc), utc_after)
        self.assertEqual(result["daily"], [
            {"day": "2026-10-31", "received_bytes": 10, "sent_bytes": 20, "reports": 1},
            {"day": "2026-11-01", "received_bytes": 30, "sent_bytes": 40, "reports": 1},
        ])
        self.assertEqual(result["month"], {"from": "2026-11-01T00:00:00+00:00",
                                           "to": utc_after.isoformat(),
                                           "received_bytes": 30, "sent_bytes": 40, "reports": 1})
        self.assertEqual(result["first_reported_at"], "2026-10-31T22:30:00+00:00")

    def test_selected_days_and_current_month_are_independent_and_daily_gaps_are_zero(self):
        observations = [(datetime(2026, 10, 31, 12, tzinfo=timezone.utc), 1000, 100),
                        (datetime(2026, 11, 1, 12, tzinfo=timezone.utc), 2000, 200),
                        (datetime(2026, 11, 18, 12, tzinfo=timezone.utc), 3000, 300),
                        (self.now, 4000, 400),
                        (self.now + timedelta(days=1), 9000, 900)]
        for when, received, sent in observations:
            self.assertTrue(voice_usage.record_usage(received, sent, now=when))
        result = self.stats(self.now.replace(day=18, hour=0))
        self.assertEqual(result["period"], {"received_bytes": 7000, "sent_bytes": 700, "reports": 2})
        self.assertEqual(result["month"], {"from": "2026-11-01T00:00:00+00:00",
                                           "to": self.now.isoformat(),
                                           "received_bytes": 9000, "sent_bytes": 900, "reports": 3})
        self.assertEqual(result["daily"], [
            {"day": "2026-11-18", "received_bytes": 3000, "sent_bytes": 300, "reports": 1},
            {"day": "2026-11-19", "received_bytes": 0, "sent_bytes": 0, "reports": 0},
            {"day": "2026-11-20", "received_bytes": 4000, "sent_bytes": 400, "reports": 1},
        ])
        self.assertEqual(result["first_reported_at"], observations[0][0].isoformat())
        self.assertEqual(result["last_reported_at"], self.now.isoformat())

    def test_empty_selected_period_keeps_retained_month_observations_separate(self):
        first = self.now.replace(day=1)
        self.assertTrue(voice_usage.record_usage(50, 70, now=first))
        result = self.stats(self.now.replace(hour=0))
        self.assertEqual(result["period"], {"received_bytes": 0, "sent_bytes": 0, "reports": 0})
        self.assertEqual(result["daily"], [])
        self.assertEqual(result["month"]["reports"], 1)
        self.assertEqual(result["month"]["received_bytes"], 50)
        self.assertEqual(result["first_reported_at"], first.isoformat())

    def test_no_data_exposes_null_coverage_and_zero_totals_without_a_fabricated_chart(self):
        self.assertEqual(self.stats(self.now.replace(day=14, hour=0)), {
            "source": "browser_transport_payload", "first_reported_at": None, "last_reported_at": None,
            "retention_days": 400, "period": {"received_bytes": 0, "sent_bytes": 0, "reports": 0},
            "month": {"from": "2026-11-01T00:00:00+00:00", "to": self.now.isoformat(),
                      "received_bytes": 0, "sent_bytes": 0, "reports": 0}, "daily": [],
        })

    def test_writer_retains_exactly_400_utc_days_including_today(self):
        rows = []
        for offset in range(401, 0, -1):
            when = self.now - timedelta(days=offset)
            rows.append({"day": when.date().isoformat(), "received_bytes": 1, "sent_bytes": 2, "reports": 1,
                         "first_reported_at": when, "last_reported_at": when})
        with session_scope() as db:
            db.execute(insert(VoiceUsageBucket), rows)
        self.assertTrue(voice_usage.record_usage(5, 7, now=self.now))
        with session_scope() as db:
            days = db.scalars(select(VoiceUsageBucket.day).order_by(VoiceUsageBucket.day)).all()
        self.assertEqual(len(days), 400)
        self.assertEqual(days[0], (self.now - timedelta(days=399)).date().isoformat())
        self.assertEqual(days[-1], self.now.date().isoformat())
        result = self.stats(self.now - timedelta(days=399))
        self.assertEqual(result["period"], {"received_bytes": 404, "sent_bytes": 805, "reports": 400})

    def test_database_failure_is_best_effort_and_does_not_claim_a_report(self):
        with patch("app.voice_usage.get_engine", side_effect=SQLAlchemyError("unavailable")):
            self.assertFalse(voice_usage.record_usage(10, 20, now=self.now))
        self.assertEqual(self.stats(self.now.replace(hour=0))["period"]["reports"], 0)
        self.assertTrue(voice_usage.record_usage(10, 20, now=self.now))
        self.assertEqual(self.stats(self.now.replace(hour=0))["period"]["reports"], 1)

    def test_analytics_sweep_prunes_usage_without_another_voice_report(self):
        self.assertTrue(voice_usage.record_usage(10, 20, now=self.now - timedelta(days=400)))
        self.assertTrue(voice_usage.record_usage(30, 40, now=self.now - timedelta(days=399)))
        analytics.persist_batches([], now=self.now, sweep=True)
        with session_scope() as db:
            rows = db.scalars(select(VoiceUsageBucket)).all()
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0].day, (self.now - timedelta(days=399)).date().isoformat())
            self.assertEqual((rows[0].received_bytes, rows[0].sent_bytes, rows[0].reports), (30, 40, 1))

    def test_writer_bypasses_exhausted_gameplay_pool_and_preserves_its_timeout(self):
        for filename, expected in (("voice-usage.sqlite", True), ("missing-schema.sqlite", False)):
            with self.subTest(database=filename):
                engine = create_engine(f"sqlite:///{self.temp.name}/{filename}", pool_size=1,
                                       max_overflow=0, pool_timeout=2)
                try:
                    with engine.connect() as connection:
                        connection.exec_driver_sql("PRAGMA busy_timeout=1234")
                        connection.commit()
                        with patch("app.voice_usage.get_engine", return_value=engine):
                            started = time.monotonic()
                            self.assertIs(voice_usage.record_usage(10, 20, now=self.now), expected)
                            self.assertLess(time.monotonic() - started, 1)
                        self.assertEqual(connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one(), 1234)
                finally:
                    engine.dispose()
        self.assertEqual(self.stats(self.now.replace(hour=0))["period"],
                         {"received_bytes": 10, "sent_bytes": 20, "reports": 1})

    def test_sqlite_write_contention_is_bounded_and_next_report_recovers(self):
        engine = create_engine(get_engine().url, pool_size=1, max_overflow=0)
        try:
            with engine.connect() as connection:
                connection.exec_driver_sql("PRAGMA busy_timeout=1234")
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                with patch("app.voice_usage.get_engine", return_value=engine):
                    started = time.monotonic()
                    self.assertFalse(voice_usage.record_usage(10, 20, now=self.now))
                    self.assertLess(time.monotonic() - started, 1)
                self.assertEqual(connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one(), 1234)
                connection.rollback()
            self.assertTrue(voice_usage.record_usage(10, 20, now=self.now))
        finally:
            engine.dispose()
        self.assertEqual(self.stats(self.now.replace(hour=0))["period"],
                         {"received_bytes": 10, "sent_bytes": 20, "reports": 1})

    def test_memory_database_does_not_fall_back_to_gameplay_connection(self):
        engine = create_engine("sqlite:///:memory:")
        try:
            VoiceUsageBucket.__table__.create(engine)
            with patch("app.voice_usage.get_engine", return_value=engine):
                self.assertFalse(voice_usage.record_usage(10, 20, now=self.now))
            with engine.connect() as connection:
                self.assertEqual(connection.execute(select(VoiceUsageBucket)).all(), [])
        finally:
            engine.dispose()

    def test_exhausted_gameplay_pool_does_not_stall_voice_heartbeat(self):
        engine = create_engine(get_engine().url, pool_size=1, max_overflow=0, pool_timeout=2)
        fake = FakeProvider()
        sockets = [VoiceSocket(user_id) for user_id in (1, 2)]
        game = {"_id": "usage-table", "_game_type": "hausdepp", "_spectators": [], "_aborted": False,
                "_players": [{"id": f"p{socket.identity.user_id}", "user_id": socket.identity.user_id,
                              "ws": socket} for socket in sockets]}
        session = GameSocketSession(sockets[0], game, sockets[0].identity, player_id="p1")

        async def exercise():
            async def command(operation, **payload):
                request_id = str(len(sockets[0].messages))
                await voice.handle_voice_action(session, {"action": "hausdepp_voice", "request_id": request_id,
                                                          "operation": operation, **payload})
                reply = next(message["hausdepp_voice"] for message in reversed(sockets[0].messages)
                             if message.get("hausdepp_voice", {}).get("request_id") == request_id)
                self.assertTrue(reply["ok"], reply)
                return reply

            try:
                token = (await command("join"))["member_token"]
                await command("publish", member_token=token, sessionDescription=description(), mid="0")
                await command("microphone", member_token=token, enabled=True)
                with engine.connect():
                    await asyncio.wait_for(command("heartbeat", member_token=token,
                                                   usage={"received_bytes": 10, "sent_bytes": 20,
                                                          "sequence": 1}), timeout=1)
                member = voice._rooms[game["_hausdepp_voice_room_id"]].members[1]
                self.assertTrue(member.microphone)
                self.assertEqual(member.usage.sequence, 1)
            finally:
                await voice.stop_voice()
                voice._cleanup.clear()

        try:
            with patch.dict(os.environ, {"ROLLTHEDICE_VOICE_ENABLED": "1",
                                         "ROLLTHEDICE_VOICE_SFU_APP_ID": "test-app",
                                         "ROLLTHEDICE_VOICE_SFU_APP_SECRET": "test-secret"}), \
                    patch.object(voice, "provider", fake), \
                    patch.object(voice, "resolve_session", lambda socket: socket.identity), \
                    patch.object(voice, "user_play_banned", return_value=False), \
                    patch("app.voice_usage.get_engine", return_value=engine):
                asyncio.run(exercise())
        finally:
            engine.dispose()
        with session_scope() as db:
            row = db.scalars(select(VoiceUsageBucket)).one()
            self.assertEqual((row.received_bytes, row.sent_bytes, row.reports), (10, 20, 1))

    def test_dashboard_only_reads_voice_usage_for_authorized_hausdepp_scopes(self):
        self.assertTrue(voice_usage.record_usage(10, 20, now=self.now))
        hidden = [("all", False), ("zdwa", False), ("zilch", False),
                  ("zdwa", True), ("zilch", True), ("watten", True)]
        with patch.object(analytics, "voice_usage_stats", wraps=voice_usage.usage_stats) as reader, \
                patch.object(analytics, "server_snapshot", return_value={}):
            for game, include_hausdepp in hidden:
                with self.subTest(game=game, include_hausdepp=include_hausdepp):
                    result = analytics.dashboard_stats(1, game, now=self.now,
                                                       include_hausdepp=include_hausdepp, include_watten=True)
                    self.assertIsNone(result["voice_usage"])
            reader.assert_not_called()
            for game in ("all", "hausdepp"):
                with self.subTest(game=game):
                    result = analytics.dashboard_stats(1, game, now=self.now, include_hausdepp=True)
                    self.assertEqual(result["voice_usage"]["period"],
                                     {"received_bytes": 10, "sent_bytes": 20, "reports": 1})
            self.assertEqual(reader.call_count, 2)
