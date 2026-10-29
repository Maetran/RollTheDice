"""Durable server review timing and authorized automatic deal continuation."""

import asyncio
from dataclasses import replace
from datetime import timedelta
from itertools import count

import pytest

from app import watten_round_runtime as review
from app.game_state import games
from app.watten_runtime import (
    apply_runtime_action,
    persist_watten_game,
    restore_watten_game,
    serialize_watten_game,
    snapshot_watten,
)
from tests import test_watten_runtime as native

server = native.server
REAL_WATCH = review.watch_game
REAL_NOW = review.utcnow


def completed_deal(server, *, blind=False):
    game_id, owners, sessions = native.local_started(server, count_players=4 if blind else 2, blind=blind, target=11)
    game = games[game_id]
    by_player = {session.player_id: session for session in sessions}
    for _ in range(40):
        if game["_watten"].engine.phase == "deal_complete":
            break
        player, data = native.next_move(game_id, count(_ * 100))
        session = by_player[player]
        candidate, *_ = apply_runtime_action(game, session.auth_identity.user_id, player, data)
        game.update(candidate)
    assert game["_watten"].engine.phase == "deal_complete"
    persist_watten_game(game)
    return game, owners, sessions


def test_checkpoint_anchors_collect_then_review_and_reload_does_not_restart_it(server, monkeypatch):
    game, _owners, _sessions = completed_deal(server)
    start = review.datetime.fromisoformat(game["_watten"].round_review_started_at)
    monkeypatch.setattr(review, "utcnow", lambda: start)
    projection = snapshot_watten(game)["round_review"]
    assert projection["collect_remaining_ms"] == 3600
    assert projection["review_remaining_ms"] == 6600
    assert projection["auto_advance"] and projection["blocked"] is None
    restored = restore_watten_game(serialize_watten_game(game))
    monkeypatch.setattr(review, "utcnow", lambda: start + timedelta(seconds=4))
    assert review.review_projection(restored) == review.review_projection(game)
    assert review.review_projection(game)["collect_remaining_ms"] == 0
    assert review.review_projection(game)["review_remaining_ms"] == 2600
    with pytest.raises(ValueError, match="review_pending"):
        review.advance_reviewed_deal(game)


def test_blind_terminal_trick_waits_one_extra_second_and_reload_keeps_deadline(server, monkeypatch):
    game, _owners, _sessions = completed_deal(server, blind=True)
    start = review.datetime.fromisoformat(game["_watten"].round_review_started_at)
    monkeypatch.setattr(review, "utcnow", lambda: start)
    assert review.review_projection(game)["collect_remaining_ms"] == 4600
    assert review.review_projection(game)["review_remaining_ms"] == 7600
    restored = restore_watten_game(serialize_watten_game(game))
    monkeypatch.setattr(review, "utcnow", lambda: start + timedelta(seconds=4))
    assert review.review_projection(restored) == review.review_projection(game)
    assert review.review_projection(game)["collect_remaining_ms"] == 600
    monkeypatch.setattr(review, "utcnow", lambda: start + timedelta(seconds=7))
    with pytest.raises(ValueError, match="review_pending"):
        review.advance_reviewed_deal(game)


def test_trusted_advance_rotates_dealer_preserves_score_and_honors_pause_or_retour_choice(server, monkeypatch):
    game, _owners, _sessions = completed_deal(server)
    old = game["_watten"]
    monkeypatch.setattr(review, "utcnow", lambda: review.datetime.fromisoformat(game["_watten"].round_review_started_at) + timedelta(seconds=7))
    game["_watten"] = replace(old, absent=(old.room.members[0].participant_id,))
    assert review.review_projection(game)["blocked"] == "paused"
    with pytest.raises(ValueError, match="review_pending"):
        review.advance_reviewed_deal(game)
    game["_watten"] = old
    monkeypatch.setattr(review, "retourschneider_offer", lambda _state: ("waiting-human",))
    assert not review.review_projection(game)["auto_advance"]
    with pytest.raises(ValueError, match="review_pending"):
        review.advance_reviewed_deal(game)
    monkeypatch.setattr(review, "retourschneider_offer", lambda _state: None)
    candidate = review.advance_reviewed_deal(game)
    new = candidate["_watten"]
    assert new.engine.deal_id != old.engine.deal_id
    assert new.engine.dealer_seat == (old.engine.dealer_seat + 1) % 2
    assert new.engine.ledger == old.engine.ledger
    assert new.room == old.room and candidate["_players"] == game["_players"]
    assert review.review_projection(candidate) is None


def test_server_job_advances_all_human_table_once_without_manufactured_host_action(server, monkeypatch):
    game, _owners, _sessions = completed_deal(server)
    before = game["_watten"]
    end = review.datetime.fromisoformat(game["_watten"].round_review_started_at) + timedelta(seconds=7)
    monkeypatch.setattr(review, "utcnow", lambda: end)

    async def scenario():
        REAL_WATCH(game)
        job = review._JOBS[game["_id"]]
        REAL_WATCH(game)
        assert review._JOBS[game["_id"]] is job
        await job.task
        assert game["_watten"].engine.deal_id != before.engine.deal_id
        assert game["_watten"].engine.ledger == before.engine.ledger
        assert game["_watten"].acks == before.acks
        assert game["_id"] not in review._JOBS
        await review.stop_round_runners()

    asyncio.run(scenario())


def test_public_updates_preserve_terminal_anchor_and_manual_next_deal_cannot_skip_review(server, monkeypatch):
    from app import watten_runtime

    game, owners, sessions = completed_deal(server)
    started = game["_watten"].round_review_started_at
    monkeypatch.setattr(review, "utcnow", REAL_NOW)
    command = native.room_command(game["_id"], "watten_next_deal", "manual-after-review",
                                  deal_id=game["_watten"].engine.deal_id,
                                  opportunity=game["_watten"].engine.opportunity)
    with pytest.raises(ValueError, match="round_review_pending"):
        apply_runtime_action(game, owners[0][0].user_id, sessions[0].player_id, command)
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: review.datetime.fromisoformat(started) + timedelta(seconds=2))
    watten_runtime._sync(game, game["_watten"], public=True)
    assert game["_watten"].round_review_started_at == started
    assert game["_updated_at"] != started
    monkeypatch.setattr(review, "utcnow", lambda: review.datetime.fromisoformat(started) + timedelta(seconds=7))
    candidate, ack, replayed, _private = apply_runtime_action(game, owners[0][0].user_id, sessions[0].player_id, command)
    assert not replayed and candidate["_watten"].round_review_started_at is None
    game.update(candidate)
    _candidate, replay_ack, replayed, _private = apply_runtime_action(game, owners[0][0].user_id, sessions[0].player_id, command)
    assert replayed and replay_ack == ack


def test_shutdown_prevents_cpu_completion_from_spawning_a_new_round_job(server, monkeypatch):
    from app import watten_cpu_runtime as cpu

    game, _owners, _sessions = completed_deal(server)
    monkeypatch.setattr(review, "utcnow", REAL_NOW)
    monkeypatch.setattr(review, "watch_game", REAL_WATCH)
    real_stop = review.stop_round_runners

    async def overlap():
        await real_stop()
        await asyncio.sleep(0)
        # This is the producer callback used by a CPU completing while the
        # other timer pool is being shut down.
        cpu.watch_game(game)
        assert not review._JOBS

    monkeypatch.setattr(review, "stop_round_runners", overlap)
    asyncio.run(cpu.stop_cpu_runners())
    assert not review._JOBS and not cpu._JOBS and not cpu._STOPPING


def test_automatic_transition_does_not_install_a_checkpoint_after_a_source_cas_race(server, monkeypatch):
    from app import watten_runtime
    from app.database import session_scope
    from app.models import ActiveGame

    game, _owners, _sessions = completed_deal(server)
    original = game["_watten"]
    monkeypatch.setattr(review, "utcnow", lambda: review.datetime.fromisoformat(original.round_review_started_at) + timedelta(seconds=7))
    real_persist = watten_runtime.persist_watten_game

    def conflict(candidate, **kwargs):
        with session_scope() as db:
            row = db.get(ActiveGame, candidate["_id"])
            row.state_json += " "
        real_persist(candidate, **kwargs)

    monkeypatch.setattr(watten_runtime, "persist_watten_game", conflict)

    async def scenario():
        REAL_WATCH(game)
        await review._JOBS[game["_id"]].task
        assert game["_watten"] is original
        assert game["_id"] not in review._JOBS

    asyncio.run(scenario())
