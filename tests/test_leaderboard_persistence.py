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
        shame = root / "leaderboard_shame.json"
        last_games = root / "leaderboard_last_games.json"
        stats = root / "stats.json"
        with (
            patch.object(main, "RECENT_FILE", recent),
            patch.object(main, "ALLTIME_FILE", alltime),
            patch.object(main, "SHAME_FILE", shame),
            patch.object(main, "LAST_GAMES_FILE", last_games),
            patch.object(main, "STATS_FILE", stats),
        ):
            yield recent, alltime, shame, last_games, stats


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
    def test_legacy_profile_link_falls_back_to_assigned_name_when_score_changed(self):
        candidates = [{
            "user_id": 4,
            "username": "Tomtom",
            "display_name": "Tom",
            "points": 759,
        }]

        self.assertEqual(
            main._linked_players_for_entry({"name": "Tom", "points": 753}, candidates),
            candidates,
        )
        self.assertEqual(
            main._linked_players_for_entry({"name": "Unbekannt", "points": 753}, candidates),
            candidates,
        )
        self.assertEqual(
            main._linked_players_for_entry(
                {"name": "Unbekannt", "points": 753},
                [*candidates, {"user_id": 5, "username": "Simon", "display_name": "Simon", "points": 802}],
            ),
            [],
        )

    def test_finalize_normal_game_writes_recent_alltime_stats_and_replay_snapshot(self):
        g = self.make_game(name="Cup", players=[("p1", "Anna"), ("p2", "Ben")])
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        g["_scoreboards"]["p2"] = self.low_scoreboard()

        with patched_leaderboard_files() as (recent_file, alltime_file, shame_file, last_games_file, stats_file):
            stats_file.write_text(json.dumps({"games_played": 7}), encoding="utf-8")

            main._finalize_and_log_results(g)

            recent = read_json(recent_file)
            alltime = read_json(alltime_file)
            shame = read_json(shame_file)
            last_games = read_json(last_games_file)
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
            self.assertEqual(shame["recent"][0]["name"], "Ben")
            self.assertEqual(shame["recent"][0]["points"], 253)
            self.assertEqual(shame["recent"][0]["opponent"], "Anna")
            self.assertEqual(shame["alltime"][0]["game_id"], g["_id"])
            self.assertEqual(last_games[0]["name"], "Anna")
            self.assertEqual(last_games[0]["game_id"], g["_id"])
            self.assertEqual(stats["games_played"], 8)
            self.assertEqual(stats["average_points"]["normal"]["games"], 1)
            self.assertEqual(stats["average_points"]["normal"]["points_total"], 410)
            self.assertEqual(stats["average_points"]["normal"]["average_points"], 410.0)
            self.assertEqual(stats["average_points"]["normal"]["trend"], "up")
            self.assertEqual(stats["average_points"]["hc"]["trend"], "same")

            replay = main.api_game_from_leaderboard(g["_id"])
            self.assertEqual(replay["game_id"], g["_id"])
            self.assertEqual(replay["gamename"], "Cup")
            self.assertEqual(replay["scoreboards"]["p2"]["reihen"][0]["rows"]["full"], 46)

    def test_finalize_hardcore_game_uses_hc_bucket_without_touching_normal_bucket(self):
        g = self.make_game(mode=1, hardcore=True, name="HC Run", players=[("solo", "Solo")])
        g["_scoreboards"]["solo"] = self.high_scoreboard()
        now = datetime.now(timezone.utc).isoformat()
        normal_entry = {"ts": now, "points": 999, "name": "Normal"}

        with patched_leaderboard_files() as (recent_file, alltime_file, shame_file, last_games_file, stats_file):
            recent_file.write_text(json.dumps({"normal": [normal_entry], "hc": []}), encoding="utf-8")
            alltime_file.write_text(json.dumps({"normal": [normal_entry], "hc": []}), encoding="utf-8")

            main._finalize_and_log_results(g)

            recent = read_json(recent_file)
            alltime = read_json(alltime_file)
            last_games = read_json(last_games_file)
            stats = read_json(stats_file)

            self.assertEqual(recent["normal"], [normal_entry])
            self.assertEqual(alltime["normal"], [normal_entry])
            self.assertEqual(recent["hc"][0]["name"], "Solo")
            self.assertEqual(recent["hc"][0]["points"], 410)
            self.assertTrue(recent["hc"][0]["hardcore"])
            self.assertEqual(alltime["hc"][0]["game_id"], g["_id"])
            self.assertFalse(shame_file.exists())
            self.assertEqual(last_games[0]["name"], "Solo")
            self.assertTrue(last_games[0]["hardcore"])
            self.assertEqual(stats["games_played"], 1)
            self.assertEqual(stats["average_points"]["normal"]["games"], 0)
            self.assertEqual(stats["average_points"]["normal"]["points_total"], 0)
            self.assertEqual(stats["average_points"]["normal"]["average_points"], 0.0)
            self.assertEqual(stats["average_points"]["normal"]["trend"], "same")
            self.assertEqual(stats["average_points"]["hc"]["games"], 1)
            self.assertEqual(stats["average_points"]["hc"]["points_total"], 410)
            self.assertEqual(stats["average_points"]["hc"]["trend"], "up")

    def test_finalize_team_game_uses_team_totals_and_member_names(self):
        g = self.make_game(mode="2v2", name="Team Cup", players=[
            ("p1", "Alina"),
            ("p2", "Ben"),
            ("p3", "Carla"),
            ("p4", "Dan"),
        ])
        g["_scoreboards_by_team"]["A"] = self.high_scoreboard()
        g["_scoreboards_by_team"]["B"] = self.low_scoreboard()

        with patched_leaderboard_files() as (recent_file, _alltime_file, shame_file, _last_games_file, _stats_file):
            main._finalize_and_log_results(g)

            entry = read_json(recent_file)["normal"][0]
            shame_entry = read_json(shame_file)["recent"][0]

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
            self.assertEqual(shame_entry["name"], "Ben, Dan")
            self.assertEqual(shame_entry["points"], 253)
            self.assertEqual(shame_entry["opponent"], "Alina, Carla")

    def test_finalize_preserves_existing_top_lists_while_writing_auxiliary_lists(self):
        g = self.make_game(name="Safe Data", players=[("p1", "Anna"), ("p2", "Ben")])
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        g["_scoreboards"]["p2"] = self.low_scoreboard()
        now = datetime.now(timezone.utc).isoformat()
        existing_recent = {"ts": now, "points": 999, "name": "Existing Recent", "game_id": "old-r"}
        existing_alltime = {"ts": now, "points": 1000, "name": "Existing Alltime", "game_id": "old-a"}

        with patched_leaderboard_files() as (recent_file, alltime_file, shame_file, last_games_file, _stats_file):
            recent_file.write_text(json.dumps({"normal": [existing_recent], "hc": []}), encoding="utf-8")
            alltime_file.write_text(json.dumps({"normal": [existing_alltime], "hc": []}), encoding="utf-8")

            main._finalize_and_log_results(g)

            recent = read_json(recent_file)
            alltime = read_json(alltime_file)

            self.assertEqual(recent["normal"][0], existing_recent)
            self.assertIn(g["_id"], {e["game_id"] for e in recent["normal"]})
            self.assertEqual(alltime["normal"][0], existing_alltime)
            self.assertIn(g["_id"], {e["game_id"] for e in alltime["normal"]})
            self.assertEqual(read_json(shame_file)["recent"][0]["name"], "Ben")
            self.assertEqual(read_json(last_games_file)[0]["game_id"], g["_id"])

    def test_finalize_extends_existing_average_stats_without_rebuilding_from_leaderboard(self):
        g = self.make_game(name="Average", players=[("p1", "Anna"), ("p2", "Ben")])
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        g["_scoreboards"]["p2"] = self.low_scoreboard()
        existing_stats = {
            "games_played": 12,
            "average_points": {
                "normal": {"games": 3, "points_total": 900, "average_points": 300.0},
                "hc": {"games": 2, "points_total": 500, "average_points": 250.0},
            },
        }

        with patched_leaderboard_files() as (_recent_file, _alltime_file, _shame_file, _last_games_file, stats_file):
            stats_file.write_text(json.dumps(existing_stats), encoding="utf-8")

            main._finalize_and_log_results(g)

            stats = read_json(stats_file)
            self.assertEqual(stats["games_played"], 13)
            self.assertEqual(stats["average_points"]["normal"]["games"], 4)
            self.assertEqual(stats["average_points"]["normal"]["points_total"], 1310)
            self.assertEqual(stats["average_points"]["normal"]["average_points"], 327.5)
            self.assertEqual(stats["average_points"]["normal"]["trend"], "up")
            self.assertEqual(stats["average_points"]["hc"]["games"], 2)
            self.assertEqual(stats["average_points"]["hc"]["points_total"], 500)
            self.assertEqual(stats["average_points"]["hc"]["trend"], "same")

    def test_average_stats_track_down_and_same_trends(self):
        with patched_leaderboard_files() as (_recent_file, _alltime_file, _shame_file, _last_games_file, stats_file):
            stats_file.write_text(json.dumps({
                "games_played": 0,
                "average_points": {
                    "normal": {"games": 1, "points_total": 900, "average_points": 900.0},
                    "hc": {"games": 0, "points_total": 0, "average_points": 0.0},
                },
            }), encoding="utf-8")

            main._mutate_stats(average_points=410, hardcore=False)

            stats = read_json(stats_file)
            self.assertEqual(stats["average_points"]["normal"]["average_points"], 655.0)
            self.assertEqual(stats["average_points"]["normal"]["trend"], "down")

            stats_file.write_text(json.dumps({
                "games_played": 0,
                "average_points": {
                    "normal": {"games": 1, "points_total": 410, "average_points": 410.0},
                    "hc": {"games": 0, "points_total": 0, "average_points": 0.0},
                },
            }), encoding="utf-8")

            main._mutate_stats(average_points=410, hardcore=False)

            stats = read_json(stats_file)
            self.assertEqual(stats["average_points"]["normal"]["average_points"], 410.0)
            self.assertEqual(stats["average_points"]["normal"]["trend"], "same")

    def test_last_games_are_capped_to_latest_ten_entries(self):
        g = self.make_game(name="Newest", players=[("p1", "Anna"), ("p2", "Ben")])
        g["_scoreboards"]["p1"] = self.high_scoreboard()
        g["_scoreboards"]["p2"] = self.low_scoreboard()
        now = datetime.now(timezone.utc)
        existing = [
            {"ts": (now - timedelta(minutes=i + 1)).isoformat(), "points": 100 + i, "name": f"Old {i}", "game_id": f"old-{i}"}
            for i in range(10)
        ]

        with patched_leaderboard_files() as (_recent_file, _alltime_file, _shame_file, last_games_file, _stats_file):
            last_games_file.write_text(json.dumps(existing), encoding="utf-8")

            main._finalize_and_log_results(g)

            last_games = read_json(last_games_file)
            self.assertEqual(len(last_games), 10)
            self.assertEqual(last_games[0]["game_id"], g["_id"])
            self.assertNotIn("old-9", {e["game_id"] for e in last_games})

    def test_replay_lookup_finds_snapshots_in_shame_and_last_games_files(self):
        shame_entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "points": 1,
            "name": "Shame",
            "game_id": "shame-game",
            "gamename": "Shame Replay",
            "players": [{"id": "p1", "name": "P1", "team": None}],
            "scoreboards": {"p1": {"reihen": [{"index": 1, "rows": {"1": 1}}]}},
        }
        last_entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "points": 2,
            "name": "Last",
            "game_id": "last-game",
            "gamename": "Last Replay",
            "players": [{"id": "p2", "name": "P2", "team": None}],
            "scoreboards": {"p2": {"reihen": [{"index": 1, "rows": {"2": 2}}]}},
        }

        with patched_leaderboard_files() as (_recent_file, _alltime_file, shame_file, last_games_file, _stats_file):
            shame_file.write_text(json.dumps({"recent": [shame_entry], "alltime": []}), encoding="utf-8")
            last_games_file.write_text(json.dumps([last_entry]), encoding="utf-8")

            shame_replay = main.api_game_from_leaderboard("shame-game")
            last_replay = main.api_game_from_leaderboard("last-game")

            self.assertEqual(shame_replay["gamename"], "Shame Replay")
            self.assertEqual(last_replay["gamename"], "Last Replay")

    def test_get_leaderboard_filters_recent_entries_and_migrates_legacy_alltime(self):
        now = datetime.now(timezone.utc)
        old = now - timedelta(days=8)
        shame_old = now - timedelta(days=11)
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
        shame_raw = {
            "recent": [
                {"ts": now.isoformat(), "points": 40, "name": "Worst"},
                {"ts": now.isoformat(), "points": 90, "name": "Less Bad"},
                {"ts": shame_old.isoformat(), "points": 1, "name": "Too Old"},
                {"ts": now.isoformat(), "points": 0, "name": "HC Shame", "hardcore": True},
            ],
            "alltime": [
                {"ts": now.isoformat(), "points": 90, "name": "Less Bad"},
                {"ts": now.isoformat(), "points": 40, "name": "Worst"},
            ],
        }
        last_raw = [
            {"ts": (now - timedelta(minutes=2)).isoformat(), "points": 20, "name": "Older"},
            {"ts": now.isoformat(), "points": 30, "name": "Newest", "hardcore": True},
            {"ts": now.isoformat(), "points": "broken", "name": "Broken"},
        ]

        with patched_leaderboard_files() as (recent_file, alltime_file, shame_file, last_games_file, stats_file):
            recent_file.write_text(json.dumps(recent_raw), encoding="utf-8")
            alltime_file.write_text(json.dumps(legacy_alltime), encoding="utf-8")
            shame_file.write_text(json.dumps(shame_raw), encoding="utf-8")
            last_games_file.write_text(json.dumps(last_raw), encoding="utf-8")
            stats_file.write_text(json.dumps({"games_played": 3}), encoding="utf-8")

            payload = asyncio.run(main.get_leaderboard())

            self.assertEqual([e["name"] for e in payload["recent"]["normal"]], ["Best", "Current"])
            self.assertEqual(payload["recent"]["hc"][0]["name"], "HC")
            self.assertEqual(payload["alltime"]["normal"], legacy_alltime)
            self.assertEqual(payload["alltime"]["hc"], [])
            self.assertEqual([e["name"] for e in payload["shame"]["recent"]], ["Worst", "Less Bad"])
            self.assertEqual([e["name"] for e in payload["shame"]["alltime"]], ["Worst", "Less Bad"])
            self.assertEqual([e["name"] for e in payload["last_games"]], ["Newest", "Older"])
            self.assertEqual(read_json(recent_file)["normal"], payload["recent"]["normal"])
            self.assertEqual(read_json(alltime_file), {"normal": legacy_alltime, "hc": []})
            self.assertEqual(read_json(shame_file), payload["shame"])
            self.assertEqual(read_json(last_games_file), payload["last_games"])
            self.assertEqual(payload["stats"]["games_played"], 3)
            self.assertEqual(payload["stats"]["average_points"]["normal"]["games"], 0)
            self.assertEqual(payload["stats"]["average_points"]["normal"]["points_total"], 0)
            self.assertEqual(payload["stats"]["average_points"]["normal"]["average_points"], 0.0)
            self.assertIsNone(payload["stats"]["average_points"]["normal"]["trend"])
            self.assertEqual(payload["stats"]["average_points"]["hc"]["games"], 0)
            self.assertEqual(payload["stats"]["average_points"]["hc"]["points_total"], 0)
            self.assertEqual(payload["stats"]["average_points"]["hc"]["average_points"], 0.0)
            self.assertIsNone(payload["stats"]["average_points"]["hc"]["trend"])
            self.assertEqual(read_json(stats_file), payload["stats"])
