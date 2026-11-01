"""Persist per-player rare surprise chances and their accepted offers."""

import sqlalchemy as sa

from alembic import op

revision = "20261101_0083"
down_revision = "20261026_0082"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("rare_surprise_lock", sa.Column("id", sa.Integer(), primary_key=True),
                    sa.CheckConstraint("id = 1", name="ck_rare_surprise_lock_singleton"))
    op.bulk_insert(sa.table("rare_surprise_lock", sa.column("id", sa.Integer())), [{"id": 1}])
    op.create_table("rare_surprise_counters", sa.Column("game_type", sa.String(16), primary_key=True),
                    sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
                    sa.Column("games", sa.Integer(), nullable=False),
                    sa.CheckConstraint("game_type IN ('hausdepp', 'watten')", name="ck_rare_counter_game"),
                    sa.CheckConstraint("games >= 0 AND games <= 100", name="ck_rare_counter_games"))
    op.create_table("rare_surprise_offers", sa.Column("game_type", sa.String(16), primary_key=True),
                    sa.Column("game_key", sa.String(160), primary_key=True),
                    sa.Column("effect", sa.String(16), nullable=True),
                    sa.Column("activated", sa.Boolean(), nullable=False),
                    sa.CheckConstraint("game_type IN ('hausdepp', 'watten')", name="ck_rare_offer_game"),
                    sa.CheckConstraint("effect IS NULL OR effect IN ('star','hammer','ufo','portal','dragon','kraken','clock','blackhole')", name="ck_rare_offer_effect"))
    op.create_table("watten_solo_surprise_claims", sa.Column("game_id", sa.String(16), primary_key=True),
                    sa.Column("effect", sa.String(16), nullable=False),
                    sa.Column("event_id", sa.String(32), nullable=False, unique=True),
                    sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
                    sa.CheckConstraint("effect IN ('star','hammer','ufo','portal','dragon','kraken','clock','blackhole')",
                                       name="ck_watten_solo_surprise_effect"))
    op.add_column("watten_table_surprise_claims", sa.Column("policy_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("active_games", sa.Column("rare_surprise_policy", sa.Integer(), nullable=False, server_default="1"))


def downgrade():
    op.drop_column("active_games", "rare_surprise_policy")
    op.drop_column("watten_table_surprise_claims", "policy_version")
    op.drop_table("watten_solo_surprise_claims")
    op.drop_table("rare_surprise_offers")
    op.drop_table("rare_surprise_counters")
    op.drop_table("rare_surprise_lock")
