"""Rare table surprises: a chance per person and game type, reset only by a real trigger.

The rules under test: 1 % in the first game after a triggered surprise, one more
percentage point per further game, certain by the 100th game. One shared result per
game; only an actual activation resets.
"""

from __future__ import annotations

import json
import secrets
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app import main
from app import rare_surprise_probability as probability
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.hausdepp_surprise_collection import SURPRISE_EFFECTS
from app.models import RareSurpriseCounter, RareSurpriseLock, RareSurpriseOffer
from app.watten_surprises import EFFECTS as WATTEN_EFFECTS

THREAD_TIMEOUT = 60


class ScriptedDraws:
    """Every percent draw returns ``percent``, every variant draw ``variant``."""

    def __init__(self):
        self.percent, self.variant, self.limits = 99, 0, []

    def randbelow(self, limit):
        self.limits.append(limit)
        return self.percent if limit == 100 else self.variant


@pytest.fixture(scope="module", autouse=True)
def isolated_database(tmp_path_factory):
    folder = Path(tmp_path_factory.mktemp("rare-chance"))
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("ROLLTHEDICE_DATABASE_URL", f"sqlite:///{folder / 'rare.sqlite3'}")
        configure_database(folder)
        upgrade_database(main.BASE)
        yield
    configure_database(main.DATA_DIR)


@pytest.fixture
def draws(monkeypatch):
    scripted = ScriptedDraws()
    monkeypatch.setattr(probability, "secrets", SimpleNamespace(randbelow=scripted.randbelow))
    return scripted


def person() -> int:
    return create_user(f"Rare{uuid4().hex[:12]}", "secure-password-123", must_change_password=False).id


def key() -> str:
    return uuid4().hex


def games_of(user_id, game_type="hausdepp"):
    with session_scope() as db:
        row = db.get(RareSurpriseCounter, (game_type, user_id))
        return row.games if row else None


def set_games(user_id, games, game_type="hausdepp"):
    with session_scope() as db:
        row = db.get(RareSurpriseCounter, (game_type, user_id))
        if row:
            row.games = games
        else:
            db.add(RareSurpriseCounter(game_type=game_type, user_id=user_id, games=games))


def start(game_key, *users, game_type="hausdepp"):
    with session_scope() as db:
        probability.start_game(db, game_type, game_key, users)


def offered(game_key, game_type="hausdepp"):
    with session_scope() as db:
        offer = probability.read_offer(db, game_type, game_key)
        return offer.effect if offer else None


def activate(game_key, effect, *users, game_type="hausdepp"):
    with session_scope() as db:
        return probability.activate(db, game_type, game_key, effect, users)


def in_parallel(*jobs):
    """Release every job at one barrier and return their results; a hang fails the test."""
    barrier = Barrier(len(jobs))

    def run(job):
        barrier.wait(THREAD_TIMEOUT)
        return job()

    with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
        return [future.result(timeout=THREAD_TIMEOUT) for future in [pool.submit(run, job) for job in jobs]]


@pytest.mark.parametrize(("games_before", "chance"), [(0, 1), (1, 2), (49, 50), (99, 100)])
def test_exactly_the_current_percentage_of_all_draws_hits(draws, games_before, chance):
    user = person()
    hits = []
    for draw in range(100):
        set_games(user, games_before)
        draws.percent = draw
        game = key()
        start(game, user)
        hits.append(offered(game) is not None)
        assert games_of(user) == chance
    assert hits == [draw < chance for draw in range(100)]
    assert sum(hits) == chance


@pytest.mark.parametrize(("games_before", "chance"), [(0, 1), (1, 2), (49, 50), (99, 100)])
def test_watten_uses_the_same_percentages(draws, games_before, chance):
    user = person()
    for draw, hit in ((chance - 1, True), (min(chance, 99), chance == 100)):
        set_games(user, games_before, "watten")
        draws.percent = draw
        game = key()
        start(game, user, game_type="watten")
        assert (offered(game, "watten") is not None) is hit
        assert games_of(user, "watten") == chance


def test_the_lottery_draws_from_one_hundred_and_all_eight_effects(draws):
    assert set(probability.EFFECTS) == set(SURPRISE_EFFECTS) == set(WATTEN_EFFECTS)
    assert len(probability.EFFECTS) == 8
    user = person()
    draws.percent = 0
    seen = []
    for index in range(8):
        draws.variant = index
        game = key()
        start(game, user)
        seen.append(offered(game))
    assert seen == list(probability.EFFECTS)
    assert set(draws.limits) == {100, 8}


def test_the_chance_rises_one_point_per_game_and_the_hundredth_game_is_certain(draws):
    user = person()
    draws.percent = 99  # The highest draw only hits at 100 %.
    for game_number in range(1, 100):
        game = key()
        start(game, user)
        assert offered(game) is None, game_number
        assert games_of(user) == game_number
    game = key()
    start(game, user)
    assert offered(game) is not None
    assert games_of(user) == 100
    # Untapped, the chance simply stays certain; the counter never passes 100.
    for _ in range(3):
        game = key()
        start(game, user)
        assert offered(game) is not None
        assert games_of(user) == 100


def test_a_new_player_and_a_reset_player_both_start_at_one_percent(draws):
    user = person()
    assert games_of(user) is None
    draws.percent = 1
    game = key()
    start(game, user)
    assert offered(game) is None
    assert games_of(user) == 1
    draws.percent = 0
    set_games(user, 37)
    game = key()
    start(game, user)
    assert activate(game, offered(game), user) is True
    assert games_of(user) == 0
    draws.percent = 1  # Would hit at 2 %, so this proves exactly 1 % right after a reset.
    game = key()
    start(game, user)
    assert offered(game) is None
    assert games_of(user) == 1


def test_two_direct_hits_are_possible_and_each_resets(draws):
    user = person()
    draws.percent = 0
    for _ in range(2):
        game = key()
        start(game, user)
        assert games_of(user) == 1
        effect = offered(game)
        assert effect is not None
        assert activate(game, effect, user) is True
        assert games_of(user) == 0


def test_an_offer_alone_never_resets_and_stays_claimable(draws):
    user = person()
    set_games(user, 49)
    draws.percent = 0
    first = key()
    start(first, user)
    effect = offered(first)
    assert effect is not None
    for _ in range(5):
        assert offered(first) == effect
    assert games_of(user) == 50
    # The player ignored it, so the next game keeps counting upwards.
    draws.percent = 99
    second = key()
    start(second, user)
    assert games_of(user) == 51
    assert activate(first, effect, user) is True
    assert games_of(user) == 0


def test_only_a_successful_activation_resets(draws):
    user = person()
    draws.percent, draws.variant = 0, 0
    hit = key()
    start(hit, user)
    effect = offered(hit)
    other = next(item for item in probability.EFFECTS if item != effect)
    draws.percent = 99
    miss = key()
    start(miss, user)
    before = games_of(user)
    assert activate(hit, other, user) is False
    assert activate(miss, effect, user) is False
    assert activate(key(), effect, user) is None
    assert games_of(user) == before
    assert activate(hit, effect, user) is True
    assert games_of(user) == 0
    # A repeated tap can neither reset a later count nor reuse the offer.
    set_games(user, 12)
    assert activate(hit, effect, user) is False
    assert games_of(user) == 12


def test_activation_resets_only_the_named_players_of_this_game_type(draws):
    present, absent = person(), person()
    set_games(present, 30, "watten")
    draws.percent = 0
    game = key()
    start(game, present, absent)
    assert activate(game, offered(game), present) is True
    assert games_of(present) == 0
    assert games_of(absent) == 1
    assert games_of(present, "watten") == 30


def test_counters_are_separate_per_person_and_game_type(draws):
    one, two = person(), person()
    draws.percent = 99
    start(key(), one)
    start(key(), one)
    start(key(), one, game_type="watten")
    start(key(), two, game_type="watten")
    assert (games_of(one), games_of(one, "watten")) == (2, 1)
    assert (games_of(two), games_of(two, "watten")) == (None, 1)


def test_one_shared_result_uses_the_highest_chance_at_the_table(draws):
    newcomer, veteran = person(), person()
    set_games(veteran, 49)
    draws.percent = 49  # Hits at 50 %, misses at the newcomer's 1 %.
    game = key()
    start(game, newcomer, veteran)
    assert offered(game) is not None
    assert (games_of(newcomer), games_of(veteran)) == (1, 50)
    assert draws.limits.count(100) == 1


def test_starting_the_same_game_again_neither_counts_nor_draws(draws):
    user = person()
    draws.percent = 99
    game = key()
    start(game, user)
    limits = list(draws.limits)
    draws.percent = 0  # A second draw would now change the immutable result.
    for _ in range(3):
        start(game, user)
    assert offered(game) is None
    assert games_of(user) == 1
    assert draws.limits == limits


def test_a_used_offer_is_not_drawn_again_when_its_game_starts_again(draws):
    user = person()
    draws.percent = 0
    game = key()
    start(game, user)
    effect = offered(game)
    assert activate(game, effect, user) is True
    start(game, user)
    assert games_of(user) == 0
    assert activate(game, effect, user) is False


def test_only_real_account_ids_count(draws):
    user = person()
    draws.percent = 0
    game = key()
    start(game, user, user, None, 0, -5, True, str(user))
    assert games_of(user) == 1
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(RareSurpriseCounter).where(
            RareSurpriseCounter.user_id.in_([0, -5]))) == 0
    nobody = key()
    start(nobody)
    assert offered(nobody) is None  # No person means no chance, not a hit on draw 0.


def test_parallel_starts_at_different_tables_count_every_game(draws):
    shared = person()
    draws.percent = 4
    tables = [key() for _ in range(10)]
    in_parallel(*[lambda game=game: start(game, shared) for game in tables])
    assert games_of(shared) == 10
    # Serialized reads see 1..10: exactly the six draws from 5 % upwards hit.
    assert sum(offered(game) is not None for game in tables) == 6


def test_parallel_starts_of_one_game_count_once_and_draw_once(draws):
    user = person()
    draws.percent = 99
    game = key()
    in_parallel(*[lambda: start(game, user) for _ in range(6)])
    assert games_of(user) == 1
    assert draws.limits.count(100) == 1


def test_parallel_taps_have_exactly_one_winner(draws):
    one, two = person(), person()
    draws.percent = 0
    game = key()
    start(game, one, two)
    effect = offered(game)
    results = in_parallel(lambda: activate(game, effect, one), lambda: activate(game, effect, two))
    assert sorted(results) == [False, True]
    winner = one if results[0] else two
    assert games_of(winner) == 0
    assert games_of(two if winner == one else one) == 1


def test_a_parallel_start_and_tap_lose_no_update(draws):
    user = person()
    for _ in range(5):
        draws.percent = 0
        tapped, started = key(), key()
        set_games(user, 20)
        start(tapped, user)
        effect = offered(tapped)
        draws.percent = 99
        results = in_parallel(lambda: activate(tapped, effect, user), lambda: start(started, user))
        assert results[0] is True
        # Tap first: 0 then 1. Start first: 22 then 0. Nothing in between.
        assert games_of(user) in {0, 1}
        with session_scope() as db:
            assert db.get(RareSurpriseOffer, ("hausdepp", started)) is not None


def test_opposite_account_orders_do_not_block_each_other(draws):
    one, two = person(), person()
    draws.percent = 99
    tables = [key() for _ in range(8)]
    in_parallel(*[lambda game=game, order=((one, two) if index % 2 else (two, one)): start(game, *order)
                  for index, game in enumerate(tables)])
    assert (games_of(one), games_of(two)) == (8, 8)


def hausdepp_table(*users, game_id=None, round_number=None, cpu=False, gone=(), **flags):
    table = {"_id": game_id or key(), "_started": True, "_finished": False, "_aborted": False, **flags,
             "_participants": [{"id": f"u{user}", "user_id": user, "is_cpu": False} for user in (*users, *gone)]
             + ([{"id": "cpu-1", "user_id": None, "is_cpu": True}] if cpu else []),
             "_hausdepp": {"players": [{"id": f"u{user}"} for user in users] + ([{"id": "cpu-1"}] if cpu else [])}}
    if round_number is not None:
        table["_hausdepp_tournament"] = {"round_number": round_number}
    return table


def record(table, previous=None):
    with session_scope() as db:
        probability.record_hausdepp_start(db, table, previous)


def test_a_hausdepp_table_counts_when_it_starts_and_never_again_in_that_round(draws):
    user = person()
    table = hausdepp_table(user)
    record({**table, "_started": False}, None)
    assert games_of(user) is None
    waiting = {**table, "_started": False, "_hausdepp": None}
    record(table, waiting)
    assert games_of(user) == 1
    for previous in (table, json.loads(json.dumps(table)), None):
        record(table, previous)
    assert games_of(user) == 1
    assert draws.limits.count(100) == 1


@pytest.mark.parametrize("state", [{"_finished": True}, {"_aborted": True}])
def test_an_ended_hausdepp_table_does_not_count(draws, state):
    user = person()
    record(hausdepp_table(user, **state), None)
    assert games_of(user) is None


def test_each_hausdepp_tournament_round_is_its_own_game(draws):
    user = person()
    table = hausdepp_table(user, round_number=1)
    record(table, None)
    second = hausdepp_table(user, game_id=table["_id"], round_number=2)
    record(second, table)
    record(second, second)
    assert games_of(user) == 2
    with session_scope() as db:
        assert probability.read_offer(db, "hausdepp", probability.hausdepp_key(table["_id"], 1)) is not None
        assert probability.read_offer(db, "hausdepp", probability.hausdepp_key(table["_id"], 2)) is not None


def test_computers_and_departed_tournament_players_do_not_count(draws):
    user, departed = person(), person()
    record(hausdepp_table(user, cpu=True, gone=(departed,), round_number=3), None)
    assert (games_of(user), games_of(departed)) == (1, None)


def test_the_real_system_random_source_decides():
    assert probability.secrets is secrets


def test_an_account_merge_keeps_the_higher_chance_per_game_type(draws):
    source, target = person(), person()
    set_games(source, 40)
    set_games(target, 10)
    set_games(source, 5, "watten")
    set_games(target, 25, "watten")
    with session_scope() as db:
        probability.merge_counters(db, source, target)
    assert (games_of(target), games_of(target, "watten")) == (40, 25)
    assert (games_of(source), games_of(source, "watten")) == (None, None)


def test_an_account_merge_moves_or_keeps_a_lone_counter(draws):
    source, target = person(), person()
    set_games(source, 17)
    set_games(target, 9, "watten")
    with session_scope() as db:
        probability.merge_counters(db, source, target)
    assert (games_of(target), games_of(target, "watten")) == (17, 9)
    assert games_of(source) is None


def test_the_database_guards_the_counter_range_and_the_single_lock(draws):
    user = person()
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(RareSurpriseLock)) == 1
    for invalid in (-1, 101):
        with pytest.raises(IntegrityError), session_scope() as db:
            db.add(RareSurpriseCounter(game_type="hausdepp", user_id=user, games=invalid))
    with pytest.raises(IntegrityError), session_scope() as db:
        db.add(RareSurpriseCounter(game_type="zdwa", user_id=user, games=1))
    with pytest.raises(IntegrityError), session_scope() as db:
        db.add(RareSurpriseOffer(game_type="hausdepp", game_key=key(), effect="sparkle", activated=False))
