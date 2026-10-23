"""Nockerl series bind real teams and advance once with a completed result."""

import json
from dataclasses import replace

import pytest

from app.watten_bidding import nockerl, retourschneider_candidate
from app.watten_engine import next_deal, start_match
from app.watten_room import (
    WattenRoomError,
    admit,
    create_rematch,
    place_cpu,
    remove_cpu,
    room_from_payload,
    room_to_payload,
    start,
    start_roster,
)
from app.watten_room import (
    finish as finish_room,
)
from app.watten_runtime import _engine_recipe
from app.watten_tournament import (
    NockerlSeries,
    bind_room_series,
    complete_room_series,
    public_score_history,
    public_series,
    series_from_payload,
    series_to_payload,
)
from tests.test_watten_engine import dealt, finish, ready, step
from tests.test_watten_room import ACCOUNTS, HOST, NOW, WAIT, join, later, new_room, seated, sit


def completed(count=4, *, target=None, cpus=()):
    room = seated(count, cpu_seats=cpus, target_points=3, tournament_nockerl_target=target)
    room = start(room, revision=room.revision, account_id=HOST, now=NOW, first_dealer=0).room
    roster = start_roster(room)
    engine = start_match(_engine_recipe(roster), "series-round-0", dealt(count), first_dealer=roster.seats[0])
    for number in range(20):
        engine = finish(ready(engine))
        if engine.phase == "match_complete":
            break
        candidate = retourschneider_candidate(engine.ledger)
        if candidate is not None:
            engine = step(engine, candidate[0], "retourschneider", "decline")
        engine = next_deal(engine, f"series-round-{number + 1}", dealt(count))
    assert engine.phase == "match_complete"
    room = finish_room(room, revision=room.revision)
    return complete_room_series(room, engine), engine


def following(source):
    return create_rematch(source, revision=source.revision, account_id=HOST, target_room_id="series-next",
                          now=NOW, wait_seconds=WAIT, reservations={account: seat for seat, account in enumerate(ACCOUNTS)
                          if f"h:{account}" in source.series.bindings}, reservations_expire_at=later(300)).room


@pytest.mark.parametrize("count", (2, 3, 4))
def test_completed_match_adds_exact_native_loss_marks_and_retries_or_restores_never_double(count):
    room, engine = completed(count)
    values = public_series(room)
    assert sum(item["count"] for item in values["nockerl"]) == sum(amount for _members, amount, _reason in nockerl(engine.ledger))
    assert room.series.completed_games == 1 and room.series.last_game_id == room.room_id
    assert complete_room_series(room, engine) == room
    restored = room_from_payload(json.loads(json.dumps(room_to_payload(room))))
    assert restored == room and complete_room_series(restored, engine) == room
    assert not values["finished"] and values["target"] is None
    assert "h:" not in json.dumps(values) and "bindings" not in values


def test_rematch_keeps_exact_human_teams_and_seats_across_new_participant_ids():
    source, _engine = completed(4)
    target = following(source)
    assert not public_series(target)["pending_roster"] and public_series(target)["teams_locked"]
    assert target.series.counts == source.series.counts
    for account, seat in ((203, 3), (202, 2), (201, 1)):
        if account != HOST:
            target = join(target, account)
    target = replace(target, reservations=())
    with pytest.raises(WattenRoomError, match="roster_locked"):
        sit(target, HOST, 2)
    for account, seat in ((HOST, 0), (201, 1), (202, 2), (203, 3)):
        assert next(item for item in target.members if item.account_id == account).seat == seat
    started = start(target, revision=target.revision, account_id=HOST, now=NOW, first_dealer=0).room
    assert started.series.series_id == source.series.series_id and started.series.counts == source.series.counts
    assert started.series.bindings == source.series.bindings and started.series.completed_games == 1
    assert next(member.participant_id for member in started.members if member.account_id == 201) != next(
        member.participant_id for member in source.members if member.account_id == 201)


def test_new_people_or_different_teams_never_inherit_old_team_marks():
    source, _engine = completed(4)
    target = following(source)
    with pytest.raises(WattenRoomError, match="roster_locked"):
        join(target, 999)
    # Choosing new teams means a distinct lobby table without inherited metadata.
    target = replace(new_room(4), room_id="fresh-independent-table")
    for account, seat in ((HOST, 0), (201, 2), (202, 1), (999, 3)):
        if account != HOST:
            target = join(target, account)
        target = sit(target, account, seat)
    bound = bind_room_series(target)
    assert bound.series.series_id == target.room_id and bound.series.counts == (0, 0)
    assert bound.series.completed_games == 0


def test_cpu_logical_seats_keep_their_marks_with_the_same_human_teams():
    source, _engine = completed(4, cpus=(1, 3))
    target = create_rematch(source, revision=source.revision, account_id=HOST, target_room_id="cpu-next", now=NOW,
                            wait_seconds=WAIT).room
    target = join(target, 201)
    assert [(item.account_id, item.seat) for item in target.members] == [(HOST, 0), (201, 2)]
    target = bind_room_series(target)
    assert target.series == replace(source.series, continuation_locked=True)


@pytest.mark.parametrize("target", (1, 2))
def test_tournament_limit_or_overshoot_ends_series_for_losing_team(target):
    room, _engine = completed(2, target=target)
    values = public_series(room)
    # A zero-score opponent gets two marks, so both reaching and overshooting
    # the target terminate this series rather than creating another round.
    assert values["finished"] and values["teams_locked"]
    assert values["loser_seats"] and values["winner_seats"]
    assert set(values["loser_seats"]) | set(values["winner_seats"]) == {0, 1}
    with pytest.raises(WattenRoomError, match="tournament_finished"):
        following(room)


def test_tournament_reservations_never_expire_into_foreign_players_or_team_changes():
    source, _engine = completed(4, target=20, cpus=(3,))
    target = create_rematch(source, revision=source.revision, account_id=HOST, target_room_id="locked-next", now=NOW,
                            wait_seconds=WAIT, reservations={201: 1, 202: 2}, reservations_expire_at=later(30)).room
    # Expired seat invitations do not relax the permanent tournament binding.
    with pytest.raises(WattenRoomError, match="tournament_roster_locked"):
        admit(target, revision=target.revision, account_id=999, now=later(31))
    target = join(target, 201, now=later(31))
    with pytest.raises(WattenRoomError, match="tournament_roster_locked"):
        sit(target, 201, 2, now=later(31))
    assert next(item for item in target.members if item.account_id == 201).seat == 1
    for operation, seat in ((place_cpu, 2), (remove_cpu, 3)):
        with pytest.raises(WattenRoomError, match="tournament_roster_locked"):
            operation(target, revision=target.revision, account_id=HOST, seat=seat, now=later(31))
    assert room_from_payload(room_to_payload(target)) == target


def test_legacy_room_and_series_json_are_strict_and_no_unfinished_match_can_award():
    room = seated(2)
    old = room_to_payload(room)
    old.pop("series")
    old["recipe"].pop("tournament_nockerl_target")
    assert room_from_payload(old) == room
    series = NockerlSeries("safe", ("h:100", "c:1"), (0, 0), 5)
    assert series_from_payload(series_to_payload(series)) == series
    for change in ({"counts": [-1, 0]}, {"target": True}, {"bindings": ["h:100", "h:100"]}, {"secret": []}):
        with pytest.raises(ValueError):
            series_from_payload({**series_to_payload(series), **change})
    room = start(room, revision=room.revision, account_id=HOST, now=NOW, first_dealer=0).room
    roster = start_roster(room)
    engine = start_match(_engine_recipe(roster), "unplayed", dealt(2), first_dealer=roster.seats[0])
    with pytest.raises(ValueError, match="not_finished"):
        complete_room_series(room, engine)


@pytest.mark.parametrize("count", (2, 3, 4))
def test_public_score_notebook_replays_scored_rounds_without_calls_cards_or_invented_times(count):
    _room, engine = completed(count)
    history = public_score_history(engine)
    assert len(history) == len(engine.ledger.applied_results)
    assert [item["round"] for item in history] == list(range(1, len(history) + 1))
    assert [item["points"] for item in history] == [result.points for result in engine.ledger.applied_results]
    assert history[-1]["scores"] == [{"seats": [engine.recipe.seats.index(player) for player in account.members],
                                      "points": account.points} for account in engine.ledger.accounts]
    encoded = json.dumps(history)
    assert all(private not in encoded for private in ("strike", "trump", "card", "timestamp", "account_id"))


def test_public_score_notebook_explicitly_records_retourschneider_erasure_before_the_comeback():
    from tests.test_watten_progression import retourschneider_state

    engine = retourschneider_state()
    history = public_score_history(engine)
    reset = next(item for item in history if item["retourschneider_reset"] is not None)
    assert reset["round"] == 2 and reset["retourschneider_reset"] == {"seats": [1, 3], "erased_points": 2}
    assert next(score["points"] for score in reset["scores"] if score["seats"] == [1, 3]) == 0
    assert next(score["points"] for score in history[-1]["scores"] if score["seats"] == [1, 3]) == 12
    assert public_score_history(None) == []
