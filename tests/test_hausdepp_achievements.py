"""Private Hausdepp awards: completed evidence, idempotence and durable delivery."""

from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select

from app import main
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
from app.hausdepp_results import finalize_hausdepp_result, list_hausdepp_results_for_user, validate_hausdepp_result
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
        self.at = datetime(2026, 10, 16, 10, 30, tzinfo=timezone.utc)

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
        self.assertEqual([item["id"] for item in ACHIEVEMENTS], [f"hausdepp_{n:02}" for n in range(1, 101)])
        self.assertEqual([item["points"] for item in ACHIEVEMENTS[:64]], [
            10, 25, 10, 10, 10, 10, 25, 50, 10, 25, 50, 25, 50, 25, 50, 100,
            25, 50, 100, 25, 25, 50, 10, 50, 10, 25, 25, 50, 25, 25, 50, 100,
            25, 50, 25, 50, 50, 50, 50, 100, 10, 25, 25, 50, 10, 25, 50, 100,
            10, 25, 50, 25, 50, 25, 50, 10, 10, 25, 25, 50, 50, 50, 50, 50,
        ])
        self.assertEqual([item["points"] for item in ACHIEVEMENTS[64:]], [
            25, 50, 25, 25, 25, 25, 25, 50, 25, 50, 50, 25,
            10, 10, 50, 25, 25, 25, 10, 25,
            10, 25, 50, 50, 10, 50, 25, 50, 25, 25, 50, 25, 10, 10, 25, 25,
        ])
        self.assertEqual(sum(item["points"] for item in ACHIEVEMENTS), 3425)
        self.assertEqual([rank["threshold"] for rank in RANKS], [
            0, 25, 50, 100, 150, 225, 300, 400, 500, 650, 800, 1000,
            1200, 1450, 1700, 2000, 2300, 2650, 3000, 3400, 3800, 4200, 4600, 5000,
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
                                             "achievement_points": 0, "round_reward": 10})
        self.assertEqual(account["rank"]["name"]["de"], "Einstein")
        self.assertEqual(account["rank"]["progress"], {"current": 0, "target": 25, "percent": 0})
        self.assertEqual((len(account["ranks"]), len(account["achievements"]["items"])), (24, 100))
        self.assertEqual(account["achievements"]["unlocked_count"], 0)
        self.assertIsNone(account["presentation"]["pending"])

    def test_first_round_points_and_rank_skip_are_idempotent_and_private(self):
        self.store(self.payload(flags=("hausdepp_17", "hausdepp_18", "hausdepp_25"),
                                foreign_flags=("hausdepp_20",)))
        first = build_hausdepp_account_for_user(self.user.id)
        second = build_hausdepp_account_for_user(self.user.id)
        self.assertEqual(first, second)
        self.assertEqual(first["scoring"], {"available": True, "points": 135, "round_points": 10,
                                           "achievement_points": 125, "round_reward": 10})
        pending = first["presentation"]["pending"]
        self.assertTrue(pending["rank_up"])
        self.assertEqual((pending["from_rank"]["level"], pending["to_rank"]["level"]), (1, 4))
        unlocked = {item["id"] for item in first["achievements"]["items"] if item["unlocked"]}
        self.assertIn("hausdepp_17", unlocked)
        self.assertNotIn("hausdepp_20", unlocked)
        self.assertNotIn("PRIVATE", json.dumps(first))
        self.assertNotIn("achievement_evidence", json.dumps(first))
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)), 7)

    def test_legacy_results_only_grant_verifiable_membership_and_outcome_achievements(self):
        payload = self.payload(schema=1, cpu=False, loser="self")
        payload["achievement_evidence"] = {"flags": ["hausdepp_62"]}
        self.store(payload)
        result = synchronize_hausdepp_progress(self.user.id)
        unlocked = {item["id"] for item in result["achievements"]["items"] if item["unlocked"]}
        self.assertEqual(unlocked, {"hausdepp_01", "hausdepp_03", "hausdepp_56"})
        self.assertEqual(result["scoring"]["points"], 40)

    def test_table_sizes_cpu_and_cumulative_ten_clears_progress(self):
        for index in range(7):
            self.store(self.payload(f"size-{index}", count=2 + index % 5, ten_clears=4,
                                    at=self.at + timedelta(minutes=index)))
        result = synchronize_hausdepp_progress(self.user.id)
        by_id = {item["id"]: item for item in result["achievements"]["items"]}
        self.assertTrue(all(by_id[f"hausdepp_{n:02}"]["unlocked"] for n in (*range(3, 10), 29)))
        self.assertEqual(by_id["hausdepp_02"]["progress"], {"current": 7, "target": 25})
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
        self.assertEqual(first["revision"], 50)
        acknowledge_hausdepp_presentation(self.user.id, first["revision"])
        self.assertIsNone(synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"])
        self.store(self.payload("round-2", at=self.at + timedelta(minutes=1)))
        acknowledge_hausdepp_presentation(self.user.id, first["revision"])
        pending = synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"]
        self.assertEqual((pending["revision"], pending["points_earned"]), (60, 10))
        self.assertEqual(pending["achievement_ids"], [])
        self.assertFalse(pending["rank_up"])
        self.assertEqual(acknowledge_hausdepp_presentation(self.user.id, 60), {"acknowledged": True, "revision": 60})
        self.assertEqual(acknowledge_hausdepp_presentation(self.user.id, 50), {"acknowledged": True, "revision": 60})
        for invalid in (True, -1, "60", 61):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "invalid_revision"):
                acknowledge_hausdepp_presentation(self.user.id, invalid)

    def test_concurrent_recovery_creates_one_credit_and_one_unlock_per_definition(self):
        self.store(self.payload(flags=("hausdepp_25",)))
        with ThreadPoolExecutor(max_workers=5) as executor:
            results = list(executor.map(lambda _: synchronize_hausdepp_progress(self.user.id), range(5)))
        self.assertTrue(all(result["scoring"]["points"] == 60 for result in results))
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppRoundCredit)), 1)
            self.assertEqual(db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)), 5)

    def test_late_older_completion_does_not_reannounce_seen_badges_or_hide_new_ones(self):
        self.store(self.payload("newer-first", cpu=False, at=self.at + timedelta(hours=1)))
        first = synchronize_hausdepp_progress(self.user.id)
        self.assertEqual(first["scoring"]["points"], 40)
        acknowledge_hausdepp_presentation(self.user.id, 40)
        self.store(self.payload("older-recovered", flags=("hausdepp_17",), at=self.at))
        pending = synchronize_hausdepp_progress(self.user.id)["presentation"]["pending"]
        self.assertEqual((pending["revision"], pending["points_earned"]), (85, 45))
        self.assertEqual(set(pending["achievement_ids"]), {"hausdepp_09", "hausdepp_17"})
        with session_scope() as db:
            grants = db.scalars(select(HausdeppAchievementUnlock).where(
                HausdeppAchievementUnlock.user_id == self.user.id,
            )).all()
            self.assertTrue(all(grant.awarded_points > 40 for grant in grants
                                if grant.achievement_id in pending["achievement_ids"]))

    def test_human_tables_and_distinct_social_thresholds_are_derived_from_account_membership(self):
        friends = [create_user(f"GastXP{index}", "test-password-123", must_change_password=False)
                   for index in range(10)]
        for index in range(2):
            accounts = [self.user, *friends[index * 5:index * 5 + 5]]
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
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["scoring"]["points"], 75)
        game["_hausdepp"]["achievement_evidence"]["players"]["self"]["flags"] = ["hausdepp_19"]
        self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
        self.assertEqual(build_hausdepp_account_for_user(self.user.id)["scoring"]["points"], 75)

    def test_all_aggregate_milestones_and_final_rank_remain_reachable_without_rare_events(self):
        # One bulk durable history fixture; no tactical evidence or invented XP.
        with session_scope() as db:
            for index in range(500):
                payload = self.payload(f"steady-{index:03}", schema=1, at=self.at + timedelta(minutes=index))
                row = CompletedGame(game_id=payload["game_id"], game_type="hausdepp", game_name=payload["name"],
                                    mode="2", hardcore=False, finished_at=datetime.fromisoformat(payload["finished_at"]),
                                    snapshot_json=json.dumps(payload), created_at=self.at)
                row.participants = [GameParticipant(position=n, player_key=player["id"], display_name=player["name"],
                                                    points=0, user_id=self.user.id if n == 0 else None)
                                    for n, player in enumerate(payload["participants"])]
                db.add(row)
        result = synchronize_hausdepp_progress(self.user.id)
        self.assertEqual(result["scoring"]["round_points"], 5000)
        self.assertEqual(result["rank"]["name"]["de"], "Hausdepp")
        self.assertIsNone(result["rank"]["next"])
        self.assertEqual(result["rank"]["progress"]["percent"], 100)
        unlocked = {item["id"] for item in result["achievements"]["items"] if item["unlocked"]}
        self.assertTrue({"hausdepp_02", "hausdepp_15", "hausdepp_16"}.issubset(unlocked))
        self.assertNotIn("hausdepp_62", unlocked)

    def test_new_comeback_style_and_three_digit_id_are_individual_one_time_awards(self):
        flags = [f"hausdepp_{number:02}" for number in range(65, 85)]
        self.store(self.payload(flags=flags))
        result = synchronize_hausdepp_progress(self.user.id)
        unlocked = {item["id"] for item in result["achievements"]["items"] if item["unlocked"]}
        self.assertTrue(set(flags).issubset(unlocked))
        self.assertNotIn("hausdepp_85", unlocked)
        self.assertNotIn("hausdepp_100", unlocked)
        self.assertEqual(result, synchronize_hausdepp_progress(self.user.id))
        payload = self.payload("eight-losses-r08", schema=3, flags=("hausdepp_100",), loser="self")
        payload["tournament"] = {"schema_version": 1, "id": "eight-losses", "round_number": 8,
                                 "losses": {"self": 8, "other": 0}, "round_losers": ["self"] * 8,
                                 "completed": True, "tages_hausdepp_id": "self"}
        self.store(payload)
        final = synchronize_hausdepp_progress(self.user.id)
        hundred = next(item for item in final["achievements"]["items"] if item["id"] == "hausdepp_100")
        self.assertTrue(hundred["unlocked"])
        self.assertEqual(hundred["progress"], {"current": 1, "target": 1})
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
