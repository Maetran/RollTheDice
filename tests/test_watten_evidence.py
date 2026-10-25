"""Public evidence and relational authority, without awarding any progression."""

import json
from copy import deepcopy
from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timedelta, timezone
from itertools import count
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.database import session_scope
from app.game_state import games
from app.models import CompletedGame, User
from app.watten_engine import SeatBinding, next_deal, retourschneider_decider, retourschneider_offer, start_match
from app.watten_evidence import (
    UNKNOWN,
    BidEvidence,
    PlayerBids,
    ProjectedBinding,
    PublicProfile,
    WattenEvidenceError,
    adapt_result_v1,
    evidence_from_json,
    evidence_from_payload,
    evidence_to_json,
    evidence_to_payload,
    validate_membership,
    validate_result_v1,
)
from app.watten_play import legal_cards
from app.watten_results import result_payload
from app.watten_runtime import apply_runtime_action, persist_watten_game
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_engine import dealt, finish, ready, recipe, step

server = runtime_tests.server
FINISHED = datetime(2026, 10, 18, 22, 30, tzinfo=timezone.utc)


def native_result(count_players=2, *, cpus=(), target=3):
    original = recipe(count_players, target_points=target)
    bindings = tuple(SeatBinding(item.player_id, None if index in cpus else item.account_id)
                     for index, item in enumerate(original.bindings))
    state = start_match(replace(original, bindings=bindings), "deal-0", dealt(count_players), first_dealer="A")
    for number in range(20):
        state = finish(ready(state))
        if state.phase == "match_complete":
            break
        candidate = retourschneider_offer(state)
        if candidate is not None:
            state = step(state, retourschneider_decider(state, candidate), "retourschneider", "decline")
        state = next_deal(state, f"deal-{number + 1}", dealt(count_players))
    assert state.phase == "match_complete"
    return state, result_for(state)


def result_for(state):
    runtime = SimpleNamespace(engine=state, names=tuple((player, f"Historic {player}") for player in state.recipe.seats))
    return result_payload({"_id": "evidence-match", "_watten": runtime})


def public_evidence(payload):
    old = adapt_result_v1(payload, finished_at=FINISHED)
    profile = PublicProfile("watten-house", 1, "normal", False, False, False, False, False)
    return replace(old, source="public_match_v1", profile=profile, started_at=FINISHED - timedelta(minutes=10))


def bindings_for(evidence):
    result = []
    for player in evidence.roster:
        score_index, score = next((index, score) for index, score in enumerate(evidence.scores)
                                  if player.player_id in score.members)
        result.append(ProjectedBinding(evidence.game_id, player.seat, player.player_id, player.name,
                                       None if player.is_cpu else player.seat + 1, score.points,
                                       str(score_index) if evidence.player_count == 4 else None))
    return tuple(result)


@pytest.mark.parametrize("count_players,cpus", ((2, ()), (3, (1,)), (4, (1,)), (4, (3,)), (4, (1, 3))))
def test_actual_engine_writer_v1_stays_exact_and_missing_evidence_is_unknown(count_players, cpus):
    state, payload = native_result(count_players, cpus=cpus)
    original = deepcopy(payload)
    copied = validate_result_v1(payload)
    evidence = adapt_result_v1(payload, finished_at=FINISHED)
    assert copied == original == payload == result_for(state)
    copied["participants"][0]["name"] = "Changed copy"
    assert payload == original
    assert evidence.profile is UNKNOWN and evidence.started_at is UNKNOWN
    assert evidence.bids == BidEvidence() and not evidence.bids.complete
    encoded = evidence_to_payload(evidence)
    assert encoded["profile"] == encoded["started_at"] == encoded["bids"]["completeness"] == "unknown"
    assert encoded["bids"]["players"] == []
    assert evidence_from_json(evidence_to_json(evidence)) == evidence
    assert [player.is_cpu for player in evidence.roster] == [index in cpus for index in range(count_players)]
    assert "user_id" not in evidence_to_json(evidence) and "account_id" not in evidence_to_json(evidence)
    with pytest.raises(FrozenInstanceError):
        evidence.roster[0].name = "Cannot mutate"


def scored_go(state, winning_party, points):
    """Use real accepted bid/response commands, never fabricate scored ledgers."""
    state = ready(state)
    starter = winning_party ^ ((points - 2) % 2)
    for _ in range(len(state.recipe.seats) + 1):
        player = state.play.current_player_id
        if state.play.plays and state.parties.party_of(player) == starter:
            break
        state = step(state, player, "play_card", legal_cards(state.play, state.bid_state, player)[0])
    state = step(state, state.play.current_player_id, "bid")
    for _ in range(points - 2):
        decider = state.parties.decider(1 - state.bid_state.pending.party)
        state = step(state, decider, "respond", "counter")
    assert state.bid_state.pending.party == winning_party
    return step(state, state.parties.decider(1 - winning_party), "respond", "go")


def co_winner_result():
    state = start_match(recipe(3, target_points=6), "co-0", dealt(3), first_dealer="A")
    for index, points in enumerate((2, 3, 4)):
        state = scored_go(state, 0, points)
        if index < 2:
            state = next_deal(state, f"co-{index + 1}", dealt(3))
    assert state.phase == "match_complete" and state.ledger.winners == (("B",), ("C",))
    return result_for(state)


def test_three_player_co_winners_come_from_all_target_accounts_including_unequal_scores():
    evidence = adapt_result_v1(co_winner_result(), finished_at=FINISHED)
    assert [(item.members, item.points) for item in evidence.scores] == [(("A",), 5), (("B",), 7), (("C",), 6)]
    assert evidence.winners == (("B",), ("C",))
    assert not validate_membership(evidence, viewer_user_id=1, bindings=bindings_for(evidence)).won
    assert validate_membership(evidence, viewer_user_id=2, bindings=bindings_for(evidence)).won
    assert validate_membership(evidence, viewer_user_id=3, bindings=bindings_for(evidence)).won


def test_four_player_winning_team_preserves_both_members_and_cpu_never_receives_membership():
    _state, payload = native_result(4, cpus=(1, 3))
    evidence = adapt_result_v1(payload, finished_at=FINISHED)
    assert len(evidence.winners) == 1 and len(evidence.winners[0]) == 2
    for user_id in (1, 3):
        membership = validate_membership(evidence, viewer_user_id=user_id, bindings=bindings_for(evidence))
        assert membership.won == (membership.player_id in evidence.winners[0])
    forged = tuple(replace(item, user_id=2) if item.position == 1 else item for item in bindings_for(evidence))
    with pytest.raises(WattenEvidenceError, match="membership"):
        validate_membership(evidence, viewer_user_id=2, bindings=forged)


def test_future_evidence_has_explicit_public_profile_time_and_complete_bid_commands():
    state = start_match(recipe(2, target_points=3), "high-stake", dealt(2), first_dealer="A")
    state = scored_go(state, 0, 12)  # no fabricated uncalled stake ceiling
    evidence = public_evidence(result_for(state))
    counts = BidEvidence(True, (PlayerBids("A", 1, 5, 0, 0), PlayerBids("B", 0, 5, 0, 1)))
    evidence = replace(evidence, bids=counts)
    assert evidence.deals[0].points == 12
    assert evidence_from_payload(evidence_to_payload(evidence)) == evidence
    assert evidence_from_json(evidence_to_json(evidence)) == evidence
    with pytest.raises(WattenEvidenceError):
        replace(evidence, bids=BidEvidence(True, (PlayerBids("A", 0, 0, 0, 0), PlayerBids("B", 0, 0, 0, 0))))
    with pytest.raises(WattenEvidenceError):
        replace(evidence, source="result_v1")


@pytest.mark.parametrize("finished,day", (
    (datetime(2026, 1, 18, 23, 30, tzinfo=timezone.utc), "2026-01-19"),
    (datetime(2026, 7, 18, 22, 30, tzinfo=timezone.utc), "2026-07-19"),
    (datetime(2026, 10, 25, 0, 30, tzinfo=timezone.utc), "2026-10-25"),
    (datetime(2026, 10, 25, 1, 30, tzinfo=timezone.utc), "2026-10-25"),
))
def test_swiss_completion_calendar_is_explicit_and_dst_aware(finished, day):
    _state, result = native_result()
    assert adapt_result_v1(result, finished_at=finished).play_day == day


@pytest.mark.parametrize("damage", (
    "extra_private", "roster_private", "deal_private", "duplicate_player", "duplicate_deal", "bool_score",
    "bool_points", "wrong_sum", "wrong_winner", "missing_winner", "extra_after_finish", "duplicate_party",
    "bad_partition", "wrong_three_rotation", "fake_cpu", "unknown_version", "unknown_match_field",
))
def test_malformed_legacy_results_cannot_become_evidence(damage):
    payload = deepcopy(co_winner_result())
    if damage == "extra_private":
        payload["stock"] = []
    elif damage == "roster_private":
        payload["participants"][0]["account_id"] = 1
    elif damage == "deal_private":
        payload["match"]["deals"][0]["call"] = {"strike": "7"}
    elif damage == "duplicate_player":
        payload["participants"][1]["id"] = "A"
    elif damage == "duplicate_deal":
        payload["match"]["deals"][1]["deal_id"] = payload["match"]["deals"][0]["deal_id"]
    elif damage == "bool_score":
        payload["match"]["scores"][0]["points"] = True
    elif damage == "bool_points":
        payload["match"]["deals"][0]["points"] = True
    elif damage == "wrong_sum":
        payload["match"]["scores"][0]["points"] += 1
    elif damage == "wrong_winner":
        payload["match"]["winners"] = [["A"]]
    elif damage == "missing_winner":
        payload["match"]["winners"] = [["B"]]
    elif damage == "extra_after_finish":
        extra = deepcopy(payload["match"]["deals"][-1])
        extra["deal_id"] = "post-terminal"
        extra["parties"] = [["A", "C"], ["B"]]
        payload["match"]["deals"].append(extra)
    elif damage == "duplicate_party":
        payload["match"]["deals"][0]["parties"] = [["A", "A"], ["B"]]
    elif damage == "bad_partition":
        payload["match"]["deals"][0]["parties"] = [["A", "D"], ["B"]]
    elif damage == "wrong_three_rotation":
        payload["match"]["deals"][1]["parties"] = [["A", "C"], ["B"]]
    elif damage == "fake_cpu":
        for item in payload["participants"]:
            item["is_cpu"] = True
    elif damage == "unknown_version":
        payload["schema_version"] = True
    else:
        payload["match"]["bids"] = 0
    with pytest.raises(ValueError):
        validate_result_v1(payload)


@pytest.mark.parametrize("damage", (
    "private_root", "private_profile", "private_feedback", "unknown_ruleset", "unknown_version", "bool_count",
    "wrong_day", "wrong_zone", "naive_time", "offset_time", "reversed_time", "partial_unknown_bids",
    "forged_zero_bids", "unknown_source", "unknown_start", "unknown_profile",
))
def test_strict_new_codec_rejects_private_unknown_and_inconsistent_fields(damage):
    payload = evidence_to_payload(public_evidence(co_winner_result()))
    if damage == "private_root":
        payload["cpu_memories"] = []
    elif damage == "private_profile":
        payload["profile"]["trump_suit"] = "bells"
    elif damage == "private_feedback":
        payload["bids"]["feedback"] = "good"
    elif damage == "unknown_ruleset":
        payload["profile"]["ruleset_version"] = 99
    elif damage == "unknown_version":
        payload["schema_version"] = 2
    elif damage == "bool_count":
        payload["player_count"] = True
    elif damage == "wrong_day":
        payload["play_day"] = "2026-10-18"
    elif damage == "wrong_zone":
        payload["play_day_zone"] = "UTC"
    elif damage == "naive_time":
        payload["finished_at"] = "2026-10-18T22:30:00"
    elif damage == "offset_time":
        payload["finished_at"] = "2026-10-19T00:30:00+02:00"
    elif damage == "reversed_time":
        payload["started_at"] = "2027-01-01T00:00:00+00:00"
    elif damage == "partial_unknown_bids":
        payload["bids"]["players"] = [{"id": "A", "initiated": 0, "countered": 0, "held": 0, "went": 0}]
    elif damage == "forged_zero_bids":
        payload["bids"] = {"completeness": "complete", "players": [
            {"id": player, "initiated": 0, "countered": 0, "held": 0, "went": 0} for player in "ABC"]}
    elif damage == "unknown_source":
        payload["source"] = "live_checkpoint"
    elif damage == "unknown_start":
        payload["started_at"] = "unknown"
    else:
        payload["profile"] = "unknown"
    with pytest.raises(WattenEvidenceError):
        evidence_from_payload(payload)


@pytest.mark.parametrize("damage", ("duplicate", "nan", "infinity", "array", "not_text"))
def test_json_rejects_duplicate_nonfinite_or_wrong_shapes(damage):
    _state, result = native_result()
    text = evidence_to_json(adapt_result_v1(result, finished_at=FINISHED))
    if damage == "duplicate":
        text = text.replace('"schema_version":1', '"schema_version":1,"schema_version":1')
    elif damage in {"nan", "infinity"}:
        text = text.replace('"target_points":3', f'"target_points":{"NaN" if damage == "nan" else "Infinity"}')
    elif damage == "array":
        text = "[]"
    else:
        text = None
    with pytest.raises(WattenEvidenceError):
        evidence_from_json(text)


@pytest.mark.parametrize("damage", (
    "outsider", "bool_viewer", "duplicate_account", "missing", "wrong_id", "wrong_name", "wrong_points",
    "wrong_game", "duplicate_position", "wrong_team", "cpu_account",
))
def test_full_relational_roster_is_required_before_private_membership(damage):
    _state, payload = native_result(4, cpus=(3,))
    evidence = adapt_result_v1(payload, finished_at=FINISHED)
    bindings, viewer = bindings_for(evidence), 1
    if damage == "outsider":
        viewer = 999
    elif damage == "bool_viewer":
        viewer = True
    elif damage == "duplicate_account":
        bindings = (bindings[0], replace(bindings[1], user_id=1), *bindings[2:])
    elif damage == "missing":
        bindings = bindings[:-1]
    else:
        values = {"wrong_id": {"player_id": "forged"}, "wrong_name": {"display_name": "New username"},
                  "wrong_points": {"points": 999}, "wrong_game": {"game_id": "other-match"},
                  "duplicate_position": {"position": 0}, "wrong_team": {"team": "1"},
                  "cpu_account": {"user_id": 987}}[damage]
        index = 3 if damage == "cpu_account" else 2
        bindings = tuple(replace(item, **values) if position == index else item for position, item in enumerate(bindings))
    with pytest.raises(WattenEvidenceError, match="membership"):
        validate_membership(evidence, viewer_user_id=viewer, bindings=bindings)


def test_actual_completed_writer_row_and_deleted_human_keep_the_original_result_v1(server):
    game_id, owners, sessions = runtime_tests.local_started(server, count_players=2)
    game, numbers = games[game_id], count()
    accounts = {session.player_id: owner[0].user_id for session, owner in zip(sessions, owners)}
    for _ in range(300):
        state = game["_watten"].engine
        if state.phase == "match_complete":
            break
        if state.phase == "deal_complete":
            player = sessions[0].player_id
            command = runtime_tests.room_command(game_id, "watten_next_deal", next(numbers),
                                                 deal_id=state.deal_id, opportunity=state.opportunity)
        else:
            player, command = runtime_tests.next_move(game_id, numbers)
        candidate, *_ = apply_runtime_action(game, accounts[player], player, command)
        game.update(candidate)
    assert game["_watten"].engine.phase == "match_complete"
    with session_scope() as db:
        db.delete(db.get(User, owners[1][0].user_id))
    persist_watten_game(game)
    original = deepcopy(game["_watten_result"])
    with session_scope() as db:
        row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game_id))
        evidence = adapt_result_v1(json.loads(row.snapshot_json), finished_at=row.finished_at.replace(tzinfo=timezone.utc))
        bindings = tuple(ProjectedBinding(row.game_id, item.position, item.player_key, item.display_name,
                                          item.user_id, item.points, item.team) for item in row.participants)
    assert not evidence.roster[1].is_cpu and bindings[1].user_id is None
    assert validate_membership(evidence, viewer_user_id=owners[0][0].user_id, bindings=bindings).seat == 0
    with pytest.raises(WattenEvidenceError, match="membership"):
        validate_membership(evidence, viewer_user_id=owners[1][0].user_id, bindings=bindings)
    persist_watten_game(game)  # existing exact v1 retry contract is unaffected
    assert game["_watten_result"] == original == result_payload(game)
    with pytest.raises(WattenEvidenceError):
        adapt_result_v1(original, finished_at=FINISHED.replace(tzinfo=None))


@pytest.mark.parametrize("fields", ({"user_id": True}, {"position": True}, {"points": True}, {"team": []}))
def test_plain_projected_bindings_reject_wrong_types_before_membership(fields):
    _state, payload = native_result()
    binding = bindings_for(adapt_result_v1(payload, finished_at=FINISHED))[0]
    with pytest.raises(WattenEvidenceError):
        replace(binding, **fields)
