"""A merged profile reads award witnesses in a batch without discarding proof."""
from unittest.mock import patch

import pytest
from sqlalchemy import event, select

from app.achievements import sync_user_achievements
from app.database import get_engine, session_scope
from app.dice_merge_achievements import _reconcile
from app.game_history import delete_completed_game
from app.models import MergedAwardBacking, User
from app.security import as_utc
from app.zilch_results import finalize_zilch_result
from tests.test_account_progress import store as store
from tests.test_dice_account_merge import EARLY, NOW, awards, engine_support, merge, zdwa_game
from tests.test_dice_account_merge import _dice_store as _dice_store


def witness_values(row):
    return (row.context_json, as_utc(row.original_unlocked_at), as_utc(row.continuity_date),
            row.credited_amount, as_utc(row.invalidated_at) if row.invalidated_at is not None else None)


@pytest.mark.parametrize("game_type", ("zdwa", "zilch"))
def test_native_followup_witnesses_use_bounded_reads_and_keep_independent_continuity(_dice_store, game_type):
    key = "career_points_1000" if game_type == "zdwa" else "zilch.double_hot_dice_turn"
    fixture = engine_support.BankedTurnAchievementTests()
    fixture.sequence = 1100
    if game_type == "zilch":
        old, source, _opponent = fixture.legal_game("double")
        assert finalize_zilch_result(old)["result_persisted"]
        old_id, source_id = old["_id"], source.id
    else:
        old_id, source_id = "batch-original", 1
    with session_scope() as db:
        if game_type == "zdwa":
            old = zdwa_game(db, old_id, [(source_id, 1000)])
            sync_user_achievements(db, db.get(User, source_id), source_completed_game_id=old.id)
        awards(db, source_id, game_type)[key].unlocked_at = EARLY
        merge(db, source_id, 2, game_type=game_type)
        winner, opponent = db.get(User, 2), db.get(User, 3)
    fixture._user = lambda name: winner if name.startswith("BankWinner") else opponent
    for number in range(6):
        if game_type == "zdwa":
            with session_scope() as db:
                current = zdwa_game(db, f"batch-later-{number}", [(2, 1000)])
                sync_user_achievements(db, db.get(User, 2), source_completed_game_id=current.id)
        else:
            current, *_ = fixture.legal_game("double")
            assert finalize_zilch_result(current)["result_persisted"]
    with session_scope() as db:
        witnesses = list(db.scalars(select(MergedAwardBacking).where(
            MergedAwardBacking.owner_user_id == 2, MergedAwardBacking.game_type == game_type)))
        assert sum(row.kind == "native_observed" and row.achievement_key == key for row in witnesses) >= 6
        before = {row.id: witness_values(row) for row in witnesses}
        reads = []

        def count_witness_reads(_connection, _cursor, statement, _parameters, _context, _many):
            sql = statement.upper()
            if sql.lstrip().startswith("SELECT") and "FROM MERGED_AWARD_BACKINGS" in sql:
                reads.append(statement)

        engine = get_engine()
        event.listen(engine, "before_cursor_execute", count_witness_reads)
        try:
            with patch("app.dice_merge_achievements.utcnow", return_value=NOW):
                _reconcile(db, 2, game_type)
        finally:
            event.remove(engine, "before_cursor_execute", count_witness_reads)
        assert 1 <= len(reads) <= 3, "A profile read must not query the full witness journal once per catalog key."
        assert {row.id: witness_values(row) for row in db.scalars(select(MergedAwardBacking).where(
                             MergedAwardBacking.owner_user_id == 2, MergedAwardBacking.game_type == game_type))} == before
    delete_completed_game(game_id=old_id, admin_user_id=4, reason="Remove the original independent witness")
    with session_scope() as db:
        _reconcile(db, 2, game_type)
        assert as_utc(awards(db, 2, game_type)[key].unlocked_at) == EARLY
