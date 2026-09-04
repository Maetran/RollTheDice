"""Link newly earned ZDWA achievements to their proven source result.

Revision ID: 20260904_0018
Revises: 20260903_0017
Create Date: 2026-09-04

Existing rows deliberately remain NULL. Their historic materialization time
does not prove which game crossed a threshold, and account/statistics awards
do not have a game source at all.
"""

import sqlalchemy as sa

from alembic import op

revision = "20260904_0018"
down_revision = "20260903_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite cannot ALTER an existing table to add a foreign-key constraint.
    # This is a child table with no inbound references, so Alembic's batch
    # copy preserves every historic unlock without the parent-table cascade
    # hazard documented by the typed-result migration.
    with op.batch_alter_table("user_achievements") as batch_op:
        batch_op.add_column(sa.Column("source_completed_game_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_user_achievements_source_completed_game",
            "completed_games",
            ["source_completed_game_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_index(
            "ix_user_achievements_source_game",
            ["source_completed_game_id"],
        )


def downgrade() -> None:
    with op.batch_alter_table("user_achievements") as batch_op:
        batch_op.drop_index("ix_user_achievements_source_game")
        batch_op.drop_constraint("fk_user_achievements_source_completed_game", type_="foreignkey")
        batch_op.drop_column("source_completed_game_id")
