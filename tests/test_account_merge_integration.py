"""All four real game adapters run through the same atomic owner operation."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app import account_merge as coordinator
from app.database import session_scope
from app.hausdepp_account import build_hausdepp_account_for_user
from app.hausdepp_achievements import synchronize_hausdepp_progress
from app.models import AccountMergeGameResolution, AccountProgressOrigin, CompletedGame, GameParticipant, User
from app.watten_account import build_watten_account
from app.watten_progression_store import store_draft_match
from app.zilch_results import finalize_zilch_result
from tests import test_hausdepp_achievements as hd_fixture
from tests import test_zilch_banked_turn_achievements as zilch_fixture
from tests.test_account_merge_transaction import actor as actor
from tests.test_account_progress import store as store
from tests.test_dice_account_merge import zdwa_game
from tests.test_user_accounts import request_for
from tests.test_watten_progression_store import game_for, written

REAL_HOOKS = coordinator._game_hooks
NOW = datetime(2026, 10, 25, 16, tzinfo=timezone.utc)


def seed_history():
    with session_scope() as db:
        source, target = db.get(User, 3), db.get(User, 2)
        zdwa_game(db, "integrated-zdwa", [(3, 1100), (2, 1000)])
    # Reuse real accepted result producers/engine fixtures, without resetting
    # the caller's database or manufacturing mixed-seat award evidence.
    hd = hd_fixture.HausdeppAchievementTests()
    hd.user, hd.other, hd.at = source, target, NOW - timedelta(days=1)
    hd.store(hd.payload("integrated-hd", cpu=False))
    synchronize_hausdepp_progress(source.id)
    synchronize_hausdepp_progress(target.id)
    engine = zilch_fixture.BankedTurnAchievementTests()
    engine.sequence = 0
    users = iter((source, target))
    engine._user = lambda _name: next(users)
    zilch, *_ = engine.legal_game()
    assert finalize_zilch_result(zilch)["result_persisted"]
    owners = [(SimpleNamespace(user_id=user.id, username=user.username), None) for user in (source, target)]
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for(owners, game_id="integrated-watten"))
        store_draft_match(db, row, evidence, bindings)


def original_results():
    with session_scope() as db:
        return tuple(tuple(db.execute(select(model.__table__).order_by(model.id)))
                     for model in (CompletedGame, GameParticipant))


def test_real_four_game_preview_apply_replay_preserves_results_and_native_receipts(actor):
    seed_history()
    originals = original_results()
    hd_pending = build_hausdepp_account_for_user(2)["presentation"]
    watten_pending = build_watten_account(2)["progress"]["pending"]
    with patch.object(coordinator, "_game_hooks", new=REAL_HOOKS):
        with session_scope() as db:
            preview = coordinator.preview_merge_in_session(db, actor_id=4, source_id=3, target_id=2)
        assert set(preview["games"]) == {"zdwa", "zilch", "hausdepp", "watten"}
        assert original_results() == originals
        with session_scope() as db:
            assert db.get(User, 3).is_active
            assert db.get(AccountProgressOrigin, 3) is None
            result = coordinator.apply_merge_in_session(
                db, identity=actor[0], request=request_for(), source_id=3, target_id=2,
                fingerprint=preview["fingerprint"], idempotency_key="all-four-games",
                current_password="ValidOwnerPassword9")
        assert result["games"] == preview["games"]
        assert all(game["games_played"] == 1 for game in result["games"].values())
        assert original_results() == originals
        with session_scope() as db:
            resolutions = list(db.scalars(select(AccountMergeGameResolution)))
            assert {row.game_type for row in resolutions} == {"zdwa", "zilch", "hausdepp", "watten"}
            assert len(resolutions) == 4
            assert not db.get(User, 3).is_active
            replay = coordinator.apply_merge_in_session(
                db, identity=actor[0], request=request_for(), source_id=3, target_id=2,
                fingerprint=preview["fingerprint"], idempotency_key="all-four-games",
                current_password="no second confirmation needed for exact committed retry")
            assert replay["replayed"] and replay["operation_id"] == result["operation_id"]
    assert build_hausdepp_account_for_user(2)["presentation"] == hd_pending
    assert build_watten_account(2)["progress"]["pending"] == watten_pending


def test_late_fourth_adapter_failure_rolls_back_every_prior_adapter_and_identity(actor):
    seed_history()
    originals = original_results()
    hooks = list(REAL_HOOKS())
    game, prepare, real_consolidate = hooks[-1]

    def fail_after_watten(db, context, prepared):
        real_consolidate(db, context, prepared)
        raise RuntimeError("failure after the final real game adapter")

    hooks[-1] = game, prepare, fail_after_watten
    with patch.object(coordinator, "_game_hooks", return_value=tuple(hooks)):
        with pytest.raises(RuntimeError, match="final real game adapter"), session_scope() as db:
            coordinator.preview_merge_in_session(db, actor_id=4, source_id=3, target_id=2)
    assert original_results() == originals
    with session_scope() as db:
        assert db.get(User, 3).is_active
        assert db.get(AccountProgressOrigin, 3) is None
