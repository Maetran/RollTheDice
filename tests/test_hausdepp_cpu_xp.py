"""CPU rounds earn two whole EP; badges and durable deliveries keep full value."""

from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from alembic.config import Config
from sqlalchemy import select, text

from alembic import command
from app import main
from app.auth import create_user
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.hausdepp_achievements import acknowledge_hausdepp_presentation, synchronize_hausdepp_progress
from app.models import HausdeppAchievementUnlock, HausdeppPresentationReceipt, HausdeppRoundCredit


@pytest.fixture
def account(tmp_path):
    url = f"sqlite:///{tmp_path}/cpu-xp.sqlite3"
    with patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": url}):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        user = create_user("CpuXpOwner", "test-password-123", must_change_password=False)
        other = create_user("CpuXpFriend", "test-password-123", must_change_password=False)
        yield SimpleNamespace(user=user, other=other, url=url)
    configure_database(main.DATA_DIR)


def store_round(account, number, *, cpus=1, humans=1, flag=None):
    players = [{"id": "self", "name": account.user.username, "is_cpu": False}]
    if humans == 2:
        players.append({"id": "friend", "name": account.other.username, "is_cpu": False})
    players.extend({"id": f"cpu-{index}", "name": f"Kartensepp{index}", "is_cpu": True} for index in range(cpus))
    loser = players[-1]["id"]
    # Weekday evening in Zurich: no play-time achievement changes these XP sums.
    at = datetime(2026, 10, 16, 18, 30, tzinfo=timezone.utc) + timedelta(minutes=number)
    payload = {
        "schema_version": 2 if flag else 1, "payload_kind": "hausdepp_result", "game_type": "hausdepp",
        "game_id": f"cpu-rule-{number}", "name": "Getrennter EP-Test", "finished_at": at.isoformat(),
        "participants": players, "loser_id": loser,
        "finished_order": [player["id"] for player in players if player["id"] != loser],
    }
    if flag:
        payload["achievement_evidence"] = {"schema_version": 1, "complete": True, "players": {
            player["id"]: {"flags": [flag] if player["id"] == "self" else [], "ten_clears": 0}
            for player in players}}
    assert persist_completed_game_result(
        game_id=payload["game_id"], game_name=payload["name"], game_type="hausdepp", mode=str(len(players)),
        hardcore=False, finished_at=at, snapshot=payload,
        participants=[{"player_key": player["id"], "display_name": player["name"],
                       "user_id": account.user.id if player["id"] == "self"
                       else account.other.id if player["id"] == "friend" else None} for player in players],
    ).succeeded


@pytest.mark.parametrize("cpus,humans,base", [(0, 2, 10), (1, 1, 2), (1, 2, 2), (2, 1, 2), (3, 1, 2), (4, 1, 2), (5, 1, 2)])
def test_any_cpu_seat_reduces_only_round_reward_and_badges_stay_full(account, cpus, humans, base):
    store_round(account, 1, cpus=cpus, humans=humans, flag="hausdepp_17")
    progress = synchronize_hausdepp_progress(account.user.id)
    assert progress["scoring"] == {
        "available": True, "points": base + 35, "round_points": base, "achievement_points": 35,
        "round_reward": 10, "cpu_round_reward": 2, "cpu_reduction_percent": 75,
    }
    assert all(type(value) is int for key, value in progress["scoring"].items() if key != "available")
    assert progress["presentation"]["revision"] == 45
    assert progress["presentation"]["pending"]["through_points"] == base + 35
    badges = {item["id"]: item for item in progress["achievements"]["items"] if item["unlocked"]}
    assert {key: item["points"] for key, item in badges.items()} == {"hausdepp_01": 10, "hausdepp_17": 25}
    assert synchronize_hausdepp_progress(account.user.id) == progress


def test_round_down_happens_per_cpu_round_and_never_after_aggregation(account):
    for number in range(1, 8):
        store_round(account, number)
        progress = synchronize_hausdepp_progress(account.user.id)
        assert progress["scoring"]["round_points"] == number * 2
        assert type(progress["scoring"]["points"]) is int
        assert type(progress["presentation"]["pending"]["points_earned"]) is int
        if number == 3:
            assert progress["scoring"]["round_points"] == 6
    with session_scope() as db:
        assert len(db.scalars(select(HausdeppRoundCredit)).all()) == 7
    assert progress["scoring"]["achievement_points"] == sum(
        item["points"] for item in progress["achievements"]["items"] if item["unlocked"])


def test_concurrent_stale_receipts_use_exact_weighted_score_and_rank(account):
    store_round(account, 1)
    first = synchronize_hausdepp_progress(account.user.id)
    assert (first["presentation"]["revision"], first["scoring"]["points"]) == (20, 12)
    store_round(account, 2, cpus=0, humans=2)
    second = synchronize_hausdepp_progress(account.user.id)
    assert (second["presentation"]["revision"], second["scoring"]["points"]) == (30, 22)
    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(lambda revision: acknowledge_hausdepp_presentation(account.user.id, revision), [20, 30] * 4))
    with session_scope() as db:
        receipt = db.get(HausdeppPresentationReceipt, account.user.id)
        assert (receipt.acknowledged_points, receipt.acknowledged_score_points) == (30, 22)
    store_round(account, 3)
    third = synchronize_hausdepp_progress(account.user.id)
    assert third["scoring"]["round_points"] == 14
    pending = third["presentation"]["pending"]
    assert (pending["revision"], pending["through_points"], pending["points_earned"]) == (60, 44, 22)
    assert pending["from_rank"]["name"]["de"] == "Einstein"
    assert pending["to_rank"]["name"]["de"] == "Bohr"
    assert pending["rank_up"] is True
    assert set(pending["achievement_ids"]) == {"hausdepp_03", "hausdepp_57"}
    acknowledge_hausdepp_presentation(account.user.id, 20)
    assert synchronize_hausdepp_progress(account.user.id)["presentation"]["pending"] == pending


def legacy_receipt(account, acknowledged):
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", account.url)
    command.downgrade(config, "20261016_0057")
    with get_engine().begin() as connection:
        connection.execute(text("UPDATE hausdepp_presentation_receipts SET acknowledged_points=:revision WHERE user_id=:user"),
                           {"revision": acknowledged, "user": account.user.id})
    upgrade_database(main.BASE)
    with session_scope() as db:
        receipt = db.get(HausdeppPresentationReceipt, account.user.id)
        assert receipt.acknowledged_points == acknowledged
        assert receipt.acknowledged_score_points is None
        assert receipt.presentation_scores_json is None


def test_real_legacy_migration_reweights_credits_and_recovers_seen_score_before_new_round(account):
    store_round(account, 1)
    store_round(account, 2)
    old = synchronize_hausdepp_progress(account.user.id)
    legacy_receipt(account, old["presentation"]["revision"])
    # The result arrives before the first read after upgrading. Its new XP
    # must not get absorbed into the recovered legacy acknowledgement.
    store_round(account, 3)
    progress = synchronize_hausdepp_progress(account.user.id)
    assert progress["scoring"]["round_points"] == 6
    assert progress["scoring"]["achievement_points"] == 30
    pending = progress["presentation"]["pending"]
    assert pending["points_earned"] == 22
    assert pending["from_rank"]["name"]["de"] == "Einstein"
    assert pending["rank_up"] is True
    assert set(pending["achievement_ids"]) == {"hausdepp_03", "hausdepp_57"}
    with session_scope() as db:
        assert len(db.scalars(select(HausdeppRoundCredit)).all()) == 3
        assert len(db.scalars(select(HausdeppAchievementUnlock)).all()) == 3
    assert synchronize_hausdepp_progress(account.user.id) == progress


def test_legacy_partial_acknowledgement_uses_unknown_delta_instead_of_gross_rank(account):
    store_round(account, 1)
    store_round(account, 2)
    synchronize_hausdepp_progress(account.user.id)
    legacy_receipt(account, 20)
    progress = synchronize_hausdepp_progress(account.user.id)
    pending = progress["presentation"]["pending"]
    assert progress["scoring"]["points"] == 14
    assert pending["from_rank"] is None
    assert pending["rank_up"] is None
    assert pending["points_earned"] is None
    acknowledge_hausdepp_presentation(account.user.id, pending["revision"])
    store_round(account, 3)
    fresh = synchronize_hausdepp_progress(account.user.id)["presentation"]["pending"]
    assert fresh["points_earned"] == 22
    assert fresh["from_rank"]["name"]["de"] == "Einstein"


def test_presentation_snapshot_window_is_bounded_and_old_receipt_cannot_hide_new_badges(account):
    for number in range(1, 71):
        store_round(account, number)
        current = synchronize_hausdepp_progress(account.user.id)
    with session_scope() as db:
        snapshots = json.loads(db.get(HausdeppPresentationReceipt, account.user.id).presentation_scores_json)
    assert len(snapshots) == 64
    assert "20" not in snapshots
    assert all(type(score) is int for score in snapshots.values())
    acknowledge_hausdepp_presentation(account.user.id, 20)
    pending = synchronize_hausdepp_progress(account.user.id)["presentation"]["pending"]
    assert pending["revision"] == current["presentation"]["revision"]
    assert pending["points_earned"] is None
    assert pending["achievement_ids"]
    acknowledge_hausdepp_presentation(account.user.id, pending["revision"])
    assert synchronize_hausdepp_progress(account.user.id)["presentation"]["pending"] is None


@pytest.mark.parametrize("broken", ['[1]', 'true', '{"20":true}', '{"20":2.5}', '{"-1":2}', '{"20":-2}',
                                     json.dumps({str(number): 1 for number in range(65)}), ' ' * 8193])
def test_corrupt_presentation_snapshots_are_unknown_until_a_proven_ack(account, broken):
    store_round(account, 1)
    synchronize_hausdepp_progress(account.user.id)
    with session_scope() as db:
        receipt = db.get(HausdeppPresentationReceipt, account.user.id)
        receipt.acknowledged_points = 5
        receipt.acknowledged_score_points = None
        receipt.presentation_scores_json = broken
    pending = synchronize_hausdepp_progress(account.user.id)["presentation"]["pending"]
    assert pending["points_earned"] is None
    assert pending["from_rank"] is None
    acknowledge_hausdepp_presentation(account.user.id, pending["revision"])
    assert synchronize_hausdepp_progress(account.user.id)["presentation"]["pending"] is None
