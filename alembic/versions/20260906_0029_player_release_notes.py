"""Persist bilingual player release notes and account-wide acknowledgements.

Revision ID: 20260906_0029
Revises: 20260906_0028
Create Date: 2026-09-06
"""

import sqlalchemy as sa

from alembic import op

revision = "20260906_0029"
down_revision = "20260906_0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("push_releases", sa.Column("player_notes_json", sa.Text(), nullable=True))
    op.create_table(
        "release_acknowledgements",
        sa.Column("revision", sa.String(40), sa.ForeignKey("push_releases.revision", ondelete="CASCADE"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("release_acknowledgements")
    op.drop_column("push_releases", "player_notes_json")
