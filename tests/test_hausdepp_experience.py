"""Gentler computers and table tips during a person's first Hausdepp rounds."""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app import main
from app.auth import create_user
from app.database import configure_database, upgrade_database
from app.game_history import persist_completed_game_result
from app.hausdepp_cpu_runner import _personality
from app.hausdepp_engine import make_deck
from app.hausdepp_experience import (
    GENTLE_ROUNDS,
    completed_rounds,
    record_table_experience,
    table_skill,
    wants_tips,
)
from app.hausdepp_snapshot import snapshot_hausdepp
from tests.test_hausdepp_engine import scenario


def test_the_newest_person_sets_a_gentle_but_not_beginner_pace():
    assert table_skill({}) == 1.0
    assert table_skill({"_hausdepp_experience": {"p0": 0}}) == 0.55
    assert table_skill({"_hausdepp_experience": {"p0": 25, "p1": 400}}) == 0.775
    assert table_skill({"_hausdepp_experience": {"p0": GENTLE_ROUNDS}}) == 1.0
    assert table_skill({"_hausdepp_experience": {"p0": 900}}) == 1.0


def test_tips_are_for_seated_newer_people_only():
    game = {"_hausdepp_experience": {"new": 3, "veteran": GENTLE_ROUNDS}}
    assert wants_tips(game, "new")
    assert not wants_tips(game, "veteran")
    assert not wants_tips(game, None)
    assert not wants_tips(game, "spectator")


def test_computer_personalities_stay_within_a_small_stable_band():
    nudges = [_personality({"_id": "table"}, f"cpu-{index}") for index in range(200)]
    assert all(-0.08 <= nudge <= 0.08 for nudge in nudges)
    assert len({round(nudge, 4) for nudge in nudges}) > 150
    assert _personality({"_id": "table"}, "cpu-1") == _personality({"_id": "table"}, "cpu-1")


def test_snapshot_offers_a_tip_only_to_a_newer_viewer():
    others = [["acorns-9", "acorns-O", "acorns-K"]]
    hand = ["hearts-7", "bells-8", "hearts-10"]
    used = {*hand, *others[0], "leaves-A"}
    state = scenario([hand, *others], discard=["leaves-A"],
                     deck=[card for card in make_deck() if card not in used][:20])
    game = {"_id": "tip-table", "_name": "Tipp", "_mode": "2", "_expected": 2, "_game_type": "hausdepp",
            "_started": True, "_hausdepp": state, "_players": [{"id": "p0", "name": "Neu", "ws": None}],
            "_participants": [{"id": "p0", "name": "Neu", "is_cpu": False, "user_id": 7, "type": "human"},
                              {"id": "p1", "name": "CPU", "is_cpu": True, "user_id": None, "type": "cpu"}],
            "_hausdepp_experience": {"p0": 2}}
    with patch("app.hausdepp_snapshot.multiplayer_pause_reason", return_value=None):
        assert snapshot_hausdepp(game, "p0")["_hausdepp"]["table_tip"] == {"key": "tipBuyAce"}
        game["_hausdepp_experience"] = {"p0": GENTLE_ROUNDS}
        assert snapshot_hausdepp(game, "p0")["_hausdepp"]["table_tip"] is None
        assert snapshot_hausdepp(game, None)["_hausdepp"]["table_tip"] is None


class CompletedRoundCountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp-experience.sqlite3",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.new = create_user("Neuling", "test-password-123", must_change_password=False)
        self.veteran = create_user("Stammgast", "test-password-123", must_change_password=False)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def store(self, game_id, user_ids, *, game_type="hausdepp"):
        persist_completed_game_result(
            game_id=game_id, game_name="Runde", game_type=game_type, mode="2", hardcore=False,
            finished_at=datetime(2026, 10, 17, 12, tzinfo=timezone.utc), snapshot={"game_type": game_type},
            participants=[{"player_key": f"p{index}", "display_name": f"P{index}", "user_id": user_id}
                          for index, user_id in enumerate(user_ids)])

    def test_counts_only_completed_hausdepp_rounds_per_seated_account(self):
        for number in range(3):
            self.store(f"round-{number}", [self.veteran.id, None])
        self.store("shared", [self.veteran.id, self.new.id])
        self.store("other-game", [self.new.id, self.veteran.id], game_type="zilch")
        self.assertEqual(completed_rounds([self.new.id, self.veteran.id, None, "x"]),
                         {self.new.id: 1, self.veteran.id: 4})
        game = {"_participants": [{"id": "a", "is_cpu": False, "user_id": self.new.id},
                                  {"id": "b", "is_cpu": False, "user_id": self.veteran.id},
                                  {"id": "c", "is_cpu": True, "user_id": None}]}
        record_table_experience(game)
        self.assertEqual(game["_hausdepp_experience"], {"a": 1, "b": 4})
        self.assertAlmostEqual(table_skill(game), 0.559)
