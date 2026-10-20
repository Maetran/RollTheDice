"""Persist authoritative Watten rare-table claims and connected-human evidence."""

import sqlalchemy as sa

from alembic import op

revision = "20261020_0077"
down_revision = "20261020_0076"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "watten_table_surprise_claims",
        sa.Column("game_id", sa.String(16), primary_key=True),
        sa.Column("deal_id", sa.String(160), primary_key=True),
        sa.Column("effect", sa.String(16), nullable=False),
        sa.Column("event_id", sa.String(32), nullable=False, unique=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("human_count", sa.Integer(), nullable=False),
        sa.CheckConstraint("effect IN ('star','hammer','ufo','portal','dragon','kraken','clock','blackhole')",
                           name="ck_watten_surprise_effect"),
        sa.CheckConstraint("human_count >= 2 AND human_count <= 4", name="ck_watten_surprise_humans"),
    )
    op.create_table(
        "watten_table_surprise_witnesses",
        sa.Column("game_id", sa.String(16), primary_key=True),
        sa.Column("deal_id", sa.String(160), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("player_id", sa.String(64), nullable=False),
        sa.Column("initiated", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["game_id", "deal_id"],
                                ["watten_table_surprise_claims.game_id", "watten_table_surprise_claims.deal_id"],
                                ondelete="CASCADE", name="fk_watten_surprise_witness_claim"),
    )


def downgrade() -> None:
    if op.get_bind().execute(sa.text("SELECT count(*) FROM watten_table_surprise_claims")).scalar_one():
        raise RuntimeError("Cannot discard recorded Watten rare-table evidence")
    op.drop_table("watten_table_surprise_witnesses")
    op.drop_table("watten_table_surprise_claims")
