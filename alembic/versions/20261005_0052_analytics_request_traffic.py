"""Add bounded sitewide daily HTTP counters without request identifiers."""
import sqlalchemy as sa

from alembic import op

revision = "20261005_0052"
down_revision = "20261005_0051"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analytics_request_buckets",
        sa.Column("day", sa.String(10), primary_key=True),
        sa.Column("country", sa.String(2), primary_key=True),
        sa.Column("status_class", sa.String(8), primary_key=True),
        sa.Column("agent_family", sa.String(24), primary_key=True),
        sa.Column("channel", sa.String(8), primary_key=True),
        sa.Column("requests", sa.BigInteger(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("analytics_request_buckets")
