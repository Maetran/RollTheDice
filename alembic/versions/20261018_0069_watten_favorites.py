"""Store one private canonical Watten recipe per account, without secrets."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0069"
down_revision = "20261018_0068"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watten_favorites",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("recipe_json", sa.Text(), nullable=False),
    )


def downgrade() -> None:
    table = sa.table("watten_favorites")
    if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
        raise RuntimeError("Cannot downgrade while Watten favorites exist")
    op.drop_table("watten_favorites")
