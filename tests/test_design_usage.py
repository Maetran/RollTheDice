"""Mission Control design usage: bounded daily seconds per look, retention and
the period, game and account aggregation behind ``design_usage``."""

import asyncio
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select

from app import analytics, main
from app.analytics import (
    DESIGN_RETENTION_DAYS,
    LOOKS,
    AnalyticsDesignBucket,
    AnalyticsEvent,
    dashboard_stats,
    normalize_batch,
    persist_batches,
)
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.models import User

NOW = datetime(2026, 10, 13, 12, tzinfo=timezone.utc)


def engagement(event_id, *, look, page="/spiel/ROOM", game="zdwa", active_ms=15000, kind="engagement"):
    return {"id": event_id * 32, "page_id": "b" * 32, "type": kind, "page": page, "game": game,
            "active_ms": active_ms, "look": look, "action": "roll_dice"}


class DesignUsageAggregationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/design-usage.sqlite"})
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)

    def tearDown(self):
        if analytics._queue is not None:
            asyncio.run(analytics.stop_analytics())
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def bucket(self, day, look, area, active_ms):
        with session_scope() as db:
            db.add(AnalyticsDesignBucket(day=day, look=look, area=area, active_ms=active_ms))

    def usage(self, days=7, game="all", now=NOW):
        return dashboard_stats(days, game, now=now)["design_usage"]

    def test_only_engagement_events_carry_a_bounded_look(self):
        raw = {"session_id": "a" * 32, "events": [
            engagement("1", look="zdwa:new:dark", kind="page_view"),
            engagement("2", look="zdwa:new:dark", kind="action"),
            engagement("3", look="zdwa:new:dark"),
            # The page decides the game; a ZDWA look cannot be filed under Zilch.
            engagement("4", look="zdwa:new:dark", page="/zilch/spiel/ROOM"),
            engagement("5", look="zdwa:new:dark" + "x" * 40),
            engagement("6", look=["zdwa:new:dark"]),
        ]}
        events = normalize_batch(raw, now=NOW)["events"]
        self.assertEqual([event.get("look") for event in events], [None, None, "zdwa:new:dark", None, None, None])
        persist_batches([normalize_batch(raw, now=NOW)], now=NOW)
        with session_scope() as db:
            rows = db.execute(select(AnalyticsDesignBucket.day, AnalyticsDesignBucket.look,
                                     AnalyticsDesignBucket.area, AnalyticsDesignBucket.active_ms)).all()
            self.assertEqual(rows, [("2026-10-13", "zdwa:new:dark", "table", 15000)])
            # The event table itself never stores a look.
            self.assertNotIn("look", AnalyticsEvent.__table__.columns)

    def test_each_day_holds_at_most_one_row_per_look_and_area(self):
        events = [engagement(str(index % 10), look=look, page=page, active_ms=1000)
                  for index, (look, page) in enumerate((look, page) for look in sorted(LOOKS)
                                                      for page in ("/spiel/ROOM", "/regeln"))]
        for offset in range(0, len(events), 10):
            chunk = [{**event, "id": f"{offset + index:032x}"} for index, event in enumerate(events[offset:offset + 10])]
            for event in chunk:
                if event["look"].startswith("zilch:"):
                    event["game"] = "zilch"
                    event["page"] = "/zilch" + event["page"]
            for _ in range(3):
                persist_batches([normalize_batch({"session_id": f"{offset + 1:032x}", "events": chunk},
                                                 now=NOW + timedelta(seconds=offset))], now=NOW)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(AnalyticsDesignBucket)), len(LOOKS) * 2)
            self.assertEqual(set(db.scalars(select(AnalyticsDesignBucket.active_ms))), {1000})

    def test_totals_are_summed_in_milliseconds_before_rounding(self):
        self.bucket("2026-10-13", "zdwa:old:light", "table", 1500)
        self.bucket("2026-10-12", "zdwa:old:light", "table", 700)
        self.bucket("2026-10-13", "zdwa:old:light", "site", 1900)
        looks = {row["look"]: row for row in self.usage()["looks"]}
        self.assertEqual(looks["zdwa:old:light"], {"look": "zdwa:old:light", "game": "zdwa",
                                                   "seconds": 4, "table_seconds": 2})

    def test_period_and_game_filters_apply_to_the_daily_rows(self):
        self.bucket("2026-10-13", "zdwa:new:classic", "site", 5000)
        self.bucket("2026-10-07", "zdwa:new:classic", "site", 7000)
        self.bucket("2026-10-06", "zdwa:new:classic", "site", 11000)
        self.bucket("2026-09-01", "zilch:lcars", "table", 9000)
        self.bucket("2026-10-13", "zilch:tavern", "table", 3000)
        # Tomorrow's row (clock skew) stays out of today's view.
        self.bucket("2026-10-14", "zdwa:new:classic", "site", 13000)
        today = {row["look"]: row["seconds"] for row in self.usage(1)["looks"]}
        self.assertEqual(today, {"zdwa:new:classic": 5, "zilch:tavern": 3})
        week = {row["look"]: row["seconds"] for row in self.usage(7)["looks"]}
        self.assertEqual(week, {"zdwa:new:classic": 12, "zilch:tavern": 3})
        quarter = self.usage(90)
        self.assertEqual([row["look"] for row in quarter["looks"]], ["zdwa:new:classic", "zilch:lcars", "zilch:tavern"])
        self.assertEqual(quarter["first_day"], "2026-09-01")
        zdwa = self.usage(90, "zdwa")
        self.assertEqual([row["look"] for row in zdwa["looks"]], ["zdwa:new:classic"])
        # The collection start follows the game filter.
        self.assertEqual(zdwa["first_day"], "2026-10-06")
        self.assertEqual(self.usage(90, "zilch")["first_day"], "2026-09-01")

    def test_unknown_rows_never_reach_the_dashboard(self):
        self.bucket("2026-10-13", "zdwa:neon:dark", "table", 5000)
        self.bucket("2026-10-13", "zdwa:new:dark", "lobby", 5000)
        usage = self.usage()
        self.assertEqual(usage["looks"], [])
        self.assertIsNone(usage["first_day"])
        self.assertEqual(usage["retention_days"], DESIGN_RETENTION_DAYS)

    def test_retention_sweep_keeps_four_hundred_days_independently_of_events(self):
        first_kept = (NOW - timedelta(days=DESIGN_RETENTION_DAYS - 1)).date().isoformat()
        expired = (NOW - timedelta(days=DESIGN_RETENTION_DAYS)).date().isoformat()
        older_than_events = (NOW - timedelta(days=200)).date().isoformat()
        for day in (expired, first_kept, older_than_events):
            self.bucket(day, "zdwa:old:dark", "table", 2000)
        persist_batches([], now=NOW, sweep=True)
        with session_scope() as db:
            days = sorted(db.scalars(select(AnalyticsDesignBucket.day)))
        self.assertEqual(days, sorted([first_kept, older_than_events]))
        # Without a sweep nothing is removed.
        self.bucket(expired, "zdwa:old:dark", "table", 2000)
        persist_batches([], now=NOW)
        with session_scope() as db:
            self.assertIn(expired, set(db.scalars(select(AnalyticsDesignBucket.day))))

    def test_account_choices_count_active_accounts_and_follow_the_game_filter(self):
        old = create_user("OldSheet", "a-secure-password-123", must_change_password=False)
        create_user("NewSheet", "a-secure-password-123", must_change_password=False)
        gone = create_user("GoneSheet", "a-secure-password-123", must_change_password=False)
        odd = create_user("OddSheet", "a-secure-password-123", must_change_password=False)
        with session_scope() as db:
            db.get(User, old.id).zdwa_design = "old"
            db.get(User, gone.id).zdwa_design = "old"
            db.get(User, gone.id).is_active = False
            # The game shows unknown stored values as the new design; so does the dashboard.
            db.get(User, odd.id).zdwa_design = "retro"
            expected_new = db.scalar(select(func.count()).select_from(User).where(
                User.is_active.is_(True), User.zdwa_design != "old"))
        choices = self.usage()["zdwa_account_choices"]
        self.assertEqual((choices["new"], choices["old"]), (expected_new, 1))
        self.assertEqual(self.usage(game="zdwa")["zdwa_account_choices"], choices)
        self.assertIsNone(self.usage(game="zilch")["zdwa_account_choices"])

    def test_account_choices_separate_answers_from_untouched_defaults(self):
        released = datetime(2026, 10, 13, 8, tzinfo=timezone.utc)
        before = released - timedelta(days=60)
        with session_scope() as db:
            # Bootstrap accounts from the migration are not part of this scenario.
            for user in db.scalars(select(User)):
                user.is_active = False
        accounts = {}
        for name in ("KeptNew", "WentBack", "NotYetAsked", "ChoseInSettings", "FreshNew", "FreshOld", "QuickPrompt"):
            accounts[name] = create_user(name, "a-secure-password-123", must_change_password=False).id
        with session_scope() as db:
            def setup(name, design, created_at, prompted_at):
                user = db.get(User, accounts[name])
                user.zdwa_design, user.created_at, user.zdwa_design_prompted_at = design, created_at, prompted_at
            # Pre-release accounts: the question was shown after the release.
            setup("KeptNew", "new", before, released + timedelta(hours=2))
            setup("WentBack", "old", before, released + timedelta(hours=3))
            setup("ChoseInSettings", "old", before, released + timedelta(days=1))
            # Not signed in since the release: still waiting for the question.
            setup("NotYetAsked", "new", before, None)
            # Registered after the release: the timestamp is set at registration.
            setup("FreshOld", "old", released + timedelta(days=2), released + timedelta(days=2, seconds=1))
            # The one-time question is only counted once the account had existed
            # for longer than the registration grace.
            setup("QuickPrompt", "new", released - timedelta(minutes=1), released + timedelta(minutes=1))
        choices = self.usage()["zdwa_account_choices"]
        self.assertEqual(choices, {"new": 4, "old": 3, "answered": {"new": 1, "old": 2},
                                   "never_asked_new": 3, "awaiting_prompt": 1})

    def test_design_usage_reports_the_rollout_switch(self):
        for mode, expected in (("all", "all"), ("owner", "owner"), ("off", "off"), ("bogus", "off")):
            with self.subTest(mode=mode), patch.dict(os.environ, {"ROLLTHEDICE_ZDWA_DESIGN": mode}):
                self.assertEqual(self.usage()["zdwa_design_mode"], expected)
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("ROLLTHEDICE_ZDWA_DESIGN", None)
            self.assertEqual(self.usage()["zdwa_design_mode"], "all")

if __name__ == "__main__":
    unittest.main()
