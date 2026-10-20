"""Record explicit Hausdepp forfeitures without completed-game credits."""

import sqlalchemy as sa

from alembic import op

revision = "20261020_0076"
down_revision = "20261020_0075"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hausdepp_withdrawals",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("result_id", sa.String(64), primary_key=True),
        sa.Column("table_game_id", sa.String(64), nullable=False),
        sa.Column("player_id", sa.String(64), nullable=False),
        sa.Column("departed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("schema_version", sa.Integer(), nullable=False),
        sa.CheckConstraint("schema_version = 1", name="ck_hausdepp_withdrawal_schema"),
    )
    op.create_index("ix_hausdepp_withdrawal_user_time", "hausdepp_withdrawals", ["user_id", "departed_at"])
    op.create_index("ix_hausdepp_withdrawal_table", "hausdepp_withdrawals", ["table_game_id"])


def downgrade() -> None:
    table = sa.table("hausdepp_withdrawals")
    if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
        raise RuntimeError("Cannot downgrade while Hausdepp withdrawal evidence exists")
    op.drop_index("ix_hausdepp_withdrawal_table", table_name="hausdepp_withdrawals")
    op.drop_index("ix_hausdepp_withdrawal_user_time", table_name="hausdepp_withdrawals")
    op.drop_table("hausdepp_withdrawals")
