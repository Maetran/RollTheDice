"""A real shared activation is required before completed-round collection credit."""

import unittest
from copy import deepcopy

from app.hausdepp_surprise_collection import record_surprise_collection, surprise_collection_evidence


class SurpriseCollectionTests(unittest.TestCase):
    def game(self):
        return {
            "_participants": [
                {"id": "actor", "user_id": 1}, {"id": "witness", "user_id": 2},
                {"id": "offline", "user_id": 3}, {"id": "cpu", "is_cpu": True, "type": "cpu"},
            ],
            "_players": [{"id": "actor", "ws": object()}, {"id": "witness", "ws": object()},
                         {"id": "offline", "ws": None}, {"id": "cpu", "ws": object()},
                         {"id": "spectator", "ws": object()}],
            "_hausdepp": {"phase": "playing", "version": 17, "current_player_id": "witness"},
        }

    def test_only_connected_humans_collect_and_actor_gets_both_tracks(self):
        game = self.game()
        engine = deepcopy(game["_hausdepp"])
        record_surprise_collection(game, "actor", "star", 1)
        self.assertEqual(surprise_collection_evidence(game, 1), {
            "actor": {"activated": ["star"], "witnessed": ["star"]},
            "witness": {"activated": [], "witnessed": ["star"]},
        })
        self.assertEqual(game["_hausdepp"], engine)

    def test_solo_cpus_offline_humans_and_spectators_cannot_qualify(self):
        game = self.game()
        game["_players"] = [player for player in game["_players"] if player["id"] != "witness"]
        record_surprise_collection(game, "actor", "hammer", 1)
        self.assertEqual(surprise_collection_evidence(game, 1), {})

    def test_guests_are_humans_but_duplicate_account_seats_are_not_two_people(self):
        game = self.game()
        game["_participants"][1]["user_id"] = None
        record_surprise_collection(game, "actor", "ufo", 1)
        self.assertEqual(set(surprise_collection_evidence(game, 1)), {"actor", "witness"})
        game["_participants"][1]["user_id"] = 1
        record_surprise_collection(game, "actor", "ufo", 1)
        self.assertEqual(surprise_collection_evidence(game, 1), {})

    def test_later_disconnect_does_not_erase_a_shared_experience(self):
        game = self.game()
        record_surprise_collection(game, "actor", "clock", 4)
        expected = surprise_collection_evidence(game, 4)
        for player in game["_players"]:
            player["ws"] = None
        self.assertEqual(surprise_collection_evidence(game, 4), expected)
        projected = surprise_collection_evidence(game, 4)
        projected["actor"]["activated"].clear()
        self.assertEqual(surprise_collection_evidence(game, 4), expected)

    def test_only_current_round_counts_and_new_claim_replaces_previous_facts(self):
        game = self.game()
        record_surprise_collection(game, "actor", "dragon", 3)
        self.assertEqual(surprise_collection_evidence(game, 4), {})
        record_surprise_collection(game, "witness", "blackhole", 4)
        evidence = surprise_collection_evidence(game, 4)
        self.assertEqual(evidence["witness"]["activated"], ["blackhole"])
        self.assertEqual(evidence["actor"]["activated"], [])
        self.assertNotIn("dragon", repr(evidence))

    def test_legacy_claim_without_collection_evidence_is_not_backfilled(self):
        game = self.game()
        game["_hausdepp_table_surprise_claim"] = {"round_number": 1, "activated": True}
        self.assertEqual(surprise_collection_evidence(game, 1), {})

    def test_invalid_capture_never_creates_collection_facts(self):
        for actor, effect, round_number in (("cpu", "star", 1), ("offline", "star", 1),
                                            ("spectator", "star", 1), ("actor", "fake", 1),
                                            ("actor", "star", True), ("actor", "star", 0)):
            with self.subTest(actor=actor, effect=effect, round_number=round_number):
                game = self.game()
                record_surprise_collection(game, actor, effect, round_number)
                self.assertEqual(surprise_collection_evidence(game, 1), {})

    def test_malformed_saved_facts_are_ignored_without_touching_engine(self):
        changes = [
            lambda raw: raw.update(round_number=True),
            lambda raw: raw["players"].pop("witness"),
            lambda raw: raw["players"].update(cpu={"activated": [], "witnessed": ["star"]}),
            lambda raw: raw["players"]["actor"].update(activated=["star", "star"]),
            lambda raw: raw["players"]["actor"].update(activated=[]),
            lambda raw: raw["players"]["witness"].update(activated=["star"]),
            lambda raw: raw["players"]["witness"].update(witnessed=["hammer"]),
            lambda raw: raw["players"]["witness"].update(witnessed=["fake"]),
        ]
        for change in changes:
            with self.subTest(change=change):
                game = self.game()
                engine = deepcopy(game["_hausdepp"])
                record_surprise_collection(game, "actor", "star", 1)
                change(game["_hausdepp_surprise_collection"])
                self.assertEqual(surprise_collection_evidence(game, 1), {})
                self.assertEqual(game["_hausdepp"], engine)
