"""Add persistent authentication rate-limit events.

Revision ID: 20260820_0002
Revises: 20260820_0001
Create Date: 2026-08-20
"""

from alembic import op
import sqlalchemy as sa


revision = "20260820_0002"
down_revision = "20260820_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "auth_rate_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("client_key", sa.String(length=64), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_auth_rate_events_kind_client_time",
        "auth_rate_events",
        ["kind", "client_key", "occurred_at"],
    )
    op.create_index(
        "ix_auth_rate_events_kind_time",
        "auth_rate_events",
        ["kind", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_auth_rate_events_kind_time", table_name="auth_rate_events")
    op.drop_index("ix_auth_rate_events_kind_client_time", table_name="auth_rate_events")
    op.drop_table("auth_rate_events")
