"""Provenance, earliest dates, frozen rewards and closed earning cycles."""
from datetime import datetime, timezone

import pytest

from app.account_merge_backings import (
    MergeBackingConflict,
    copy_active_backings,
    invalidate_source_backings,
    is_canonical_mirror,
    reconcile_award_backings,
    record_award_support,
)
from app.database import session_scope
from app.models import AccountMergeOperation
from tests.test_account_progress import store as store

EARLY = datetime(2026, 8, 1, tzinfo=timezone.utc)
LATER = datetime(2026, 9, 10, tzinfo=timezone.utc)
NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)


def capture(db, owner, origin, key, stamp, *, amount=10, support="first", continuity=None):
    return record_award_support(
        db, owner_id=owner, origin_user_id=origin, game_type="watten", achievement_key=key,
        support_key=support, operation_id="a" * 32, unlocked_at=stamp, credited_amount=amount,
        context={"game_type": "watten", "game_id": support, "excluded_origin_ids": [origin]},
        continuity_date=continuity,
    )


def project(db, owner, valid=lambda row: True):
    return reconcile_award_backings(db, owner_id=owner, game_type="watten", achievement_key="goal", now=NOW, validate=valid)


def test_duplicate_earliest_date_and_one_max_frozen_reward(store):
    with session_scope() as db:
        capture(db, 2, 1, "goal", EARLY, amount=8)
        capture(db, 2, 2, "goal", LATER, amount=12, support="second")
        result = project(db, 2)
        assert result.unlocked_at == EARLY
        assert result.credited_amount == 12
        assert len(result.support_ids) == 2
        # Removing the earliest actual source does not move a continuously
        # valid canonical first date later.
        result = project(db, 2, valid=lambda row: row.origin_user_id == 2)
        assert result.unlocked_at == EARLY
        assert result.credited_amount == 12


def test_chained_copy_keeps_continuity_on_every_remaining_support(store):
    with session_scope() as db:
        capture(db, 2, 2, "goal", LATER, continuity=EARLY)
        db.add(AccountMergeOperation(id="c" * 32, actor_user_id=4, source_user_id=2, target_user_id=3,
                                     idempotency_key="second", preview_fingerprint="d" * 64,
                                     created_at=NOW, summary_json="{}"))
        db.flush()
        assert copy_active_backings(db, source_owner_id=2, target_owner_id=3, game_type="watten",
                                    operation_id="c" * 32, continuity_dates={"goal": EARLY}) == 1
        result = project(db, 3)
        assert result.unlocked_at == EARLY
        assert len(result.support_ids) == 1
        # A repeated copy is idempotent, including its sealed opponent context.
        copy_active_backings(db, source_owner_id=2, target_owner_id=3, game_type="watten",
                             operation_id="c" * 32, continuity_dates={"goal": EARLY})
        assert project(db, 3) == result


def test_closed_support_does_not_revive_or_reuse_old_first_date(store):
    with session_scope() as db:
        capture(db, 2, 1, "goal", EARLY)
        assert invalidate_source_backings(db, game_type="watten", now=NOW, matches=lambda row: True) == {2}
        assert project(db, 2) is None
        assert is_canonical_mirror(db, 2, "watten", "goal")
        assert capture(db, 2, 1, "goal", EARLY).invalidated_at is not None
        assert project(db, 2) is None
        capture(db, 2, 2, "goal", NOW, support="fresh-native-cycle")
        assert project(db, 2).unlocked_at == NOW


def test_direct_source_removal_preserves_continuity_before_first_reconcile(store):
    with session_scope() as db:
        capture(db, 2, 1, "goal", EARLY)
        capture(db, 2, 2, "goal", LATER, support="later")
        invalidate_source_backings(db, game_type="watten", now=NOW, matches=lambda row: row.origin_user_id == 1)
        assert project(db, 2).unlocked_at == EARLY


def test_witness_is_immutable_and_all_writes_share_callers_rollback(store):
    with session_scope() as db:
        capture(db, 2, 1, "goal", EARLY)
        with pytest.raises(MergeBackingConflict, match="merge_support_conflict"):
            capture(db, 2, 1, "goal", EARLY, amount=999)
        db.rollback()
    with session_scope() as db:
        assert project(db, 2) is None
