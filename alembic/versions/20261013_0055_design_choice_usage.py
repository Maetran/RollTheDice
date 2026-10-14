"""Per-account ZDWA design choice and anonymous daily visible time per look."""

import sqlalchemy as sa

from alembic import op

revision = "20261013_0055"
down_revision = "20261010_0054"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing and new accounts start with the 2026 design; the one-time
    # prompt after the release offers the way back.
    op.add_column(
        "users",
        sa.Column("zdwa_design", sa.String(8), nullable=False, server_default="new"),
    )
    op.add_column(
        "users",
        sa.Column("zdwa_design_prompted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "analytics_design_buckets",
        sa.Column("day", sa.String(10), primary_key=True),
        sa.Column("look", sa.String(24), primary_key=True),
        sa.Column("area", sa.String(8), primary_key=True),
        sa.Column("active_ms", sa.BigInteger(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_table("analytics_design_buckets")
    op.drop_column("users", "zdwa_design_prompted_at")
    op.drop_column("users", "zdwa_design")
