"""Add coarse anonymous device categories without inferring historical devices."""
import sqlalchemy as sa

from alembic import op

revision = "20261005_0050"
down_revision = "20261004_0049"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analytics_sessions", sa.Column("os", sa.String(16), nullable=False, server_default="unknown"))
    op.add_column("analytics_sessions", sa.Column("device_family", sa.String(16), nullable=False, server_default="unknown"))


def downgrade() -> None:
    op.drop_column("analytics_sessions", "device_family")
    op.drop_column("analytics_sessions", "os")
