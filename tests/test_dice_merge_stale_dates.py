"""Deleted native proof cannot lend its stale first date to an inherited award."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app import main
from app.achievements import sync_user_achievements
from app.database import session_scope
from app.models import CompletedGame, DeletedGame, MergedAwardBacking, User, ZilchAchievementEvidence
from app.security import as_utc
from app.zilch_achievements import ZilchAchievementSyncError, _evidence_for_user
from app.zilch_results import finalize_zilch_result
from tests.test_account_progress import store as store
from tests.test_dice_account_merge import (
    EARLY,
    NOW,
    awards,
    engine_support,
    merge,
    zdwa_game,
)
from tests.test_dice_account_merge import (
    _dice_store as _dice_store,
)


def test_zdwa_failed_post_delete_cleanup_cannot_backdate_valid_inherited_award(_dice_store):
    key, later = "career_points_1000", EARLY + timedelta(days=2)
    with session_scope() as db:
        old = zdwa_game(db, "stale-target-zdwa", [(2, 1000)], finished=EARLY)
        sync_user_achievements(db, db.get(User, 2), source_completed_game_id=old.id)
        awards(db, 2)[key].unlocked_at = EARLY
        source = zdwa_game(db, "valid-source-zdwa", [(1, 1000)], finished=later)
        sync_user_achievements(db, db.get(User, 1), source_completed_game_id=source.id)
        awards(db, 1)[key].unlocked_at = later
    with (patch("app.main.require_admin", return_value=SimpleNamespace(user_id=4)),
          patch("app.main.require_csrf"), patch("app.main._remove_deleted_game_from_files"),
          patch("app.main.sync_achievements_for_users", side_effect=RuntimeError("cleanup unavailable"))):
        with pytest.raises(RuntimeError, match="cleanup unavailable"):
            main.admin_delete_completed_game("stale-target-zdwa", main.DeleteCompletedGameReq(
                confirmation_game_id="stale-target-zdwa", reason="Delete obsolete native evidence"), object())
    with session_scope() as db:
        assert db.scalar(select(CompletedGame).where(CompletedGame.game_id == "stale-target-zdwa")) is None
        assert db.scalar(select(DeletedGame).where(DeletedGame.game_id == "stale-target-zdwa")) is not None
        assert as_utc(awards(db, 2)[key].unlocked_at) == EARLY
        result = merge(db)
        assert key in result["inherited_keys"]
        assert as_utc(awards(db, 2)[key].unlocked_at) == later


def test_zilch_cleanup_pending_cannot_backdate_valid_native_inherited_award(_dice_store):
    key, later = "zilch.double_hot_dice_turn", EARLY + timedelta(days=2)
    fixture = engine_support.BankedTurnAchievementTests()
    fixture.sequence = 500
    deleted_game, target, _opponent = fixture.legal_game("double")
    assert finalize_zilch_result(deleted_game)["result_persisted"]
    with session_scope() as db:
        awards(db, target.id, "zilch")[key].unlocked_at = EARLY
    with (patch("app.main.require_admin", return_value=SimpleNamespace(user_id=4)),
          patch("app.main.require_csrf"), patch("app.main.can_access_zilch_preview", return_value=True),
          patch("app.main.remove_zilch_result_from_achievements", side_effect=ZilchAchievementSyncError())):
        removed = main.admin_delete_completed_game(deleted_game["_id"], main.DeleteCompletedGameReq(
            confirmation_game_id=deleted_game["_id"], reason="Delete obsolete native evidence"), object())
    assert removed["achievement_cleanup_pending"]
    valid_game, source, _opponent = fixture.legal_game("double")
    assert finalize_zilch_result(valid_game)["result_persisted"]
    with session_scope() as db:
        assert not _evidence_for_user(db, target.id)
        assert db.scalar(select(ZilchAchievementEvidence).where(
            ZilchAchievementEvidence.source_game_id == deleted_game["_id"],
            ZilchAchievementEvidence.user_id == target.id)) is not None
        assert as_utc(awards(db, target.id, "zilch")[key].unlocked_at) == EARLY
        awards(db, source.id, "zilch")[key].unlocked_at = later
        result = merge(db, source.id, target.id, game_type="zilch", operation_id="s" * 32,
                       stamp=max(NOW, datetime.now(timezone.utc)) + timedelta(seconds=1))
        assert key in result["inherited_keys"]
        assert as_utc(awards(db, target.id, "zilch")[key].unlocked_at) == later
        supports = list(db.scalars(select(MergedAwardBacking).where(
            MergedAwardBacking.owner_user_id == target.id, MergedAwardBacking.achievement_key == key)))
        assert supports and all(as_utc(row.continuity_date) == later for row in supports)
