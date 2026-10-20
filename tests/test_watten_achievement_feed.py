"""Persisted public labels only, with verified sources and no GET mutations."""

import json
from dataclasses import replace
from types import SimpleNamespace

import pytest
from sqlalchemy import event, select

from app import watten_achievement_feed as feed
from app.database import get_engine, session_scope
from app.models import (
    GameParticipant,
    HausdeppAchievementUnlock,
    User,
    WattenAchievementGrant,
    WattenMatchEvidence,
    WattenProgressState,
)
from app.watten_engine import SeatBinding, next_deal, start_match
from app.watten_progression import DRAFT_CATALOG_VERSION
from app.watten_progression_store import store_draft_match
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_engine import dealt, recipe
from tests.test_watten_evidence import FINISHED, scored_go
from tests.test_watten_progression_store import JOURNAL_MODELS, game_for, written

server = runtime_tests.server


def persist_own(db, owner, game_id):
    row, evidence, bindings = written(db, game_for([owner], game_id=game_id, cpus=(1,)))
    store_draft_match(db, row, evidence, bindings)
    return row


def snapshot(db):
    return tuple(tuple(db.execute(select(model.__table__))) for model in JOURNAL_MODELS)


def test_exact_public_allowlist_frozen_xp_bilingual_labels_current_title_and_no_get_writes(server):
    owners = [runtime_tests.account(name) for name in ("FeedOwner", "FeedOther")]
    with session_scope() as db:
        for index, owner in enumerate(owners):
            persist_own(db, owner, f"PRIVATE-SOURCE-{index}")
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == owners[0][0].user_id,
                                                              WattenAchievementGrant.achievement_id == "watten_matches_1"))
        grant.xp = 73  # historical frozen amount, not the current catalog's ten
        db.add(HausdeppAchievementUnlock(user_id=owners[0][0].user_id, achievement_id="hausdepp_01", unlocked_at=FINISHED,
                                        source_game_id="FOREIGN-GAME-SOURCE", awarded_points=999))
        db.flush()
        before = snapshot(db)
    result = feed.build_watten_achievement_feed(owners[0][0].user_id)
    assert result["status"] == "draft" and result["game_type"] == "watten" and result["coverage"] == {"complete": True}
    assert len(result["entries"]) == 6
    own = next(item for item in result["entries"] if item["player"]["is_self"] and item["achievement"]["id"] == "watten_matches_1")
    assert own["achievement"]["actual_xp"] == 73 and own["player"]["title"]["threshold"] == 90
    for entry in result["entries"]:
        assert set(entry) == {"reached_at", "player", "achievement"}
        assert set(entry["player"]) == {"display_name", "is_self", "title"}
        assert set(entry["achievement"]) == {"id", "name", "description", "actual_xp", "catalog_version", "archived"}
        assert set(entry["achievement"]["name"]) == set(entry["achievement"]["description"]) == {"de", "en"}
    encoded = json.dumps(result)
    assert all(value not in encoded for value in ('"user_id"', '"game_id"', '"source_game_id"', '"generation"',
        '"roster"', '"profile"', '"hands"', '"stock"', '"bindings"', '"call"', "PRIVATE-SOURCE", "FOREIGN-GAME", "hausdepp_01", "Seppl"))
    with session_scope() as db:
        assert snapshot(db) == before


def test_deleted_inactive_old_generation_and_uncredited_accounts_do_not_appear_and_renames_are_current(server):
    owners = [runtime_tests.account(name) for name in ("OldFeedName", "DeletedFeedName", "InactiveFeedName", "NoGrants")]
    with session_scope() as db:
        for index, owner in enumerate(owners[:3]):
            persist_own(db, owner, f"visibility-{index}")
        written(db, game_for([owners[3]], game_id="uncredited-private", cpus=(1,)))
        db.get(User, owners[0][0].user_id).username = "CurrentFeedName"
        db.delete(db.get(User, owners[1][0].user_id))
        db.get(User, owners[2][0].user_id).is_active = False
    result = feed.build_watten_achievement_feed(owners[0][0].user_id)
    assert {item["player"]["display_name"] for item in result["entries"]} == {"CurrentFeedName"}
    assert result["pagination"]["total_entries"] == 3
    with session_scope() as db:
        db.get(WattenProgressState, owners[0][0].user_id).generation = 2  # future-epoch fixture; no reset API
    assert feed.build_watten_achievement_feed(owners[0][0].user_id)["entries"] == []


def test_page_order_is_stable_on_ties_and_each_account_is_verified_once_per_page(server, monkeypatch):
    owners = [runtime_tests.account(f"TieFeed{index}") for index in range(3)]
    with session_scope() as db:
        for index, owner in enumerate(owners):
            persist_own(db, owner, f"tie-private-{index}")
    seen, actual = [], feed._progress

    def once(db, account, matches):
        seen.append(account)
        return actual(db, account, matches)

    monkeypatch.setattr(feed, "_progress", once)
    full = feed.build_watten_achievement_feed(owners[0][0].user_id, limit=30)
    assert sorted(seen) == sorted(owner[0].user_id for owner in owners)
    seen.clear()
    first = feed.build_watten_achievement_feed(owners[0][0].user_id, limit=2)
    assert first == feed.build_watten_achievement_feed(owners[0][0].user_id, limit=2)
    keys = []
    for page in range(1, 6):
        result = feed.build_watten_achievement_feed(owners[0][0].user_id, page=page, limit=2)
        keys.extend((item["player"]["display_name"], item["achievement"]["id"], item["reached_at"]) for item in result["entries"])
        assert result["pagination"]["total_entries"] == 9
        assert result["pagination"]["has_next"] is (page < 5)
    assert len(keys) == len(set(keys)) == len(full["entries"]) == 9
    assert feed.build_watten_achievement_feed(owners[0][0].user_id, page=10**30)["entries"] == []


@pytest.mark.parametrize("damage", ("foreign_source", "forged_roster", "corrupt_freeze"))
def test_grant_does_not_authorize_a_foreign_or_corrupt_source_by_itself(server, damage):
    owner, other = runtime_tests.account("SourceFeed"), runtime_tests.account("OtherSourceFeed")
    with session_scope() as db:
        own_row = persist_own(db, owner, "own-private-source")
        persist_own(db, other, "other-private-source")
        if damage == "foreign_source":
            db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == owner[0].user_id)).source_game_id = "other-private-source"
        elif damage == "forged_roster":
            db.scalar(select(GameParticipant).where(GameParticipant.game_id == own_row.id, GameParticipant.position == 1)).user_id = owner[0].user_id
        else:
            db.get(WattenMatchEvidence, own_row.game_id).evidence_json = '{"private_profile":"never expose"}'
    with pytest.raises(feed.WattenAchievementFeedError, match="invalid_source"):
        feed.build_watten_achievement_feed(owner[0].user_id, limit=30)


def test_unknown_archived_achievement_keeps_actual_xp_without_inventing_a_condition(server):
    owner = runtime_tests.account("ArchivedFeed")
    with session_scope() as db:
        persist_own(db, owner, "archived-private")
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.achievement_id == "watten_matches_1"))
        grant.achievement_id, grant.xp = "PRIVATE-UNRECOGNIZED-ID", 37
    entry = next(item for item in feed.build_watten_achievement_feed(owner[0].user_id)["entries"] if item["achievement"]["archived"])
    assert entry["achievement"]["actual_xp"] == 37 and entry["achievement"]["id"] == "archived"
    assert "PRIVATE-UNRECOGNIZED-ID" not in json.dumps(entry)
    assert entry["achievement"]["name"]["en"] == "Stored Watten achievement"
    assert "not part" in entry["achievement"]["description"]["en"]


def test_real_three_player_co_winner_sources_and_both_four_player_team_grants_are_validated(server):
    owners = [runtime_tests.account(f"WinnerFeed{index}") for index in range(4)]
    original = recipe(3, target_points=6)
    bindings = tuple(SeatBinding(player, owners[index][0].user_id) for index, player in enumerate("ABC"))
    state = start_match(replace(original, bindings=bindings), "co-0", dealt(3), first_dealer="A")
    for index, points in enumerate((2, 3, 4)):
        state = scored_go(state, 0, points)
        if index < 2:
            state = next_deal(state, f"co-{index + 1}", dealt(3))
    assert state.ledger.winners == (("B",), ("C",))
    game = {"_id": "secret-three", "_name": "Private", "_mode": "3", "_finished_at": FINISHED.isoformat(),
            "_watten": SimpleNamespace(engine=state, names=tuple((player, owners[index][0].username) for index, player in enumerate("ABC")))}
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        store_draft_match(db, row, evidence, bindings)
        row, evidence, bindings = written(db, game_for(owners, game_id="secret-four", count_players=4))
        store_draft_match(db, row, evidence, bindings)
        winners = {owners["ABCD".index(player)][0].username for player in evidence.winners[0]}
    entries = feed.build_watten_achievement_feed(owners[0][0].user_id, limit=30)["entries"]
    assert {item["player"]["display_name"] for item in entries if item["achievement"]["id"] == "watten_three"} == {f"WinnerFeed{index}" for index in range(3)}
    assert {item["player"]["display_name"] for item in entries if item["achievement"]["id"] == "watten_team_first"} == winners


@pytest.mark.parametrize("arguments", ({"page": 0}, {"page": True}, {"page": "1"}, {"limit": 0}, {"limit": 31}, {"limit": True}))
def test_strict_positive_pagination_rejects_invalid_values(arguments):
    with pytest.raises(feed.WattenAchievementFeedError, match="invalid_request"):
        feed.build_watten_achievement_feed(1, **arguments)


def test_future_catalog_same_id_is_archived_and_known_unknown_bid_claim_fails_closed(server):
    owner = runtime_tests.account("FutureCatalogFeed")
    with session_scope() as db:
        row = persist_own(db, owner, "future-private-source")
        state = db.get(WattenProgressState, owner[0].user_id)
        state.grant_sequence += 1
        db.add(WattenAchievementGrant(user_id=owner[0].user_id, generation=1, catalog_version=DRAFT_CATALOG_VERSION + 1,
            achievement_id="watten_quiet_win", source_game_id=row.game_id, reached_at=FINISHED, xp=73,
            policy_version=2, grant_sequence=state.grant_sequence))
    entries = feed.build_watten_achievement_feed(owner[0].user_id)["entries"]
    archived = next(item for item in entries if item["achievement"]["archived"])
    assert archived["achievement"]["id"] == "archived" and archived["achievement"]["actual_xp"] == 73
    assert "Quiet win" not in json.dumps(entries)
    with session_scope() as db:
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.achievement_id == "watten_quiet_win"))
        grant.catalog_version = 1  # impossible claimed v1 goal: original public bids are UNKNOWN
    with pytest.raises(feed.WattenAchievementFeedError, match="invalid_source"):
        feed.build_watten_achievement_feed(owner[0].user_id)


def test_foreign_active_grant_owner_without_state_fails_closed_before_json_and_without_get_writes(server, monkeypatch):
    viewer, other = runtime_tests.account("IntactFeedViewer"), runtime_tests.account("OrphanFeedOwner")
    with session_scope() as db:
        persist_own(db, viewer, "intact-feed-source")
        persist_own(db, other, "orphan-feed-source")
        db.delete(db.get(WattenProgressState, other[0].user_id))
    with session_scope() as db:
        before = snapshot(db)
    statements = []

    def observed(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    monkeypatch.setattr(feed, "_owned_matches", lambda *_args: pytest.fail("orphan check read private match JSON"))
    event.listen(get_engine(), "before_cursor_execute", observed)
    try:
        with pytest.raises(feed.WattenAchievementFeedError, match="invalid_source"):
            feed.build_watten_achievement_feed(viewer[0].user_id)
    finally:
        event.remove(get_engine(), "before_cursor_execute", observed)
    assert statements and all(statement.lstrip().upper().startswith("SELECT") and "_json" not in statement
                              for statement in statements)
    with session_scope() as db:
        assert snapshot(db) == before


def test_compatible_v1_achievement_labels_survive_additive_catalog_upgrade():
    from types import SimpleNamespace

    from app.watten_achievement_feed import _achievement
    from app.watten_progression import DRAFT_ACHIEVEMENTS

    goal = DRAFT_ACHIEVEMENTS[0]
    known = _achievement(SimpleNamespace(achievement_id=goal.achievement_id, catalog_version=1, xp=goal.xp))
    assert known["id"] == goal.achievement_id and known["archived"] is False
    assert known["name"]["de"] == goal.name.de and known["actual_xp"] == goal.xp
    future = _achievement(SimpleNamespace(achievement_id=goal.achievement_id, catalog_version=DRAFT_CATALOG_VERSION + 1, xp=goal.xp))
    assert future["archived"] is True
