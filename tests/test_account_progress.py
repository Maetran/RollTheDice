"""Historical ownership is distinct from actual-account authority."""
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from app import main
from app.account_progress import (
    ProgressIdentityError,
    is_retired_merge_origin,
    lock_account_rows,
    owned_origin_ids,
    progress_owner_id,
    progress_owner_ids,
    require_exact_active_account,
)
from app.database import configure_database, session_scope, upgrade_database
from app.models import AccountMergeOperation, AccountProgressOrigin, User


@pytest.fixture
def store(tmp_path):
    with patch.dict("os.environ", {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/merge.sqlite"}):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        now = datetime(2026, 10, 25, tzinfo=timezone.utc)
        with session_scope() as db:
            db.add_all(User(id=i, username=f"Origin{i}", username_normalized=f"origin{i}",
                            password_hash="unused", created_at=now, updated_at=now) for i in range(1, 5))
            db.flush()
            db.add(AccountMergeOperation(id="a" * 32, actor_user_id=4, source_user_id=1, target_user_id=2,
                                         idempotency_key="one", preview_fingerprint="b" * 64,
                                         created_at=now, summary_json="{}"))
            db.flush()
            db.get(User, 1).is_active = False
            db.add(AccountProgressOrigin(origin_user_id=1, owner_user_id=2, operation_id="a" * 32))
        yield
    configure_database(main.DATA_DIR)


def test_retired_origin_projects_progress_but_never_authenticates_as_target(store):
    with session_scope() as db:
        assert progress_owner_ids(db, [1, 2, 3]) == {1: 2, 2: 2, 3: 3}
        assert progress_owner_id(db, 1) == 2
        assert owned_origin_ids(db, 2) == (1, 2)
        assert owned_origin_ids(db, 3) == (3,)
        assert is_retired_merge_origin(db, 1)
        with pytest.raises(ProgressIdentityError, match="progress_owner_retired"):
            owned_origin_ids(db, 1)
        with pytest.raises(ProgressIdentityError, match="account_retired_or_inactive"):
            require_exact_active_account(db, 1)
        assert require_exact_active_account(db, 2).id == 2


def test_lock_refreshes_cached_authority_and_remains_caller_transactional(store):
    with session_scope() as db:
        cached = db.get(User, 2)
        assert cached.is_active
        db.execute(User.__table__.update().where(User.id == 2).values(is_active=False))
        cached.username = "Uncommitted stale name"
        with pytest.raises(ProgressIdentityError, match="account_retired_or_inactive"):
            require_exact_active_account(db, 2)
        assert not cached.is_active
        assert cached.username == "Origin2"
        assert list(lock_account_rows(db, [4, 2, 4])) == [2, 4]
        db.rollback()
    with session_scope() as db:
        assert db.get(User, 2).is_active


def test_original_identities_cannot_be_deleted_and_flat_map_is_unique(store):
    with pytest.raises(IntegrityError), session_scope() as db:
        db.execute(delete(User).where(User.id == 1))
    with session_scope() as db:
        assert db.scalar(select(AccountProgressOrigin.owner_user_id).where(AccountProgressOrigin.origin_user_id == 1)) == 2
        assert db.get(User, 1) is not None
