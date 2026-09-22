"""Index newest-achievement feeds by stable timeline order."""

from alembic import op

revision = "20260922_0044"
down_revision = "20260920_0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_user_achievements_feed_order",
        "user_achievements",
        ["unlocked_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_user_achievements_key_feed_order",
        "user_achievements",
        ["achievement_key", "unlocked_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_zilch_achievement_unlocks_feed_order",
        "zilch_achievement_unlocks",
        ["unlocked_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_zilch_achievement_unlocks_key_feed_order",
        "zilch_achievement_unlocks",
        ["achievement_key", "unlocked_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_zilch_achievement_unlocks_key_feed_order", table_name="zilch_achievement_unlocks")
    op.drop_index("ix_zilch_achievement_unlocks_feed_order", table_name="zilch_achievement_unlocks")
    op.drop_index("ix_user_achievements_key_feed_order", table_name="user_achievements")
    op.drop_index("ix_user_achievements_feed_order", table_name="user_achievements")
