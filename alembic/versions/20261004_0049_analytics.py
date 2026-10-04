"""Bounded anonymous telemetry and explicit founder-managed dashboard access."""
import sqlalchemy as sa

from alembic import op

revision = "20261004_0049"
down_revision = "20260928_0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("analytics_access", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "analytics_sessions",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("device", sa.String(16), nullable=False),
        sa.Column("referrer", sa.String(200), nullable=False),
        sa.Column("country", sa.String(2), nullable=False),
    )
    op.create_index("ix_analytics_sessions_last_seen", "analytics_sessions", ["last_seen_at"])
    op.create_table(
        "analytics_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("dedupe_key", sa.String(64), nullable=False, unique=True),
        sa.Column("session_id", sa.String(64), sa.ForeignKey("analytics_sessions.id", ondelete="CASCADE"), nullable=True),
        sa.Column("received_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("event_type", sa.String(16), nullable=False),
        sa.Column("page", sa.String(32), nullable=False),
        sa.Column("game", sa.String(8), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("active_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("mode", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("source", sa.String(8), nullable=False, server_default="client"),
    )
    op.create_index("ix_analytics_events_received", "analytics_events", ["received_at"])
    op.create_index("ix_analytics_events_game_received", "analytics_events", ["game", "received_at"])
    op.create_index("ix_analytics_events_session_received", "analytics_events", ["session_id", "received_at"])


def downgrade() -> None:
    op.drop_table("analytics_events")
    op.drop_table("analytics_sessions")
    op.drop_column("users", "analytics_access")
