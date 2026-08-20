from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker


_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None
_database_url: str | None = None
_schema_ready = False


def configure_database(data_dir: Path) -> None:
    global _engine, _session_factory, _database_url, _schema_ready

    if _engine is not None:
        _engine.dispose()
    _schema_ready = False
    configured_url = os.getenv("ROLLTHEDICE_DATABASE_URL", "").strip()
    database_path = data_dir / "rollthedice.sqlite3"
    _database_url = configured_url or f"sqlite:///{database_path}"
    connect_args = {"check_same_thread": False, "timeout": 30} if _database_url.startswith("sqlite") else {}
    _engine = create_engine(_database_url, connect_args=connect_args, pool_pre_ping=True)

    if _database_url.startswith("sqlite"):
        @event.listens_for(_engine, "connect")
        def _sqlite_pragmas(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.close()

    _session_factory = sessionmaker(bind=_engine, expire_on_commit=False)


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("Database has not been configured")
    return _engine


def database_schema_ready() -> bool:
    return _schema_ready


@contextmanager
def session_scope() -> Iterator[Session]:
    if _session_factory is None:
        raise RuntimeError("Database has not been configured")
    db = _session_factory()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def upgrade_database(base_dir: Path) -> None:
    global _schema_ready
    if not _database_url:
        raise RuntimeError("Database has not been configured")
    config = Config(str(base_dir / "alembic.ini"))
    config.set_main_option("script_location", str(base_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", _database_url.replace("%", "%%"))
    command.upgrade(config, "head")
    _schema_ready = True
