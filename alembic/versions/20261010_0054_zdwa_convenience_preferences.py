"""Enable optional ZDWA gameplay conveniences for existing and new players."""

import sqlalchemy as sa

from alembic import op

revision = "20261010_0054"
down_revision = "20261005_0053"
branch_labels = None
depends_on = None

PREFERENCES = ("skip_forced_strike_confirmation", "auto_hold_announced_numbers", "announce_button_writes")


def upgrade() -> None:
    for name in PREFERENCES:
        op.add_column("users", sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    for name in reversed(PREFERENCES):
        op.drop_column("users", name)
