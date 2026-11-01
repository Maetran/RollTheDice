"""Rare table surprises through the real Hausdepp and Watten entry points.

Admission, autostart, tournament rounds, checkpoints, restarts and taps must count
each played game once and reset only on an actual activation.
"""

from __future__ import annotations

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from itertools import count
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app import main
from app import rare_surprise_probability as probability
from app.active_games import load_active_games, save_active_game
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_lifecycle import admit_player, commit_room_binding
from app.game_registry import create_game_state
from app.game_snapshot import snapshot
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.hausdepp_cpu_runner import stop_cpu_runners
from app.hausdepp_engine import apply_action
from app.hausdepp_results import finalize_hausdepp_result
from app.hausdepp_state import configure_hausdepp_game, start_hausdepp_game
from app.hausdepp_table_surprises import (
    _eligible_effect,
    handle_table_surprise,
    table_effects_projection,
    table_surprise_offer,
)
from app.hausdepp_tournament import start_next_round
from app.models import ActiveGame, RareSurpriseCounter, RareSurpriseOffer, User, WattenTableSurpriseClaim
from app.watten_runtime import persist_watten_game, restore_watten_json, serialize_watten_game
from app.watten_surprises import handle_surprise, surprise_offer
from app.watten_websocket import _handle_locked
from tests import test_watten_runtime as runtime_tests
from tests.test_hausdepp_tournament import finish_round
from tests.test_user_accounts import request_for

server = runtime_tests.server
PASSWORD = "secure-password-123"


class ScriptedDraws:
    """Every percent draw returns ``percent``, every variant draw ``variant``."""

    def __init__(self):
        self.percent, self.variant, self.limits = 99, 0, []

    def randbelow(self, limit):
        self.limits.append(limit)
        return self.percent if limit == 100 else self.variant


class RecordingSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        json.dumps(message)
        self.messages.append(message)

    async def close(self, **_kwargs):
        return None


@pytest.fixture
def draws(monkeypatch):
    scripted = ScriptedDraws()
    monkeypatch.setattr(probability, "secrets", SimpleNamespace(randbelow=scripted.randbelow))
    return scripted


@pytest.fixture
def people(tmp_path, monkeypatch):
    monkeypatch.setenv("ROLLTHEDICE_DATABASE_URL", f"sqlite:///{tmp_path / 'rare-flows.sqlite3'}")
    monkeypatch.setenv("ROLLTHEDICE_COOKIE_DOMAIN", "")
    monkeypatch.setenv("ROLLTHEDICE_COOKIE_SECURE", "0")
    monkeypatch.setenv("ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS", "60")
    previous = dict(games)
    games.clear()
    configure_database(tmp_path)
    upgrade_database(main.BASE)
    yield [create_user(f"RareFlow{index}", PASSWORD, must_change_password=False) for index in range(3)]
    asyncio.run(stop_cpu_runners())
    games.clear()
    games.update(previous)
    monkeypatch.undo()
    configure_database(main.DATA_DIR)


def counters(game_type, *accounts):
    with session_scope() as db:
        rows = [db.get(RareSurpriseCounter, (game_type, getattr(account, "id", account))) for account in accounts]
        return [row.games if row else None for row in rows]


def stored_offer(game_type, game_key):
    with session_scope() as db:
        offer = db.get(RareSurpriseOffer, (game_type, game_key))
        return (offer.effect, offer.activated) if offer else None


def open_table(accounts, *, game_id="rare-table", cpus=0, tournament=False, manual=False):
    """The real creation and admission path; a full fixed table starts by itself."""
    game = create_game_state(game_id, "Seltene Funde", "6" if manual else str(len(accounts) + cpus), "hausdepp")
    configure_hausdepp_game(game, host_user_id=accounts[0].id, cpu_count=cpus, tournament=tournament,
                            **({"waiting_mode": "open", "manual_start": True} if manual else {}))
    commit_room_binding(game, [accounts[0].id])
    for index, account in enumerate(accounts):
        admit_player(game, {"id": f"p{index}", "name": account.username, "user_id": account.id,
                            "ws": RecordingSocket(), "resume_token": f"resume-{index}"})
    return game


def to_playing(game):
    while game["_hausdepp"]["phase"] == "peeking":
        state = game["_hausdepp"]
        game["_hausdepp"] = apply_action(state, state["current_player_id"], "peek", version=state["version"])
    save_active_game(game)


def tap(game, accounts, index, effect, *, round_number=1):
    """Tap as the seated, connected person and return what this socket received last."""
    player = game["_players"][index]
    identity, _token = login(request_for(), accounts[index].username, PASSWORD)
    session = GameSocketSession(player["ws"], game, identity, player_id=player["id"])
    asyncio.run(handle_table_surprise(session, {"effect": effect, "round_number": round_number}))
    return player["ws"].messages[-1]


def test_hausdepp_admission_start_counts_once_across_saves_and_restart(people, draws):
    host, guest = people[:2]
    game = create_game_state("rare-start", "Seltene Funde", "2", "hausdepp")
    configure_hausdepp_game(game, host_user_id=host.id, cpu_count=0)
    commit_room_binding(game, [host.id])
    admit_player(game, {"id": "p0", "name": host.username, "user_id": host.id, "ws": RecordingSocket(), "resume_token": "resume-0"})
    assert not game["_started"]
    assert counters("hausdepp", host, guest) == [None, None]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-start", 1)) is None
    admit_player(game, {"id": "p1", "name": guest.username, "user_id": guest.id, "ws": RecordingSocket(), "resume_token": "resume-1"})
    assert game["_started"]
    assert counters("hausdepp", host, guest) == [1, 1]
    assert draws.limits.count(100) == 1
    for _ in range(3):
        save_active_game(game)
    restored = load_active_games()["rare-start"]
    assert restored["_started"]
    assert counters("hausdepp", host, guest) == [1, 1]
    assert draws.limits.count(100) == 1


def test_hausdepp_cpu_seats_never_count_and_the_human_does(people, draws):
    game = open_table(people[:1], cpus=2)
    assert game["_started"]
    assert counters("hausdepp", people[0]) == [1]
    with session_scope() as db:
        assert [row.user_id for row in db.scalars(select(RareSurpriseCounter))] == [people[0].id]


def test_hausdepp_manual_start_counts_at_the_start_not_at_admission(people, draws):
    game = open_table(people[:2], manual=True)
    assert not game["_started"]
    assert counters("hausdepp", *people[:2]) == [None, None]
    start_hausdepp_game(game, manual=True)
    save_active_game(game)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    save_active_game(game)
    assert counters("hausdepp", *people[:2]) == [1, 1]


def test_hausdepp_only_players_of_the_started_game_count(people, draws):
    game = open_table(people[:2], manual=True)
    start_hausdepp_game(game, manual=True)
    save_active_game(game)
    assert counters("hausdepp", people[2]) == [None]


@pytest.mark.parametrize("hit", [True, False])
def test_hausdepp_a_new_table_offers_only_its_stored_draw_never_the_old_hash(people, draws, hit):
    legacy_id = next(f"rare-{number}" for number in range(20_000) if _eligible_effect(f"rare-{number}", 1))
    draws.percent = 0 if hit else 99
    game = open_table(people[:2], game_id=legacy_id)
    to_playing(game)
    effect = table_surprise_offer(game, "p0")["effect"]
    assert effect == (probability.EFFECTS[0] if hit else None)
    assert stored_offer("hausdepp", probability.hausdepp_key(legacy_id, 1)) == (effect, False)


def test_hausdepp_a_miss_cannot_be_tapped_even_with_a_guessed_effect(people, draws):
    draws.percent = 99
    game = open_table(people[:2])
    to_playing(game)
    for effect in probability.EFFECTS:
        assert "error_code" in tap(game, people, 0, effect)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (None, False)


def test_hausdepp_showing_the_offer_never_resets(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    effect = probability.EFFECTS[0]
    for viewer in ("p0", "p1", "p0"):
        assert table_surprise_offer(game, viewer)["effect"] == effect
        snapshot(game, viewer)
    save_active_game(game)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, False)


def test_hausdepp_a_tap_resets_everyone_connected_once_and_survives_a_restart(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    effect = probability.EFFECTS[0]
    message = tap(game, people, 0, effect)
    assert message["hausdepp_table_surprise"]["effect"] == effect
    assert counters("hausdepp", *people[:2]) == [0, 0]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, True)
    # The claim is durable before anyone is told: a crash right now cannot revive it.
    assert load_active_games()["rare-table"]["_hausdepp_table_surprise_claim"] == {"round_number": 1, "activated": True}
    # Everyone at the table saw the one shared event.
    for player in game["_players"]:
        assert sum("hausdepp_table_surprise" in item for item in player["ws"].messages) == 1
    assert table_surprise_offer(game, "p1")["effect"] is None
    assert "error_code" in tap(game, people, 1, effect)
    assert counters("hausdepp", *people[:2]) == [0, 0]
    # A restart neither revives the offer nor counts the running game again.
    restored = load_active_games()["rare-table"]
    assert table_surprise_offer({**restored, "_players": game["_players"]}, "p0")["effect"] is None
    save_active_game(game)
    assert counters("hausdepp", *people[:2]) == [0, 0]


def test_hausdepp_an_untapped_offer_survives_a_restart_and_can_still_be_tapped_once(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    effect = probability.EFFECTS[0]
    draws.percent = 99  # A second draw after the restart would lose the find.
    limits = list(draws.limits)
    restored = load_active_games()["rare-table"]
    games["rare-table"] = restored
    for player in restored["_players"]:
        player["ws"] = RecordingSocket()
    restored["_resume_required"] = False
    assert table_surprise_offer(restored, "p0")["effect"] == effect
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert "hausdepp_table_surprise" in tap(restored, people, 1, effect)
    assert counters("hausdepp", *people[:2]) == [0, 0]
    assert draws.limits == limits
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, True)
    assert "error_code" in tap(restored, people, 0, effect)


def test_hausdepp_a_used_draw_blocks_a_second_find_even_if_the_table_forgot_its_claim(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    effect = probability.EFFECTS[0]
    assert "hausdepp_table_surprise" in tap(game, people, 0, effect)
    game.pop("_hausdepp_table_surprise_claim")
    assert table_surprise_offer(game, "p0")["effect"] is None
    assert "error_code" in tap(game, people, 1, effect)
    assert counters("hausdepp", *people[:2]) == [0, 0]


def test_hausdepp_the_next_game_after_a_tap_starts_at_one_percent(people, draws):
    draws.percent = 0
    game = open_table(people[:2], tournament=True)
    to_playing(game)
    assert "hausdepp_table_surprise" in tap(game, people, 0, probability.EFFECTS[0])
    finish_round(game)
    version = game["_hausdepp"]["version"]
    assert finalize_hausdepp_result(game)["result_persisted"]
    draws.percent = 1  # Would hit from 2 %, so round two must miss at exactly 1 %.
    start_next_round(game, "p0", version)
    save_active_game(game)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 2)) == (None, False)


def test_hausdepp_two_direct_hits_across_tournament_rounds(people, draws):
    draws.percent = 0
    game = open_table(people[:2], tournament=True)
    for round_number in (1, 2):
        to_playing(game)
        effect = table_surprise_offer(game, "p0")["effect"]
        assert effect is not None
        message = tap(game, people, 0, effect, round_number=round_number)
        assert message["hausdepp_table_surprise"]["round_number"] == round_number
        assert counters("hausdepp", *people[:2]) == [0, 0]
        finish_round(game)
        version = game["_hausdepp"]["version"]
        assert finalize_hausdepp_result(game)["result_persisted"]
        start_next_round(game, "p0", version)
        save_active_game(game)
        assert counters("hausdepp", *people[:2]) == [1, 1]


def test_hausdepp_each_tournament_round_counts_once_without_a_tap(people, draws):
    game = open_table(people[:2], tournament=True)
    for expected in (1, 2, 3):
        assert counters("hausdepp", *people[:2]) == [expected, expected]
        to_playing(game)
        save_active_game(game)
        assert counters("hausdepp", *people[:2]) == [expected, expected]
        finish_round(game)
        save_active_game(game)
        assert counters("hausdepp", *people[:2]) == [expected, expected]
        version = game["_hausdepp"]["version"]
        assert finalize_hausdepp_result(game)["result_persisted"]
        start_next_round(game, "p0", version)
        save_active_game(game)
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 4)) == (None, False)
    assert draws.limits.count(100) == 4


def test_hausdepp_an_earlier_round_cannot_be_tapped_later(people, draws):
    draws.percent = 0
    game = open_table(people[:2], tournament=True)
    to_playing(game)
    effect = probability.EFFECTS[0]
    finish_round(game)
    version = game["_hausdepp"]["version"]
    assert finalize_hausdepp_result(game)["result_persisted"]
    draws.percent = 99
    start_next_round(game, "p0", version)
    to_playing(game)
    assert "error_code" in tap(game, people, 0, effect, round_number=1)
    assert "error_code" in tap(game, people, 0, effect, round_number=2)
    assert counters("hausdepp", *people[:2]) == [2, 2]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, False)


def test_hausdepp_a_stale_board_rejects_the_tap_without_any_reset(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    effect = probability.EFFECTS[0]
    game["_hausdepp"]["version"] += 1  # This memory state is newer than its checkpoint.
    assert "error_code" in tap(game, people, 0, effect)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, False)
    assert not game.get("_hausdepp_table_surprise_claim")


def test_hausdepp_a_failed_checkpoint_rolls_the_reset_back(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    effect = probability.EFFECTS[0]
    with patch("app.active_games.serializable_game_state", side_effect=RuntimeError("disk full")), \
            pytest.raises(RuntimeError):
        tap(game, people, 0, effect)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, False)
    assert not game.get("_hausdepp_table_surprise_claim")


def test_hausdepp_a_missing_person_pauses_the_table_and_hides_the_offer(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    game["_players"][1]["ws"] = None
    assert table_surprise_offer(game, "p0")["effect"] is None
    assert "error_code" in tap(game, people, 0, probability.EFFECTS[0])
    assert counters("hausdepp", *people[:2]) == [1, 1]


def test_hausdepp_a_running_table_without_a_stored_draw_keeps_its_old_policy(people, draws):
    legacy_id, legacy_effect = next((f"rare-{number}", _eligible_effect(f"rare-{number}", 1)) for number in range(20_000)
                                    if _eligible_effect(f"rare-{number}", 1))
    draws.percent = 99
    game = open_table(people[:2], game_id=legacy_id)
    to_playing(game)
    # A table already running at rollout has neither a stored draw nor the policy mark.
    game.pop("_hausdepp_rare_policy_round", None)
    with session_scope() as db:
        db.delete(db.get(RareSurpriseOffer, ("hausdepp", probability.hausdepp_key(legacy_id, 1))))
    save_active_game(game)
    assert table_surprise_offer(game, "p0")["effect"] == legacy_effect
    assert "hausdepp_table_surprise" in tap(game, people, 0, legacy_effect)
    assert counters("hausdepp", *people[:2]) == [1, 1]  # The old policy never touches the new chance.
    assert stored_offer("hausdepp", probability.hausdepp_key(legacy_id, 1)) is None


def test_hausdepp_a_new_table_never_falls_back_to_the_old_hash_without_its_draw(people, draws):
    legacy_id = next(f"rare-{number}" for number in range(20_000) if _eligible_effect(f"rare-{number}", 1))
    draws.percent = 99
    game = open_table(people[:2], game_id=legacy_id)
    to_playing(game)
    with session_scope() as db:
        db.delete(db.get(RareSurpriseOffer, ("hausdepp", probability.hausdepp_key(legacy_id, 1))))
    assert table_surprise_offer(game, "p0")["effect"] is None


def test_hausdepp_a_rematch_style_new_table_is_a_new_game(people, draws):
    open_table(people[:2], game_id="first")
    open_table(people[:2], game_id="second")
    assert counters("hausdepp", *people[:2]) == [2, 2]
    assert stored_offer("hausdepp", probability.hausdepp_key("first", 1)) is not None
    assert stored_offer("hausdepp", probability.hausdepp_key("second", 1)) is not None


def test_parallel_tables_keep_their_own_offers_and_one_tap_does_not_end_the_other(people, draws):
    draws.percent = 0
    first = open_table(people[:2], game_id="left")
    second = open_table(people[:2], game_id="right")
    assert counters("hausdepp", *people[:2]) == [2, 2]
    to_playing(first)
    to_playing(second)
    effect = probability.EFFECTS[0]
    assert "hausdepp_table_surprise" in tap(first, people, 0, effect)
    assert counters("hausdepp", *people[:2]) == [0, 0]
    assert table_surprise_offer(second, "p0")["effect"] == effect
    assert "hausdepp_table_surprise" in tap(second, people, 0, effect)
    assert counters("hausdepp", *people[:2]) == [0, 0]


def test_hausdepp_the_offer_waits_for_the_cards_and_ends_with_the_round(people, draws):
    draws.percent = 0
    game = open_table(people[:2], tournament=True)
    effect = probability.EFFECTS[0]
    assert game["_hausdepp"]["phase"] == "peeking"
    assert table_surprise_offer(game, "p0")["effect"] is None
    to_playing(game)
    assert table_surprise_offer(game, "p0")["effect"] == effect
    finish_round(game)
    save_active_game(game)
    assert table_surprise_offer(game, "p0")["effect"] is None
    assert "error_code" in tap(game, people, 0, effect)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, False)


def test_hausdepp_a_person_alone_with_computers_can_tap_too(people, draws):
    draws.percent = 0
    game = open_table(people[:1], cpus=1)
    to_playing(game)
    effect = table_surprise_offer(game, "p0")["effect"]
    assert effect == probability.EFFECTS[0]
    assert "hausdepp_table_surprise" in tap(game, people, 0, effect)
    assert counters("hausdepp", people[0]) == [0]


def test_hausdepp_a_wrong_effect_changes_nothing(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    assert "error_code" in tap(game, people, 0, probability.EFFECTS[1])
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert table_surprise_offer(game, "p0")["effect"] == probability.EFFECTS[0]


def test_hausdepp_the_dragon_marks_the_table_durably_in_the_same_step(people, draws):
    draws.percent, draws.variant = 0, probability.EFFECTS.index("dragon")
    game = open_table(people[:2])
    to_playing(game)
    assert "hausdepp_table_surprise" in tap(game, people, 0, "dragon")
    assert table_effects_projection(game) == {"scorched_cards": True}
    assert table_effects_projection(load_active_games()["rare-table"]) == {"scorched_cards": True}


def test_hausdepp_a_finished_person_who_went_offline_keeps_their_count(people, draws):
    draws.percent = 0
    game = open_table(people, game_id="rare-three")
    to_playing(game)
    gone = next(player for player in game["_hausdepp"]["players"] if player["id"] == "p2")
    gone["finished"] = True
    next(player for player in game["_players"] if player["id"] == "p2")["ws"] = None
    effect = table_surprise_offer(game, "p0")["effect"]
    assert effect == probability.EFFECTS[0]
    assert "hausdepp_table_surprise" in tap(game, people, 0, effect)
    assert counters("hausdepp", *people) == [0, 0, 1]


def test_hausdepp_a_running_table_joins_the_new_policy_with_its_next_round(people, draws):
    game = open_table(people[:2], tournament=True)
    to_playing(game)
    with session_scope() as db:
        db.delete(db.get(RareSurpriseOffer, ("hausdepp", probability.hausdepp_key("rare-table", 1))))
        db.delete(db.get(RareSurpriseCounter, ("hausdepp", people[0].id)))
        db.delete(db.get(RareSurpriseCounter, ("hausdepp", people[1].id)))
    save_active_game(game)
    assert counters("hausdepp", *people[:2]) == [None, None]  # The running round is not recounted.
    finish_round(game)
    version = game["_hausdepp"]["version"]
    assert finalize_hausdepp_result(game)["result_persisted"]
    start_next_round(game, "p0", version)
    save_active_game(game)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 2)) == (None, False)


def test_parallel_real_admissions_count_every_table(people, draws):
    tables = [f"parallel-{index}" for index in range(4)]
    barrier = Barrier(len(tables))

    def admit(game_id):
        barrier.wait(60)
        return open_table(people[:2], game_id=game_id)

    with ThreadPoolExecutor(max_workers=len(tables)) as pool:
        started = [future.result(timeout=120) for future in [pool.submit(admit, table) for table in tables]]
    assert all(game["_started"] for game in started)
    assert counters("hausdepp", *people[:2]) == [4, 4]
    assert draws.limits.count(100) == 4


def test_hausdepp_a_failing_offer_read_does_not_break_the_table_view(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    failure = OperationalError("SELECT", {}, Exception("database is locked"))
    with patch("app.rare_surprise_probability.read_offer", side_effect=failure):
        assert table_surprise_offer(game, "p0")["effect"] is None
        assert snapshot(game, "p0")["_hausdepp_table_surprises"]["effect"] is None


def test_hausdepp_a_database_failure_during_a_tap_answers_instead_of_dropping_the_socket(people, draws):
    draws.percent = 0
    game = open_table(people[:2])
    to_playing(game)
    effect = probability.EFFECTS[0]
    failure = OperationalError("UPDATE", {}, Exception("database is locked"))
    with patch("app.rare_surprise_probability.activate", side_effect=failure):
        assert "error_code" in tap(game, people, 0, effect)
    assert counters("hausdepp", *people[:2]) == [1, 1]
    assert stored_offer("hausdepp", probability.hausdepp_key("rare-table", 1)) == (effect, False)
    assert "hausdepp_table_surprise" in tap(game, people, 0, effect)


def watten_table(server, *, players=2, cpus=()):
    game_id, owners, sessions = runtime_tests.local_started(server, count_players=players, cpus=cpus, target=11)
    numbers = count()
    runtime_tests.advance_to_play(game_id, sessions, numbers)
    return games[game_id], [owner[0].user_id for owner in owners], sessions, numbers


def watten_tap(game, sessions, index, effect):
    identities = {session.websocket: session.auth_identity for session in sessions}
    data = {"action": "watten_table_surprise", "deal_id": game["_watten"].engine.deal_id, "effect": effect}
    asyncio.run(handle_surprise(sessions[index], data, identities.get))


def test_watten_start_counts_every_seated_person_once_across_checkpoints_and_restart(server, draws):
    game, accounts, sessions, numbers = watten_table(server)
    assert counters("watten", *accounts) == [1, 1]
    assert draws.limits.count(100) == 1
    assert stored_offer("watten", game["_id"]) == (None, False)
    persist_watten_game(game)
    with session_scope() as db:
        checkpoint = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    assert serialize_watten_game(restore_watten_json(checkpoint))
    assert counters("watten", *accounts) == [1, 1]
    assert draws.limits.count(100) == 1


def test_watten_a_waiting_room_has_not_played_yet(server, draws):
    owner = runtime_tests.account("RareWaiting")
    game_id = runtime_tests.create_game(server, owner, count=2)
    assert counters("watten", owner[0].user_id) == [None]
    assert stored_offer("watten", game_id) is None


def test_watten_cpu_seats_never_count(server, draws):
    game_id, owners, _sessions = runtime_tests.local_started(server, count_players=2, cpus=(1,), target=11)
    game = games[game_id]
    accounts = [owner[0].user_id for owner in owners]
    assert counters("watten", *accounts) == [1]
    with session_scope() as db:
        assert [row.user_id for row in db.scalars(select(RareSurpriseCounter))] == accounts
    assert stored_offer("watten", game["_id"]) == (None, False)


def test_watten_counts_separately_from_hausdepp(server, draws):
    _game, accounts, _sessions, _numbers = watten_table(server)
    assert counters("hausdepp", *accounts) == [None, None]
    assert counters("watten", *accounts) == [1, 1]


def test_watten_showing_the_offer_never_resets_and_a_tap_resets_once(server, draws):
    draws.percent = 0
    game, accounts, sessions, _numbers = watten_table(server)
    effect = probability.EFFECTS[0]
    for session in sessions * 2:
        assert surprise_offer(game, session.player_id)["effect"] == effect
    assert counters("watten", *accounts) == [1, 1]
    assert stored_offer("watten", game["_id"]) == (effect, False)
    watten_tap(game, sessions, 0, effect)
    assert counters("watten", *accounts) == [0, 0]
    assert stored_offer("watten", game["_id"]) == (effect, True)
    assert surprise_offer(game, sessions[1].player_id)["effect"] is None
    with pytest.raises(ValueError, match="watten_action_unavailable"):
        watten_tap(game, sessions, 1, effect)
    assert counters("watten", *accounts) == [0, 0]
    with session_scope() as db:
        assert len(list(db.scalars(select(WattenTableSurpriseClaim)))) == 1


def test_watten_an_untapped_offer_survives_a_restart(server, draws):
    draws.percent = 0
    game, accounts, sessions, _numbers = watten_table(server)
    effect = probability.EFFECTS[0]
    draws.percent = 99
    limits = list(draws.limits)
    with session_scope() as db:
        checkpoint = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    restored = restore_watten_json(checkpoint)
    assert serialize_watten_game(restored) == serialize_watten_game(game)
    assert stored_offer("watten", game["_id"]) == (effect, False)
    assert counters("watten", *accounts) == [1, 1]
    assert draws.limits == limits
    assert surprise_offer(game, sessions[0].player_id)["effect"] == effect


def test_watten_a_stored_miss_beats_the_old_hash(server, draws):
    draws.percent = 99
    game, accounts, sessions, _numbers = watten_table(server)
    with patch("app.watten_surprises.eligible_effect", return_value="dragon"):
        assert surprise_offer(game, sessions[0].player_id)["effect"] is None
        with pytest.raises(ValueError):
            watten_tap(game, sessions, 0, "dragon")
    assert counters("watten", *accounts) == [1, 1]
    assert stored_offer("watten", game["_id"]) == (None, False)


def test_watten_a_rejected_claim_rolls_the_reset_back(server, draws):
    draws.percent = 0
    game, accounts, sessions, _numbers = watten_table(server)
    effect = probability.EFFECTS[0]
    with session_scope() as db:
        db.get(User, accounts[1]).is_active = False
    with pytest.raises(ValueError):
        watten_tap(game, sessions, 0, effect)
    assert counters("watten", *accounts) == [1, 1]
    assert stored_offer("watten", game["_id"]) == (effect, False)
    with session_scope() as db:
        assert list(db.scalars(select(WattenTableSurpriseClaim))) == []


def play_on_to_the_next_deal(game, sessions, numbers):
    first_deal = game["_watten"].engine.deal_id
    by_player = {session.player_id: session for session in sessions}
    for _ in range(20):
        if game["_watten"].engine.phase == "deal_complete":
            break
        player, command = runtime_tests.next_move(game["_id"], numbers)
        asyncio.run(_handle_locked(by_player[player], command["action"], command))
    state = game["_watten"].engine
    assert state.phase == "deal_complete"
    command = runtime_tests.room_command(game["_id"], "watten_next_deal", next(numbers),
                                         deal_id=state.deal_id, opportunity=state.opportunity)
    asyncio.run(_handle_locked(sessions[0], command["action"], command))
    runtime_tests.advance_to_play(game["_id"], sessions, numbers)
    assert game["_watten"].engine.deal_id != first_deal


def test_watten_a_tapped_offer_stays_used_in_the_next_deal(server, draws):
    draws.percent = 0
    game, accounts, sessions, numbers = watten_table(server)
    effect = probability.EFFECTS[0]
    watten_tap(game, sessions, 0, effect)
    play_on_to_the_next_deal(game, sessions, numbers)
    assert surprise_offer(game, sessions[0].player_id)["effect"] is None
    with pytest.raises(ValueError, match="watten_action_unavailable"):
        watten_tap(game, sessions, 1, effect)
    assert counters("watten", *accounts) == [0, 0]


def test_watten_the_offer_outlives_a_deal_until_it_is_tapped(server, draws):
    draws.percent = 0
    game, accounts, sessions, numbers = watten_table(server)
    effect = probability.EFFECTS[0]
    play_on_to_the_next_deal(game, sessions, numbers)
    assert counters("watten", *accounts) == [1, 1]  # A new deal is not a new game.
    assert draws.limits.count(100) == 1
    assert surprise_offer(game, sessions[0].player_id)["effect"] == effect
    watten_tap(game, sessions, 0, effect)
    assert counters("watten", *accounts) == [0, 0]


def test_watten_a_new_policy_claim_is_marked_as_such(server, draws):
    draws.percent = 0
    game, _accounts, sessions, _numbers = watten_table(server)
    watten_tap(game, sessions, 0, probability.EFFECTS[0])
    with session_scope() as db:
        assert [claim.policy_version for claim in db.scalars(select(WattenTableSurpriseClaim))] == [2]


def test_watten_a_running_table_without_a_stored_draw_keeps_its_old_policy(server, draws):
    draws.percent = 99
    game, accounts, sessions, _numbers = watten_table(server)
    with session_scope() as db:
        # A table already running at rollout: no stored draw and the old policy mark.
        db.delete(db.get(RareSurpriseOffer, ("watten", game["_id"])))
        db.scalar(select(ActiveGame).where(ActiveGame.game_id == game["_id"])).rare_surprise_policy = 1
    with patch("app.watten_surprises.eligible_effect", return_value="hammer"):
        assert surprise_offer(game, sessions[0].player_id)["effect"] == "hammer"
        watten_tap(game, sessions, 0, "hammer")
    assert counters("watten", *accounts) == [1, 1]
    with session_scope() as db:
        assert [claim.policy_version for claim in db.scalars(select(WattenTableSurpriseClaim))] == [1]


def test_watten_a_tap_resets_only_the_people_connected_at_that_moment(server, draws):
    draws.percent = 0
    game, accounts, sessions, _numbers = watten_table(server, players=4)
    next(player for player in game["_players"] if player["id"] == sessions[3].player_id)["ws"] = None
    effect = probability.EFFECTS[0]
    assert surprise_offer(game, sessions[0].player_id)["effect"] == effect
    watten_tap(game, sessions, 0, effect)
    assert counters("watten", *accounts) == [0, 0, 0, 1]


def test_watten_one_connected_person_can_tap_under_the_new_policy(server, draws):
    draws.percent = 0
    game, accounts, sessions, _numbers = watten_table(server)
    next(player for player in game["_players"] if player["id"] == sessions[1].player_id)["ws"] = None
    effect = probability.EFFECTS[0]
    assert surprise_offer(game, sessions[0].player_id)["effect"] == effect
    watten_tap(game, sessions, 0, effect)
    assert counters("watten", *accounts) == [0, 1]
    assert stored_offer("watten", game["_id"]) == (effect, True)


def test_watten_a_new_table_never_falls_back_to_the_old_hash_without_its_draw(server, draws):
    draws.percent = 99
    game, accounts, sessions, _numbers = watten_table(server)
    with session_scope() as db:
        db.delete(db.get(RareSurpriseOffer, ("watten", game["_id"])))
    with patch("app.watten_surprises.eligible_effect", return_value="hammer"):
        assert surprise_offer(game, sessions[0].player_id)["effect"] is None
        with pytest.raises(ValueError):
            watten_tap(game, sessions, 0, "hammer")
    assert counters("watten", *accounts) == [1, 1]


def test_watten_a_room_still_waiting_at_rollout_joins_the_new_policy_when_it_starts(server, draws):
    draws.percent = 0
    host, guest = [runtime_tests.account(f"RareRollout{index}") for index in range(2)]
    game_id = runtime_tests.create_game(server, host, count=2, target=11)
    with session_scope() as db:
        db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id)).rare_surprise_policy = 1
    game = games[game_id]
    sessions = []
    players = []
    for seat, owner in enumerate((host, guest)):
        candidate, player = runtime_tests.admit_account(game, owner[0], game["_watten"].room.revision, None)
        game.update(candidate)
        socket = runtime_tests.CapturingSocket(owner)
        next(item for item in game["_players"] if item["id"] == player)["ws"] = socket
        sessions.append(GameSocketSession(socket, game, owner[0], player_id=player))
        players.append(player)
        candidate, *_ = runtime_tests.apply_runtime_action(game, owner[0].user_id, player, runtime_tests.room_command(
            game_id, "watten_take_seat", seat, seat=seat, team=None))
        game.update(candidate)
    candidate, *_ = runtime_tests.apply_runtime_action(game, host[0].user_id, players[0], runtime_tests.room_command(
        game_id, "watten_start", "start"))
    persist_watten_game(candidate)
    game.update(candidate)
    runtime_tests.advance_to_play(game_id, sessions, count())
    accounts = [host[0].user_id, guest[0].user_id]
    assert counters("watten", *accounts) == [1, 1]
    effect = probability.EFFECTS[0]
    assert stored_offer("watten", game_id) == (effect, False)
    watten_tap(game, sessions, 0, effect)
    assert counters("watten", *accounts) == [0, 0]
