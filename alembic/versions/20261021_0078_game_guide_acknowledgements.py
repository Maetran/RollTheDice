"""Remember explicit acknowledgement of the new card-game guides.

Existing tour choices remain intact. Revision zero shows the updated guide even
to someone who completed the older Hausdepp tour without its gesture hints.
"""

import sqlalchemy as sa

from alembic import op

revision = "20261021_0078"
down_revision = "20261020_0077"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for game in ("hausdepp", "watten"):
        op.add_column("game_tour_preferences", sa.Column(f"{game}_guide_revision", sa.Integer(),
            nullable=False, server_default="0"))


def downgrade() -> None:
    if op.get_bind().exec_driver_sql(
        "SELECT 1 FROM game_tour_preferences WHERE hausdepp_guide_revision <> 0 OR watten_guide_revision <> 0 LIMIT 1"
    ).first():
        raise RuntimeError("Cannot discard acknowledged game guides")
    with op.batch_alter_table("game_tour_preferences") as batch:
        batch.drop_column("watten_guide_revision")
        batch.drop_column("hausdepp_guide_revision")
