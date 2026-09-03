"""Type completed-game records for ZDWA and private Zilch results.

Revision ID: 20260903_0016
Revises: 20260902_0015
Create Date: 2026-09-03

The application has historically stored only ZDWA completed games.  Existing
rows are therefore deterministically backfilled to ``zdwa``.  The non-null
server default is retained as a database-side compatibility guard for old
writers during a rolling upgrade; all current application writers pass an
explicit type.

Downgrading after a Zilch result exists would make the row impossible to type
for older code.  Refuse that operation rather than silently discarding or
rewriting private result data.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260903_0016"
down_revision = "20260902_0015"
branch_labels = None
depends_on = None

_GAME_TYPE_CHECK = "game_type IN ('zdwa', 'zilch')"


def _sqlite_type_triggers(table_name: str, constraint_name: str) -> None:
    """Install SQLite's lossless equivalent of an added CHECK constraint.

    Recreating ``completed_games`` to add a table CHECK makes SQLite process
    the CASCADE foreign keys from ``game_participants`` while its parent table
    is replaced.  Native ``ADD COLUMN`` preserves every historic row.  SQLite
    cannot add a named CHECK afterwards, so paired INSERT/UPDATE triggers are
    the database-side constraint equivalent for this existing table.
    """
    for event, suffix in (("INSERT", "insert"), ("UPDATE OF game_type", "update")):
        op.execute(
            sa.text(
                f"""
                CREATE TRIGGER {constraint_name}_{suffix}
                BEFORE {event} ON {table_name}
                FOR EACH ROW WHEN NEW.game_type NOT IN ('zdwa', 'zilch')
                BEGIN
                    SELECT RAISE(ABORT, 'invalid_game_type');
                END
                """
            )
        )


def _add_type_column(table_name: str, constraint_name: str) -> None:
    """Add a non-null type with a safe backfill without rebuilding parents."""
    op.add_column(
        table_name,
        sa.Column("game_type", sa.String(length=16), nullable=False, server_default="zdwa"),
    )
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        _sqlite_type_triggers(table_name, constraint_name)
    else:
        op.create_check_constraint(constraint_name, table_name, _GAME_TYPE_CHECK)


def upgrade() -> None:
    _add_type_column("completed_games", "ck_completed_games_game_type")
    _add_type_column("deleted_games", "ck_deleted_games_game_type")
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE completed_games SET game_type = 'zdwa' WHERE game_type IS NULL OR game_type = ''"))
    bind.execute(sa.text("UPDATE deleted_games SET game_type = 'zdwa' WHERE game_type IS NULL OR game_type = ''"))
    # Result lists are chronological and now always type-filtered.
    op.create_index(
        "ix_completed_games_game_type_finished_at",
        "completed_games",
        ["game_type", "finished_at"],
    )


def _assert_no_zilch_results(table_name: str) -> None:
    bind = op.get_bind()
    count = bind.execute(
        sa.text(f"SELECT COUNT(*) FROM {table_name} WHERE game_type <> 'zdwa'")
    ).scalar_one()
    if int(count or 0):
        raise RuntimeError(
            "Cannot downgrade typed completed-game results while Zilch records exist; "
            "restore a compatible backup or remove the Zilch records through a future typed tool first."
        )


def _drop_type_column(table_name: str, constraint_name: str) -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS {constraint_name}_insert"))
        op.execute(sa.text(f"DROP TRIGGER IF EXISTS {constraint_name}_update"))
    else:
        op.drop_constraint(constraint_name, table_name, type_="check")
    # SQLite has supported native DROP COLUMN since 3.35 (2021).  It avoids
    # rebuilding a parent table and therefore keeps participant/audit foreign
    # keys intact during a lossless ZDWA-only rollback.
    op.drop_column(table_name, "game_type")


def downgrade() -> None:
    _assert_no_zilch_results("completed_games")
    _assert_no_zilch_results("deleted_games")
    op.drop_index("ix_completed_games_game_type_finished_at", table_name="completed_games")
    _drop_type_column("deleted_games", "ck_deleted_games_game_type")
    _drop_type_column("completed_games", "ck_completed_games_game_type")
