"""Store one account-wide Hausdepp favourite without retaining room passwords."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0065"
down_revision = "20261017_0064"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hausdepp_preferences", sa.Column("favourite_preset_json", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("hausdepp_preferences") as batch:
        batch.drop_column("favourite_preset_json")
