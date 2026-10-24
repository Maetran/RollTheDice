"""Remember the shared account default for listening, never the microphone."""

import sqlalchemy as sa

from alembic import op

revision = "20261025_0079"
down_revision = "20261021_0078"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("voice_listening_default", sa.Boolean(), nullable=False, server_default="0"))


def downgrade() -> None:
    # Native DROP COLUMN keeps the users table, cross-table ownership triggers
    # and referencing event rows intact; a SQLite batch rebuild cannot do so.
    op.drop_column("users", "voice_listening_default")
