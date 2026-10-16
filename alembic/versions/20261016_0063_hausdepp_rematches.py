"""Durable Hausdepp rematch identity and opt-in invitations."""

import sqlalchemy as sa

from alembic import op

revision = "20261016_0063"
down_revision = "20261016_0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hausdepp_rematch_sources",
        sa.Column("game_id", sa.String(64), primary_key=True),
        sa.Column("original_user_ids_json", sa.Text(), nullable=False),
        sa.Column("settings_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "hausdepp_rematches",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("source_game_id", sa.String(64), nullable=False, unique=True),
        sa.Column("game_id", sa.String(64), nullable=False, unique=True),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("original_user_ids_json", sa.Text(), nullable=False),
        sa.Column("settings_json", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "hausdepp_rematch_invitations",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("rematch_id", sa.String(64), sa.ForeignKey("hausdepp_rematches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("rematch_id", "user_id", name="uq_hausdepp_rematch_recipient"),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined')", name="ck_hausdepp_rematch_invitation_status"),
    )
    op.create_index("ix_hausdepp_rematch_invitation_recipient", "hausdepp_rematch_invitations", ["user_id", "status"])


def downgrade() -> None:
    op.drop_table("hausdepp_rematch_invitations")
    op.drop_table("hausdepp_rematches")
    op.drop_table("hausdepp_rematch_sources")
