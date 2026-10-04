"""The abandonment fresh start must preserve games, scores and other awards."""

from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from alembic.config import Config
from sqlalchemy import Boolean, DateTime, Integer, MetaData, Table, create_engine, insert

from alembic import command

BASE = Path(__file__).resolve().parents[1]
PRE_RESET_REVISION = "20260922_0047"
RESET_REVISION = "20260928_0048"
TIMESTAMP = "2026-09-28T12:00:00+00:00"
FAIRPLAY_KEYS = tuple(
    f"manual_{mode}_aborts_{count}"
    for mode in ("solo", "multiplayer")
    for count in (1, 5, 10)
)


class AbandonmentResetMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.directory.name) / "abandonment-reset.sqlite3"
        self.database_url = f"sqlite:///{self.database_path}"
        self._upgrade(PRE_RESET_REVISION)
        engine = create_engine(self.database_url)
        try:
            with engine.begin() as connection:
                now = datetime(2026, 9, 28, 12, tzinfo=timezone.utc)
                # This fixture intentionally targets the historical schema.
                # Current User ORM columns can include fields not introduced yet.
                users = Table("users", MetaData(), autoload_with=connection)
                values = {"username": "Reset Player", "username_normalized": "resetplayer", "password_hash": "unused",
                          "role": "user", "is_active": True, "announce_selection_mode": "overlay",
                          "preferred_language": "de", "game_invite_push_audience": "all"}
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
                        raise AssertionError(f"Historical user fixture needs {column.name}")
                self.user_id = connection.execute(insert(users).values(**values)).inserted_primary_key[0]
        finally:
            engine.dispose()

    def tearDown(self) -> None:
        self.directory.cleanup()

    def _config(self) -> Config:
        config = Config(str(BASE / "alembic.ini"))
        config.set_main_option("script_location", str(BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", self.database_url)
        return config

    def _upgrade(self, revision: str = "head") -> None:
        command.upgrade(self._config(), revision)

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, isolation_level=None)
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    def _insert_abandonment(self, connection: sqlite3.Connection, game_type: str, game_id: str) -> None:
        row_id = connection.execute(
            "INSERT INTO abandoned_games "
            "(game_id, game_type, game_name, mode, hardcore, started_at, abandoned_at, reason, "
            "aborted_by_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (game_id, game_type, "A stopped game", "1", 0, TIMESTAMP, TIMESTAMP, "manual",
             self.user_id, TIMESTAMP),
        ).lastrowid
        connection.execute(
            "INSERT INTO abandoned_game_participants (abandoned_game_id, user_id, was_abort_initiator) "
            "VALUES (?, ?, ?)", (row_id, self.user_id, 1),
        )

    @staticmethod
    def _insert_active(connection: sqlite3.Connection, game_id: str, raw: str) -> None:
        connection.execute(
            "INSERT INTO active_games (game_id, state_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (game_id, raw, TIMESTAMP, TIMESTAMP),
        )

    def test_reset_clears_both_counters_and_only_fairplay_awards_preserving_results(self) -> None:
        preserved_tables = ("users", "completed_games", "game_participants", "zilch_achievement_unlocks")
        with self._connection() as connection:
            for game_type in ("zdwa", "zilch"):
                self._insert_abandonment(connection, game_type, f"old-abort-{game_type}")
            for game_id, game_type, outcome, score in (
                ("zdwa-finished", "zdwa", "completed", 777),
                ("zilch-finished", "zilch", "completed", 10000),
                ("zilch-private-abort", "zilch", "abandoned", 350),
            ):
                payload = json.dumps({"outcome": {"status": outcome}, "totals": {"p1": score}})
                result_id = connection.execute(
                    "INSERT INTO completed_games (game_id, game_type, game_name, finished_at, mode, hardcore, "
                    "snapshot_json, imported_from_legacy, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (game_id, game_type, game_id, TIMESTAMP, "1", 0, payload, 0, TIMESTAMP),
                ).lastrowid
                connection.execute(
                    "INSERT INTO game_participants (game_id, position, player_key, display_name, points, user_id) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (result_id, 0, "p1", "Reset Player", score, self.user_id),
                )
            for key in (*FAIRPLAY_KEYS, "account_created", "career_points_1000"):
                connection.execute(
                    "INSERT INTO user_achievements (user_id, achievement_key, unlocked_at) VALUES (?, ?, ?)",
                    (self.user_id, key, TIMESTAMP),
                )
            connection.execute(
                "INSERT INTO zilch_achievement_unlocks (user_id, achievement_key, definition_version, unlocked_at) "
                "VALUES (?, ?, ?, ?)", (self.user_id, "first_game", 1, TIMESTAMP),
            )
            original_columns = {table: ", ".join(row[1] for row in connection.execute(f"PRAGMA table_info({table})"))
                                for table in preserved_tables}
            before = {table: connection.execute(f"SELECT {original_columns[table]} FROM {table} ORDER BY id").fetchall()
                      for table in preserved_tables}
            other_awards = connection.execute(
                "SELECT * FROM user_achievements WHERE achievement_key IN ('account_created', 'career_points_1000') "
                "ORDER BY id"
            ).fetchall()

        self._upgrade()

        with self._connection() as connection:
            self.assertEqual(connection.execute("SELECT * FROM abandoned_game_participants").fetchall(), [])
            self.assertEqual(connection.execute("SELECT * FROM abandoned_games").fetchall(), [])
            self.assertEqual(connection.execute("SELECT * FROM user_achievements ORDER BY id").fetchall(), other_awards)
            for table, original in before.items():
                self.assertEqual(connection.execute(f"SELECT {original_columns[table]} FROM {table} ORDER BY id").fetchall(), original)
            self.assertEqual(connection.execute("PRAGMA foreign_key_check").fetchall(), [])

    def test_reset_settles_terminal_aborts_but_keeps_recovery_payloads_and_live_games(self) -> None:
        terminal_states = {
            "zdwa-abort": {"_aborted": True, "_players": [{"id": "p1"}], "p1": {"ones": 0}},
            "zilch-abort": {"_game_type": "zilch", "_aborted": True, "_scoreboard": {"p1": [100]}},
            "solo-finalization": {
                "_game_type": "zilch", "_aborted": False, "_finished": True,
                "_manual_solo_abandonment": True, "_zilch_outcome": {"status": "abandoned"},
                "_scoreboard": {"p1": [350]}, "_finalization_pending": True,
            },
        }
        untouched = {
            "running-zdwa": '{"_game_type": "zdwa", "_started": true, "_finished": false}',
            "running-zilch": '{"_game_type": "zilch", "_started": true, "_finished": false}',
            "completed-pending": '{"_game_type": "zilch", "_finished": true, "_finalization_pending": true}',
            "incomplete-solo": '{"_game_type":"zilch","_manual_solo_abandonment":true,"_finished":false}',
            "already-accounted": '{"_aborted":true,"_abandonment_accounted":true}',
            "unsupported": '{"_game_type": "other", "_aborted": true}',
            "invalid-game-type": '{"_game_type": [], "_aborted": true}',
            "invalid": "not json",
            "list": "[]",
        }
        with self._connection() as connection:
            for game_id, state in terminal_states.items():
                self._insert_active(connection, game_id, json.dumps(state))
            for game_id, raw in untouched.items():
                self._insert_active(connection, game_id, raw)

        self._upgrade()

        with self._connection() as connection:
            stored = dict(connection.execute("SELECT game_id, state_json FROM active_games").fetchall())
            self.assertEqual(len(stored), len(terminal_states) + len(untouched))
            for game_id, state in terminal_states.items():
                self.assertEqual(json.loads(stored[game_id]), {**state, "_abandonment_accounted": True})
            for game_id, raw in untouched.items():
                self.assertEqual(stored[game_id], raw)
            self.assertEqual(connection.execute(
                "SELECT DISTINCT created_at, updated_at FROM active_games"
            ).fetchall(), [(TIMESTAMP, TIMESTAMP)])

    def test_later_upgrades_keep_new_abandonments_and_downgrade_never_restores_old_counts(self) -> None:
        with self._connection() as connection:
            self._insert_abandonment(connection, "zdwa", "pre-reset")
        self._upgrade()
        with self._connection() as connection:
            for game_type in ("zdwa", "zilch"):
                self._insert_abandonment(connection, game_type, f"new-{game_type}")
            connection.execute(
                "INSERT INTO user_achievements (user_id, achievement_key, unlocked_at) VALUES (?, ?, ?)",
                (self.user_id, FAIRPLAY_KEYS[0], TIMESTAMP),
            )
            self._insert_active(connection, "new-terminal", '{"_aborted":true}')
            tables = ("abandoned_games", "abandoned_game_participants", "user_achievements", "active_games")
            before = {table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall() for table in tables}

        self._upgrade()

        with self._connection() as connection:
            self.assertEqual(connection.execute("SELECT version_num FROM alembic_version").fetchone(), ("20261004_0049",))
            for table, original in before.items():
                self.assertEqual(connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall(), original)
        command.downgrade(self._config(), PRE_RESET_REVISION)
        with self._connection() as connection:
            for table, original in before.items():
                self.assertEqual(connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall(), original)


if __name__ == "__main__":
    unittest.main()
