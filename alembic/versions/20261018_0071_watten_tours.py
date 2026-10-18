"""Keep one private Watten tour choice without changing other tour states."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0071"
down_revision = "20261018_0070"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("game_tour_preferences", sa.Column("watten_state", sa.String(16),
        sa.CheckConstraint("watten_state IN ('unseen', 'dismissed', 'started', 'completed')",
                           name="ck_game_tour_watten_state"), nullable=False, server_default="unseen"))


def downgrade() -> None:
    if op.get_bind().exec_driver_sql(
        "SELECT 1 FROM game_tour_preferences WHERE watten_state <> 'unseen' LIMIT 1"
    ).first():
        raise RuntimeError("Cannot discard saved Watten tour choices")
    with op.batch_alter_table("game_tour_preferences") as batch:
        batch.drop_constraint("ck_game_tour_watten_state", type_="check")
        batch.drop_column("watten_state")
