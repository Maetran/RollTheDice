"""Browser workers keep legacy JSON and SQLite inside the same owned sandbox."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app import main
from app.database import configure_database, get_engine
from app.leaderboard_storage import LeaderboardFiles, atomic_write_json
from app.proxy_headers import TrustedProxyHeadersMiddleware
from scripts.browser_test_app import create_application


class BrowserTestApplicationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name).resolve() / "suite"
        self.directory.mkdir()
        self.shared = Path(self.temporary.name).resolve() / "shared"
        self.shared.mkdir()
        self.environment = patch.dict(os.environ, {
            "PLAYWRIGHT_TEST_DIR": str(self.directory),
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.directory / 'accounts.sqlite3'}",
        })
        self.environment.start()
        self.paths = patch.multiple(main, DATA_DIR=self.shared, LEADERBOARD_FILES=LeaderboardFiles.in_directory(self.shared))
        self.paths.start()
        configure_database(self.directory)

    def tearDown(self):
        self.paths.stop()
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary.cleanup()

    def test_original_asgi_proxy_lifespan_and_routes_are_retained(self):
        lifespan = main.app.router.lifespan_context
        routes = list(main.app.routes)
        application = create_application()
        self.assertIsInstance(application, TrustedProxyHeadersMiddleware)
        self.assertIs(application.app.app, main.app)
        self.assertIs(main.app.router.lifespan_context, lifespan)
        self.assertEqual(main.app.routes, routes)
        self.assertEqual(Path(get_engine().url.database).resolve(), self.directory / "accounts.sqlite3")

    def test_json_writes_and_legacy_import_sources_stay_inside_the_suite(self):
        sentinel = self.shared / "stats.json"
        sentinel.write_text('{"shared":true}', encoding="utf-8")
        create_application()
        self.assertEqual(main.DATA_DIR, self.directory)
        for source in [*main.LEADERBOARD_FILES.legacy_paths(), main.LEADERBOARD_FILES.stats]:
            self.assertEqual(source.parent, self.directory)
        atomic_write_json(main.LEADERBOARD_FILES.stats, {"isolated": True})
        self.assertEqual(json.loads((self.directory / "stats.json").read_text(encoding="utf-8")), {"isolated": True})
        self.assertEqual(json.loads(sentinel.read_text(encoding="utf-8")), {"shared": True})

    def test_missing_sandbox_and_unrelated_database_are_refused_before_factory(self):
        with patch.dict(os.environ, {"PLAYWRIGHT_TEST_DIR": ""}):
            with self.assertRaisesRegex(RuntimeError, "PLAYWRIGHT_TEST_DIR"):
                create_application()
        for url in ("", "sqlite:////outside/accounts.sqlite3", "postgresql://example.invalid/database"):
            with self.subTest(url=url), patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": url}):
                with self.assertRaisesRegex(RuntimeError, "browser test database"):
                    create_application()
