"""The real native persistence transaction includes draft credits and grants."""

import json
from copy import deepcopy

import pytest
from sqlalchemy import func, select

from app import watten_completion as completion
from app.database import session_scope
from app.models import ActiveGame, CompletedGame, WattenAchievementGrant, WattenMatchCredit, WattenMatchEvidence
from app.watten_evidence import evidence_from_json
from app.watten_progression_store import read_draft_progress
from app.watten_runtime import persist_watten_game, restore_watten_json
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch

server = native.server


def row_counts(db):
    return tuple(db.scalar(select(func.count()).select_from(model))
                 for model in (CompletedGame, WattenMatchEvidence, WattenMatchCredit, WattenAchievementGrant))


@pytest.mark.parametrize("cpus", ((), (1,)))
def test_native_final_checkpoint_and_draft_journal_commit_once_across_restart(server, cpus):
    owners = [native.account(f"CompletionHuman{index}") for index in range(2 - len(cpus))]
    assert [identity.user_id for identity, _cookie in owners] == list(range(1, len(owners) + 1))
    match = NativeMatch(2, cpus=cpus, target=3)
    match.ready()
    persist_watten_game(match.game, creating=True)
    match.finish()
    persist_watten_game(match.game)
    assert match.game["_completion_persisted"]
    with session_scope() as db:
        counts = row_counts(db)
        assert counts[:3] == (1, 1, 2 - len(cpus))
        proof = db.scalar(select(WattenMatchEvidence))
        evidence = evidence_from_json(proof.evidence_json)
        assert evidence.bids.complete and evidence.profile.determination == "normal"
        assert all(item.initiated == item.countered == item.held == item.went == 0 for item in evidence.bids.players)
        before = read_draft_progress(db, user_id=1)
        raw = db.scalar(select(ActiveGame.state_json))
    restored = restore_watten_json(raw)
    persist_watten_game(restored)
    with session_scope() as db:
        assert row_counts(db) == counts
        assert read_draft_progress(db, user_id=1) == before
        assert json.loads(db.scalar(select(CompletedGame.snapshot_json))) == restored["_watten_result"]


def test_grant_failure_rolls_back_result_and_checkpoint_without_installing_completion(server, monkeypatch):
    owners = [native.account(f"CompletionRollback{index}") for index in range(2)]
    assert [identity.user_id for identity, _cookie in owners] == [1, 2]
    match = NativeMatch(2, target=3)
    match.ready()
    persist_watten_game(match.game, creating=True)
    with session_scope() as db:
        prior = db.scalar(select(ActiveGame.state_json))
    match.finish()
    terminal = deepcopy(match.game)
    real_store = completion.store_draft_match

    def fail_after_grants(*args):
        real_store(*args)
        raise RuntimeError("after grants before checkpoint commit")

    with monkeypatch.context() as fault:
        fault.setattr(completion, "store_draft_match", fail_after_grants)
        with pytest.raises(RuntimeError, match="after grants"):
            persist_watten_game(match.game)
    assert not match.game["_completion_persisted"]
    assert match.game["_watten_result"] is None
    assert match.game["_watten"].bid_counters == terminal["_watten"].bid_counters
    with session_scope() as db:
        assert row_counts(db) == (0, 0, 0, 0)
        assert db.scalar(select(ActiveGame.state_json)) == prior
    persist_watten_game(match.game)
    with session_scope() as db:
        assert row_counts(db)[:3] == (1, 1, 2)
        assert read_draft_progress(db, user_id=1).total_xp > 0
