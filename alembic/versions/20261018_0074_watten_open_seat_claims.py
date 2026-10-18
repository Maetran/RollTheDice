"""Add only the native general-invitation room flood barrier."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0074"
down_revision = "20261018_0073"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watten_open_seat_claims",
        sa.Column("game_id", sa.String(64), sa.ForeignKey("active_games.game_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    table = sa.table("watten_open_seat_claims")
    if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
        raise RuntimeError("Cannot downgrade while Watten open-seat claims exist")
    op.drop_table("watten_open_seat_claims")
