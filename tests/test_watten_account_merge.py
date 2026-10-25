"""Real Watten journals: generous ownership without fabricated matches or ACKs."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app import watten_public_titles as titles
from app.account_merge_backings import MergeContext
from app.account_progress import owned_origin_ids
from app.database import session_scope
from app.models import AccountMergeOperation, AccountProgressOrigin, MergedAwardBacking, User, WattenAchievementGrant
from app.watten_account import build_watten_account
from app.watten_achievement_feed import build_watten_achievement_feed
from app.watten_leaderboard import build_watten_leaderboard
from app.watten_merge import consolidate_watten_merge_in_session, prepare_watten_merge_in_session, selected_matches
from app.watten_progress_presentations import apply_match_receipts, match_presentation
from app.watten_progression_store import store_draft_match
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_evidence import FINISHED
from tests.test_watten_progression_store import JOURNAL_MODELS, game_for, written

server = runtime_tests.server
AT = datetime(2026, 10, 25, 15, tzinfo=timezone.utc)


def journal_snapshot(db):
    return tuple(tuple(db.execute(select(model.__table__))) for model in JOURNAL_MODELS)


def merge(db, source, target, *, operation="b" * 32):
    context = MergeContext(operation, source, target, owned_origin_ids(db, source), owned_origin_ids(db, target), AT)
    db.add(AccountMergeOperation(id=operation, actor_user_id=target, source_user_id=source, target_user_id=target,
        idempotency_key=operation, preview_fingerprint="f" * 64, policy_version=1, created_at=AT, summary_json="{}"))
    db.flush()
    prepared = prepare_watten_merge_in_session(db, context)
    before = journal_snapshot(db)
    for origin in context.source_origin_ids:
        row = db.get(AccountProgressOrigin, origin)
        if row is None:
            db.add(AccountProgressOrigin(origin_user_id=origin, owner_user_id=target, operation_id=operation))
        else:
            row.owner_user_id, row.operation_id = target, operation
    db.get(User, source).is_active = False
    db.flush()
    summary = consolidate_watten_merge_in_session(db, context, prepared)
    assert journal_snapshot(db) == before
    return summary


def test_shared_best_whole_seat_frozen_max_price_native_pending_and_warm_title_cache(server):
    owners = [runtime_tests.account(f"MergeHuman{index}") for index in range(2)]
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for(owners, game_id="shared"))
        store_draft_match(db, row, evidence, bindings)
        winner = evidence.winners[0][0]
        source = next(item.user_id for item in bindings if item.player_id == winner)
        target = next(item.user_id for item in bindings if item.user_id != source)
        duplicate = db.get(WattenAchievementGrant, (target, 1, "watten_matches_1"))
        duplicate.xp = 73
    before = build_watten_account(target)
    fake_table = {"_watten": SimpleNamespace(room=SimpleNamespace(members=(
        SimpleNamespace(seat=0, account_id=target, participant_id="seat"),)))}
    with session_scope() as db:
        fake_table[titles.CACHE_KEY] = titles._read_titles(db, fake_table)
        cached = fake_table[titles.CACHE_KEY].entries[0]
        summary = merge(db, source, target)
        chosen = selected_matches(db, target)
        assert len(chosen) == 1 and chosen[0].origin_id == source
        assert summary["resolutions"] == [chosen[0].metadata()]
        refreshed = titles._read_titles(db, fake_table).entries[0]
        assert (cached.generation, cached.sequence) == (refreshed.generation, refreshed.sequence)
        assert refreshed.merge_revision != cached.merge_revision
    after = build_watten_account(target)
    assert after["statistics"]["all_matches"] == after["statistics"]["all_wins"] == 1
    assert after["progress"]["match_xp"] == 10
    goal = next(item for item in after["progress"]["achievements"] if item["id"] == "watten_matches_1")
    assert goal["unlocked"] and goal["granted_xp"] == 73
    assert after["progress"]["pending"] == before["progress"]["pending"]
    assert after["progress"]["grant_sequence"] == before["progress"]["grant_sequence"]
    assert refreshed.title.payload() == after["progress"]["title"]
    board = build_watten_leaderboard(target, metric="xp")
    assert board["entries"][0]["value"] == after["progress"]["total_xp"]
    feed = build_watten_achievement_feed(target, limit=30)
    ids = [item["achievement"]["id"] for item in feed["entries"]]
    assert len(ids) == len(set(ids))
    assert all(item["player"]["is_self"] for item in feed["entries"])
    assert all(item["player"]["title"] == after["progress"]["title"] for item in feed["entries"])


def test_inherited_history_keeps_uncredited_sources_uncredited_and_never_replays_donor_receipts(server):
    source_owner = runtime_tests.account("MergeInactiveDonor")
    target_owner = runtime_tests.account("MergeNewTarget")
    source, target = source_owner[0].user_id, target_owner[0].user_id
    with session_scope() as db:
        for game_id, credited in (("inherited-credit", True), ("inherited-no-credit", False)):
            row, evidence, bindings = written(db, game_for([source_owner], game_id=game_id, cpus=(1,)))
            if credited:
                store_draft_match(db, row, evidence, bindings)
        db.get(User, source).is_active = False
    with session_scope() as db:
        merge(db, source, target)
    account = build_watten_account(target)
    assert account["statistics"]["all_matches"] == 2 and account["statistics"]["credited_matches"] == 1
    assert account["statistics"]["uncredited_matches"] == 1 and account["progress"]["match_xp"] == 10
    assert account["progress"]["pending"] == {"credits": [], "achievements": []}
    assert apply_match_receipts(account, user_id=target) == account
    for game_id in ("inherited-credit", "inherited-no-credit"):
        presentation = match_presentation(account, user_id=target, game_id=game_id)
        assert presentation["credit"] is None and presentation["achievements"] == [] and presentation["through_sequence"] == 0
    with pytest.raises(ValueError, match="not_found"):
        match_presentation(account, user_id=target, game_id="foreign")


def test_combined_threshold_is_merge_dated_and_future_real_match_does_not_regrant_inherited_key(server):
    source_owner = runtime_tests.account("MergeFiveDonor")
    target_owner = runtime_tests.account("MergeFiveTarget")
    source, target = source_owner[0].user_id, target_owner[0].user_id
    with session_scope() as db:
        for index in range(5):
            owner = source_owner if index < 3 else target_owner
            row, evidence, bindings = written(db, game_for([owner], game_id=f"distinct-{index}", cpus=(1,)))
            store_draft_match(db, row, evidence, bindings)
        merge(db, source, target)
        combined = db.scalar(select(MergedAwardBacking).where(MergedAwardBacking.owner_user_id == target,
            MergedAwardBacking.achievement_key == "watten_matches_5"))
        assert combined is not None and combined.kind == "merge_threshold"
        assert combined.original_unlocked_at.replace(tzinfo=timezone.utc) == AT
        assert db.get(WattenAchievementGrant, (target, 1, "watten_matches_5")) is None
        for index in range(3):
            game = game_for([target_owner], game_id=f"native-after-{index}", cpus=(1,))
            game["_finished_at"] = (FINISHED + timedelta(days=10 + index)).isoformat()
            row, evidence, bindings = written(db, game)
            store_draft_match(db, row, evidence, bindings)
        assert db.get(WattenAchievementGrant, (target, 1, "watten_matches_5")) is None
    result = build_watten_account(target)
    assert result["statistics"]["credited_matches"] == 8 and result["progress"]["match_xp"] == 80
    goal = next(item for item in result["progress"]["achievements"] if item["id"] == "watten_matches_5")
    assert goal["unlocked"] and goal["earned_at"] == AT.isoformat()


def test_a_win_from_one_seat_cannot_combine_with_the_other_seats_absent_bids(server):
    from dataclasses import replace

    from app.watten_engine import SeatBinding
    from app.watten_merge import _journals, _union_facts
    from tests.test_watten_engine import ready
    from tests.test_watten_progression import TrackedJourney

    owners = [runtime_tests.account(f"WholeSeat{index}") for index in range(2)]
    journey = TrackedJourney(2)
    for _index in range(5):
        journey.go("B", 2)  # accepted native bid + opponent's go, no invented counters
        journey.next()
    # At ten, the real gestrichen rule prevents another opening bid. Finish
    # by actual card commands instead; the other seat never opens/counters.
    while journey.state.phase != "match_complete":
        journey.state = ready(journey.state)
        journey._play_out()
        if journey.state.phase != "match_complete":
            journey.next()
    proof = journey.evidence()
    assert proof.winners == (("B",),)
    assert proof.bids.players[1].initiated == 5 and proof.bids.players[0].initiated == proof.bids.players[0].countered == 0
    engine = replace(journey.state, recipe=replace(journey.state.recipe, bindings=tuple(
        SeatBinding(player, owner[0].user_id) for player, owner in zip("AB", owners))))
    game = {"_id": proof.game_id, "_name": "Whole-seat native bids", "_mode": "2", "_finished_at": FINISHED.isoformat(),
            "_watten": SimpleNamespace(engine=engine, names=tuple((item.player_id, item.name) for item in proof.roster))}
    with session_scope() as db:
        row, _legacy, bindings = written(db, game)
        store_draft_match(db, row, proof, bindings)
        journals = _journals(db, tuple(owner[0].user_id for owner in owners))
        counters, _rare = _union_facts(db, tuple(journals), journals)
        assert counters["wins"] == 1 and counters["bid_matches"] == 1
        assert counters["quiet_wins"] == 0  # winning seat bid; quiet seat lost


def test_merge_failure_rolls_back_operation_ownership_backings_and_keeps_original_journals(server):
    source_owner, target_owner = runtime_tests.account("RollbackDonor"), runtime_tests.account("RollbackTarget")
    source, target = source_owner[0].user_id, target_owner[0].user_id
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([source_owner], cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        before = journal_snapshot(db)
    with pytest.raises(RuntimeError, match="abort atomic merge"), session_scope() as db:
        merge(db, source, target)
        raise RuntimeError("abort atomic merge")
    with session_scope() as db:
        assert journal_snapshot(db) == before
        assert db.get(User, source).is_active
        assert db.get(AccountProgressOrigin, source) is None
        assert not list(db.scalars(select(MergedAwardBacking)))
        assert not list(db.scalars(select(AccountMergeOperation)))
    assert build_watten_account(target)["statistics"]["all_matches"] == 0


def test_chained_merge_keeps_earliest_date_max_price_and_no_donor_pending(server):
    owners = [runtime_tests.account(f"ChainWatten{index}") for index in range(3)]
    source, middle, final = [owner[0].user_id for owner in owners]
    with session_scope() as db:
        for index, owner in enumerate(owners[:2]):
            game = game_for([owner], game_id=f"chain-original-{index}", cpus=(1,))
            game["_finished_at"] = (FINISHED + timedelta(days=index)).isoformat()
            row, evidence, bindings = written(db, game)
            store_draft_match(db, row, evidence, bindings)
        db.get(WattenAchievementGrant, (middle, 1, "watten_matches_1")).xp = 73
        merge(db, source, middle)
    before = build_watten_account(middle)
    with session_scope() as db:
        merge(db, middle, final, operation="c" * 32)
    after = build_watten_account(final)
    assert after["progress"]["total_xp"] == before["progress"]["total_xp"]
    assert after["statistics"]["all_matches"] == 2
    goal = next(item for item in after["progress"]["achievements"] if item["id"] == "watten_matches_1")
    assert goal["unlocked"] and goal["granted_xp"] == 73 and goal["earned_at"] == FINISHED.isoformat()
    assert after["progress"]["grant_sequence"] == 0 and after["progress"]["acknowledged_sequence"] == 0
    assert after["progress"]["pending"] == {"credits": [], "achievements": []}
    assert build_watten_leaderboard(final)["entries"][0]["value"] == after["progress"]["total_xp"]
