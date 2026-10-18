"""Persist private explicit native follow-up invitation consent."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0073"
down_revision = "20261018_0072"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watten_personal_invitations",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("source_game_id", sa.String(64), sa.ForeignKey("active_games.game_id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_game_id", sa.String(64), sa.ForeignKey("active_games.game_id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_participant_id", sa.String(12), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("target_game_id", "recipient_user_id", name="uq_watten_personal_invitation_target_recipient"),
        sa.CheckConstraint("source_game_id <> target_game_id", name="ck_watten_personal_invitation_pair"),
        sa.CheckConstraint("expires_at > created_at", name="ck_watten_personal_invitation_expiry"),
        sa.CheckConstraint("status IN ('pending', 'accepted', 'declined')", name="ck_watten_personal_invitation_status"),
        sa.CheckConstraint("(status = 'pending' AND responded_at IS NULL) OR "
                           "(status IN ('accepted', 'declined') AND responded_at IS NOT NULL)",
                           name="ck_watten_personal_invitation_response"),
    )
    op.create_index("ix_watten_personal_invitation_recipient", "watten_personal_invitations", ["recipient_user_id", "created_at"])


def downgrade() -> None:
    table = sa.table("watten_personal_invitations")
    if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
        raise RuntimeError("Cannot downgrade while Watten personal invitations exist")
    op.drop_index("ix_watten_personal_invitation_recipient", table_name="watten_personal_invitations")
    op.drop_table("watten_personal_invitations")
