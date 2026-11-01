"""The shared draw counts real games once and resets only on activation."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

from app.database import session_scope
from app.models import RareSurpriseCounter
from app.rare_surprise_probability import activate, read_offer, start_game
from tests import test_watten_runtime as runtime_tests

server = runtime_tests.server


def counter(db, game_type, account):
    row = db.get(RareSurpriseCounter, (game_type, account))
    return row.games if row else 0


def test_progress_guarantee_shared_draw_reset_and_game_isolation(server, monkeypatch):
    one, two = [runtime_tests.account(f"RareChance{index}")[0].user_id for index in (1, 2)]
    # A draw of 1 fails at 1%, but succeeds at 2%; variant index 0 is star.
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda limit: 1 if limit == 100 else 0)
    with session_scope() as db:
        start_game(db, "hausdepp", "a:1", [one, two])
        start_game(db, "hausdepp", "a:1", [one, two])
        assert [counter(db, "hausdepp", user) for user in (one, two)] == [1, 1]
        assert read_offer(db, "hausdepp", "a:1").effect is None
        start_game(db, "hausdepp", "b:1", [one, two])
        assert read_offer(db, "hausdepp", "b:1").effect == "star"
        assert [counter(db, "hausdepp", user) for user in (one, two)] == [2, 2]
        # Only connected humans reset, never on offer; duplicate taps do nothing.
        assert activate(db, "hausdepp", "b:1", "star", [one]) is True
        assert activate(db, "hausdepp", "b:1", "star", [one, two]) is False
        assert [counter(db, "hausdepp", user) for user in (one, two)] == [0, 2]
        start_game(db, "watten", "independent", [one])
        assert counter(db, "watten", one) == 1
        assert activate(db, "hausdepp", "legacy", "star", [one]) is None
    # The highest personal chance is used at the common table.
    with session_scope() as db:
        db.get(RareSurpriseCounter, ("hausdepp", two)).games = 49
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda limit: 49 if limit == 100 else 0)
    with session_scope() as db:
        start_game(db, "hausdepp", "c:1", [one, two])
        assert read_offer(db, "hausdepp", "c:1").effect == "star"
        assert [counter(db, "hausdepp", user) for user in (one, two)] == [1, 50]
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda limit: 99 if limit == 100 else 0)
    with session_scope() as db:
        db.get(RareSurpriseCounter, ("hausdepp", two)).games = 99
    with session_scope() as db:
        start_game(db, "hausdepp", "guaranteed:1", [one, two])
        assert read_offer(db, "hausdepp", "guaranteed:1").effect == "star"
        assert counter(db, "hausdepp", two) == 100


def test_simultaneous_duplicate_start_counts_once(server, monkeypatch):
    account = runtime_tests.account("RareConcurrent")[0].user_id
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda limit: limit - 1)
    barrier = Barrier(2)

    def worker():
        barrier.wait()
        with session_scope() as db:
            start_game(db, "watten", "race", [account])

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: worker(), range(2)))
    with session_scope() as db:
        assert counter(db, "watten", account) == 1


def test_success_can_repeat_immediately_after_reset(server, monkeypatch):
    account = runtime_tests.account("RareConsecutive")[0].user_id
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda _limit: 0)
    with session_scope() as db:
        start_game(db, "watten", "consecutive-one", [account])
        assert read_offer(db, "watten", "consecutive-one").effect == "star"
        assert activate(db, "watten", "consecutive-one", "star", [account]) is True
        assert counter(db, "watten", account) == 0
        start_game(db, "watten", "consecutive-two", [account])
        assert counter(db, "watten", account) == 1
        assert read_offer(db, "watten", "consecutive-two").effect == "star"
