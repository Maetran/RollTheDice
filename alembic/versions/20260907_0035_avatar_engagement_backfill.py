"""Repair the objectively provable first profile-picture award once.

Revision ID: 20260907_0035
Revises: 20260907_0034

The prior interaction rollout intentionally did not scan history.  A current
``user_avatars`` row is different: it is a durable account state with its own
timestamp, so it proves that its owner had set a first picture.  Only that
single award is repaired here.  A historic replacement cannot be recovered
truthfully and therefore remains forward-only.
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "20260907_0035"
down_revision = "20260907_0034"
branch_labels = None
depends_on = None

_ZDWA_AVATAR_SET = "avatar_set"
_ZILCH_AVATAR_SET = "zilch.avatar_set"


def upgrade() -> None:
    bind = op.get_bind()
    # Every statement is independently idempotent. This keeps a resumed
    # deployment and a partially applied local migration from duplicating an
    # event or award. Account-interaction awards deliberately do not enter
    # Zilch's result-presentation queue.
    bind.execute(
        sa.text(
            """
            INSERT INTO user_engagement_events
                   (user_id, event_key, first_seen_at, last_seen_at, count)
            SELECT avatar.user_id, :event_key, avatar.updated_at, avatar.updated_at, 1
              FROM user_avatars AS avatar
              JOIN users AS user ON user.id = avatar.user_id
             WHERE user.is_active = 1
               AND NOT EXISTS (
                    SELECT 1
                      FROM user_engagement_events AS existing
                     WHERE existing.user_id = avatar.user_id
                       AND existing.event_key = :event_key
               )
            """
        ),
        {"event_key": _ZDWA_AVATAR_SET},
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO user_achievements
                   (user_id, achievement_key, source_completed_game_id, unlocked_at)
            SELECT avatar.user_id, :achievement_key, NULL, avatar.updated_at
              FROM user_avatars AS avatar
              JOIN users AS user ON user.id = avatar.user_id
             WHERE user.is_active = 1
               AND NOT EXISTS (
                    SELECT 1
                      FROM user_achievements AS existing
                     WHERE existing.user_id = avatar.user_id
                       AND existing.achievement_key = :achievement_key
               )
            """
        ),
        {"achievement_key": _ZDWA_AVATAR_SET},
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO zilch_achievement_unlocks
                   (user_id, achievement_key, definition_version,
                    source_evidence_id, source_community_recipient_id,
                    source_game_id, presentation_game_id, unlocked_at)
            SELECT avatar.user_id, :achievement_key, 1,
                   NULL, NULL, NULL, NULL, avatar.updated_at
              FROM user_avatars AS avatar
              JOIN users AS user ON user.id = avatar.user_id
             WHERE user.is_active = 1
               AND NOT EXISTS (
                    SELECT 1
                      FROM zilch_achievement_unlocks AS existing
                     WHERE existing.user_id = avatar.user_id
                       AND existing.achievement_key = :achievement_key
               )
            """
        ),
        {"achievement_key": _ZILCH_AVATAR_SET},
    )
def downgrade() -> None:
    # This is a data repair, not a schema feature. Keep already granted player
    # awards intact when only this revision is rolled back; a further rollback
    # to 0033 removes the interaction tables in that revision's normal path.
    pass
