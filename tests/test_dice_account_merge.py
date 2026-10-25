"""Origin-aware proof and canonical dice-award continuity in real DB transactions."""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import delete, select

from app.account_merge_backings import MergeContext
from app.account_progress import owned_origin_ids
from app.achievements import _owner_multiplayer_metrics, _progress_for_user, sync_user_achievements
from app.api_users import _recent_games_for_user, _statistics_for_user, player_ranking
from app.database import session_scope
from app.dice_merge_achievements import (
    consolidate_zdwa_merge_in_session,
    consolidate_zilch_merge_in_session,
    prepare_zdwa_merge_in_session,
    prepare_zilch_merge_in_session,
)
from app.models import (
    AccountMergeOperation,
    AccountProgressOrigin,
    CompletedGame,
    GameParticipant,
    MergedAwardBacking,
    User,
    UserAchievement,
    ZilchAchievementDelivery,
    ZilchAchievementEvidence,
    ZilchAchievementUnlock,
)
from app.security import as_utc
from app.zilch_achievements import (
    ZILCH_ACHIEVEMENT_BY_KEY,
    _criterion_is_satisfied,
    _evidence_for_user,
    _progress_for_definition,
    _sync_user_achievements_in_session,
    pending_zilch_awards,
)
from app.zilch_results import finalize_zilch_result, list_zilch_results_for_user, load_zilch_result_for_user
from app.zilch_statistics import _iter_player_results_in_session, zilch_cpu_completed_experience
from tests import test_zilch_banked_turn_achievements as engine_support
from tests.test_account_progress import store as store
from tests.test_zdwa_conjunction_achievements import qualifying_rows

NOW = datetime(2026, 10, 25, tzinfo=timezone.utc)
EARLY = NOW - timedelta(days=30)


@pytest.fixture
def _dice_store(store):
    with session_scope() as db:
        db.execute(delete(AccountProgressOrigin))
        for user in db.scalars(select(User)):
            user.is_active = True
            for key in User.__mapper__.columns.keys():
                if key.startswith("achievement_") and key.endswith("_started_at"):
                    setattr(user, key, NOW - timedelta(days=365))
    yield


def zdwa_game(db, label, seats, *, rows=None, finished=NOW, mode=None, teams=None):
    import json
    game = CompletedGame(game_id=label, game_type="zdwa", game_name=label, mode=mode or str(len(seats)),
                         hardcore=False, created_at=finished - timedelta(minutes=5), finished_at=finished,
                         imported_from_legacy=False, snapshot_json=json.dumps({"scoreboards": {
                             f"p{index}": {"reihen": rows[index - 1] if rows else []}
                             for index in range(1, len(seats) + 1)}}))
    for index, (user_id, score) in enumerate(seats, 1):
        game.participants.append(GameParticipant(player_key=f"p{index}", position=index, display_name=f"Seat{index}",
                                                  user_id=user_id, points=score, team=teams[index - 1] if teams else None))
    db.add(game)
    db.flush()
    return game


def merge(db, source=1, target=2, *, game_type="zdwa", operation_id="a" * 32, stamp=NOW):
    if db.get(AccountMergeOperation, operation_id) is None:
        db.add(AccountMergeOperation(id=operation_id, actor_user_id=4, source_user_id=source, target_user_id=target,
                                     idempotency_key=operation_id, preview_fingerprint="c" * 64,
                                     created_at=stamp, summary_json="{}"))
        db.flush()
    context = MergeContext(operation_id, source, target, owned_origin_ids(db, source), owned_origin_ids(db, target), stamp)
    prepare = prepare_zdwa_merge_in_session if game_type == "zdwa" else prepare_zilch_merge_in_session
    consolidate = consolidate_zdwa_merge_in_session if game_type == "zdwa" else consolidate_zilch_merge_in_session
    prepared = prepare(db, context)
    for origin in context.source_origin_ids:
        mapping = db.get(AccountProgressOrigin, origin)
        if mapping is None:
            db.add(AccountProgressOrigin(origin_user_id=origin, owner_user_id=target, operation_id=operation_id))
        else:
            mapping.owner_user_id = target
            mapping.operation_id = operation_id
    db.get(User, source).is_active = False
    db.flush()
    return consolidate(db, context, prepared)


def awards(db, owner, game_type="zdwa"):
    model = UserAchievement if game_type == "zdwa" else ZilchAchievementUnlock
    return {row.achievement_key: row for row in db.scalars(select(model).where(model.user_id == owner))}


def test_shared_zdwa_statistics_and_new_aggregate_count_whole_best_seat_once(_dice_store):
    with session_scope() as db:
        for index in range(4):
            zdwa_game(db, f"source-{index}", [(1, 1000)])
            zdwa_game(db, f"target-{index}", [(2, 1000)])
        for index in range(2):
            zdwa_game(db, f"shared-{index}", [(1, 1000), (2, 1100)])
        result = merge(db)
        progress = _progress_for_user(db, db.get(User, 2))
        assert progress["games_played"] == 10
        assert progress["career_points"] == 10200
        assert "career_points_10000" in awards(db, 2)
        assert as_utc(awards(db, 2)["career_points_10000"].unlocked_at) == NOW
        assert awards(db, 2)["career_points_10000"].source_completed_game_id is None
        assert len(result["resolutions"]) == 10
        assert {item["origin_user_id"] for item in result["resolutions"] if item["game_id"].startswith("shared")} == {2}
        assert result["public"]["games_played"] == 10
        assert "origin_ids" not in str(result["public"])
        assert _statistics_for_user(db, 2)["overall"] == {"games_played": 10, "points_total": 10200}
        assert len(_recent_games_for_user(db, 2, 0)) == 10
    ranking = player_ranking(sort="points", mode="normal", limit=50, offset=0)["players"]
    assert [(row["id"], row["games_played"], row["points_total"]) for row in ranking] == [(2, 10, 10200)]


def test_family_cutoffs_precede_global_best_seat_and_single_game_conjunction(_dice_store):
    with session_scope() as db:
        game = zdwa_game(db, "nonselected-qualifier", [(1, 1000), (2, 1100)], rows=[qualifying_rows(), []])
        db.get(User, 2).achievement_gameplay_started_at = NOW + timedelta(days=1)
        db.get(User, 1).is_active = False  # inactive original history remains valid; authentication stays retired
        result = merge(db)
        assert result["resolutions"][0]["origin_user_id"] == 2
        assert _progress_for_user(db, db.get(User, 2))["lower_clean_sheet"]
        assert "lower_clean_sheet" in awards(db, 2)
        assert all(seat.user_id == index for index, seat in enumerate(game.participants, 1))
        # A second game cannot supply the missing half of a conjunction.
        altered = qualifying_rows()
        altered[0]["rows"]["1"] += 1
        zdwa_game(db, "not-equal", [(1, 1000)], rows=[altered])
        assert len(db.scalars(select(GameParticipant).where(GameParticipant.game_id == game.id)).all()) == 2


def test_zdwa_earliest_union_chaining_and_total_loss_then_fresh_reearn(_dice_store):
    with session_scope() as db:
        first = zdwa_game(db, "first", [(1, 1000)])
        second = zdwa_game(db, "second", [(2, 1000)])
        sync_user_achievements(db, db.get(User, 1))
        sync_user_achievements(db, db.get(User, 2))
        awards(db, 1)["career_points_1000"].unlocked_at = EARLY
        awards(db, 2)["career_points_1000"].unlocked_at = EARLY + timedelta(days=2)
        merge(db)
        assert as_utc(awards(db, 2)["career_points_1000"].unlocked_at) == EARLY
        merge(db, 2, 3, operation_id="d" * 32, stamp=NOW + timedelta(days=1))
        db.delete(first)
        db.flush()
        sync_user_achievements(db, db.get(User, 3))
        assert as_utc(awards(db, 3)["career_points_1000"].unlocked_at) == EARLY
        db.delete(second)
        db.flush()
        sync_user_achievements(db, db.get(User, 3))
        assert "career_points_1000" not in awards(db, 3)
        closed = list(db.scalars(select(MergedAwardBacking).where(
            MergedAwardBacking.owner_user_id == 3, MergedAwardBacking.achievement_key == "career_points_1000")))
        assert closed and all(row.invalidated_at is not None for row in closed)
        zdwa_game(db, "fresh", [(3, 1000)], finished=NOW + timedelta(days=2))
        fresh_date = NOW + timedelta(days=2)
        with patch("app.dice_merge_achievements.utcnow", return_value=fresh_date):
            sync_user_achievements(db, db.get(User, 3))
        assert as_utc(awards(db, 3)["career_points_1000"].unlocked_at) == fresh_date
        assert all(row.invalidated_at is not None for row in closed)


@pytest.mark.parametrize("scores,owned,expected", [
    ([1000, 900, 700], {1, 2}, 300), ([1000, 900, 700], {1, 3}, 100),
    ([1000, 900, 700], {1, 2, 3}, 0),
])
def test_new_three_player_margins_keep_original_win_and_compare_external_whole_score(_dice_store, scores, owned, expected):
    with session_scope() as db:
        game = zdwa_game(db, "three", list(zip((1, 2, 3), scores)))
        winner = _owner_multiplayer_metrics(game, game.participants[0], owned)
        loser = _owner_multiplayer_metrics(game, game.participants[1], owned)
        assert winner["multiplayer_margin_3p_runner_up"] == expected
        assert winner["multiplayer_margin_3p_last"] == expected
        assert not any(loser.values())


def test_new_team_win_requires_external_human_but_never_synthesizes_team_board(_dice_store):
    with session_scope() as db:
        game = zdwa_game(db, "teams", [(1, 1100), (2, 1100), (3, 900), (4, 900)],
                         mode="2v2", teams=["A", "A", "B", "B"])
        assert _owner_multiplayer_metrics(game, game.participants[0], {1, 3})["multiplayer_margin_2v2"] == 200
        assert not any(_owner_multiplayer_metrics(game, game.participants[0], {1, 2, 3, 4}).values())
        assert not any(_owner_multiplayer_metrics(game, game.participants[2], {1, 3}).values())


def legal_zilch(recipe="1100", first=None):
    fixture = engine_support.BankedTurnAchievementTests()
    fixture.sequence = 200
    game, one, two = fixture.legal_game(recipe, first=first)
    assert finalize_zilch_result(game)["result_persisted"]
    return game, one, two


def test_real_zilch_merge_registered_evidence_private_history_cpu_and_receipts(_dice_store):
    game, one, two = legal_zilch("double")
    before_queue = pending_zilch_awards(two.id)
    before_detail = load_zilch_result_for_user(game["_id"], two.id)
    with session_scope() as db:
        snapshots = {row.id: row.facts_json for row in db.scalars(select(ZilchAchievementEvidence))}
        target_deliveries = [(row.id, row.acknowledged_at) for row in db.scalars(select(ZilchAchievementDelivery))]
        result = merge(db, one.id, two.id, game_type="zilch", operation_id="e" * 32,
                       stamp=datetime.now(timezone.utc) + timedelta(seconds=1))
        assert "zilch.double_hot_dice_turn" in awards(db, two.id, "zilch")
        assert len(list(_iter_player_results_in_session(db, user_id=two.id))) == 1
        assert result["resolutions"][0]["origin_user_id"] == one.id
        assert {row.id: row.facts_json for row in db.scalars(select(ZilchAchievementEvidence))} == snapshots
        assert [(row.id, row.acknowledged_at) for row in db.scalars(select(ZilchAchievementDelivery))] == target_deliveries
        facts = [fact for _row, fact in _evidence_for_user(db, two.id)]
        count_goal = next(goal for goal in ZILCH_ACHIEVEMENT_BY_KEY.values() if goal.criterion == "games_played")
        assert _progress_for_definition(count_goal, facts)["current"] == 1
        _sync_user_achievements_in_session(db, one.id)  # old-origin maintenance routes to its active beneficiary
        assert "zilch.double_hot_dice_turn" in awards(db, two.id, "zilch")
    assert len(list_zilch_results_for_user(two.id)) == 1
    assert load_zilch_result_for_user(game["_id"], 3) is None
    assert zilch_cpu_completed_experience(two.id) == 1
    after_queue = pending_zilch_awards(two.id)
    # Canonical first-unlock dates may become earlier; queue identity, sources and ACK state do not change.
    assert [{key: value for key, value in row.items() if key != "unlocked_at"} for row in after_queue["awards"]] == [
        {key: value for key, value in row.items() if key != "unlocked_at"} for row in before_queue["awards"]]
    assert after_queue["rank_upgrade"] == before_queue["rank_upgrade"]
    assert before_detail["moments"]["status"] == "ready"
    assert load_zilch_result_for_user(game["_id"], two.id)["moments"] == before_detail["moments"]


def test_zilch_whole_proofs_never_mix_winner_with_losers_clean_bank_list(_dice_store):
    game, one, two = legal_zilch("1100", first="400")
    with session_scope() as db:
        pairs = _evidence_for_user(db, one.id, origin_ids=(one.id, two.id), excluded_opponent_ids=())
        definition = ZILCH_ACHIEVEMENT_BY_KEY["zilch.no_small_change"]
        assert not _criterion_is_satisfied(definition, [facts for _row, facts in pairs])
        merge(db, one.id, two.id, game_type="zilch", operation_id="f" * 32)
        assert definition.key not in awards(db, two.id, "zilch")
        facts = [fact for _row, fact in _evidence_for_user(db, two.id)]
        assert all(fact.get("_self_opponent") for fact in facts)
        assert not _criterion_is_satisfied(ZILCH_ACHIEVEMENT_BY_KEY["zilch.first_hvh_win"], facts)


def test_zdwa_result_moments_keep_original_dates_and_do_not_attach_merge_thresholds(_dice_store):
    from app.achievements import earned_achievement_payloads_for_game
    with session_scope() as db:
        first = zdwa_game(db, "old-donor", [(1, 1000)], finished=EARLY - timedelta(days=2))
        second = zdwa_game(db, "old-target", [(2, 1000)], finished=EARLY - timedelta(days=1))
        sync_user_achievements(db, db.get(User, 1), source_completed_game_id=first.id)
        sync_user_achievements(db, db.get(User, 2), source_completed_game_id=second.id)
        awards(db, 1)["career_points_1000"].unlocked_at = EARLY
        awards(db, 2)["career_points_1000"].unlocked_at = EARLY + timedelta(days=1)
    first_before = earned_achievement_payloads_for_game("old-donor")
    second_before = earned_achievement_payloads_for_game("old-target")
    with session_scope() as db:
        merge(db)
    assert earned_achievement_payloads_for_game("old-donor") == first_before
    assert earned_achievement_payloads_for_game("old-target") == second_before


def test_zilch_unknown_hot_dice_proof_stays_unknown_and_tombstone_revokes_only_unsupported_key(_dice_store):
    import json

    from app.game_history import delete_completed_game
    from app.zilch_achievements import remove_zilch_result_from_achievements
    game, one, two = legal_zilch("double")
    with session_scope() as db:
        evidence = db.scalar(select(ZilchAchievementEvidence).where(
            ZilchAchievementEvidence.user_id == one.id, ZilchAchievementEvidence.source_game_id == game["_id"],
        ))
        facts = json.loads(evidence.facts_json)
        facts["banked_turn_hot_dice_v1"] = None
        evidence.facts_json = json.dumps(facts)
        _sync_user_achievements_in_session(db, one.id)
        merge(db, one.id, two.id, game_type="zilch", operation_id="g" * 32)
        assert "zilch.double_hot_dice_turn" not in awards(db, two.id, "zilch")
        current = [facts for _row, facts in _evidence_for_user(db, two.id)]
        assert next(facts for facts in current if facts["participant_id"] == "p1")["banked_turn_hot_dice_v1"] is None
    delete_completed_game(game_id=game["_id"], admin_user_id=4, reason="Merge tombstone recovery test")
    remove_zilch_result_from_achievements(game["_id"])
    with session_scope() as db:
        assert not awards(db, two.id, "zilch")


def test_complete_merge_hook_rollback_and_repeated_consolidation_are_idempotent(_dice_store):
    with session_scope() as db:
        zdwa_game(db, "source", [(1, 1000)])
    with pytest.raises(RuntimeError, match="rollback"), session_scope() as db:
        merge(db)
        assert awards(db, 2)
        raise RuntimeError("rollback")
    with session_scope() as db:
        assert not owned_origin_ids(db, 2) == (1, 2)
        assert not awards(db, 2)
        assert not list(db.scalars(select(MergedAwardBacking)))
        result = merge(db)
        before = {row.id: (row.context_json, row.original_unlocked_at, row.continuity_date)
                  for row in db.scalars(select(MergedAwardBacking))}
        keys = set(awards(db, 2))
        from app.dice_merge_achievements import _reconcile
        _reconcile(db, 2, "zdwa")
        assert set(awards(db, 2)) == keys
        assert {row.id: (row.context_json, row.original_unlocked_at, row.continuity_date)
                for row in db.scalars(select(MergedAwardBacking))} == before
        assert result["public"]["after_points"] >= result["public"]["before_points"]


def test_assignment_correction_reconciles_active_owner_and_refuses_retired_destination(_dice_store):
    from types import SimpleNamespace

    from fastapi import HTTPException

    from app.api_users import AssignmentRequest, assign_game_participant
    from app.models import AccountMergeGameResolution
    with session_scope() as db:
        db.get(User, 4).role = "admin"
        game = zdwa_game(db, "corrected", [(1, 1000)])
        participant_id = game.participants[0].id
        result = merge(db)
        db.add(AccountMergeGameResolution(owner_user_id=2, operation_id="a" * 32, **result["resolutions"][0]))
        assert "career_points_1000" in awards(db, 2)
    with (patch("app.api_users.require_admin", return_value=SimpleNamespace(user_id=4)),
          patch("app.api_users.require_csrf")):
        with pytest.raises(HTTPException) as refused:
            assign_game_participant(participant_id, AssignmentRequest(user_id=1), object())
        assert refused.value.status_code == 404
        assert assign_game_participant(participant_id, AssignmentRequest(user_id=3), object()) == {"ok": True, "changed": True}
    with session_scope() as db:
        assert "career_points_1000" not in awards(db, 2)
        assert "career_points_1000" in awards(db, 3)
        assert _recent_games_for_user(db, 2, 0) == []
        assert len(_recent_games_for_user(db, 3, 0)) == 1
        assert not list(db.scalars(select(AccountMergeGameResolution)))


def test_frozen_community_recipient_union_never_recounts_or_recreates_recipients(_dice_store):
    from app.models import ZilchCommunityGame, ZilchCommunityMilestone, ZilchCommunityRecipient, ZilchCommunityState
    from app.zilch_achievements import get_zilch_achievement_profile
    definition = next(item for item in ZILCH_ACHIEVEMENT_BY_KEY.values() if item.criterion == "community_games")
    with session_scope() as db:
        db.add(ZilchCommunityGame(game_id="old-trigger", ordinal=definition.target, counted_at=EARLY))
        db.get(ZilchCommunityState, 1).qualified_games = definition.target
        db.flush()
        milestone = ZilchCommunityMilestone(achievement_key=definition.key, threshold=definition.target,
                                             reached_ordinal=definition.target, trigger_game_id="old-trigger", reached_at=EARLY)
        db.add(milestone)
        db.flush()
        recipient = ZilchCommunityRecipient(milestone_id=milestone.id, user_id=1, awarded_at=EARLY)
        db.add(recipient)
        db.flush()
        state_before = db.get(ZilchCommunityState, 1).qualified_games
        result = merge(db, game_type="zilch")
        assert definition.key in awards(db, 2, "zilch")
        assert as_utc(awards(db, 2, "zilch")[definition.key].unlocked_at) == EARLY
        assert db.get(ZilchCommunityState, 1).qualified_games == state_before
        assert list(db.scalars(select(ZilchCommunityRecipient))) == [recipient]
        assert result["public"]["games_played"] == 0
    profile = get_zilch_achievement_profile(2)
    assert definition.key in {award["key"] for award in profile["unlocked"]}


def test_real_later_result_observation_keeps_continuity_when_old_support_disappears(_dice_store):
    with session_scope() as db:
        old = zdwa_game(db, "old", [(1, 1000)])
        sync_user_achievements(db, db.get(User, 1), source_completed_game_id=old.id)
        awards(db, 1)["career_points_1000"].unlocked_at = EARLY
        merge(db)
        later = zdwa_game(db, "later-native", [(2, 1000)], finished=NOW + timedelta(days=1))
        with patch("app.dice_merge_achievements.utcnow", return_value=NOW + timedelta(days=1)):
            sync_user_achievements(db, db.get(User, 2), source_completed_game_id=later.id)
            witness_count = len(list(db.scalars(select(MergedAwardBacking))))
            sync_user_achievements(db, db.get(User, 2), source_completed_game_id=later.id)
            assert len(list(db.scalars(select(MergedAwardBacking)))) == witness_count
        db.delete(old)
        db.flush()
        with patch("app.dice_merge_achievements.utcnow", return_value=NOW + timedelta(days=2)):
            sync_user_achievements(db, db.get(User, 2))
        assert as_utc(awards(db, 2)["career_points_1000"].unlocked_at) == EARLY


@pytest.mark.parametrize("imported", [False, True])
def test_cross_game_union_uses_original_cutoffs_and_deleted_origin_routes_both_currencies(_dice_store, imported):
    from app.achievements import sync_achievements_for_users
    from app.game_history import delete_completed_game
    from app.zilch_achievements import sync_zilch_cross_game_achievements_for_users
    game, one, _two = legal_zilch()
    stamp = datetime.now(timezone.utc) + timedelta(seconds=1)
    with session_scope() as db:
        source = zdwa_game(db, "paired-zdwa", [(1, 1000)], finished=stamp - timedelta(seconds=1))
        source.imported_from_legacy = imported
        operation_id = "h" * 32
        db.add(AccountMergeOperation(id=operation_id, actor_user_id=4, source_user_id=1, target_user_id=one.id,
                                     idempotency_key=operation_id, preview_fingerprint="c" * 64,
                                     created_at=stamp, summary_json="{}"))
        db.flush()
        context = MergeContext(operation_id, 1, one.id, (1,), (one.id,), stamp)
        zdwa_prepared = prepare_zdwa_merge_in_session(db, context)
        zilch_prepared = prepare_zilch_merge_in_session(db, context)
        db.add(AccountProgressOrigin(origin_user_id=1, owner_user_id=one.id, operation_id=operation_id))
        db.get(User, 1).is_active = False
        db.flush()
        consolidate_zdwa_merge_in_session(db, context, zdwa_prepared)
        consolidate_zilch_merge_in_session(db, context, zilch_prepared)
        zilch_key = next(item.key for item in ZILCH_ACHIEVEMENT_BY_KEY.values()
                         if item.criterion == "cross_game_days" and item.target == 1)
        assert ("cross_game_days_1" in awards(db, one.id)) is not imported
        assert (zilch_key in awards(db, one.id, "zilch")) is not imported
        if not imported:
            assert awards(db, one.id)["cross_game_days_1"].source_completed_game_id is None
            assert awards(db, one.id, "zilch")[zilch_key].source_game_id is None
    deleted = delete_completed_game(game_id="paired-zdwa", admin_user_id=4, reason="Owned pairing correction")
    assert deleted["affected_user_ids"] == [1]
    sync_achievements_for_users({1})
    sync_zilch_cross_game_achievements_for_users({1})
    with session_scope() as db:
        assert "cross_game_days_1" not in awards(db, one.id)
        assert zilch_key not in awards(db, one.id, "zilch")
    assert load_zilch_result_for_user(game["_id"], one.id) is not None


def test_merge_does_not_register_or_infer_awards_from_unregistered_private_history(_dice_store):
    fixture = engine_support.BankedTurnAchievementTests()
    fixture.sequence = 400
    game, one, two = fixture.legal_game("double")
    fixture._store(game)  # typed durable history, deliberately never registered for achievements
    with session_scope() as db:
        assert not list(db.scalars(select(ZilchAchievementEvidence)))
        result = merge(db, one.id, two.id, game_type="zilch", operation_id="i" * 32)
        assert not awards(db, two.id, "zilch")
        assert not list(db.scalars(select(ZilchAchievementEvidence)))
        assert result["public"]["games_played"] == 1


def test_assignment_within_same_owner_keeps_continuous_first_date(_dice_store):
    from types import SimpleNamespace

    from app.api_users import AssignmentRequest, assign_game_participant
    with session_scope() as db:
        db.get(User, 4).role = "admin"
        game = zdwa_game(db, "same-owner-correction", [(1, 1000)])
        participant_id = game.participants[0].id
        sync_user_achievements(db, db.get(User, 1))
        awards(db, 1)["career_points_1000"].unlocked_at = EARLY
        merge(db)
        prior_id = awards(db, 2)["career_points_1000"].id
    with (patch("app.api_users.require_admin", return_value=SimpleNamespace(user_id=4)),
          patch("app.api_users.require_csrf")):
        assign_game_participant(participant_id, AssignmentRequest(user_id=2), object())
    with session_scope() as db:
        retained = awards(db, 2)["career_points_1000"]
        assert retained.id == prior_id
        assert as_utc(retained.unlocked_at) == EARLY
        assert _statistics_for_user(db, 2)["overall"] == {"games_played": 1, "points_total": 1000}


def test_new_cross_game_pair_after_merge_keeps_native_delivery_and_truthful_source(_dice_store):
    import json

    from app.zilch_achievements import _known_unlock_rows, _sync_cross_game_achievements_in_session
    game, one, _two = legal_zilch()
    stamp = datetime.now(timezone.utc) + timedelta(seconds=1)
    with session_scope() as db:
        merge(db, 1, one.id, game_type="zilch", operation_id="j" * 32, stamp=stamp)
        key = next(item.key for item in ZILCH_ACHIEVEMENT_BY_KEY.values()
                   if item.criterion == "cross_game_days" and item.target == 1)
        assert key not in awards(db, one.id, "zilch")
        zdwa_game(db, "ordinary-pair-after-merge", [(one.id, 1000)], finished=stamp)
        with patch("app.dice_merge_achievements.utcnow", return_value=stamp + timedelta(seconds=1)):
            unlocked, revoked = _sync_cross_game_achievements_in_session(
                db, db.get(User, one.id), _known_unlock_rows(db, one.id),
            )
            db.flush()
            native = next(item for item in unlocked if item["key"] == key)
            assert native["progress"] == {"current": 1, "target": 1}
            assert "queued_at" in native
            assert native["source_game_id"] == game["_id"]
            unlock = awards(db, one.id, "zilch")[key]
            assert db.scalar(select(ZilchAchievementDelivery).where(
                ZilchAchievementDelivery.unlock_id == unlock.id,
            )) is not None
            proof = db.scalar(select(MergedAwardBacking).where(
                MergedAwardBacking.owner_user_id == one.id, MergedAwardBacking.achievement_key == key,
            ))
            assert proof.kind == "native_observed"
            assert json.loads(proof.context_json)["source_game_id"] == game["_id"]
            assert not revoked
            repeated, _ = _sync_cross_game_achievements_in_session(
                db, db.get(User, one.id), _known_unlock_rows(db, one.id),
            )
            assert not repeated
