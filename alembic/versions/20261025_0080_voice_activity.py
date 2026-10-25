"""Private bounded server-observed voice membership activity."""

import sqlalchemy as sa

from alembic import op

revision = "20261025_0080"
down_revision = "20261025_0079"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voice_activity_buckets",
        sa.Column("day", sa.String(10), primary_key=True),
        sa.Column("game_type", sa.String(16), primary_key=True),
        sa.Column("game_id", sa.String(128), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("activations", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("connected_ms", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("first_observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("game_type IN ('zdwa', 'hausdepp', 'watten')", name="ck_voice_activity_game_type"),
        sa.CheckConstraint("activations >= 0 AND connected_ms >= 0", name="ck_voice_activity_nonnegative"),
    )
    op.create_index("ix_voice_activity_user_day", "voice_activity_buckets", ["user_id", "day"])


def downgrade() -> None:
    table = sa.table("voice_activity_buckets")
    if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
        raise RuntimeError("Cannot downgrade while private voice activity exists")
    op.drop_index("ix_voice_activity_user_day", table_name="voice_activity_buckets")
    op.drop_table("voice_activity_buckets")
