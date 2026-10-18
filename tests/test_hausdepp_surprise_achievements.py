"""Rare table collections use completed, private, idempotent round evidence."""

from __future__ import annotations

import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select

from app import main
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.hausdepp_achievement_feed import list_hausdepp_achievement_feed
from app.hausdepp_achievements import acknowledge_hausdepp_presentation, synchronize_hausdepp_progress
from app.hausdepp_results import finalize_hausdepp_result, list_hausdepp_results_for_user, validate_hausdepp_result
from app.hausdepp_surprise_collection import SURPRISE_EFFECTS, record_surprise_collection, surprise_collection_evidence
from app.models import CompletedGame, HausdeppAchievementUnlock, HausdeppRoundCredit


class HausdeppSurpriseAchievementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/surprise-awards.sqlite3",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.actor = create_user("SurpriseActor", "test-password-123", must_change_password=False)
        self.witness = create_user("SurpriseWitness", "test-password-123", must_change_password=False)
        self.at = datetime(2026, 10, 16, 18, 30, tzinfo=timezone.utc)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def payload(self, game_id="surprise-round", *, effect=None, index=0):
        players = [{"id": "actor", "name": self.actor.username, "is_cpu": False},
                   {"id": "witness", "name": self.witness.username, "is_cpu": False}]
        evidence = {player["id"]: {"flags": [], "ten_clears": 0} for player in players}
        if effect is not None:
            evidence["actor"]["table_surprises"] = {"activated": [effect], "witnessed": [effect]}
            evidence["witness"]["table_surprises"] = {"activated": [], "witnessed": [effect]}
        return {"schema_version": 2, "payload_kind": "hausdepp_result", "game_type": "hausdepp",
                "game_id": game_id, "name": "Surprise table",
                "finished_at": (self.at + timedelta(minutes=index)).isoformat(), "participants": players,
                "loser_id": "witness", "finished_order": ["actor"],
                "achievement_evidence": {"schema_version": 1, "complete": True, "players": evidence}}

    def store(self, payload):
        payload = validate_hausdepp_result(payload)
        result = persist_completed_game_result(
            game_id=payload["game_id"], game_name=payload["name"], game_type="hausdepp", mode="2", hardcore=False,
            finished_at=datetime.fromisoformat(payload["finished_at"]), snapshot=payload,
            participants=[{"player_key": player["id"], "display_name": player["name"],
                           "user_id": self.actor.id if player["id"] == "actor" else self.witness.id}
                          for player in payload["participants"]],
        )
        self.assertTrue(result.succeeded)

    @staticmethod
    def collection_items(progress):
        return {item["id"]: item for item in progress["achievements"]["items"]
                if item["category"] in {"surprises_activated", "surprises_witnessed"}}

    def finished_game(self, *, effect="star", claim_round=1):
        payload = self.payload()
        participants = [{**player, "type": "human",
                         "user_id": self.actor.id if player["id"] == "actor" else self.witness.id}
                        for player in payload["participants"]]
        game = {"_id": payload["game_id"], "_game_type": "hausdepp", "_name": payload["name"], "_mode": "2",
                "_started": True, "_finished": True, "_finished_at": payload["finished_at"],
                "_participants": participants, "_players": [{**player, "ws": object()} for player in participants],
                "_hausdepp": {"phase": "finished", "loser_id": payload["loser_id"],
                               "finished_order": payload["finished_order"],
                               "achievement_evidence": payload["achievement_evidence"]}}
        record_surprise_collection(game, "actor", effect, claim_round)
        return game

    def test_actor_gets_both_tracks_and_other_human_only_witnesses(self):
        self.store(self.payload(effect="star"))
        actor = self.collection_items(synchronize_hausdepp_progress(self.actor.id))
        witness = self.collection_items(synchronize_hausdepp_progress(self.witness.id))
        self.assertEqual({key for key, item in actor.items() if item["unlocked"]},
                         {"hausdepp_116", "hausdepp_126"})
        self.assertEqual({key for key, item in witness.items() if item["unlocked"]}, {"hausdepp_126"})
        self.assertEqual(actor["hausdepp_124"]["progress"], {"current": 1, "target": 4})
        self.assertEqual(witness["hausdepp_124"]["progress"], {"current": 0, "target": 4})

    def test_duplicate_variants_do_not_advance_four_and_eight_collections(self):
        for index in range(4):
            self.store(self.payload(f"same-effect-{index}", effect="dragon", index=index))
        progress = synchronize_hausdepp_progress(self.actor.id)
        items = self.collection_items(progress)
        self.assertEqual({key for key, item in items.items() if item["unlocked"]},
                         {"hausdepp_120", "hausdepp_130"})
        self.assertEqual(items["hausdepp_124"]["progress"], {"current": 1, "target": 4})
        self.assertEqual(items["hausdepp_135"]["progress"], {"current": 1, "target": 8})
        self.assertEqual(progress, synchronize_hausdepp_progress(self.actor.id))

    def test_four_and_eight_distinct_variants_unlock_each_track_once_with_large_bonuses(self):
        for index, effect in enumerate(SURPRISE_EFFECTS):
            self.store(self.payload(f"variant-{index}", effect=effect, index=index))
            actor = self.collection_items(synchronize_hausdepp_progress(self.actor.id))
            witness = self.collection_items(synchronize_hausdepp_progress(self.witness.id))
            self.assertEqual(actor["hausdepp_124"]["unlocked"], index >= 3)
            self.assertEqual(witness["hausdepp_134"]["unlocked"], index >= 3)
            self.assertEqual(actor["hausdepp_125"]["unlocked"], index == 7)
            self.assertEqual(witness["hausdepp_135"]["unlocked"], index == 7)
        self.assertTrue(all(item["unlocked"] for item in actor.values()))
        self.assertEqual(sum(item["points"] for item in actor.values() if item["unlocked"]), 1500)
        self.assertEqual(sum(item["points"] for item in witness.values() if item["unlocked"]), 500)
        final = synchronize_hausdepp_progress(self.actor.id)
        self.assertEqual(final, synchronize_hausdepp_progress(self.actor.id))
        self.assertEqual(actor["hausdepp_125"]["points"], 500)
        self.assertEqual(witness["hausdepp_135"]["points"], 250)
        with session_scope() as db:
            badges = db.scalars(select(HausdeppAchievementUnlock).where(
                HausdeppAchievementUnlock.user_id == self.actor.id,
                HausdeppAchievementUnlock.achievement_id.in_(("hausdepp_125", "hausdepp_135")),
            )).all()
            self.assertEqual({badge.source_game_id for badge in badges}, {"variant-7"})

    def test_optional_collection_is_strict_bounded_and_rejects_impossible_membership(self):
        invalid = [None, [], {}, {"activated": [], "witnessed": [], "extra": True},
                   {"activated": "star", "witnessed": ["star"]},
                   {"activated": [True], "witnessed": [True]},
                   {"activated": ["unknown"], "witnessed": ["unknown"]},
                   {"activated": ["star"], "witnessed": []},
                   {"activated": ["star"], "witnessed": ["dragon"]},
                   {"activated": [], "witnessed": ["star", "star"]},
                   {"activated": ["star", "star"], "witnessed": ["star"]}]
        for raw in invalid:
            payload = self.payload(effect="star")
            payload["achievement_evidence"]["players"]["actor"]["table_surprises"] = raw
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, "invalid_evidence"):
                validate_hausdepp_result(payload)
        for mutation in ("cpu", "one_witness", "two_actors", "no_actor", "different_effects"):
            payload = self.payload(effect="star")
            players = payload["achievement_evidence"]["players"]
            if mutation == "cpu":
                payload["participants"][1]["is_cpu"] = True
            elif mutation == "one_witness":
                players["witness"].pop("table_surprises")
            elif mutation == "two_actors":
                players["witness"]["table_surprises"]["activated"] = ["star"]
            elif mutation == "no_actor":
                players["actor"]["table_surprises"]["activated"] = []
            else:
                players["witness"]["table_surprises"]["witnessed"] = ["dragon"]
            with self.subTest(mutation=mutation), self.assertRaisesRegex(ValueError, "invalid_evidence"):
                validate_hausdepp_result(payload)

    def test_legacy_credit_without_collection_is_empty_and_cannot_retroactively_collect(self):
        self.store(self.payload())
        first = synchronize_hausdepp_progress(self.actor.id)
        self.assertFalse(any(item["unlocked"] for item in self.collection_items(first).values()))
        with session_scope() as db:
            credit = db.get(HausdeppRoundCredit, (self.actor.id, "surprise-round"))
            self.assertNotIn("table_surprises", json.loads(credit.facts_json))
            source = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "surprise-round"))
            source.snapshot_json = json.dumps(self.payload(effect="star"))
        self.assertEqual(first, synchronize_hausdepp_progress(self.actor.id))

    def test_round_finalization_merges_a_copy_and_delivers_private_awards_once_after_disconnect(self):
        game = self.finished_game()
        original_engine = deepcopy(game["_hausdepp"])
        for player in game["_players"]:
            player["ws"] = None
        before = synchronize_hausdepp_progress(self.actor.id)
        self.assertFalse(any(item["unlocked"] for item in self.collection_items(before).values()))
        with patch("app.hausdepp_rematch.retain_rematch_source", return_value=True):
            self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
            self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
        self.assertEqual(game["_hausdepp"], original_engine)
        actor = synchronize_hausdepp_progress(self.actor.id)
        self.assertEqual(set(actor["presentation"]["pending"]["achievement_ids"]),
                         {"hausdepp_01", "hausdepp_116", "hausdepp_126"})
        summary = game["_hausdepp_round_summary"]["players"]
        self.assertEqual({item["id"] for item in summary["witness"]["achievements"]},
                         {"hausdepp_01", "hausdepp_126"})
        encoded = json.dumps(list_hausdepp_results_for_user(self.actor.id))
        self.assertNotIn("table_surprises", encoded)
        self.assertNotIn("achievement_evidence", encoded)
        self.assertNotIn("table_surprises", json.dumps(actor))
        self.assertEqual(actor, synchronize_hausdepp_progress(self.actor.id))
        acknowledge_hausdepp_presentation(self.actor.id, actor["presentation"]["revision"])
        self.assertIsNone(synchronize_hausdepp_progress(self.actor.id)["presentation"]["pending"])

    def test_stale_round_collection_is_not_credited_and_tournament_uses_its_actual_round(self):
        stale = self.finished_game(claim_round=2)
        with patch("app.hausdepp_rematch.retain_rematch_source", return_value=True):
            self.assertTrue(finalize_hausdepp_result(stale)["result_persisted"])
        self.assertFalse(any(item["unlocked"] for item in self.collection_items(
            synchronize_hausdepp_progress(self.actor.id)).values()))
        game = self.finished_game(effect="clock", claim_round=2)
        game["_id"] = "tournament-table"
        game["_hausdepp_tournament"] = {
            "schema_version": 1, "id": game["_id"], "round_number": 2,
            "losses": {"actor": 0, "witness": 1}, "round_losers": ["witness"],
            "completed": False, "tages_hausdepp_id": None,
        }
        with patch("app.hausdepp_results.surprise_collection_evidence", wraps=surprise_collection_evidence) as evidence:
            self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
            evidence.assert_called_once_with(game, 2)
        items = self.collection_items(synchronize_hausdepp_progress(self.actor.id))
        self.assertTrue(items["hausdepp_122"]["unlocked"])
        self.assertTrue(items["hausdepp_132"]["unlocked"])
        with session_scope() as db:
            unlock = db.get(HausdeppAchievementUnlock, (self.actor.id, "hausdepp_122"))
            self.assertEqual(unlock.source_game_id, "tournament-table-r02")

    def test_simultaneous_recovery_has_one_award_and_feed_exposes_only_public_copy(self):
        self.store(self.payload(effect="blackhole"))
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: synchronize_hausdepp_progress(self.actor.id), range(2)))
        self.assertEqual(results[0], results[1])
        feed = list_hausdepp_achievement_feed(self.actor.id)
        self.assertEqual({item["achievement"]["id"] for item in feed["items"]},
                         {"hausdepp_01", "hausdepp_123", "hausdepp_133"})
        for private in ("table_surprises", "facts_json", "source_game_id", "actor_id", "witnessed"):
            self.assertNotIn(f'"{private}"', json.dumps(feed))
