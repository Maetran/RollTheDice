"""Allow typed Hausdepp outcomes without rebuilding SQLite parent tables."""

import sqlalchemy as sa

from alembic import op

revision = "20261016_0056"
down_revision = "20261013_0055"
branch_labels = None
depends_on = None
_TABLES = (("completed_games", "ck_completed_games_game_type"), ("deleted_games", "ck_deleted_games_game_type"))


def _replace_constraint(table: str, name: str, *, hausdepp: bool) -> None:
    allowed = "'zdwa', 'zilch', 'hausdepp'" if hausdepp else "'zdwa', 'zilch'"
    if op.get_bind().dialect.name == "sqlite":
        # Revision 0016 deliberately uses triggers instead of rebuilding these
        # referenced parent tables. Preserve its lossless approach and all IDs.
        for event, suffix in (("INSERT", "insert"), ("UPDATE OF game_type", "update")):
            op.execute(sa.text(f"DROP TRIGGER IF EXISTS {name}_{suffix}"))
            op.execute(sa.text(f"""CREATE TRIGGER {name}_{suffix} BEFORE {event} ON {table}
                FOR EACH ROW WHEN NEW.game_type NOT IN ({allowed})
                BEGIN SELECT RAISE(ABORT, 'invalid_game_type'); END"""))
    else:
        op.drop_constraint(name, table, type_="check")
        op.create_check_constraint(name, table, f"game_type IN ({allowed})")


def upgrade() -> None:
    for table, name in _TABLES:
        _replace_constraint(table, name, hausdepp=True)


def downgrade() -> None:
    for table, _name in _TABLES:
        count = op.get_bind().execute(sa.text(f"SELECT COUNT(*) FROM {table} WHERE game_type = 'hausdepp'")).scalar_one()
        if count:
            raise RuntimeError("Cannot downgrade while Hausdepp results or deletion records exist")
    for table, name in _TABLES:
        _replace_constraint(table, name, hausdepp=False)
