"""The additive signup migration preserves existing login credentials."""

from __future__ import annotations

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest import TestCase

from alembic.config import Config
from sqlalchemy import Boolean, DateTime, Integer, MetaData, Table, create_engine, insert, inspect, select

from alembic import command

BASE = Path(__file__).resolve().parents[1]


class PasskeySignupMigrationTest(TestCase):
    def test_upgrade_downgrade_and_reupgrade_preserve_accounts_and_passkeys(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Config(str(BASE / "alembic.ini"))
            config.set_main_option("script_location", str(BASE / "alembic"))
            database_url = f"sqlite:///{directory}/signup-migration.sqlite3"
            config.set_main_option("sqlalchemy.url", database_url)
            command.upgrade(config, "20261005_0052")
            engine = create_engine(database_url)
            now = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
            try:
                with engine.begin() as connection:
                    users = Table("users", MetaData(), autoload_with=connection)
                    values = {
                        "username": "Existing_Player", "username_normalized": "existing_player",
                        "password_hash": "existing-password-hash", "role": "user", "is_active": True,
                        "announce_selection_mode": "overlay", "preferred_language": "de",
                        "game_invite_push_audience": "all",
                    }
                    for column in users.columns:
                        if column.primary_key or column.nullable or column.server_default is not None or column.name in values:
                            continue
                        if isinstance(column.type, DateTime):
                            values[column.name] = now
                        elif isinstance(column.type, Boolean):
                            values[column.name] = False
                        elif isinstance(column.type, Integer):
                            values[column.name] = 0
                        else:
                            self.fail(f"Historical user fixture needs {column.name}")
                    user_id = connection.execute(insert(users).values(**values)).inserted_primary_key[0]
                    credentials = Table("passkey_credentials", MetaData(), autoload_with=connection)
                    connection.execute(insert(credentials).values(
                        user_id=user_id, credential_id=b"existing-credential", credential_public_key=b"existing-public-key",
                        sign_count=3, device_type="single_device", backed_up=False, created_at=now,
                    ))
                command.upgrade(config, "head")
                with engine.begin() as connection:
                    users = Table("users", MetaData(), autoload_with=connection)
                    row = connection.execute(select(users).where(users.c.id == user_id)).mappings().one()
                    self.assertEqual(row["password_hash"], "existing-password-hash")
                    self.assertIsNone(row["passkey_prompted_at"])
                    signup = Table("passkey_signup_ceremonies", MetaData(), autoload_with=connection)
                    connection.execute(insert(signup).values(
                        state_token_hash="a" * 64, challenge=b"x" * 32, username="Pending_Player",
                        username_normalized="pending_player", user_handle=b"h" * 32,
                        preferred_language="en", request_origin="https://example.test",
                        created_at=now, expires_at=now,
                    ))
                command.downgrade(config, "20261005_0052")
                with engine.connect() as connection:
                    self.assertNotIn("passkey_signup_ceremonies", inspect(connection).get_table_names())
                    self.assertNotIn("passkey_prompted_at", {item["name"] for item in inspect(connection).get_columns("users")})
                    self.assertEqual(connection.execute(select(credentials.c.credential_id)).scalar_one(), b"existing-credential")
                command.upgrade(config, "head")
                with engine.connect() as connection:
                    users = Table("users", MetaData(), autoload_with=connection)
                    self.assertEqual(connection.execute(select(users.c.username)).scalar_one(), "Existing_Player")
                    self.assertIsNone(connection.execute(select(users.c.passkey_prompted_at)).scalar_one())
            finally:
                engine.dispose()
