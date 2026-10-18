"""Add owned DRAFT match presentation boundaries without touching the journal."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0068"
down_revision = "20261018_0067"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watten_match_presentation_acks",
        sa.Column("user_id", sa.Integer(), primary_key=True),
        sa.Column("generation", sa.Integer(), primary_key=True),
        sa.Column("game_id", sa.String(64), primary_key=True),
        sa.Column("through_sequence", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(("user_id", "generation", "game_id"),
                                ("watten_match_credits.user_id", "watten_match_credits.generation", "watten_match_credits.game_id"),
                                name="fk_watten_match_presentation_credit", ondelete="CASCADE"),
        sa.CheckConstraint("generation >= 1 AND through_sequence >= 1", name="ck_watten_match_presentation_boundary"),
    )


def downgrade() -> None:
    table = sa.table("watten_match_presentation_acks")
    if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
        raise RuntimeError("Cannot downgrade while Watten match presentation receipts exist")
    op.drop_table("watten_match_presentation_acks")
