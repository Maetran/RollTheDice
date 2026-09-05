"""Regression coverage for the typed completed-game result migration."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from alembic.config import Config

from alembic import command

BASE = Path(__file__).resolve().parents[1]
PRE_TYPED_RESULTS_REVISION = "20260902_0015"
# ``head`` now includes the isolated Zilch-achievement tables.  The typed
# game-result assertions below remain deliberately exercised through the full
# upgrade chain so later revisions cannot leave the legacy type migration in a
# partially upgraded state.
LATEST_SCHEMA_REVISION = "20260905_0020"


class TypedCompletedResultsMigrationTest(unittest.TestCase):
    """Exercise the migration against real SQLite files, including old data."""

    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "typed-results.sqlite3"

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _config(self) -> Config:
        config = Config(str(BASE / "alembic.ini"))
        config.set_main_option("script_location", str(BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")
        return config

    def _upgrade(self, revision: str = "head") -> None:
        command.upgrade(self._config(), revision)

    def _downgrade(self, revision: str) -> None:
        command.downgrade(self._config(), revision)

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database_path, isolation_level=None)
        connection.execute("PRAGMA foreign_keys=ON")
        try:
            yield connection
        finally:
            connection.close()

    @staticmethod
    def _columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
        return [str(row[1]) for row in connection.execute(f"PRAGMA table_info({table_name})")]

    def _insert_user(self, connection: sqlite3.Connection) -> int:
        """Insert a valid user without coupling the migration test to ORM defaults."""
        timestamp = "2026-09-03T12:00:00+00:00"
        values = {
            "username": "Migration User",
            "username_normalized": "migrationuser",
            "password_hash": "not-used-by-this-migration-test",
            "role": "admin",
            "is_active": 1,
            "must_change_password": 0,
            "announce_selection_mode": "overlay",
            "auto_write_announced": 1,
            "mobile_row_quick_entry": 0,
            "haptic_feedback": 0,
            "keep_screen_awake": 0,
            "preferred_language": "de",
            "statistics_views": 0,
            "created_at": timestamp,
            "updated_at": timestamp,
        }
        columns = [column for column in self._columns(connection, "users") if column != "id"]
        for column in columns:
            if column.endswith("_at"):
                values.setdefault(column, timestamp)
        self.assertTrue(set(columns).issubset(values), f"missing user values: {set(columns) - set(values)}")
        cursor = connection.execute(
            f"INSERT INTO users ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            tuple(values[column] for column in columns),
        )
        return int(cursor.lastrowid)

    def _insert_completed_game(
        self,
        connection: sqlite3.Connection,
        *,
        game_id: str,
        game_type: str | None = None,
    ) -> int:
        timestamp = "2026-09-03T12:00:00+00:00"
        values: dict[str, object] = {
            "game_id": game_id,
            "game_name": "Migration game",
            "finished_at": timestamp,
            "mode": "2",
            "hardcore": 0,
            "snapshot_json": "{}",
            "imported_from_legacy": 0,
            "created_at": timestamp,
        }
        if game_type is not None:
            values["game_type"] = game_type
        columns = [column for column in self._columns(connection, "completed_games") if column in values]
        cursor = connection.execute(
            f"INSERT INTO completed_games ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            tuple(values[column] for column in columns),
        )
        return int(cursor.lastrowid)

    def _insert_deleted_game(
        self,
        connection: sqlite3.Connection,
        *,
        game_id: str,
        user_id: int,
        game_type: str | None = None,
    ) -> int:
        timestamp = "2026-09-03T12:00:00+00:00"
        values: dict[str, object] = {
            "game_id": game_id,
            "game_name": "Deleted migration game",
            "finished_at": timestamp,
            "mode": "2",
            "hardcore": 0,
            "deleted_at": timestamp,
            "deleted_by_user_id": user_id,
            "reason": "migration test",
        }
        if game_type is not None:
            values["game_type"] = game_type
        columns = [column for column in self._columns(connection, "deleted_games") if column in values]
        cursor = connection.execute(
            f"INSERT INTO deleted_games ({', '.join(columns)}) VALUES ({', '.join('?' for _ in columns)})",
            tuple(values[column] for column in columns),
        )
        return int(cursor.lastrowid)

    def _seed_pre_typed_rows(self) -> tuple[str, str, int]:
        self._upgrade(PRE_TYPED_RESULTS_REVISION)
        with self._connection() as connection:
            user_id = self._insert_user(connection)
            completed_id = self._insert_completed_game(connection, game_id="legacy-completed")
            connection.execute(
                """
                INSERT INTO game_participants
                    (game_id, position, player_key, display_name, team, points, user_id, assigned_at, assigned_by_user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (completed_id, 0, "p1", "Legacy player", None, 777, user_id, None, None),
            )
            self._insert_deleted_game(connection, game_id="legacy-deleted", user_id=user_id)
        return "legacy-completed", "legacy-deleted", completed_id

    def test_empty_upgrade_creates_typed_schema_and_is_idempotent(self) -> None:
        self._upgrade()
        self._upgrade()

        with self._connection() as connection:
            version = connection.execute("SELECT version_num FROM alembic_version").fetchone()[0]
            self.assertEqual(version, LATEST_SCHEMA_REVISION)
            completed_info = {
                str(row[1]): {"notnull": int(row[3]), "default": row[4]}
                for row in connection.execute("PRAGMA table_info(completed_games)")
            }
            deleted_info = {
                str(row[1]): {"notnull": int(row[3]), "default": row[4]}
                for row in connection.execute("PRAGMA table_info(deleted_games)")
            }
            self.assertEqual(completed_info["game_type"]["notnull"], 1)
            self.assertIn("zdwa", str(completed_info["game_type"]["default"]))
            self.assertEqual(deleted_info["game_type"]["notnull"], 1)
            self.assertIn("zdwa", str(deleted_info["game_type"]["default"]))
            indexes = {
                str(row[1]): [str(column[2]) for column in connection.execute(f"PRAGMA index_info({row[1]})")]
                for row in connection.execute("PRAGMA index_list(completed_games)")
            }
            self.assertEqual(indexes["ix_completed_games_game_type_finished_at"], ["game_type", "finished_at"])
            achievement_columns = {
                str(row[1]): {"notnull": int(row[3]), "default": row[4]}
                for row in connection.execute("PRAGMA table_info(user_achievements)")
            }
            self.assertEqual(
                achievement_columns["source_completed_game_id"],
                {"notnull": 0, "default": None},
            )
            achievement_indexes = {
                str(row[1]): [str(column[2]) for column in connection.execute(f"PRAGMA index_info({row[1]})")]
                for row in connection.execute("PRAGMA index_list(user_achievements)")
            }
            self.assertEqual(
                achievement_indexes["ix_user_achievements_source_game"],
                ["source_completed_game_id"],
            )

    def test_achievement_source_migration_keeps_history_unlinked_and_sets_null_on_delete(self) -> None:
        self._upgrade("20260903_0017")
        with self._connection() as connection:
            user_id = self._insert_user(connection)
            completed_id = self._insert_completed_game(
                connection,
                game_id="achievement-source-game",
                game_type="zdwa",
            )
            connection.execute(
                """
                INSERT INTO user_achievements (user_id, achievement_key, unlocked_at)
                VALUES (?, ?, ?)
                """,
                (user_id, "career_points_1000", "2026-09-03T12:00:00+00:00"),
            )

        self._upgrade()

        with self._connection() as connection:
            self.assertIsNone(
                connection.execute(
                    "SELECT source_completed_game_id FROM user_achievements WHERE user_id = ?",
                    (user_id,),
                ).fetchone()[0]
            )
            connection.execute(
                "UPDATE user_achievements SET source_completed_game_id = ? WHERE user_id = ?",
                (completed_id, user_id),
            )
            connection.execute("DELETE FROM completed_games WHERE id = ?", (completed_id,))
            self.assertIsNone(
                connection.execute(
                    "SELECT source_completed_game_id FROM user_achievements WHERE user_id = ?",
                    (user_id,),
                ).fetchone()[0]
            )

    def test_upgrade_backfills_legacy_rows_and_preserves_participants(self) -> None:
        completed_game_id, deleted_game_id, completed_id = self._seed_pre_typed_rows()

        self._upgrade()

        with self._connection() as connection:
            self.assertEqual(
                connection.execute(
                    "SELECT game_type FROM completed_games WHERE game_id = ?", (completed_game_id,)
                ).fetchone()[0],
                "zdwa",
            )
            self.assertEqual(
                connection.execute(
                    "SELECT game_type FROM deleted_games WHERE game_id = ?", (deleted_game_id,)
                ).fetchone()[0],
                "zdwa",
            )
            self.assertEqual(
                connection.execute(
                    "SELECT game_id, player_key, display_name, points FROM game_participants WHERE game_id = ?",
                    (completed_id,),
                ).fetchone(),
                (completed_id, "p1", "Legacy player", 777),
            )

    def test_database_rejects_unknown_completed_and_deleted_game_types(self) -> None:
        self._upgrade()

        with self._connection() as connection:
            user_id = self._insert_user(connection)
            with self.assertRaisesRegex(sqlite3.IntegrityError, "invalid_game_type"):
                self._insert_completed_game(connection, game_id="invalid-completed", game_type="unknown")
            with self.assertRaisesRegex(sqlite3.IntegrityError, "invalid_game_type"):
                self._insert_deleted_game(
                    connection,
                    game_id="invalid-deleted",
                    user_id=user_id,
                    game_type="unknown",
                )

    def test_zdwa_only_downgrade_preserves_completed_deleted_and_participant_rows(self) -> None:
        completed_game_id, deleted_game_id, completed_id = self._seed_pre_typed_rows()
        self._upgrade()

        self._downgrade(PRE_TYPED_RESULTS_REVISION)

        with self._connection() as connection:
            self.assertNotIn("game_type", self._columns(connection, "completed_games"))
            self.assertNotIn("game_type", self._columns(connection, "deleted_games"))
            self.assertEqual(
                connection.execute("SELECT game_id FROM completed_games WHERE game_id = ?", (completed_game_id,)).fetchone()[0],
                completed_game_id,
            )
            self.assertEqual(
                connection.execute("SELECT game_id FROM deleted_games WHERE game_id = ?", (deleted_game_id,)).fetchone()[0],
                deleted_game_id,
            )
            self.assertEqual(
                connection.execute("SELECT player_key FROM game_participants WHERE game_id = ?", (completed_id,)).fetchone()[0],
                "p1",
            )

    def test_downgrade_refuses_when_a_zilch_completed_result_exists(self) -> None:
        self._upgrade()
        with self._connection() as connection:
            self._insert_completed_game(connection, game_id="zilch-completed", game_type="zilch")

        with self.assertRaisesRegex(RuntimeError, "Zilch records exist"):
            self._downgrade(PRE_TYPED_RESULTS_REVISION)

        with self._connection() as connection:
            self.assertIn("game_type", self._columns(connection, "completed_games"))
            self.assertEqual(
                connection.execute("SELECT game_type FROM completed_games WHERE game_id = 'zilch-completed'").fetchone()[0],
                "zilch",
            )

    def test_downgrade_refuses_when_a_zilch_tombstone_exists(self) -> None:
        self._upgrade()
        with self._connection() as connection:
            user_id = self._insert_user(connection)
            self._insert_deleted_game(
                connection,
                game_id="zilch-deleted",
                user_id=user_id,
                game_type="zilch",
            )

        with self.assertRaisesRegex(RuntimeError, "Zilch records exist"):
            self._downgrade(PRE_TYPED_RESULTS_REVISION)

        with self._connection() as connection:
            self.assertIn("game_type", self._columns(connection, "deleted_games"))
            self.assertEqual(
                connection.execute("SELECT game_type FROM deleted_games WHERE game_id = 'zilch-deleted'").fetchone()[0],
                "zilch",
            )
