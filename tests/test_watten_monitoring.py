"""Closed-product dashboard capability, truthful native facts and no game secrets."""

import asyncio
import json
from dataclasses import replace
from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from sqlalchemy import event, select
from starlette.testclient import TestClient

from app.analytics import AnalyticsEvent, AnalyticsSession, dashboard_stats
from app.api_analytics import router
from app.auth import logout
from app.database import get_engine, session_scope
from app.game_ws_session import GameSocketSession
from app.models import CompletedGame, User, WattenMatchEvidence
from app.ownership import bind_founder, grant_ownership
from app.security import utcnow
from app.watten_results import store_result_in_session
from app.watten_runtime import persist_watten_game
from app.watten_websocket import handle_watten_gameplay_action
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch

server = native.server


@pytest.fixture
def monitoring(server):
    founder = native.account("MonitoringFounder", role="admin")
    human = native.account("MonitoringHuman")
    delegate = native.account("MonitoringDelegate")
    owner = native.account("MonitoringOwner", role="admin")
    with session_scope() as db:
        bind_founder(db, founder[0].user_id)
        grant_ownership(db, owner[0].user_id, founder[0].user_id)
        db.get(User, delegate[0].user_id).analytics_access = True
        db.get(User, owner[0].user_id).analytics_access = True
    app = FastAPI()
    app.include_router(router)
    with TestClient(app, base_url=native.LOCAL) as client:
        yield client, (founder, human, delegate, owner)


def request(monitoring, actor=0, game="all", *, headers=None):
    client, accounts = monitoring
    return client.get(f"/api/admin/analytics?days=7&game={game}", headers={
        "Cookie": accounts[actor][1], **(headers or {})})


def complete(game_id, *, previous=False, frozen=True):
    now = utcnow()
    match = NativeMatch(2, target=3, game_id=game_id)
    match.ready()
    match.finish()
    end = now - timedelta(days=8) if previous else now - timedelta(seconds=5)
    match.game["_finished_at"] = end.isoformat()
    match.game["_started_at"] = (end - timedelta(seconds=125)).isoformat()
    if frozen:
        persist_watten_game(match.game, creating=True)
    else:
        with session_scope() as db:
            store_result_in_session(db, match.game)
    return match


def public_result(game_id, *, previous=False):
    now = utcnow()
    end = now - timedelta(days=8) if previous else now - timedelta(minutes=5)
    with session_scope() as db:
        db.add(CompletedGame(game_id=game_id, game_type="zdwa", game_name="PRIVATE_TABLE_NAME",
                             finished_at=end, mode="2", hardcore=False, snapshot_json='{"duration_seconds":90}',
                             created_at=end))


def test_current_previous_and_all_filters_never_grant_delegates_or_nonfounder_owners_native_facts(monitoring):
    complete("native-current", frozen=True)
    complete("native-legacy", frozen=False)
    complete("native-previous", previous=True, frozen=False)
    public_result("public-current")
    public_result("public-previous", previous=True)
    for actor in (2, 3):
        response = request(monitoring, actor)
        assert response.status_code == 200
        value = response.json()
        assert value["available_games"] == ["zdwa", "zilch"]
        assert value["overview"]["completed_games"] == 1
        assert value["comparison"]["overview"]["completed_games"]["previous"] == 1
        assert sum(day["completed_games"] for day in value["daily"]) == 1
        assert "watten" not in response.text and "PRIVATE" not in response.text
        assert request(monitoring, actor, "watten").status_code == 403
    founder = request(monitoring).json()
    assert founder["available_games"] == ["zdwa", "zilch", "hausdepp", "watten"]
    assert founder["overview"]["completed_games"] == 3
    assert founder["comparison"]["overview"]["completed_games"]["previous"] == 2
    assert founder["metric_coverage"]["traffic_games"] == ["zdwa", "zilch", "hausdepp"]
    assert "PRIVATE" not in json.dumps(founder)


@pytest.mark.parametrize("gate", ("flag", "configured_origin", "raw_host", "fixed_watten_host"))
def test_founder_capability_requires_current_game_flag_configured_local_origin_and_raw_local_host(monitoring, monkeypatch, gate):
    complete("gated-native", frozen=False)
    headers = {}
    if gate == "flag":
        monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    elif gate == "configured_origin":
        monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    elif gate == "raw_host":
        headers["Host"] = "attacker.invalid"
    else:
        headers["Host"] = "watten.zockdiewandan.online"
    response = request(monitoring, headers=headers)
    assert response.status_code == 200
    assert "watten" not in response.text
    assert response.json()["overview"]["completed_games"] == 0
    assert request(monitoring, game="watten", headers=headers).status_code == 403


def test_capability_rechecks_real_founder_binding_instead_of_a_stale_identity_flag_and_shared_grant(monitoring):
    assert request(monitoring, game="watten").status_code == 200
    stale = replace(monitoring[1][2][0], is_founder=True)
    with patch("app.api_analytics.require_user", return_value=stale):
        response = request(monitoring, 2)
        assert response.status_code == 200 and "watten" not in response.text
        assert request(monitoring, 2, game="watten").status_code == 403
    with session_scope() as db:
        db.get(User, stale.user_id).analytics_access = False
    assert request(monitoring, 2).status_code == 403
    logout(monitoring[1][0][1].split("=", 1)[1])
    assert request(monitoring, game="watten").status_code == 401


def test_native_traffic_and_abandonments_are_unknown_not_fabricated_zero_even_with_forged_telemetry(monitoring):
    complete("unmeasured-native", frozen=False)
    now = utcnow()
    with session_scope() as db:
        db.add(AnalyticsSession(id="a" * 64, first_seen_at=now, last_seen_at=now, device="desktop", referrer="direct", country="CH"))
        db.flush()
        db.add(AnalyticsEvent(dedupe_key="b" * 64, session_id="a" * 64, received_at=now,
                              event_type="action", page="PRIVATE_HAND_CALL_PARTNER_FEEDBACK", game="watten",
                              action="PRIVATE_CALL", active_ms=9999, source="client"))
    value = request(monitoring, game="watten").json()
    assert value["overview"]["completed_games"] == 1
    for key in ("sessions", "page_views", "active_seconds", "avg_active_seconds", "game_clicks", "live_sessions"):
        assert value["overview"][key] is None
    previous = value["comparison"]["overview"]["sessions"]
    assert previous == {"current": None, "previous": None, "delta": None, "change_percent": None}
    assert value["metric_coverage"]["traffic"] == "not_instrumented"
    assert value["metric_coverage"]["traffic_games"] == []
    assert value["geography_summary"]["sessions"] is None
    assert value["pwa"]["confirmed_installations"] is None
    assert value["journeys"]["sample"]["total_page_views"] is None
    assert value["pages"] == value["actions"] == value["geography"] == []
    assert all(row["sessions"] is None for row in value["daily"])
    assert all(row["page_views"] is None for row in value["hourly"])
    assert all(row["sessions"] is None for row in value["heatmap"])
    assert value["games"][0]["abandoned_games"] is None
    assert value["games"][0]["abandonments_source"] == "unavailable"
    assert value["games"][0]["avg_duration_seconds"] is None
    assert "PRIVATE" not in json.dumps(value)
    for actor in (0, 2):
        assert "PRIVATE" not in request(monitoring, actor).text


def test_native_comparison_never_inherits_legacy_traffic_coverage_or_retention_date(monitoring):
    complete("native-comparison-current", frozen=False)
    complete("native-comparison-previous", previous=True, frozen=False)
    old = utcnow() - timedelta(days=30)
    with session_scope() as db:
        db.add(AnalyticsSession(id="c" * 64, first_seen_at=old, last_seen_at=old,
                                device="desktop", referrer="direct", country="CH"))
        db.flush()
        db.add(AnalyticsEvent(dedupe_key="d" * 64, session_id="c" * 64, received_at=old,
                              event_type="page_view", page="/", game="zdwa", action="", source="client"))
    comparison = request(monitoring, game="watten").json()["comparison"]
    assert comparison["previous_data_coverage"] == "not_instrumented"
    assert comparison["coverage_basis"] == "not_instrumented"
    assert comparison["traffic_retained_from"] is None
    assert comparison["overview"]["completed_games"] == {
        "current": 1, "previous": 1, "delta": 0, "change_percent": 0.0}
    # The existing products still describe their genuinely retained traffic.
    legacy = request(monitoring, game="zdwa").json()["comparison"]
    assert legacy["previous_data_coverage"] == "complete"
    assert legacy["coverage_basis"] == "earliest_retained_event"
    assert legacy["traffic_retained_from"] == old.isoformat()


def test_duration_uses_actual_frozen_writer_evidence_keeps_result_v1_unchanged_and_read_has_no_writes(monitoring):
    actual = complete("real-duration")
    complete("legacy-duration", frozen=False)
    with session_scope() as db:
        original = db.scalar(select(CompletedGame.snapshot_json).where(CompletedGame.game_id == "real-duration"))
        assert "started_at" not in json.loads(original)
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    event.listen(get_engine(), "before_cursor_execute", capture)
    try:
        value = dashboard_stats(7, "watten", include_watten=True)
    finally:
        event.remove(get_engine(), "before_cursor_execute", capture)
    row = value["games"][0]
    assert row["completed_games"] == 2
    assert row["avg_duration_seconds"] == 125 and row["duration_sample_count"] == 1
    assert row["duration_sample_limit"] == 2000
    assert row["duration_unknown_count"] == 1 and not row["duration_sample_truncated"]
    assert row["participants_scope"] == "recorded_seats_including_cpus"
    assert not any(statement.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE")) for statement in statements)
    assert not any("active_games" in statement.lower() for statement in statements)
    assert actual.game["_watten_result"] == json.loads(original)


@pytest.mark.parametrize("damage", ("unknown_start", "wrong_finish", "wrong_game", "changed_result", "hidden_evidence"))
def test_malformed_or_unrelated_evidence_cannot_invent_a_duration(monitoring, damage):
    complete("corrupt-duration")
    with session_scope() as db:
        proof = db.get(WattenMatchEvidence, "corrupt-duration")
        evidence = json.loads(proof.evidence_json)
        if damage == "unknown_start":
            evidence["started_at"] = "unknown"
        elif damage == "wrong_finish":
            evidence["finished_at"] = (utcnow() - timedelta(days=1)).isoformat()
        elif damage == "wrong_game":
            evidence["game_id"] = "other-native-game"
        elif damage == "changed_result":
            db.scalar(select(CompletedGame).where(CompletedGame.game_id == "corrupt-duration")).snapshot_json = '{"duration_seconds":777}'
        else:
            evidence["hand"] = ["PRIVATE_CARD"]
        proof.evidence_json = json.dumps(evidence)
    value = request(monitoring, game="watten").json()
    assert value["games"][0]["avg_duration_seconds"] is None
    assert value["games"][0]["duration_sample_count"] == 0
    assert value["overview"]["completed_games"] == 1
    assert "PRIVATE" not in json.dumps(value)


def test_native_live_counts_deduplicate_bound_accounts_and_ignore_cpus_spectators_and_revoked_sockets(monitoring):
    accounts = monitoring[1]
    first = NativeMatch(2, cpus=(1,), game_id="native-one")
    second = NativeMatch(2, game_id="native-two")
    for match in (first, second):
        for player in match.game["_players"]:
            player["ws"] = native.CapturingSocket(accounts[player["user_id"] - 1])
        native.games[match.game["_id"]] = match.game
    # A second device for the same canonical person is not a second human.
    second.game["_players"].append({**second.game["_players"][0], "ws": native.CapturingSocket(accounts[0])})
    cpu = first.runtime.room.cpus[0]
    first.game["_players"].append({"id": cpu.participant_id, "user_id": accounts[2][0].user_id,
                                  "ws": native.CapturingSocket(accounts[2])})
    spectator = GameSocketSession(native.CapturingSocket(accounts[2]), first.game, accounts[2][0])
    asyncio.run(handle_watten_gameplay_action(spectator, "spectate_game", {"action": "spectate_game"}))
    native.games["old-public"] = {"_game_type": "zdwa", "_started": True, "_players": [{"ws": object()}]}
    value = request(monitoring, game="watten").json()
    live = value["games"][0]["live"]
    assert live == {"active_tables": 2, "playing_tables": 2, "waiting_tables": 0, "connected_humans": 2,
                    "cpu_seats": 1, "active_tournaments": None, "interround_tables": None, "paused_tables": 0}
    assert value["server"]["players_online"] == 2
    assert "MonitoringHuman" not in json.dumps(value) and "p1" not in json.dumps(value)
    delegated = request(monitoring, 2).json()
    assert delegated["server"]["active_rooms"] == delegated["server"]["players_online"] == 1
    logout(accounts[1][1].split("=", 1)[1])
    assert request(monitoring, game="watten").json()["server"]["players_online"] == 1


def test_unknown_live_native_source_is_null_instead_of_an_underreported_zero(monitoring):
    native.games["malformed-native"] = {"_game_type": "watten", "_players": [], "_watten": None}
    value = request(monitoring, game="watten").json()
    assert value["server"]["players_online"] is value["server"]["active_rooms"] is None
    assert all(item is None for item in value["games"][0]["live"].values())
    assert "watten" not in request(monitoring, 2).text
