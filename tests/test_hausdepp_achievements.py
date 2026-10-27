"""Private Hausdepp awards: completed evidence, idempotence and durable delivery."""

from __future__ import annotations

import copy
import json
import os
import random
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select

from app import main
from app.active_games import load_active_games
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.hausdepp_account import build_hausdepp_account_for_user
from app.hausdepp_achievements import (
    ACHIEVEMENTS,
    RANKS,
    acknowledge_hausdepp_presentation,
    synchronize_hausdepp_progress,
)
from app.hausdepp_cpu_strategy import CpuMemory, choose_cpu_action
from app.hausdepp_engine import new_round, project_state
from app.hausdepp_gameplay import apply_hausdepp_command
from app.hausdepp_leaderboard import build_hausdepp_leaderboard
from app.hausdepp_results import finalize_hausdepp_result, list_hausdepp_results_for_user, validate_hausdepp_result
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game, start_hausdepp_game
from app.models import CompletedGame, GameParticipant, HausdeppAchievementUnlock, HausdeppRoundCredit


class HausdeppAchievementTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp-awards.sqlite3",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.user = create_user("HausXP", "test-password-123", must_change_password=False)
        self.other = create_user("AndereXP", "test-password-123", must_change_password=False)
        # 20:30 Swiss time on a weekday: no single-round play-time achievement applies.
        self.at = datetime(2026, 10, 16, 18, 30, tzinfo=timezone.utc)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def payload(self, game_id="round-1", *, flags=(), foreign_flags=(), count=2, cpu=True, loser="other",
                schema=2, ten_clears=0, complete=True, at=None):
        players = [{"id": "self", "name": self.user.username, "is_cpu": False},
                   {"id": "other", "name": self.other.username, "is_cpu": cpu}]
        players.extend({"id": f"cpu-{index}", "name": f"Bot{index}", "is_cpu": True}
                       for index in range(count - 2))
        result = {"schema_version": schema, "payload_kind": "hausdepp_result", "game_type": "hausdepp",
                  "game_id": game_id, "name": "Privater XP-Tisch", "finished_at": (at or self.at).isoformat(),
                  "participants": players, "loser_id": loser,
                  "finished_order": [player["id"] for player in players if player["id"] != loser]}
        if schema >= 2:
            result["achievement_evidence"] = {
                "schema_version": 1, "complete": complete,
                "players": {player["id"]: {"flags": list(flags if player["id"] == "self" else foreign_flags),
                                           "ten_clears": ten_clears if player["id"] == "self" else 0,
                                           "hand": ["PRIVATE-NOT-PERSISTED"]}
                            for player in players},
                "tracking": "PRIVATE-TRACKING",
            }
        return result

    def store(self, payload, *, game_type="hausdepp", account=None):
        result = persist_completed_game_result(
            game_id=payload["game_id"], game_name=payload["name"], game_type=game_type,
            mode=str(len(payload["participants"])), hardcore=False,
            finished_at=datetime.fromisoformat(payload["finished_at"]), snapshot=payload,
            participants=[{"player_key": player["id"], "display_name": player["name"],
                           "user_id": (account or self.user.id) if player["id"] == "self"
                           else self.other.id if not player["is_cpu"] else None}
                          for player in payload["participants"]],
        )
        self.assertTrue(result.succeeded)
        return result

    def test_catalog_has_exact_approved_ids_points_thresholds_and_original_bilingual_flavours(self):
        self.assertEqual([item["id"] for item in ACHIEVEMENTS], [f"hausdepp_{n:02}" for n in range(1, 139)])
        self.assertEqual([item["points"] for item in ACHIEVEMENTS[:64]], [
            10, 25, 10, 10, 10, 10, 25, 50, 10, 25, 50, 25, 50, 25, 50, 100,
            25, 50, 100, 25, 25, 50, 10, 50, 10, 25, 25, 50, 25, 25, 50, 100,
            25, 50, 25, 50, 50, 50, 50, 100, 10, 25, 25, 50, 10, 25, 50, 100,
            10, 25, 50, 25, 50, 25, 50, 10, 10, 25, 25, 50, 50, 50, 50, 50,
        ])
        self.assertEqual([item["points"] for item in ACHIEVEMENTS[64:115]], [
            25, 50, 25, 25, 25, 25, 25, 50, 25, 50, 50, 25,
            10, 10, 50, 25, 25, 25, 10, 25,
            10, 25, 50, 50, 10, 50, 25, 50, 25, 25, 50, 25, 10, 10, 25, 25,
            # When and how often: office hours, breaks, night, weekends, streaks, totals.
            10, 25, 50, 100, 10, 25, 25, 25, 25, 10, 25, 50, 100, 100, 100,
        ])
        self.assertEqual([item["points"] for item in ACHIEVEMENTS[115:136]],
                         [*([50] * 8), 100, 500, *([25] * 8), 50, 250, 0])
        # The 136 original awards keep their exact total; 137/138 are appended.
        self.assertEqual(sum(item["points"] for item in ACHIEVEMENTS[:136]), 5605)
        self.assertEqual([item["points"] for item in ACHIEVEMENTS[136:]], [50, 50])
        self.assertEqual(sum(item["points"] for item in ACHIEVEMENTS), 5705)
        # Literal category baseline for 1..136, written out independently of _category.
        old_categories = [
            *["participation"] * 8, *["community"] * 8, *["cut_gamble"] * 8, *["tens"] * 8,
            *["four"] * 8, *["tempo"] * 8, *["mishaps"] * 8, *["endgame"] * 8,
            *["comebacks"] * 12, *["style"] * 8, *["tournament"] * 16, *["habits"] * 15,
            *["surprises_activated"] * 10, *["surprises_witnessed"] * 10, "zonk",
        ]
        self.assertEqual([item["category"] for item in ACHIEVEMENTS[:136]], old_categories)
        self.assertEqual([item["category"] for item in ACHIEVEMENTS[136:]], ["tempo", "endgame"])
        self.assertEqual([rank["threshold"] for rank in RANKS], [
            0, 25, 50, 100, 150, 225, 300, 400, 500, 650, 800, 1000,
            # Above 2300 the ladder stretches so the last ranks take real time.
            1200, 1450, 1700, 2000, 2300, 2900, 3600, 4400, 5300, 6300, 7500, 9000,
        ])
        self.assertEqual(RANKS[2]["quote"]["de"], "Ab jetzt geht’s bergab. Ganz nach den Naturgesetzen.")
        self.assertEqual(len({rank["quote"]["de"] for rank in RANKS}), 24)
        for item in (*ACHIEVEMENTS, *RANKS):
            for key in ("name", "description") if "description" in item else ("name", "quote"):
                self.assertEqual(set(item[key]), {"de", "en"})
                self.assertTrue(all(item[key].values()))

    def test_empty_account_is_einstein_with_full_catalog_without_fabricated_awards(self):
        account = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(account["schema_version"], 2)
        self.assertEqual(account["scoring"], {"available": True, "points": 0, "round_points": 0,
                                             "achievement_points": 0, "round_reward": 10,
                                             "cpu_round_reward": 2, "cpu_reduction_percent": 75})
        self.assertEqual(account["rank"]["name"]["de"], "Einstein")
        self.assertEqual(account["rank"]["progress"], {"current": 0, "target": 25, "percent": 0})
        self.assertEqual((len(account["ranks"]), len(account["achievements"]["items"])), (24, 138))
        self.assertEqual(account["achievements"]["unlocked_count"], 0)
        self.assertIsNone(account["presentation"]["pending"])

    def test_first_round_points_and_rank_skip_are_idempotent_and_private(self):
        self.store(self.payload(flags=("hausdepp_17", "hausdepp_18", "hausdepp_25"),
                                foreign_flags=("hausdepp_20",)))
        first = build_hausdepp_account_for_user(self.user.id)
        second = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(first, second)
        self.assertEqual(first["scoring"], {"available": True, "points": 87, "round_points": 2,
                                           "achievement_points": 85, "round_reward": 10,
                                           "cpu_round_reward": 2, "cpu_reduction_percent": 75})
        pending = first["presentation"]["pending"]
        self.assertTrue(pending["rank_up"])
        self.assertEqual((pending["from_rank"]["level"], pending["to_rank"]["level"]), (1, 3))
        unlocked = {item["id"] for item in first["achievements"]["items"] if item["unlocked"]}
        self.assertIn("hausdepp_17", unlocked)
        self.assertNotIn("hausdepp_20", unlocked)
        self.assertNotIn("PRIVATE", json.dumps(first))
        self.assertNotIn("achievement_evidence", json.dumps(first))
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)), 3)

    def test_legacy_results_only_grant_verifiable_membership_and_outcome_achievements(self):
        payload = self.payload(schema=1, cpu=False, loser="self")
        payload["achievement_evidence"] = {"flags": ["hausdepp_62"]}
        self.store(payload)
        result = synchronize_hausdepp_progress(self.user.id)
        unlocked = {item["id"] for item in result["achievements"]["items"] if item["unlocked"]}
        self.assertEqual(unlocked, {"hausdepp_01"})
        self.assertEqual(result["scoring"]["points"], 20)
        items = {item["id"]: item for item in result["achievements"]["items"]}
        self.assertEqual(items["hausdepp_56"]["progress"], {"current": 1, "target": 3})

    def test_table_sizes_cpu_and_cumulative_ten_clears_progress(self):
        for index in range(15):
            self.store(self.payload(f"size-{index}", count=2 + index % 5, ten_clears=4,
                                    at=self.at + timedelta(minutes=index)))
        result = synchronize_hausdepp_progress(self.user.id)
        by_id = {item["id"]: item for item in result["achievements"]["items"]}
        self.assertTrue(all(by_id[f"hausdepp_{n:02}"]["unlocked"] for n in (*range(3, 10), 29)))
        self.assertEqual(by_id["hausdepp_02"]["progress"], {"current": 15, "target": 25})
        self.assertEqual(by_id["hausdepp_29"]["progress"], {"current": 25, "target": 25})

    def test_social_progress_uses_distinct_account_ids_not_names_cpu_or_own_account(self):
        for index in range(10):
            self.store(self.payload(f"familiar-{index}", cpu=False, at=self.at + timedelta(minutes=index)))
        result = synchronize_hausdepp_progress(self.user.id)
        by_id = {item["id"]: item for item in result["achievements"]["items"]}
        self.assertTrue(by_id["hausdepp_14"]["unlocked"])
        self.assertEqual(by_id["hausdepp_12"]["progress"], {"current": 1, "target": 5})
        self.assertNotIn('"opponents":', json.dumps(result))
        self.assertNotIn("user_id", json.dumps(result))

    def test_invalid_foreign_ambiguous_and_wrong_game_rows_never_mint_credit(self):
        self.store(self.payload("wronggame"), game_type="zilch")
        self.store(self.payload("foreign"), account=self.other.id)
        self.store(self.payload("ambiguous", cpu=False))
        self.store(self.payload("damaged"))
        self.store(self.payload("cpu-forged"))
        with session_scope() as db:
            ambiguous = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "ambiguous"))
            ambiguous.participants[1].user_id = self.user.id
            damaged = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "damaged"))
            damaged.snapshot_json = "{}"
            cpu = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "cpu-forged"))
            cpu.participants[1].user_id = self.user.id
        result = synchronize_hausdepp_progress(self.user.id)
        self.assertEqual(result["scoring"]["points"], 0)
        self.assertEqual(result["achievements"]["unlocked_count"], 0)

    def test_schema_two_evidence_is_strict_bounded_and_strips_all_tracking(self):
        good = self.payload(flags=("hausdepp_17",))
        validated = validate_hausdepp_result(good)
        self.assertEqual(validated["achievement_evidence"]["players"]["self"],
                         {"flags": ["hausdepp_17"], "ten_clears": 0})
        self.assertNotIn("PRIVATE", json.dumps(validated))
        invalid = [None, {}, {"schema_version": True, "complete": True, "players": {}},
                   {"schema_version": 1, "complete": "yes", "players": {}}]
        for raw in invalid:
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, "invalid_evidence"):
                validate_hausdepp_result({**good, "achievement_evidence": raw})
        for change in ({"flags": ["hausdepp_01"]}, {"flags": ["hausdepp_17"] * 2},
                       {"flags": ["unknown"]}, {"ten_clears": True}, {"ten_clears": 5}, {"flags": [17]}):
            raw = copy.deepcopy(good)
            raw["achievement_evidence"]["players"]["self"].update(change)
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "invalid_evidence"):
                validate_hausdepp_result(raw)
        for flag in ("hausdepp_62", "hausdepp_74", "hausdepp_75", "hausdepp_84"):
            incomplete = self.payload(flags=(flag,), complete=False)
            with self.subTest(flag=flag), self.assertRaisesRegex(ValueError, "invalid_evidence"):
                validate_hausdepp_result(incomplete)

    def test_result_list_never_exposes_own_or_foreign_private_event_evidence(self):
        self.store(self.payload(flags=("hausdepp_17",), foreign_flags=("hausdepp_20",)))
        encoded = json.dumps(list_hausdepp_results_for_user(self.user.id))
        for private in ("achievement_evidence", "hausdepp_17", "hausdepp_20", "ten_clears", "PRIVATE"):
            self.assertNotIn(private, encoded)
        self.assertEqual(len(list_hausdepp_results_for_user(self.user.id)), 1)

    def test_acknowledgements_are_durable_monotonic_and_do_not_swallow_new_generation(self):
        self.store(self.payload())
        first = synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"]
        self.assertEqual(first["revision"], 20)
        acknowledge_hausdepp_presentation(self.user.id, first["revision"])
        self.assertIsNone(synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"])
        self.store(self.payload("round-2", at=self.at + timedelta(minutes=1)))
        acknowledge_hausdepp_presentation(self.user.id, first["revision"])
        pending = synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"]
        self.assertEqual((pending["revision"], pending["points_earned"]), (30, 2))
        self.assertEqual(pending["achievement_ids"], [])
        self.assertFalse(pending["rank_up"])
        self.assertEqual(pending["from_rank"]["level"], pending["to_rank"]["level"])
        self.assertEqual(acknowledge_hausdepp_presentation(self.user.id, 30), {"acknowledged": True, "revision": 30})
        self.assertEqual(acknowledge_hausdepp_presentation(self.user.id, 20), {"acknowledged": True, "revision": 30})
        for invalid in (True, -1, "30", 31):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "invalid_revision"):
                acknowledge_hausdepp_presentation(self.user.id, invalid)

    def test_concurrent_recovery_creates_one_credit_and_one_unlock_per_definition(self):
        self.store(self.payload(flags=("hausdepp_25",)))
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(lambda _: synchronize_hausdepp_progress(self.user.id), range(5)))
        self.assertTrue(all(result["scoring"]["points"] == 12 for result in results))
        badge = next(item for item in results[0]["achievements"]["items"] if item["id"] == "hausdepp_25")
        self.assertEqual(badge["progress"], {"current": 1, "target": 5})
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)), 1)

    def test_late_older_completion_does_not_reannounce_seen_badges_or_hide_new_ones(self):
        self.store(self.payload("newer-first", cpu=False, at=self.at + timedelta(hours=1)))
        first = synchronize_hausdepp_progress(self.user.id)
        self.assertEqual(first["scoring"]["points"], 20)
        acknowledge_hausdepp_presentation(self.user.id, 20)
        self.store(self.payload("older-recovered", flags=("hausdepp_17",), at=self.at))
        pending = synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"]
        self.assertEqual((pending["revision"], pending["points_earned"]), (55, 27))
        self.assertEqual(set(pending["achievement_ids"]), {"hausdepp_17"})
        with session_scope() as db:
            grants = db.scalars(select(HausdeppAchievementUnlock).where(
                HausdeppAchievementUnlock.user_id == self.user.id,
            )).all()
            self.assertTrue(all(grant.awarded_points > 20 for grant in grants
                                if grant.achievement_id in pending["achievement_ids"]))

    def test_human_tables_and_distinct_social_thresholds_are_derived_from_account_membership(self):
        friends = [create_user(f"GastXP{index}", "test-password-123", must_change_password=False)
                   for index in range(10)]
        for index in range(3):
            group = index % 2
            accounts = [self.user, *friends[group * 5:group * 5 + 5]]
            players = [{"id": f"seat-{number}", "name": account.username, "is_cpu": False}
                       for number, account in enumerate(accounts)]
            payload = {"schema_version": 1, "payload_kind": "hausdepp_result", "game_type": "hausdepp",
                       "game_id": f"humans-{index}", "name": "Menschentisch",
                       "finished_at": (self.at + timedelta(minutes=index)).isoformat(),
                       "participants": players, "loser_id": players[-1]["id"],
                       "finished_order": [player["id"] for player in players[:-1]]}
            self.assertTrue(persist_completed_game_result(
                game_id=payload["game_id"], game_name=payload["name"], game_type="hausdepp", mode="6", hardcore=False,
                finished_at=datetime.fromisoformat(payload["finished_at"]), snapshot=payload,
                participants=[{"player_key": player["id"], "display_name": player["name"], "user_id": account.id}
                              for player, account in zip(players, accounts)],
            ).succeeded)
        result = synchronize_hausdepp_progress(self.user.id)
        by_id = {item["id"]: item for item in result["achievements"]["items"]}
        self.assertTrue(all(by_id[f"hausdepp_{number:02}"]["unlocked"] for number in (7, 10, 11, 12, 13)))
        self.assertEqual(by_id["hausdepp_13"]["progress"], {"current": 10, "target": 10})
        self.assertFalse(by_id["hausdepp_09"]["unlocked"])

    def test_finalization_failure_is_recovered_by_account_read_and_retry_keeps_original(self):
        payload = self.payload(flags=("hausdepp_17",))
        game = {"_id": payload["game_id"], "_name": payload["name"], "_mode": "2", "_finished": True,
                "_finished_at": payload["finished_at"],
                "_participants": [{**player, "user_id": self.user.id if player["id"] == "self" else None}
                                   for player in payload["participants"]],
                "_hausdepp": {"phase": "finished", "loser_id": payload["loser_id"],
                               "finished_order": payload["finished_order"],
                               "achievement_evidence": payload["achievement_evidence"]}}
        with patch("app.hausdepp_achievements.synchronize_hausdepp_progress", side_effect=RuntimeError("retry me")):
            self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["scoring"]["points"], 37)
        game["_hausdepp"]["achievement_evidence"]["players"]["self"]["flags"] = ["hausdepp_19"]
        self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["scoring"]["points"], 37)

    def test_all_aggregate_milestones_and_final_rank_remain_reachable_without_rare_events(self):
        # One bulk durable history fixture; no tactical evidence or invented XP.
        with session_scope() as db:
            for index in range(900):
                payload = self.payload(f"steady-{index:03}", schema=1, cpu=False, at=self.at + timedelta(minutes=index))
                row = CompletedGame(game_id=payload["game_id"], game_type="hausdepp", game_name=payload["name"],
                                    mode="2", hardcore=False, finished_at=datetime.fromisoformat(payload["finished_at"]),
                                    snapshot_json=json.dumps(payload), created_at=self.at)
                row.participants = [GameParticipant(position=n, player_key=player["id"], display_name=player["name"],
                                                    points=0, user_id=self.user.id if n == 0 else None)
                                    for n, player in enumerate(payload["participants"])]
                db.add(row)
        result = synchronize_hausdepp_progress(self.user.id)
        self.assertEqual(result["scoring"]["round_points"], 9000)
        self.assertEqual(result["rank"]["name"]["de"], "Hausdepp")
        self.assertIsNone(result["rank"]["next"])
        self.assertEqual(result["rank"]["progress"]["percent"], 100)
        unlocked = {item["id"] for item in result["achievements"]["items"] if item["unlocked"]}
        self.assertTrue({"hausdepp_02", "hausdepp_15", "hausdepp_16"}.issubset(unlocked))
        self.assertNotIn("hausdepp_62", unlocked)

    def test_new_comeback_style_and_three_digit_id_are_individual_one_time_awards(self):
        flags = [f"hausdepp_{number:02}" for number in range(65, 85)]
        self.store(self.payload(flags=flags))
        first = synchronize_hausdepp_progress(self.user.id)
        first_unlocked = {item["id"] for item in first["achievements"]["items"] if item["unlocked"]}
        self.assertEqual(first_unlocked, {"hausdepp_01", "hausdepp_74", "hausdepp_75", "hausdepp_79"})
        for index in range(1, 5):
            self.store(self.payload(f"recovery-{index}", flags=flags, at=self.at + timedelta(minutes=index)))
        result = synchronize_hausdepp_progress(self.user.id)
        unlocked = {item["id"] for item in result["achievements"]["items"] if item["unlocked"]}
        self.assertTrue(set(flags).issubset(unlocked))
        self.assertNotIn("hausdepp_85", unlocked)
        self.assertNotIn("hausdepp_100", unlocked)
        self.assertEqual(result, synchronize_hausdepp_progress(self.user.id))
        for index in range(3):
            tournament_id = f"eight-losses-{index}"
            payload = self.payload(f"{tournament_id}-r08", schema=3, flags=("hausdepp_100",), loser="self")
            payload["tournament"] = {"schema_version": 1, "id": tournament_id, "round_number": 8,
                                     "losses": {"self": 8, "other": 0}, "round_losers": ["self"] * 8,
                                     "completed": True, "tages_hausdepp_id": "self"}
            self.store(payload)
        final = synchronize_hausdepp_progress(self.user.id)
        hundred = next(item for item in final["achievements"]["items"] if item["id"] == "hausdepp_100")
        self.assertTrue(hundred["unlocked"])
        self.assertEqual(hundred["progress"], {"current": 3, "target": 3})
        self.assertEqual(hundred["points"], 25)

    def test_completed_tournament_lifetime_counts_are_distinct_and_survive_reload(self):
        for index in range(10):
            tournament_id = f"tournament-{index}"
            payload = self.payload(f"{tournament_id}-r08", schema=3, flags=("hausdepp_85", "hausdepp_90"),
                                   at=self.at + timedelta(minutes=index))
            payload["tournament"] = {"schema_version": 1, "id": tournament_id, "round_number": 8,
                                     "losses": {"self": 0, "other": 8}, "round_losers": ["other"] * 8,
                                     "completed": True, "tages_hausdepp_id": "other"}
            self.store(payload)
            result = synchronize_hausdepp_progress(self.user.id)
            by_id = {item["id"]: item for item in result["achievements"]["items"]}
            self.assertEqual(by_id["hausdepp_86"]["progress"], {"current": min(index + 1, 3), "target": 3})
            self.assertEqual(by_id["hausdepp_87"]["progress"], {"current": index + 1, "target": 10})
        self.assertTrue(by_id["hausdepp_86"]["unlocked"])
        self.assertTrue(by_id["hausdepp_87"]["unlocked"])
        self.assertEqual(result, synchronize_hausdepp_progress(self.user.id))
        # A nonterminal tournament round grants ordinary round XP but cannot
        # advance completed-tournament milestones or award tournament flags.
        pending = self.payload("pending-tourney", schema=3)
        pending["tournament"] = {"schema_version": 1, "id": "pending-tourney", "round_number": 1,
                                  "losses": {"self": 0, "other": 1}, "round_losers": ["other"],
                                  "completed": False, "tages_hausdepp_id": None}
        self.store(pending)
        pending["achievement_evidence"]["players"]["self"]["flags"] = ["hausdepp_85"]
        with self.assertRaisesRegex(ValueError, "invalid_tournament"):
            validate_hausdepp_result(pending)
        after = synchronize_hausdepp_progress(self.user.id)
        after_items = {item["id"]: item for item in after["achievements"]["items"]}
        self.assertEqual(after_items["hausdepp_87"]["progress"], {"current": 10, "target": 10})

    def test_appended_mixed_chain_and_quartet_finish_are_ordinary_round_events(self):
        new = ("hausdepp_137", "hausdepp_138")
        self.store(self.payload("ordinary", flags=new))
        first = {item["id"]: item for item in synchronize_hausdepp_progress(self.user.id)["achievements"]["items"]}
        for key, category in zip(new, ("tempo", "endgame")):
            self.assertTrue(first[key]["unlocked"])
            self.assertEqual((first[key]["points"], first[key]["category"]), (50, category))
            self.assertEqual(first[key]["progress"], {"current": 1, "target": 1})
        # Neither an unfinished nor a finished tournament round rejects them,
        # and they are credited without needing a first completed tournament.
        unfinished = self.payload("open-tourney", schema=3, flags=new, at=self.at + timedelta(minutes=1))
        unfinished["tournament"] = {"schema_version": 1, "id": "open-tourney", "round_number": 1,
                                    "losses": {"self": 0, "other": 1}, "round_losers": ["other"],
                                    "completed": False, "tages_hausdepp_id": None}
        self.assertEqual(validate_hausdepp_result(unfinished)["achievement_evidence"]["players"]["self"]["flags"],
                         list(new))
        finished = self.payload("done-tourney-r08", schema=3, flags=(*new, "hausdepp_85"),
                                at=self.at + timedelta(minutes=2))
        finished["tournament"] = {"schema_version": 1, "id": "done-tourney", "round_number": 8,
                                  "losses": {"self": 0, "other": 8}, "round_losers": ["other"] * 8,
                                  "completed": True, "tages_hausdepp_id": "other"}
        validate_hausdepp_result(finished)
        for payload in (unfinished, finished):
            self.store(payload)
        again = {item["id"]: item for item in synchronize_hausdepp_progress(self.user.id)["achievements"]["items"]}
        # Repeated qualifying rounds keep the first unlock date and the one-time 50 XP.
        for key in new:
            self.assertEqual(again[key]["unlocked_at"], first[key]["unlocked_at"])
            self.assertEqual(again[key]["points"], 50)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)
                                       .where(HausdeppAchievementUnlock.achievement_id.in_(new))), 2)
        # Re-delivering the same stored results is a stable no-op.
        self.assertEqual(synchronize_hausdepp_progress(self.user.id), synchronize_hausdepp_progress(self.user.id))

    def test_concurrent_old_and_new_receipts_never_regress_or_hide_unseen_round_points(self):
        self.store(self.payload())
        self.assertEqual(synchronize_hausdepp_progress(self.user.id)["scoring"]["points"], 12)
        self.store(self.payload("second-generation", flags=("hausdepp_17",),
                                at=self.at + timedelta(minutes=1)))
        revisions = [20, 55] * 4
        with ThreadPoolExecutor(max_workers=8) as executor:
            receipts = list(executor.map(
                lambda revision: acknowledge_hausdepp_presentation(self.user.id, revision), revisions,
            ))
        self.assertTrue(all(revision <= receipt["revision"] <= 55
                            for revision, receipt in zip(revisions, receipts)))
        self.assertIsNone(synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"])
        self.store(self.payload("third-generation", at=self.at + timedelta(minutes=2)))
        with ThreadPoolExecutor(max_workers=4) as executor:
            list(executor.map(lambda revision: acknowledge_hausdepp_presentation(self.user.id, revision),
                              [20, 55, 20, 55]))
        pending = synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"]
        self.assertEqual((pending["revision"], pending["points_earned"]), (85, 22))
        self.assertEqual(set(pending["achievement_ids"]), {"hausdepp_03", "hausdepp_57"})

    def test_real_seeded_tournament_credits_every_human_once_and_counts_all_nonlosers(self):
        # A whole tournament uses real peeking, dealing and all legal action
        # transitions. Only randomness is seeded; no hands/results are arranged.
        with patch.dict(main.games, clear=True):
            game = new_hausdepp_game("earned-tournament", "Durchgespielt", "3")
            configure_hausdepp_game(game, host_user_id=self.user.id, cpu_count=1, tournament=True)
            for player_id, account in (("self", self.user), ("other", self.other)):
                join_hausdepp_player(game, {"id": player_id, "name": account.username, "user_id": account.id,
                                            "ws": object(), "resume_token": f"test-{player_id}"})
            start_hausdepp_game(game)
            game["_hausdepp"] = new_round(game["_participants"], dealer_index=2, rng=random.Random(2701))
            observed_losers = []
            while not game["_hausdepp_tournament"]["completed"]:
                memories = {player["id"]: CpuMemory() for player in game["_participants"]}
                for _ in range(5000):
                    if game["_finished"]:
                        break
                    for participant in game["_participants"]:
                        view = project_state(game["_hausdepp"], participant["id"])
                        command = choose_cpu_action(view, memory=memories[participant["id"]])
                        if command:
                            apply_hausdepp_command(game, participant["id"], command,
                                                   trusted_cpu=participant["is_cpu"])
                            memories[participant["id"]].remember(view, command)
                            break
                    else:
                        self.fail("No legal action in a running seeded tournament round")
                self.assertTrue(game["_finished"], "Seeded legal policy did not finish the round")
                observed_losers.append(game["_hausdepp"]["loser_id"])
                self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
                self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
                for account in (self.user, self.other):
                    progress = build_hausdepp_account_for_user(account.id)
                    self.assertEqual(progress["scoring"]["round_points"], len(observed_losers) * 2)
                    self.assertEqual(progress["statistics"]["rounds_played"], len(observed_losers))
                    awards = {item["id"] for item in progress["achievements"]["items"] if item["unlocked"]}
                    if not game["_hausdepp_tournament"]["completed"]:
                        self.assertFalse(awards.intersection(f"hausdepp_{number:02}" for number in range(85, 101)))
                if not game["_hausdepp_tournament"]["completed"]:
                    self.assertIn(game["_id"], load_active_games())
                    round_number = len(observed_losers) + 1
                    with patch("app.hausdepp_tournament.new_round", side_effect=lambda players, dealer_index, **rules: new_round(
                        players, dealer_index=dealer_index, rng=random.Random(2700 + round_number), **rules,
                    )):
                        apply_hausdepp_command(game, "self", {"action": "next_round",
                                                             "version": game["_hausdepp"]["version"]})
            round_count = len(observed_losers)
            self.assertEqual(max(observed_losers.count(key) for key in set(observed_losers)), 8)
            self.assertEqual(game["_hausdepp_tournament"]["round_losers"], observed_losers)
            self.assertNotIn(game["_id"], load_active_games())
            standings = build_hausdepp_leaderboard(self.user.id, players=3)
            by_name = {entry["display_name"]: entry for entry in standings["entries"]}
            self.assertEqual(set(by_name), {self.user.username, self.other.username})
            for key, account in (("self", self.user), ("other", self.other)):
                self.assertEqual(by_name[account.username]["wins"], round_count - observed_losers.count(key))
                self.assertEqual(by_name[account.username]["rounds_played"], round_count)
                progress = synchronize_hausdepp_progress(account.id)
                self.assertEqual(progress["scoring"]["round_points"], round_count * 2)
                items = {item["id"]: item for item in progress["achievements"]["items"]}
                self.assertTrue(items["hausdepp_85"]["unlocked"])
                self.assertEqual(items["hausdepp_89"]["unlocked"], key == observed_losers[-1])
                self.assertEqual(progress["scoring"]["achievement_points"],
                                 sum(item["points"] for item in items.values() if item["unlocked"]))
            with session_scope() as db:
                self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), round_count * 2)
                self.assertEqual(db.scalar(select(func.count()).select_from(CompletedGame)), round_count)
            saved_progress = {account.id: synchronize_hausdepp_progress(account.id)
                              for account in (self.user, self.other)}
            main.games.clear()
            configure_database(Path(self.temp.name))
            upgrade_database(main.BASE)
            for account in (self.user, self.other):
                self.assertEqual(synchronize_hausdepp_progress(account.id), saved_progress[account.id])

    def test_common_achievements_progress_once_per_distinct_round_and_unlock_in_stages(self):
        previous = set()
        # All rounds finish on one evening: five earn "Spielabend", ten "Kartenmarathon".
        milestones = {1: {"hausdepp_01"}, 3: {"hausdepp_03", "hausdepp_49", "hausdepp_57"},
                      5: {"hausdepp_09", "hausdepp_25", "hausdepp_110"}, 10: {"hausdepp_45", "hausdepp_111"}}
        for number in range(1, 11):
            self.store(self.payload(f"balanced-{number}", flags=("hausdepp_25", "hausdepp_45", "hausdepp_49"),
                                    at=self.at + timedelta(minutes=number)))
            result = synchronize_hausdepp_progress(self.user.id)
            self.assertEqual(result, synchronize_hausdepp_progress(self.user.id))
            items = {item["id"]: item for item in result["achievements"]["items"]}
            unlocked = {key for key, item in items.items() if item["unlocked"]}
            self.assertEqual(unlocked - previous, milestones.get(number, set()))
            self.assertEqual(items["hausdepp_25"]["progress"], {"current": min(number, 5), "target": 5})
            self.assertEqual(items["hausdepp_45"]["progress"], {"current": number, "target": 10})
            self.assertEqual(result["scoring"]["round_points"], number * 2)
            previous = unlocked

    def test_previously_earned_awards_are_not_revoked_by_higher_future_goals(self):
        self.store(self.payload(flags=("hausdepp_25",)))
        synchronize_hausdepp_progress(self.user.id)
        # Represents a badge already earned under the former one-round rule.
        with session_scope() as db:
            db.add(HausdeppAchievementUnlock(user_id=self.user.id, achievement_id="hausdepp_25",
                                             source_game_id="round-1", unlocked_at=self.at, awarded_points=30))
        result = synchronize_hausdepp_progress(self.user.id)
        badge = next(item for item in result["achievements"]["items"] if item["id"] == "hausdepp_25")
        self.assertTrue(badge["unlocked"])
        self.assertEqual(result["scoring"]["points"], 22)
        self.assertEqual(result, synchronize_hausdepp_progress(self.user.id))

    def test_repeated_conditions_are_honest_in_both_languages(self):
        items = {item["id"]: item for item in ACHIEVEMENTS}
        for number in (25, 33, 41, 49, 56, 57):
            description = items[f"hausdepp_{number:02}"]["description"]
            self.assertNotIn("ersten Mal", description["de"])
            self.assertNotIn("first", description["en"])
        self.assertIn("5", items["hausdepp_25"]["description"]["de"])
        self.assertIn("5", items["hausdepp_25"]["description"]["en"])
        self.assertIn("drei", items["hausdepp_100"]["description"]["de"])
        self.assertIn("three", items["hausdepp_100"]["description"]["en"])

    def test_optional_round_duration_requires_a_real_consistent_start_and_never_invents_history(self):
        payload = self.payload()
        self.assertNotIn("duration_seconds", validate_hausdepp_result(payload))
        valid = {**payload, "started_at": (self.at - timedelta(seconds=42)).isoformat(), "duration_seconds": 42}
        result = validate_hausdepp_result(valid)
        self.assertEqual(result["duration_seconds"], 42)
        self.assertEqual(result["started_at"], valid["started_at"])
        for changes in ({"started_at": "not-a-date"}, {"started_at": "2026-10-16T10:29:18"},
                        {"started_at": (self.at + timedelta(seconds=1)).isoformat()},
                        {"started_at": (self.at - timedelta(days=31)).isoformat()},
                        {"duration_seconds": True}, {"duration_seconds": float("nan")},
                        {"duration_seconds": float("inf")}, {"duration_seconds": 10 ** 1000},
                        {"duration_seconds": 41}):
            with self.subTest(changes=changes):
                projected = validate_hausdepp_result({**valid, **changes})
                self.assertNotIn("started_at", projected)
                self.assertNotIn("duration_seconds", projected)

    def test_play_time_and_streak_achievements_follow_swiss_local_time(self):
        def unlocked():
            return {item["id"] for item in synchronize_hausdepp_progress(self.user.id)["achievements"]["items"]
                    if item["unlocked"]}

        # Tuesday 10:00 in Zurich (summer time, UTC+2) counts as office hours.
        self.store(self.payload("office", at=datetime(2026, 10, 13, 8, tzinfo=timezone.utc)))
        self.assertIn("hausdepp_101", unlocked())
        # 03:30 in Zurich is a night-owl round, even though it is 01:30 UTC.
        self.store(self.payload("night", at=datetime(2026, 10, 14, 1, 30, tzinfo=timezone.utc)))
        self.assertIn("hausdepp_107", unlocked())
        self.assertNotIn("hausdepp_112", unlocked())
        # Seven consecutive Zurich days, each with an evening round, build the week streak.
        for day in range(15, 22):
            self.store(self.payload(f"streak-{day}", at=datetime(2026, 10, day, 18, 30, tzinfo=timezone.utc)))
        progress = synchronize_hausdepp_progress(self.user.id)
        items = {item["id"]: item for item in progress["achievements"]["items"]}
        self.assertTrue(items["hausdepp_112"]["unlocked"])
        # 13 and 14 October continue straight into the week: nine days in a row.
        self.assertEqual(items["hausdepp_113"]["progress"], {"current": 9, "target": 14})
        self.assertEqual(items["hausdepp_109"]["progress"]["current"], 2)  # 17 and 18 October are a weekend
        self.assertEqual(items["hausdepp_101"]["category"], "habits")
