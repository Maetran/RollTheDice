"""Reset abandonment counts while preserving results and unfinished games.

Revision ID: 20260928_0048
Revises: 20260922_0047
"""

import json
import logging

import sqlalchemy as sa

from alembic import op

revision = "20260928_0048"
down_revision = "20260922_0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # Explicit child deletion also makes the reset safe for installations
    # whose historical SQLite connections did not enable foreign keys.
    bind.execute(sa.text("DELETE FROM abandoned_game_participants"))
    removed_games = bind.execute(sa.text("DELETE FROM abandoned_games")).rowcount
    removed_awards = bind.execute(sa.text(
        "DELETE FROM user_achievements WHERE achievement_key IN ("
        "'manual_solo_aborts_1', 'manual_solo_aborts_5', 'manual_solo_aborts_10', "
        "'manual_multiplayer_aborts_1', 'manual_multiplayer_aborts_5', 'manual_multiplayer_aborts_10')"
    )).rowcount

    # Recovery must not recreate a pre-reset abandonment after the restart.
    # Keep the full snapshot: a terminal Solo run may still need to finalize
    # its private result. Running games and ordinary completed games are not
    # affected and can continue through their usual persistence paths.
    accounted_snapshots = 0
    for row_id, raw in bind.execute(sa.text("SELECT id, state_json FROM active_games")).all():
        try:
            state = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if not isinstance(state, dict) or state.get("_game_type", "zdwa") not in ("zdwa", "zilch"):
            continue
        outcome = state.get("_zilch_outcome")
        manual_solo_abort = (
            state.get("_game_type") == "zilch"
            and state.get("_manual_solo_abandonment") is True
            and state.get("_finished") is True
            and isinstance(outcome, dict)
            and outcome.get("status") == "abandoned"
        )
        if not (state.get("_aborted") is True or manual_solo_abort):
            continue
        if state.get("_abandonment_accounted") is True:
            continue
        state["_abandonment_accounted"] = True
        bind.execute(
            sa.text("UPDATE active_games SET state_json = :state WHERE id = :row_id"),
            {"state": json.dumps(state, ensure_ascii=False), "row_id": row_id},
        )
        accounted_snapshots += 1
    logging.getLogger("alembic.runtime.migration").info(
        "Abandonment reset removed %s records and %s Fairplay reminders; settled %s terminal snapshots",
        removed_games, removed_awards, accounted_snapshots,
    )


def downgrade() -> None:
    # This one-time data correction has no schema change. Restoring old counts
    # or replaying terminal snapshots would require the deployment backup.
    pass
