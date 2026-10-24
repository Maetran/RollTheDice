"""Database startup must not silently disable already imported app loggers."""

import os
import subprocess
import sys
from pathlib import Path


def test_migration_startup_preserves_application_error_logging(tmp_path):
    root = Path(__file__).resolve().parents[1]
    marker = "application-error-after-database-upgrade"
    script = """
import logging
import sys
from pathlib import Path
from app.database import configure_database, get_engine, upgrade_database
from app.hausdepp_experience import logger

if logger.disabled:
    raise SystemExit('application logger unexpectedly disabled before database startup')
configure_database(Path(sys.argv[2]))
upgrade_database(Path(sys.argv[1]))
if logger.disabled or not logger.isEnabledFor(logging.ERROR):
    raise SystemExit('migration startup disabled application error logging')
logger.error(sys.argv[3])
get_engine().dispose()
"""
    result = subprocess.run(
        [sys.executable, "-c", script, str(root), str(tmp_path), marker],
        # An inherited test database URL must not override configure_database's
        # temporary data directory. Child checks also work under Python -O.
        cwd=root, env={**os.environ, "ROLLTHEDICE_DATABASE_URL": ""},
        capture_output=True, text=True, timeout=30, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert marker in result.stderr
