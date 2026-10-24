"""Server-observed listening: bounded intervals, account privacy and durable totals."""

import asyncio
import os
import queue
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import delete, func, inspect, select
from sqlalchemy.exc import SQLAlchemyError

from app import analytics, api_analytics, main
from app import voice_activity as activity
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.models import User, VoiceActivityBucket, VoiceUsageBucket
from tests.test_analytics import batch
from tests.test_user_accounts import request_for


@pytest.fixture
def store(tmp_path):
    pending = queue.Queue(maxsize=300)
    now = datetime(2026, 11, 20, 12, tzinfo=timezone.utc)
    with patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/activity.sqlite"}), \
            patch.object(analytics, "_queue", pending):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        activity._owners.clear()
        activity._dropped = 0
        with session_scope() as db:
            db.add_all(User(id=index, username=f"Listener{index}", username_normalized=f"listener{index}",
                            password_hash="unused-test-verifier", created_at=now, updated_at=now)
                       for index in range(1, 14))
        yield SimpleNamespace(pending=pending, now=now, path=tmp_path)
        activity._owners.clear()
    configure_database(main.DATA_DIR)


def observe(store, counter, stamp, *, user=1, game="hausdepp", party="table-one", connected=True, ended=False,
            wall=None):
    return activity.observe_activity(counter, user_id=user, game_type=game, game_id=party, now=stamp,
                                     wall_time=wall or store.now + timedelta(seconds=stamp),
                                     connected=connected, ended=ended)


def flush(store, *, sweep=False, now=None):
    rows = [store.pending.get_nowait() for _ in range(store.pending.qsize())]
    analytics.persist_batches(rows, now=now or store.now + timedelta(hours=1), sweep=sweep)


def stats(store, *, games=activity.GAMES, start=None, now=None):
    with session_scope() as db:
        return activity.activity_stats(db, start or store.now.replace(hour=0), now or store.now + timedelta(hours=1), games)


def test_join_heartbeat_repeated_resume_count_one_activation_and_monotonic_minutes(store):
    counter = activity.ActivityCounter()
    for stamp in (0, 10, 10, 20, 30, 40, 50, 60):
        assert observe(store, counter, stamp)
    flush(store)
    assert stats(store)["period"] == {"activations": 1, "games": 1, "users": 1, "connected_minutes": 1.0}
    assert stats(store)["top_users"] == [{"username": "Listener1", "connected_minutes": 1.0}]


def test_disconnect_pause_resume_and_late_cleanup_never_count_the_gap(store):
    counter = activity.ActivityCounter()
    assert observe(store, counter, 0)
    assert observe(store, counter, 10, connected=False)
    assert observe(store, counter, 200, connected=True)
    assert observe(store, counter, 210, ended=True)
    assert not observe(store, counter, 220, ended=True)
    flush(store)
    assert stats(store)["period"]["connected_minutes"] == round(20 / 60, 2)
    assert stats(store)["period"]["activations"] == 1


def test_stale_end_is_capped_at_last_confirmation_plus_thirty_seconds(store):
    counter = activity.ActivityCounter()
    observe(store, counter, 0)
    observe(store, counter, 10)
    observe(store, counter, 900, ended=True)
    flush(store)
    assert stats(store)["period"]["connected_minutes"] == round(40 / 60, 2)


def test_cross_game_handoff_keeps_activation_but_creates_distinct_zero_time_party(store):
    counter = activity.ActivityCounter()
    observe(store, counter, 0, game="zdwa", party="same-id")
    observe(store, counter, 20, game="zdwa", party="same-id")
    observe(store, counter, 25, game="watten", party="same-id")
    flush(store)
    result = stats(store)
    assert result["period"] == {"activations": 1, "games": 2, "users": 1, "connected_minutes": round(20 / 60, 2)}
    by_game = {row["game_type"]: row for row in result["by_game"]}
    assert by_game["watten"] == {"game_type": "watten", "activations": 0, "games": 1,
                                 "users": 1, "connected_minutes": 0.0}


def test_simultaneous_account_counter_cannot_double_minutes_and_revoked_counter_stays_dead(store):
    old, newer = activity.ActivityCounter(), activity.ActivityCounter()
    observe(store, old, 0)
    observe(store, newer, 10)
    assert not observe(store, old, 20)
    observe(store, newer, 30)
    flush(store)
    assert stats(store)["period"] == {"activations": 2, "games": 1, "users": 1, "connected_minutes": 0.5}


def test_fresh_confirmed_join_after_explicit_revoke_is_a_new_activation(store):
    first, second = activity.ActivityCounter(), activity.ActivityCounter()
    observe(store, first, 0)
    observe(store, first, 10, ended=True)
    observe(store, second, 11)
    observe(store, second, 21, ended=True)
    flush(store)
    assert stats(store)["period"]["activations"] == 2
    assert stats(store)["period"]["connected_minutes"] == round(20 / 60, 2)


@pytest.mark.parametrize("user,game,party", [(True, "zdwa", "x"), (0, "zdwa", "x"), (None, "zdwa", "x"),
                                               (1, "zilch", "x"), (1, "hausdepp", "bad/id"), (1, "watten", "")])
def test_non_account_cpu_and_malformed_context_never_enqueue(store, user, game, party):
    assert not observe(store, activity.ActivityCounter(), 0, user=user, game=game, party=party)
    assert store.pending.empty()


def test_counter_cannot_switch_account_or_run_backwards_and_wall_clock_does_not_define_minutes(store):
    counter = activity.ActivityCounter()
    observe(store, counter, 10)
    assert not observe(store, counter, 9)
    assert not observe(store, counter, 15, user=2)
    assert not observe(store, counter, float("nan"), wall=store.now)
    observe(store, counter, 20, wall=store.now + timedelta(hours=10))
    flush(store)
    assert stats(store, now=store.now + timedelta(hours=11))["period"]["connected_minutes"] == round(10 / 60, 2)


def test_utc_midnight_splits_elapsed_time_and_keeps_single_activation(store):
    counter = activity.ActivityCounter()
    first = store.now.replace(hour=23, minute=59, second=55)
    observe(store, counter, 0, wall=first)
    observe(store, counter, 10, wall=first + timedelta(seconds=10))
    flush(store, now=first + timedelta(seconds=11))
    with session_scope() as db:
        rows = db.scalars(select(VoiceActivityBucket).order_by(VoiceActivityBucket.day)).all()
        assert [(row.day, row.connected_ms, row.activations) for row in rows] == [
            ("2026-11-20", 5000, 1), ("2026-11-21", 5000, 0)]


def test_queue_outage_full_and_exception_never_block_voice_or_claim_complete_measurement(store):
    with patch.object(analytics, "_queue", None), patch.object(analytics, "get_engine") as engine:
        assert not observe(store, activity.ActivityCounter(), 0)
        engine.assert_not_called()
    with patch.object(analytics, "_queue", queue.Queue(maxsize=1)) as pending:
        pending.put({})
        assert not observe(store, activity.ActivityCounter(), 0, user=2)
    with patch.object(analytics, "enqueue_voice_activity", side_effect=RuntimeError("unavailable")):
        assert not observe(store, activity.ActivityCounter(), 0, user=3)
    assert stats(store)["dropped_observations_since_restart"] == 3
    assert stats(store)["first_observed_at"] is None


def test_migration_persistence_current_names_and_account_delete_cascade(store):
    counter = activity.ActivityCounter()
    observe(store, counter, 0)
    observe(store, counter, 30)
    flush(store)
    configure_database(store.path)
    schema = inspect(get_engine())
    foreign = schema.get_foreign_keys("voice_activity_buckets")
    assert foreign[0]["referred_table"] == "users"
    assert foreign[0]["options"]["ondelete"] == "CASCADE"
    with session_scope() as db:
        db.get(User, 1).username = "CurrentListener"
    assert stats(store)["top_users"][0]["username"] == "CurrentListener"
    with session_scope() as db:
        db.execute(delete(User).where(User.id == 1))
    assert stats(store)["period"]["users"] == 0
    # An observation already queued before deletion cannot restore deleted data.
    observe(store, counter, 40)
    flush(store)
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(VoiceActivityBucket)) == 0


def test_retention_is_four_hundred_utc_days_and_total_is_explicitly_retained(store):
    for index, days in enumerate((400, 399, 1, 0), 1):
        counter = activity.ActivityCounter()
        first = store.now - timedelta(days=days)
        observe(store, counter, 0, user=index, wall=first)
        observe(store, counter, 30, user=index, wall=first + timedelta(seconds=30))
    flush(store, now=store.now + timedelta(seconds=31), sweep=True)
    result = stats(store, now=store.now + timedelta(seconds=31))
    assert result["period"]["activations"] == 1
    assert result["retained"]["activations"] == 3
    assert result["retained"]["connected_minutes"] == 1.5
    assert result["first_observed_at"] == (store.now - timedelta(days=399)).isoformat()


def test_private_game_filters_and_ten_current_names_do_not_relabel_anonymous_bytes(store):
    counters = []
    for user in range(1, 14):
        counter = activity.ActivityCounter()
        counters.append(counter)
        game = activity.GAMES[(user - 1) % 3]
        observe(store, counter, 0, user=user, game=game)
        observe(store, counter, user, user=user, game=game)
    flush(store)
    with patch.object(analytics, "server_snapshot", return_value={}):
        public_scope = analytics.dashboard_stats(1, "all", now=store.now + timedelta(hours=1))
        assert [row["game_type"] for row in public_scope["voice_activity"]["by_game"]] == ["zdwa"]
        assert public_scope["voice_activity"]["period"]["users"] == 5
        assert public_scope["voice_usage"] is None
        founder = analytics.dashboard_stats(1, "all", now=store.now + timedelta(hours=1),
                                            include_hausdepp=True, include_watten=True)
        assert founder["voice_activity"]["period"]["users"] == 13
        assert len(founder["voice_activity"]["top_users"]) == 10
        assert founder["voice_activity"]["top_users"][0]["username"] == "Listener13"
        assert analytics.dashboard_stats(1, "zilch", now=store.now)["voice_activity"] is None
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(VoiceUsageBucket)) == 0


def test_api_requires_existing_dashboard_capability_before_private_aggregation(store):
    identity = SimpleNamespace(user_id=1, is_founder=False)
    with patch.object(api_analytics, "require_user", return_value=identity), \
            patch.object(api_analytics, "dashboard_stats") as reader:
        with pytest.raises(HTTPException) as denied:
            api_analytics.analytics_dashboard(request_for(), Response(), days=1, game="all")
        assert denied.value.status_code == 403
        reader.assert_not_called()
        with session_scope() as db:
            db.get(User, 1).analytics_access = True
        reader.return_value = {"voice_activity": {"top_users": []}}
        with patch.object(api_analytics, "can_access_watten", return_value=False):
            response = Response()
            assert api_analytics.analytics_dashboard(request_for(), response, days=1, game="all") == reader.return_value
        assert response.headers["cache-control"] == "no-store"
        reader.assert_called_once_with(1, "all", include_hausdepp=False, include_watten=False)


def test_public_beacons_cannot_supply_private_activity_rows(store):
    forged = batch()
    forged["voice_activity"] = [{"user_id": 1, "connected_ms": 99999999}]
    sanitized = analytics.normalize_batch(forged, now=store.now)
    assert "voice_activity" not in sanitized
    analytics.persist_batches([sanitized], now=store.now)
    assert stats(store)["period"]["activations"] == 0


def test_existing_background_writer_handles_voice_only_db_failure_without_dying(store):
    async def run():
        with patch.object(analytics, "persist_batches", side_effect=SQLAlchemyError("busy")):
            await analytics.start_analytics()
            observe(store, activity.ActivityCounter(), 0)
            await asyncio.sleep(.05)
            assert activity._dropped >= 1
            assert not analytics._worker.done()
            await analytics.stop_analytics()
    asyncio.run(run())
