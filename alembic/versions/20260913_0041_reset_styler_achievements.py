"""Reset both Styler awards and their progress without changing game scores.

Revision ID: 20260913_0041
Revises: 20260912_0040
"""

import json
import logging
from datetime import datetime, timezone

import sqlalchemy as sa

from alembic import op

revision = "20260913_0041"
down_revision = "20260912_0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("users")}
    column_added = "achievement_styler_started_at" not in columns
    if column_added:
        op.add_column("users", sa.Column("achievement_styler_started_at", sa.DateTime(timezone=True), nullable=True))
    pending_users = bind.execute(sa.text(
        "SELECT COUNT(*) FROM users WHERE achievement_styler_started_at IS NULL"
    )).scalar_one()
    if not column_added and not pending_users:
        return
    # This boundary belongs only to Styler. Do not touch the broader extra
    # achievement marker, other award rows or result scores.
    removed = bind.execute(sa.text(
        "DELETE FROM user_achievements WHERE achievement_key IN ('styler_full_once', 'styler_full_10') "
        "AND user_id IN (SELECT id FROM users WHERE achievement_styler_started_at IS NULL)"
    )).rowcount
    bind.execute(
        sa.text("UPDATE users SET achievement_styler_started_at = :started_at "
                "WHERE achievement_styler_started_at IS NULL"),
        {"started_at": datetime.now(timezone.utc)},
    )
    # An unfinished game will receive new completion timestamps later. Remove
    # only its pre-reset proof, so finishing it cannot revive an old Styler.
    # New genuine Full writes in that same game may build fresh evidence.
    for game_id, raw in bind.execute(sa.text(
        "SELECT id, state_json FROM active_games"
    )).all():
        try:
            state = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if (
            not isinstance(state, dict)
            or state.get("_game_type", "zdwa") != "zdwa"
            or "_styler_full_evidence" not in state
        ):
            continue
        state.pop("_styler_full_evidence")
        bind.execute(
            sa.text("UPDATE active_games SET state_json = :state WHERE id = :game_id"),
            {"state": json.dumps(state, ensure_ascii=False), "game_id": game_id},
        )
    logging.getLogger("alembic.runtime.migration").info(
        "Styler reset removed %s awards; progress reset for %s accounts", removed, pending_users,
    )


def downgrade() -> None:
    # Schema-only downgrade: never fabricate removed awards or evidence.
    # Restoring those data requires the deployment's database backup.
    op.drop_column("users", "achievement_styler_started_at")
