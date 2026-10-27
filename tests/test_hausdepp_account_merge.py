"""HD ownership overlays retain whole proofs and independent native delivery."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.account_merge_backings import MergeContext
from app.account_progress import owned_origin_ids
from app.database import session_scope
from app.hausdepp_account import build_hausdepp_account_for_user
from app.hausdepp_achievement_feed import list_hausdepp_achievement_feed
from app.hausdepp_achievements import synchronize_hausdepp_progress
from app.hausdepp_experience import completed_rounds
from app.hausdepp_leaderboard import build_hausdepp_leaderboard
from app.hausdepp_merge import (
    _progress_values,
    consolidate_hausdepp_merge_in_session,
    prepare_hausdepp_merge_in_session,
    selected_rounds,
)
from app.hausdepp_notices import pending_hausdepp_notices
from app.models import (
    AccountMergeOperation,
    AccountProgressOrigin,
    HausdeppAchievementUnlock,
    HausdeppPresentationReceipt,
    HausdeppRoundCredit,
    MergedAwardBacking,
    User,
)
from tests import test_hausdepp_achievements as fixture

AT = datetime(2026, 10, 25, 15, tzinfo=timezone.utc)


@pytest.fixture
def hd():
    case = fixture.HausdeppAchievementTests()
    case.setUp()
    try:
        yield case
    finally:
        case.tearDown()


def merge(db, source, target, *, operation="a" * 32):
    context = MergeContext(operation, source, target, owned_origin_ids(db, source), owned_origin_ids(db, target), AT)
    db.add(AccountMergeOperation(id=operation, actor_user_id=target, source_user_id=source, target_user_id=target,
        idempotency_key=operation, preview_fingerprint="f" * 64, policy_version=1, created_at=AT, summary_json="{}"))
    db.flush()
    prepared = prepare_hausdepp_merge_in_session(db, context)
    immutable = tuple(tuple(db.execute(select(model.__table__)))
                      for model in (HausdeppRoundCredit, HausdeppAchievementUnlock, HausdeppPresentationReceipt))
    for origin in context.source_origin_ids:
        row = db.get(AccountProgressOrigin, origin)
        if row is None:
            db.add(AccountProgressOrigin(origin_user_id=origin, owner_user_id=target, operation_id=operation))
        else:
            row.owner_user_id, row.operation_id = target, operation
    db.get(User, source).is_active = False
    db.flush()
    summary = consolidate_hausdepp_merge_in_session(db, context, prepared)
    assert tuple(tuple(db.execute(select(model.__table__)))
                 for model in (HausdeppRoundCredit, HausdeppAchievementUnlock, HausdeppPresentationReceipt)) == immutable
    return summary


def test_shared_round_best_seat_nonselected_achievement_and_native_pending_all_survive(hd):
    for index in range(3):
        hd.store(hd.payload(f"shared-hd-{index}", cpu=False, loser="other", at=hd.at + timedelta(minutes=index)))
    source, target = hd.user.id, hd.other.id
    before = build_hausdepp_account_for_user(target)
    notices = pending_hausdepp_notices(target)
    with session_scope() as db:
        db.get(User, source).is_active = False  # ordinary inactive donors remain valid historical proof
    with session_scope() as db:
        summary = merge(db, source, target)
        chosen = list(selected_rounds(db, target))
        assert len(chosen) == 3 and all(item.origin_id == source for item in chosen)
        assert summary["resolutions"] == [item.metadata() for item in chosen]
    after = build_hausdepp_account_for_user(target)
    assert after["statistics"]["rounds_played"] == after["statistics"]["finished_rounds"] == 3
    assert after["statistics"]["hausdepp_rounds"] == 0
    assert after["scoring"]["round_points"] == 30  # each human-only shared round once
    goals = {item["id"]: item for item in after["achievements"]["items"]}
    assert goals["hausdepp_56"]["unlocked"] and goals["hausdepp_57"]["unlocked"]
    assert after["presentation"] == before["presentation"]
    assert pending_hausdepp_notices(target) == notices
    assert completed_rounds([target])[target] == 3
    standing = build_hausdepp_leaderboard(target)["entries"]
    assert len(standing) == 1 and standing[0]["wins"] == standing[0]["rounds_played"] == 3
    feed = list_hausdepp_achievement_feed(target)
    assert all(item["player"]["display_name"] == hd.other.username for item in feed["items"])
    keys = [item["achievement"]["id"] for item in feed["items"]]
    assert len(keys) == len(set(keys))


def test_merge_threshold_is_separate_merge_dated_and_later_native_recovery_does_not_duplicate(hd):
    for index in range(2):
        hd.store(hd.payload(f"donor-{index}"))
    hd.store(hd.payload("target-0"), account=hd.other.id)
    source, target = hd.user.id, hd.other.id
    with session_scope() as db:
        summary = merge(db, source, target)
        grant = db.scalar(select(MergedAwardBacking).where(MergedAwardBacking.owner_user_id == target,
            MergedAwardBacking.achievement_key == "hausdepp_03"))
        assert grant is not None and grant.kind == "merge_threshold"
        assert grant.original_unlocked_at.replace(tzinfo=timezone.utc) == AT
        assert db.get(HausdeppAchievementUnlock, (target, "hausdepp_03")) is None
        assert summary["public"]["new_achievement_count"] > 0
    first = build_hausdepp_account_for_user(target)
    for index in range(1, 3):
        hd.store(hd.payload(f"target-{index}", at=AT + timedelta(hours=index)), account=target)
        synchronize_hausdepp_progress(target)
    after = build_hausdepp_account_for_user(target)
    assert after["statistics"]["rounds_played"] == 5 and after["scoring"]["round_points"] == 10
    with session_scope() as db:
        assert db.get(HausdeppAchievementUnlock, (target, "hausdepp_03")) is None
        original = db.scalar(select(MergedAwardBacking).where(MergedAwardBacking.owner_user_id == target,
            MergedAwardBacking.achievement_key == "hausdepp_03"))
        assert original.original_unlocked_at.replace(tzinfo=timezone.utc) == AT
        later = db.scalar(select(MergedAwardBacking).where(MergedAwardBacking.owner_user_id == target,
            MergedAwardBacking.achievement_key == "hausdepp_09"))
        assert later.kind == "native_observed" and later.original_unlocked_at.replace(tzinfo=timezone.utc) == AT + timedelta(hours=2)
    assert first["scoring"]["points"] < after["scoring"]["points"]


def test_one_shared_round_cannot_mix_two_partial_surprise_collections(hd):
    from app.hausdepp_surprise_collection import SURPRISE_EFFECTS
    effects = list(SURPRISE_EFFECTS)
    facts = {"participant_count": 2, "human_count": 2, "cpu_count": 0, "outcome": "finished", "opponents": [],
             "flags": [], "ten_clears": 0, "completed_tournament_id": None}
    rows = [SimpleNamespace(user_id=origin, game_id="same", finished_at=AT,
                facts_json=json.dumps({**facts, "table_surprises": {"activated": effects[offset:offset + 2]}}))
            for origin, offset in ((hd.user.id, 0), (hd.other.id, 2))]
    with session_scope() as db:
        values = _progress_values(db, (hd.user.id, hd.other.id), rows)
    assert values["hausdepp_124"] == (2, 4)


def test_chained_merge_keeps_first_date_score_and_does_not_create_a_normal_notice(hd):
    from app.auth import create_user
    from app.models import CompletedGame

    hd.store(hd.payload("original-donor", at=hd.at))
    hd.store(hd.payload("original-target", at=hd.at + timedelta(days=1)), account=hd.other.id)
    final = create_user("NewestHD", "test-password-123", must_change_password=False)
    with session_scope() as db:
        merge(db, hd.user.id, hd.other.id)
    middle = build_hausdepp_account_for_user(hd.other.id)
    with session_scope() as db:
        merge(db, hd.other.id, final.id, operation="c" * 32)
    after = build_hausdepp_account_for_user(final.id)
    assert after["scoring"] == middle["scoring"]
    first = next(item for item in after["achievements"]["items"] if item["id"] == "hausdepp_01")
    assert first["unlocked_at"] == hd.at.isoformat()
    assert after["presentation"] == {"pending": None, "revision": 0}
    assert pending_hausdepp_notices(final.id) == {"notices": [], "revision": 0, "points": 0}
    with session_scope() as db:
        # HD credits/awards deliberately survive result deletion, as before.
        row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "original-donor"))
        db.delete(row)
    after_delete = build_hausdepp_account_for_user(final.id)
    assert after_delete["statistics"]["rounds_played"] == 1
    assert after_delete["scoring"] == after["scoring"]


def test_trusted_retired_origin_recovery_updates_owner_union_without_target_read_or_ack(hd):
    for index in range(2):
        hd.store(hd.payload(f"recovery-before-{index}"))
    hd.store(hd.payload("recovery-target"), account=hd.other.id)
    with session_scope() as db:
        merge(db, hd.user.id, hd.other.id)
    for index in range(2):
        hd.store(hd.payload(f"retired-recovery-{index}", at=AT + timedelta(hours=index + 1)))
        synchronize_hausdepp_progress(hd.user.id)  # trusted original proof recovery, no login alias
    with session_scope() as db:
        award = db.scalar(select(MergedAwardBacking).where(MergedAwardBacking.owner_user_id == hd.other.id,
            MergedAwardBacking.achievement_key == "hausdepp_09"))
        assert award is not None and award.kind == "native_observed"
        assert award.original_unlocked_at.replace(tzinfo=timezone.utc) == AT + timedelta(hours=2)
        assert db.get(HausdeppAchievementUnlock, (hd.other.id, "hausdepp_09")) is None


def test_one_account_request_reuses_validated_history_and_credits(hd, monkeypatch):
    from collections import Counter

    from app import hausdepp_merge as adapter

    for index in range(2):
        hd.store(hd.payload(f"bounded-donor-{index}"))
    hd.store(hd.payload("bounded-target"), account=hd.other.id)
    with session_scope() as db:
        merge(db, hd.user.id, hd.other.id)
    calls = Counter()
    for name in ("selected_rounds", "_credits"):
        original = getattr(adapter, name)
        def observed(*args, _name=name, _original=original, **kwargs):
            calls[_name] += 1
            return _original(*args, **kwargs)
        monkeypatch.setattr(adapter, name, observed)
    account = build_hausdepp_account_for_user(hd.other.id)
    assert account["statistics"]["rounds_played"] == 3
    assert calls == {"selected_rounds": 1, "_credits": 1}
    calls.clear()
    from app.hausdepp_achievements import public_hausdepp_ranks
    with session_scope() as db:
        title = public_hausdepp_ranks(db, [hd.other.id])[hd.other.id]
    assert title["level"] == account["rank"]["level"]
    assert calls == {"_credits": 1}  # public title never scans full result snapshots


def test_favorite_opponents_merge_origins_without_counting_the_owner_as_opponent(hd):
    for index in range(11):
        hd.store(hd.payload(f"opposed-{index}", cpu=False, loser="other"))
    assert len(build_hausdepp_account_for_user(hd.user.id)["favorite_opponents"]) == 1
    with session_scope() as db:
        merge(db, hd.user.id, hd.other.id)
    assert build_hausdepp_account_for_user(hd.other.id)["favorite_opponents"] == []


def test_favorite_opponent_merges_historical_accounts_into_the_current_name(hd):
    from app.auth import create_user
    from app.game_history import persist_completed_game_result

    target = create_user("MergedOpponent", "test-password-123", must_change_password=False)
    for index in range(11):
        payload = hd.payload(f"opponent-origin-{index}", cpu=False, loser="other")
        opponent = hd.other if index < 6 else target
        payload["participants"][1]["name"] = opponent.username
        assert persist_completed_game_result(
            game_id=payload["game_id"], game_name=payload["name"], game_type="hausdepp", mode="2",
            hardcore=False, finished_at=hd.at, snapshot=payload,
            participants=[{"player_key": "self", "display_name": hd.user.username, "user_id": hd.user.id},
                          {"player_key": "other", "display_name": opponent.username, "user_id": opponent.id}],
        ).succeeded
    assert build_hausdepp_account_for_user(hd.user.id)["favorite_opponents"] == []
    with session_scope() as db:
        merge(db, hd.other.id, target.id)
    assert build_hausdepp_account_for_user(hd.user.id)["favorite_opponents"] == [
        {"name": target.username, "wins": 11, "losses": 0, "draws": 0, "games": 11}]


def test_favorite_opponents_exclude_ambiguous_merged_seats_from_both_sides(hd):
    from app.auth import create_user
    from app.game_history import persist_completed_game_result

    third = create_user("OtherOrigin", "test-password-123", must_change_password=False)
    for index in range(11):
        hd.store(hd.payload(f"clear-duel-{index}", cpu=False, loser="other"))
    # One merged account held both a winning and losing seat. Whichever
    # original seat lost, neither account has a clear direct result.
    for index, loser in enumerate(("other", "cpu-0")):
        payload = hd.payload(f"mixed-seats-{index}", count=3, cpu=False, loser=loser)
        payload["participants"][2].update(name=third.username, is_cpu=False)
        assert persist_completed_game_result(
            game_id=payload["game_id"], game_name=payload["name"], game_type="hausdepp", mode="3",
            hardcore=False, finished_at=hd.at, snapshot=payload,
            participants=[{"player_key": "self", "display_name": hd.user.username, "user_id": hd.user.id},
                          {"player_key": "other", "display_name": hd.other.username, "user_id": hd.other.id},
                          {"player_key": "cpu-0", "display_name": third.username, "user_id": third.id}],
        ).succeeded
    with session_scope() as db:
        merge(db, third.id, hd.other.id)
    assert build_hausdepp_account_for_user(hd.user.id)["favorite_opponents"] == [
        {"name": hd.other.username, "wins": 11, "losses": 0, "draws": 0, "games": 11}]
    assert build_hausdepp_account_for_user(hd.other.id)["favorite_opponents"] == [
        {"name": hd.user.username, "wins": 0, "losses": 11, "draws": 0, "games": 11}]
