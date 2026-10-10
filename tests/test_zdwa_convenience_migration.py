"""Existing and subsequently created accounts receive all three conveniences."""

from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import TestCase

from alembic.config import Config
from sqlalchemy import Boolean, DateTime, Integer, MetaData, Table, create_engine, insert, select, update

from alembic import command

BASE = Path(__file__).resolve().parents[1]
PREFERENCES = ("skip_forced_strike_confirmation", "auto_hold_announced_numbers", "announce_button_writes")


class ZdwaConvenienceMigrationTest(TestCase):
    def test_existing_and_new_users_default_on_and_upgrade_preserves_existing_preferences(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Config(str(BASE / "alembic.ini"))
            config.set_main_option("script_location", str(BASE / "alembic"))
            database_url = f"sqlite:///{directory}/conveniences.sqlite3"
            config.set_main_option("sqlalchemy.url", database_url)
            command.upgrade(config, "20261005_0053")
            engine = create_engine(database_url)
            try:
                with engine.begin() as connection:
                    users = Table("users", MetaData(), autoload_with=connection)
                    values = {
                        "username": "Existing_Player", "username_normalized": "existing_player",
                        "password_hash": "existing-password-hash", "role": "user", "is_active": True,
                        "announce_selection_mode": "table", "preferred_language": "en",
                        "game_invite_push_audience": "all", "auto_write_announced": False,
                    }
                    for column in users.columns:
                        if column.primary_key or column.nullable or column.server_default is not None or column.name in values:
                            continue
                        if isinstance(column.type, DateTime):
                            values[column.name] = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
                        elif isinstance(column.type, Boolean):
                            values[column.name] = False
                        elif isinstance(column.type, Integer):
                            values[column.name] = 0
                        else:
                            self.fail(f"Historical user fixture needs {column.name}")
                    existing_id = connection.execute(insert(users).values(**values)).inserted_primary_key[0]
                command.upgrade(config, "head")
                with engine.begin() as connection:
                    users = Table("users", MetaData(), autoload_with=connection)
                    existing = connection.execute(select(users).where(users.c.id == existing_id)).mappings().one()
                    for name in PREFERENCES:
                        self.assertTrue(existing[name])
                    self.assertEqual(existing["announce_selection_mode"], "table")
                    self.assertEqual(existing["preferred_language"], "en")
                    self.assertFalse(existing["auto_write_announced"])
                    self.assertEqual(existing["password_hash"], "existing-password-hash")
                    # The database default also protects new accounts inserted by an old server.
                    new_id = connection.execute(insert(users).values(
                        **{**values, "username": "New_Player", "username_normalized": "new_player"},
                    )).inserted_primary_key[0]
                    new = connection.execute(select(users).where(users.c.id == new_id)).mappings().one()
                    for name in PREFERENCES:
                        self.assertTrue(new[name])
                    connection.execute(update(users).where(users.c.id == existing_id).values(
                        **{name: False for name in PREFERENCES},
                    ))
                command.upgrade(config, "head")
                with engine.connect() as connection:
                    existing = connection.execute(select(users).where(users.c.id == existing_id)).mappings().one()
                    for name in PREFERENCES:
                        self.assertFalse(existing[name])
            finally:
                engine.dispose()
