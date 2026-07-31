import asyncio
import json
import tempfile
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from app import main
from tests.support import GameStateTestCase


@contextmanager
def patched_leaderboard_files():
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        recent = root / "leaderboard_recent.json"
        alltime = root / "leaderboard_alltime.json"
        stats = root / "stats.json"
        with (
            patch.object(main, "RECENT_FILE", recent),
            patch.object(main, "ALLTIME_FILE", alltime),
            patch.object(main, "STATS_FILE", stats),
        ):
            yield recent, alltime, stats


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


class FinalTotalsTestCase(GameStateTestCase):
    def test_compute_final_totals_for_single_player_boards(self):
        g = self.make_game(players=[("p1", "Anna"), ("p2", "Ben")])
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        g["_scoreboards"]["p2"] = self.low_scoreboard()

        totals = main._compute_final_totals(g)
        results = main._compute_results_for_snapshot(g)

        self.assertEqual(totals, {"p1": 410, "p2": 253})
        self.assertEqual(results, [{"player": "Anna", "total": 410}, {"player": "Ben", "total": 253}])
        self.assertTrue(main._is_game_finished(g))

    def test_compute_final_totals_for_team_boards(self):
        g = self.make_game(mode="2v2", players=[
            ("p1", "Alina"),
            ("p2", "Ben"),
            ("p3", "Carla"),
            ("p4", "Dan"),
        ])
        g["_scoreboards_by_team"]["A"] = self.high_scoreboard()
        g["_scoreboards_by_team"]["B"] = self.low_scoreboard()

        totals = main._compute_final_totals(g)
        results = main._compute_results_for_snapshot(g)

        self.assertEqual(totals, {"A": 410, "B": 253})
        self.assertEqual(results, [{"player": "Team A", "total": 410}, {"player": "Team B", "total": 253}])
        self.assertTrue(main._is_game_finished(g))


class LeaderboardPersistenceTestCase(GameStateTestCase):
    def test_finalize_normal_game_writes_recent_alltime_stats_and_replay_snapshot(self):
        g = self.make_game(name="Cup", players=[("p1", "Anna"), ("p2", "Ben")])
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        g["_scoreboards"]["p2"] = self.low_scoreboard()

        with patched_leaderboard_files() as (recent_file, alltime_file, stats_file):
            stats_file.write_text(json.dumps({"games_played": 7}), encoding="utf-8")

            main._finalize_and_log_results(g)

            recent = read_json(recent_file)
            alltime = read_json(alltime_file)
            stats = read_json(stats_file)
            entry = recent["normal"][0]

            self.assertEqual(entry["name"], "Anna")
            self.assertEqual(entry["points"], 410)
            self.assertEqual(entry["opponent"], "Ben")
            self.assertEqual(entry["opp_points"], 253)
            self.assertEqual(entry["diff"], 157)
            self.assertEqual(entry["game_id"], g["_id"])
            self.assertEqual(entry["mode"], "2")
            self.assertFalse(entry["hardcore"])
            self.assertEqual(len(entry["players"]), 2)
            self.assertEqual(entry["scoreboards"]["p1"]["reihen"][0]["rows"]["poker"], 74)
            self.assertEqual(alltime["normal"][0]["game_id"], g["_id"])
            self.assertEqual(stats["games_played"], 8)

            replay = main.api_game_from_leaderboard(g["_id"])
            self.assertEqual(replay["game_id"], g["_id"])
            self.assertEqual(replay["gamename"], "Cup")
            self.assertEqual(replay["scoreboards"]["p2"]["reihen"][0]["rows"]["full"], 46)

    def test_finalize_hardcore_game_uses_hc_bucket_without_touching_normal_bucket(self):
        g = self.make_game(mode=1, hardcore=True, name="HC Run", players=[("solo", "Solo")])
        g["_scoreboards"]["solo"] = self.high_scoreboard()
        now = datetime.now(timezone.utc).isoformat()
        normal_entry = {"ts": now, "points": 999, "name": "Normal"}

        with patched_leaderboard_files() as (recent_file, alltime_file, stats_file):
            recent_file.write_text(json.dumps({"normal": [normal_entry], "hc": []}), encoding="utf-8")
            alltime_file.write_text(json.dumps({"normal": [normal_entry], "hc": []}), encoding="utf-8")

            main._finalize_and_log_results(g)

            recent = read_json(recent_file)
            alltime = read_json(alltime_file)
            stats = read_json(stats_file)

            self.assertEqual(recent["normal"], [normal_entry])
            self.assertEqual(alltime["normal"], [normal_entry])
            self.assertEqual(recent["hc"][0]["name"], "Solo")
            self.assertEqual(recent["hc"][0]["points"], 410)
            self.assertTrue(recent["hc"][0]["hardcore"])
            self.assertEqual(alltime["hc"][0]["game_id"], g["_id"])
            self.assertEqual(stats["games_played"], 1)

    def test_finalize_team_game_uses_team_totals_and_member_names(self):
        g = self.make_game(mode="2v2", name="Team Cup", players=[
            ("p1", "Alina"),
            ("p2", "Ben"),
            ("p3", "Carla"),
            ("p4", "Dan"),
        ])
        g["_scoreboards_by_team"]["A"] = self.high_scoreboard()
        g["_scoreboards_by_team"]["B"] = self.low_scoreboard()

        with patched_leaderboard_files() as (recent_file, _alltime_file, _stats_file):
            main._finalize_and_log_results(g)

            entry = read_json(recent_file)["normal"][0]

            self.assertEqual(entry["name"], "Alina, Carla")
            self.assertEqual(entry["opponent"], "Ben, Dan")
            self.assertEqual(entry["points"], 410)
            self.assertEqual(entry["opp_points"], 253)
            self.assertEqual(entry["diff"], 157)
            self.assertEqual(entry["scoreboards"]["A"]["reihen"][0]["rows"]["60"], 90)
            self.assertEqual(entry["scoreboards"]["B"]["reihen"][0]["rows"]["60"], 80)
            self.assertEqual(
                {p["id"]: p["team"] for p in entry["players"]},
                {"p1": "A", "p2": "B", "p3": "A", "p4": "B"},
            )

    def test_get_leaderboard_filters_recent_entries_and_migrates_legacy_alltime(self):
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=8)
        recent_raw = {
            "normal": [
                {"ts": now.isoformat(), "points": 100, "name": "Current"},
                {"ts": now.isoformat(), "points": 250, "name": "Best"},
                {"ts": old.isoformat(), "points": 999, "name": "Expired"},
                {"ts": now.isoformat(), "points": "broken", "name": "Broken"},
            ],
            "hc": [{"ts": now.isoformat(), "points": 80, "name": "HC"}],
        }
        legacy_alltime = [{"ts": old.isoformat(), "points": 12, "name": "Legacy"}]

        with patched_leaderboard_files() as (recent_file, alltime_file, stats_file):
            recent_file.write_text(json.dumps(recent_raw), encoding="utf-8")
            alltime_file.write_text(json.dumps(legacy_alltime), encoding="utf-8")
            stats_file.write_text(json.dumps({"games_played": 3}), encoding="utf-8")

            payload = asyncio.run(main.get_leaderboard())

            self.assertEqual([e["name"] for e in payload["recent"]["normal"]], ["Best", "Current"])
            self.assertEqual(payload["recent"]["hc"][0]["name"], "HC")
            self.assertEqual(payload["alltime"]["normal"], legacy_alltime)
            self.assertEqual(payload["alltime"]["hc"], [])
            self.assertEqual(read_json(recent_file)["normal"], payload["recent"]["normal"])
            self.assertEqual(read_json(alltime_file), {"normal": legacy_alltime, "hc": []})
            self.assertEqual(payload["stats"], {"games_played": 3})
