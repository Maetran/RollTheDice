"""Store exact weighted Hausdepp presentation snapshots with integer XP."""

import sqlalchemy as sa

from alembic import op

revision = "20261016_0058"
down_revision = "20261016_0057"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Existing integer grant revisions remain untouched. Legacy weighted
    # snapshots are recovered only when the stored receipt proves them.
    op.add_column("hausdepp_presentation_receipts", sa.Column(
        "acknowledged_score_points", sa.Integer(),
        sa.CheckConstraint("acknowledged_score_points IS NULL OR acknowledged_score_points >= 0",
                           name="ck_hausdepp_receipt_score_points"), nullable=True,
    ))
    op.add_column("hausdepp_presentation_receipts", sa.Column("presentation_scores_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("hausdepp_presentation_receipts", "presentation_scores_json")
    op.drop_column("hausdepp_presentation_receipts", "acknowledged_score_points")
