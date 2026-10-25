"""Human-owned mixed-team comeback decisions, without a CPU veto or timer spin."""

import asyncio
from dataclasses import replace

import pytest

from app import watten_cpu_runtime as runner
from app import watten_round_runtime as review
from app.game_state import games
from app.watten_bidding import DealResult, ScoreAccount, ScoreLedger, retourschneider_candidate
from app.watten_cpu import CpuWait, decide
from app.watten_cpu_memory import new_memory
from app.watten_engine import EngineActor, WattenEngineError, apply_command, next_deal, start_match
from app.watten_runtime import (
    _sync,
    apply_runtime_action,
    persist_watten_game,
    restore_watten_game,
    serialize_watten_game,
    snapshot_watten,
)
from app.watten_views import cpu_view, member_view
from tests import test_watten_cpu_runtime as cpu_tests
from tests import test_watten_runtime as native
from tests.test_watten_engine import actor, command, dealt, finish, ready, step
from tests.test_watten_preplay import restored, retour_choice

server = native.server
cpu_ready = cpu_tests.ready
REAL_ROUND_WATCH = review.watch_game


def mixed_choice():
    state = retour_choice()
    human, cpu = retourschneider_candidate(state.ledger)
    bindings = tuple(replace(item, account_id=None) if item.player_id == cpu else item for item in state.recipe.bindings)
    return replace(state, recipe=replace(state.recipe, bindings=bindings), ack_cache=()), human, cpu


def personal(state, player):
    return member_view(state, account_id=actor(state, player).account_id, player_id=player)


def test_mixed_cpu_waits_without_an_action_and_engine_rejects_forged_votes_before_human():
    state, human, cpu = mixed_choice()
    assert "retourschneider" in personal(state, human)["actions"]
    for _ in range(4):
        view = cpu_view(state, player_id=cpu)
        assert "retourschneider" not in view["actions"]
        assert isinstance(decide(view, new_memory(cpu), seed=2).decision, CpuWait)
    for value in ("accept", "decline"):
        with pytest.raises(WattenEngineError, match="retourschneider_unavailable"):
            step(state, cpu, "retourschneider", value)
        with pytest.raises(WattenEngineError, match="actor_not_bound"):
            apply_command(state, EngineActor(human, None), command(state, human, "retourschneider", value))
    with pytest.raises(WattenEngineError, match="decision_pending"):
        next_deal(state, "too-soon", dealt())


@pytest.mark.parametrize("value", ("accept", "decline"))
def test_human_decision_applies_to_mixed_team_atomically_and_replays_only_once(value):
    state, human, cpu = mixed_choice()
    members = retourschneider_candidate(state.ledger)
    before = next(item.points for item in state.ledger.accounts if item.members == members)
    request = command(state, human, "retourschneider", value)
    transition = apply_command(state, actor(state, human), request)
    state = transition.state
    view = personal(state, human)["retourschneider"]
    assert view["status"] == ("active" if value == "accept" else "declined")
    assert view["accepted_by"] == (list(members) if value == "accept" else [])
    assert next(item.points for item in state.ledger.accounts if item.members == members) == (0 if value == "accept" else before)
    assert "retourschneider" not in cpu_view(state, player_id=cpu)["actions"]
    replay = apply_command(state, actor(state, human), request)
    assert replay.replayed and replay.state == state and restored(state) == state
    following = next_deal(state, "normal-next-deal", dealt())
    assert following.deal_id == "normal-next-deal" and following.ledger == state.ledger
    assert following.dealer_seat == (state.dealer_seat + 1) % 4


def test_saved_human_yes_can_only_be_mirrored_by_cpu_yes_and_never_vetoed():
    state, human, cpu = mixed_choice()
    state = restored(replace(state, retour_accepted_by=(human,)))
    view = cpu_view(state, player_id=cpu)
    assert "retourschneider" in view["actions"]
    proposal = decide(view, new_memory(cpu), seed=2).decision
    assert proposal.kind == "retourschneider" and proposal.value == "accept"
    with pytest.raises(WattenEngineError, match="retourschneider_unavailable"):
        step(state, cpu, "retourschneider", "decline")
    state = step(state, cpu, "retourschneider", "accept")
    assert personal(state, human)["retourschneider"]["status"] == "active"


def test_two_humans_still_need_two_separate_yes_votes():
    state = retour_choice()
    first, second = retourschneider_candidate(state.ledger)
    state = step(state, first, "retourschneider", "accept")
    assert personal(state, first)["retourschneider"]["status"] == "available"
    assert "retourschneider" in personal(state, second)["actions"]
    assert personal(step(state, second, "retourschneider", "decline"), first)["retourschneider"]["status"] == "declined"


@pytest.mark.parametrize("saved_vote", (False, True))
def test_all_cpu_team_has_no_offer_or_cpu_decision_even_for_an_older_saved_partial_vote(saved_vote):
    state = retour_choice()
    members = retourschneider_candidate(state.ledger)
    bindings = tuple(replace(item, account_id=None) if item.player_id in members else item for item in state.recipe.bindings)
    state = restored(replace(state, recipe=replace(state.recipe, bindings=bindings), ack_cache=(),
                             retour_accepted_by=(members[0],) if saved_vote else ()))
    for cpu in members:
        view = cpu_view(state, player_id=cpu)
        assert view["retourschneider"] is None and "retourschneider" not in view["actions"]
        assert isinstance(decide(view, new_memory(cpu), seed=2).decision, CpuWait)
        for value in ("accept", "decline"):
            with pytest.raises(WattenEngineError, match="retourschneider_unavailable"):
                step(state, cpu, "retourschneider", value)
    following = next_deal(state, "normal-all-cpu-next", dealt())
    assert following.ledger == state.ledger and not following.retour_accepted_by


def runtime_choice(server, *, cpu_only=False):
    game_id, _owners, sessions = native.local_started(server, count_players=4, cpus=(1, 2, 3) if cpu_only else (2, 3), target=11)
    game = games[game_id]
    runtime = game["_watten"]
    state = finish(ready(start_match(runtime.engine.recipe, runtime.engine.deal_id, dealt(), first_dealer=runtime.engine.recipe.seats[0])))
    last = state.bid_state.result
    results = (DealResult("prior-two", state.parties, 1 - last.winning_party, 2, "tricks"),
               DealResult("prior-seven", state.parties, last.winning_party, 7, "tricks"), last)
    accounts = tuple(ScoreAccount(account.members, 9 if index == last.winning_party else 2)
                     for index, account in enumerate(state.ledger.accounts))
    state = replace(state, ledger=ScoreLedger(11, accounts, results))
    _sync(game, replace(runtime, engine=state, cpu_memories=(), bid_counters=None), public=True)
    persist_watten_game(game)
    members = retourschneider_candidate(state.ledger)
    human = next((session for session in sessions if session.player_id in members), sessions[0])
    cpu = next(item.player_id for item in state.recipe.bindings if item.player_id in members and item.account_id is None)
    return game, human, cpu


@pytest.mark.parametrize("value", ("accept", "decline"))
def test_repeated_runtime_snapshots_do_not_schedule_cpu_while_human_is_pending_and_choice_unblocks_normal_advance(
        server, cpu_ready, monkeypatch, value):
    game, human, _cpu = runtime_choice(server)
    before = game["_watten"].engine
    monkeypatch.setattr(runner, "decide", lambda *_args, **_kwargs: pytest.fail("pending mixed choice scheduled CPU policy"))

    async def scenario():
        try:
            for _ in range(4):
                assert snapshot_watten(game, human.player_id)["engine"]["retourschneider"]["status"] == "available"
                runner.watch_game(game)
                await asyncio.sleep(0)
                assert not any(key[0] == game["_id"] for key in runner._JOBS)
            assert game["_watten"].engine == before
            assert review.review_projection(game)["blocked"] == "retourschneider"
            data = native.engine_command(game["_id"], "retourschneider", "human-choice", value)
            candidate, *_ = apply_runtime_action(game, human.auth_identity.user_id, human.player_id, data)
            persist_watten_game(candidate)
            game.update(candidate)
            runner.watch_game(game)
            await asyncio.sleep(0)
            assert not any(key[0] == game["_id"] for key in runner._JOBS)
            view = snapshot_watten(game, human.player_id)["engine"]["retourschneider"]
            assert view["status"] == ("active" if value == "accept" else "declined")
            assert restore_watten_game(serialize_watten_game(game))["_watten"].engine == game["_watten"].engine
            assert review.review_projection(game)["auto_advance"]
            following = review.advance_reviewed_deal(game)
            assert following["_watten"].engine.deal_id != before.deal_id
            assert following["_watten"].engine.ledger == game["_watten"].engine.ledger
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


@pytest.mark.parametrize("saved_vote", (False, True))
def test_scheduler_does_not_offer_or_decide_for_all_cpu_team_and_automatically_advances_old_checkpoints(
        server, cpu_ready, monkeypatch, saved_vote):
    game, host, cpu = runtime_choice(server, cpu_only=True)
    before = game["_watten"].engine
    members = retourschneider_candidate(before.ledger)
    assert members and all(actor(before, member).account_id is None for member in members)
    if saved_vote:
        game["_watten"] = replace(game["_watten"], engine=replace(before, retour_accepted_by=(cpu,)))
        persist_watten_game(game)
        game.update(restore_watten_game(serialize_watten_game(game)))
    monkeypatch.setattr(runner, "decide", lambda *_args, **_kwargs: pytest.fail("all-CPU offer scheduled a policy decision"))

    async def scenario():
        try:
            for _ in range(4):
                assert snapshot_watten(game, host.player_id)["engine"]["retourschneider"] is None
                runner.watch_game(game)
                await asyncio.sleep(0)
                assert not any(key[0] == game["_id"] for key in runner._JOBS)
            assert review.review_projection(game)["auto_advance"]
            # Isolate this deadline from the ordinary CPU turn after new cards.
            monkeypatch.setattr(runner, "watch_game", lambda _game: None)
            REAL_ROUND_WATCH(game)
            job = review._JOBS[game["_id"]]
            await job.task
            after = game["_watten"].engine
            assert after.deal_id != before.deal_id and after.ledger == before.ledger
            assert not after.retour_accepted_by and after.ledger.retourschneider is None
            assert restore_watten_game(serialize_watten_game(game))["_watten"].engine == after
        finally:
            await review.stop_round_runners()
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


def test_scheduler_mirrors_an_already_saved_human_yes_once_after_restart(server, cpu_ready):
    game, human, cpu = runtime_choice(server)
    game["_watten"] = replace(game["_watten"], engine=replace(game["_watten"].engine, retour_accepted_by=(human.player_id,)))
    persist_watten_game(game)

    async def scenario():
        try:
            runner.watch_game(game)
            job = runner._JOBS[game["_id"], cpu]
            for _ in range(3):
                runner.watch_game(game)
                assert runner._JOBS[game["_id"], cpu] is job
            await job.task
            assert snapshot_watten(game, human.player_id)["engine"]["retourschneider"]["status"] == "active"
            after = game["_watten"].engine
            runner.watch_game(game)
            assert not any(key[0] == game["_id"] for key in runner._JOBS)
            assert game["_watten"].engine == after
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
