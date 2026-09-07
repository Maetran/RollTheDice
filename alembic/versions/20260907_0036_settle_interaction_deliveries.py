"""Settle obsolete modal deliveries for account-interaction awards.

Revision ID: 20260907_0036
Revises: 20260907_0035

The first interaction rollout queued Zilch's result-award presentation for
account clicks. Those rows have no truthful game or community moment and can
block ordinary account controls. Keep the durable unlocks, but settle only
their old, still-pending delivery records.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260907_0036"
down_revision = "20260907_0035"
branch_labels = None
depends_on = None

_ENGAGEMENT_AWARD_KEYS = (
    "zilch.avatar_set",
    "zilch.avatar_changed",
    "zilch.settings_viewed",
    "zilch.settings_saved",
    "zilch.statistics_viewed",
    "zilch.achievements_viewed",
    "zilch.rules_viewed",
    "zilch.history_viewed",
    "zilch.leaderboard_viewed",
    "zilch.github_clicked",
    "zilch.theme_changed",
    "zilch.language_changed",
    "zilch.game_switcher_used",
    "zilch.push_settings_viewed",
    "zilch.chat_settings_saved",
)


def upgrade() -> None:
    deliveries = sa.table(
        "zilch_achievement_deliveries",
        sa.column("unlock_id", sa.Integer),
        sa.column("queued_at", sa.DateTime(timezone=True)),
        sa.column("acknowledged_at", sa.DateTime(timezone=True)),
    )
    unlocks = sa.table(
        "zilch_achievement_unlocks",
        sa.column("id", sa.Integer),
        sa.column("achievement_key", sa.String),
        sa.column("source_evidence_id", sa.Integer),
        sa.column("source_community_recipient_id", sa.Integer),
        sa.column("source_game_id", sa.String),
    )
    interaction_unlock_ids = sa.select(unlocks.c.id).where(
        unlocks.c.achievement_key.in_(_ENGAGEMENT_AWARD_KEYS),
        unlocks.c.source_evidence_id.is_(None),
        unlocks.c.source_community_recipient_id.is_(None),
        unlocks.c.source_game_id.is_(None),
    )
    op.get_bind().execute(
        sa.update(deliveries)
        .where(
            deliveries.c.acknowledged_at.is_(None),
            deliveries.c.unlock_id.in_(interaction_unlock_ids),
        )
        .values(acknowledged_at=deliveries.c.queued_at)
    )


def downgrade() -> None:
    # A settled presentation is safer than reopening a stale, non-result
    # dialog when this data-only repair is rolled back.
    pass
