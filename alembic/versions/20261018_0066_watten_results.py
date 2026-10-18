"""Allow typed Watten result records without widening other product tables."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0066"
down_revision = "20261018_0065"
branch_labels = None
depends_on = None
_TABLES = (("completed_games", "ck_completed_games_game_type"), ("deleted_games", "ck_deleted_games_game_type"))


def _trigger_check(table: str, name: str, allowed: str) -> None:
    if op.get_bind().dialect.name == "sqlite":
        for event, suffix in (("INSERT", "insert"), ("UPDATE OF game_type", "update")):
            op.execute(sa.text(f"DROP TRIGGER IF EXISTS {name}_{suffix}"))
            op.execute(sa.text(f"""CREATE TRIGGER {name}_{suffix} BEFORE {event} ON {table}
                FOR EACH ROW WHEN NEW.game_type NOT IN ({allowed})
                BEGIN SELECT RAISE(ABORT, 'invalid_game_type'); END"""))
    else:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, f"game_type IN ({allowed})")


def _abandoned_check(allowed: str) -> None:
    connection = op.get_bind()
    sqlite = connection.dialect.name == "sqlite"
    if sqlite:
        connection.exec_driver_sql("CREATE TEMP TABLE watten_abandoned_backup AS SELECT * FROM abandoned_game_participants")
    with op.batch_alter_table("abandoned_games") as batch:
        batch.drop_constraint("ck_abandoned_games_game_type", type_="check")
        batch.create_check_constraint("ck_abandoned_games_game_type", f"game_type IN ({allowed})")
    if sqlite:
        connection.exec_driver_sql("INSERT INTO abandoned_game_participants (id, abandoned_game_id, user_id, was_abort_initiator) "
                                   "SELECT id, abandoned_game_id, user_id, was_abort_initiator FROM watten_abandoned_backup "
                                   "WHERE NOT EXISTS (SELECT 1 FROM abandoned_game_participants current WHERE current.id = watten_abandoned_backup.id)")
        connection.exec_driver_sql("DROP TABLE watten_abandoned_backup")


def upgrade() -> None:
    for table, name in _TABLES:
        _trigger_check(table, name, "'zdwa', 'zilch', 'hausdepp', 'watten'")
    _abandoned_check("'zdwa', 'zilch', 'watten'")


def downgrade() -> None:
    for name in ("completed_games", "deleted_games", "abandoned_games"):
        table = sa.table(name, sa.column("game_type"))
        if op.get_bind().execute(sa.select(sa.func.count()).select_from(table).where(table.c.game_type == "watten")).scalar_one():
            raise RuntimeError("Cannot downgrade while Watten result or audit records exist")
    for table, name in _TABLES:
        _trigger_check(table, name, "'zdwa', 'zilch', 'hausdepp'")
    _abandoned_check("'zdwa', 'zilch'")
