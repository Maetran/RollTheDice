"""Use the production ASGI stack with disposable browser-suite data paths."""
from __future__ import annotations

import os
from pathlib import Path


def create_application():
    raw_directory = os.getenv("PLAYWRIGHT_TEST_DIR", "").strip()
    if not raw_directory:
        raise RuntimeError("The browser test factory requires PLAYWRIGHT_TEST_DIR")
    directory = Path(raw_directory).resolve()
    database_url = os.getenv("ROLLTHEDICE_DATABASE_URL", "")
    prefix = "sqlite:///"
    if (not database_url.startswith(prefix)
            or Path(database_url[len(prefix):]).resolve() != directory / "accounts.sqlite3"):
        raise RuntimeError("The browser test database must be accounts.sqlite3 in PLAYWRIGHT_TEST_DIR")
    directory.mkdir(parents=True, exist_ok=True)

    # Importing main configures its database from the already-isolated URL.
    # All legacy JSON readers/writers and startup imports consult these globals
    # at runtime; replace them before the original lifespan is ever entered.
    from app import main
    from app.asgi import create_application as production_application
    from app.leaderboard_storage import LeaderboardFiles

    main.DATA_DIR = directory
    main.LEADERBOARD_FILES = LeaderboardFiles.in_directory(directory)
    return production_application()
