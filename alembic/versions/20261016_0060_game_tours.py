"""Store private tour choices without rewriting existing account or game data."""

import sqlalchemy as sa

from alembic import op

revision = "20261016_0060"
down_revision = "20261016_0059"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "game_tour_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("zdwa_state", sa.String(16), nullable=False, server_default="unseen"),
        sa.Column("zilch_state", sa.String(16), nullable=False, server_default="unseen"),
        sa.Column("hausdepp_state", sa.String(16), nullable=False, server_default="unseen"),
        *(
            sa.CheckConstraint(
                f"{game}_state IN ('unseen', 'dismissed', 'started', 'completed')",
                name=f"ck_game_tour_{game}_state",
            )
            for game in ("zdwa", "zilch", "hausdepp")
        ),
    )


def downgrade() -> None:
    op.drop_table("game_tour_preferences")
