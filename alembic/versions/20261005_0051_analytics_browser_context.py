"""Add coarse launch mode, browser family and preferred browser language."""
import sqlalchemy as sa

from alembic import op

revision = "20261005_0051"
down_revision = "20261005_0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name, length in (("app_mode", 16), ("browser", 24), ("browser_language", 8)):
        op.add_column("analytics_sessions", sa.Column(name, sa.String(length), nullable=False, server_default="unknown"))


def downgrade() -> None:
    for name in ("browser_language", "browser", "app_mode"):
        op.drop_column("analytics_sessions", name)
