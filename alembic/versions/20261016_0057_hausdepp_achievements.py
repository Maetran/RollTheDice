"""Private Hausdepp round credits, achievement unlocks and rank receipts."""

import sqlalchemy as sa

from alembic import op

revision = "20261016_0057"
down_revision = "20261016_0056"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("hausdepp_round_credits",
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("game_id", sa.String(64), primary_key=True),
                    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("facts_json", sa.Text(), nullable=False))
    op.create_table("hausdepp_achievement_unlocks",
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("achievement_id", sa.String(32), primary_key=True),
                    sa.Column("unlocked_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("source_game_id", sa.String(64), nullable=False),
                    sa.Column("awarded_points", sa.Integer(), nullable=False))
    op.create_table("hausdepp_presentation_receipts",
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("acknowledged_points", sa.Integer(), nullable=False),
                    sa.CheckConstraint("acknowledged_points >= 0", name="ck_hausdepp_receipt_points"))


def downgrade() -> None:
    op.drop_table("hausdepp_presentation_receipts")
    op.drop_table("hausdepp_achievement_unlocks")
    op.drop_table("hausdepp_round_credits")
