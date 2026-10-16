"""Private product context must not enter delegated installation totals."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from app import analytics, main
from app.database import configure_database, session_scope, upgrade_database
from app.security import utcnow


class AnalyticsPwaPrivacyTests(unittest.TestCase):
    def test_private_or_future_manifest_events_never_change_delegated_all_totals(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{directory}/analytics.sqlite3"}):
                configure_database(Path(directory))
                try:
                    upgrade_database(main.BASE)
                    now = utcnow()
                    with session_scope() as db:
                        # Existing/legacy rows may pair a known manifest action
                        # with a private page context. Do not assume today's
                        # client allowlist will always prevent that combination.
                        for number, action in enumerate(("pwa_installed_zdwa", "pwa_first_open_zilch")):
                            db.add(analytics.AnalyticsEvent(
                                dedupe_key=str(number) * 64, session_id=None,
                                received_at=now - timedelta(seconds=1), event_type="action",
                                page="/hausdepp", game="hausdepp", action=action,
                                active_ms=0, mode="unknown", source="client",
                            ))
                    delegate = analytics.dashboard_stats(1, "all", now=now)
                    self.assertEqual(delegate["pwa"], {"confirmed_installations": 0, "first_detected_starts": 0})
                    founder = analytics.dashboard_stats(1, "all", now=now, include_hausdepp=True)
                    self.assertEqual(founder["pwa"], {"confirmed_installations": 1, "first_detected_starts": 1})
                    # A future House manifest counter must also respect its
                    # product audience even if emitted on a public suite page.
                    with session_scope() as db:
                        db.add(analytics.AnalyticsEvent(
                            dedupe_key="f" * 64, session_id=None, received_at=now - timedelta(seconds=1),
                            event_type="action", page="/", game="zdwa", action="pwa_installed_hausdepp",
                            active_ms=0, mode="unknown", source="client",
                        ))
                    with patch.dict(analytics.PWA_ACTIONS, {"pwa_installed_hausdepp": ("hausdepp", "confirmed_installations")}):
                        self.assertEqual(analytics.dashboard_stats(1, "all", now=now)["pwa"], delegate["pwa"])
                        self.assertEqual(analytics.dashboard_stats(1, "all", now=now, include_hausdepp=True)["pwa"],
                                         {"confirmed_installations": 2, "first_detected_starts": 1})
                finally:
                    configure_database(main.DATA_DIR)
