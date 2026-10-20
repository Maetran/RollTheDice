"""Retain anonymous daily browser-reported voice payload totals."""

import sqlalchemy as sa

from alembic import op

revision = "20261020_0075"
down_revision = "20261018_0074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "voice_usage_buckets",
        sa.Column("day", sa.String(10), primary_key=True),
        sa.Column("received_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("sent_bytes", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("reports", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("first_reported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_reported_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("received_bytes >= 0 AND sent_bytes >= 0 AND reports >= 0", name="ck_voice_usage_nonnegative"),
    )


def downgrade() -> None:
    table = sa.table("voice_usage_buckets")
    if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
        raise RuntimeError("Cannot downgrade while voice usage totals exist")
    op.drop_table("voice_usage_buckets")
