"""Private DRAFT Watten evidence, immutable prices and generation-bound receipts."""

import sqlalchemy as sa

from alembic import op

revision = "20261018_0067"
down_revision = "20261018_0066"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("watten_match_evidence",
                    sa.Column("game_id", sa.String(64), primary_key=True),
                    sa.Column("result_v1_json", sa.Text(), nullable=False),
                    sa.Column("evidence_json", sa.Text(), nullable=False),
                    sa.Column("bindings_json", sa.Text(), nullable=False),
                    sa.Column("frozen_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("watten_progress_states",
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("generation", sa.Integer(), nullable=False),
                    sa.Column("grant_sequence", sa.Integer(), nullable=False),
                    sa.Column("acknowledged_sequence", sa.Integer(), nullable=False),
                    sa.CheckConstraint("generation >= 1", name="ck_watten_progress_generation"),
                    sa.CheckConstraint("grant_sequence >= 0 AND acknowledged_sequence >= 0 AND acknowledged_sequence <= grant_sequence",
                                       name="ck_watten_progress_cursor"))
    op.create_table("watten_match_credits",
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("generation", sa.Integer(), primary_key=True),
                    sa.Column("game_id", sa.String(64), sa.ForeignKey("watten_match_evidence.game_id"), primary_key=True),
                    sa.Column("player_id", sa.String(64), nullable=False),
                    sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("won", sa.Boolean(), nullable=False),
                    sa.Column("cohort_json", sa.Text(), nullable=False),
                    sa.Column("xp", sa.Integer(), nullable=False),
                    sa.Column("policy_version", sa.Integer(), nullable=False),
                    sa.Column("catalog_version", sa.Integer(), nullable=False),
                    sa.Column("grant_sequence", sa.Integer(), nullable=False),
                    sa.CheckConstraint("generation >= 1 AND policy_version >= 1 AND catalog_version >= 1", name="ck_watten_credit_versions"),
                    sa.CheckConstraint("xp >= 0 AND grant_sequence >= 1", name="ck_watten_credit_amount"),
                    sa.UniqueConstraint("user_id", "generation", "grant_sequence", name="uq_watten_credit_sequence"))
    op.create_table("watten_achievement_grants",
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("generation", sa.Integer(), primary_key=True),
                    sa.Column("catalog_version", sa.Integer(), primary_key=True),
                    sa.Column("achievement_id", sa.String(64), primary_key=True),
                    sa.Column("source_game_id", sa.String(64), sa.ForeignKey("watten_match_evidence.game_id"), nullable=False),
                    sa.Column("reached_at", sa.DateTime(timezone=True), nullable=False),
                    sa.Column("xp", sa.Integer(), nullable=False),
                    sa.Column("policy_version", sa.Integer(), nullable=False),
                    sa.Column("grant_sequence", sa.Integer(), nullable=False),
                    sa.CheckConstraint("generation >= 1 AND policy_version >= 1 AND catalog_version >= 1", name="ck_watten_achievement_versions"),
                    sa.CheckConstraint("xp >= 0 AND grant_sequence >= 1", name="ck_watten_achievement_amount"),
                    sa.UniqueConstraint("user_id", "generation", "grant_sequence", name="uq_watten_achievement_sequence"))


def downgrade() -> None:
    for table_name in ("watten_achievement_grants", "watten_match_credits", "watten_progress_states", "watten_match_evidence"):
        table = sa.table(table_name)
        if op.get_bind().execute(sa.select(sa.func.count()).select_from(table)).scalar_one():
            raise RuntimeError("Cannot downgrade while private Watten progression evidence exists")
    for table_name in ("watten_achievement_grants", "watten_match_credits", "watten_progress_states", "watten_match_evidence"):
        op.drop_table(table_name)
