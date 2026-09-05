"""Focused persistence contracts for private, server-derived Zilch awards.

These tests deliberately write typed Zilch results through the shared result
writer and then invoke the isolated registration boundary.  They must never
depend on a browser event or on the public ZDWA achievement tables.
"""

from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import TestCase
from unittest.mock import patch

from alembic.config import Config
from sqlalchemy import func, inspect, select, text

from alembic import command
from app import main
from app.auth import create_user
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.game_history import delete_completed_game, persist_completed_game_result
from app.game_state import games
from app.game_types import ZILCH_GAME_TYPE
from app.models import (
    CompletedGame,
    ZilchAchievementDelivery,
    ZilchAchievementEvaluation,
    ZilchAchievementEvidence,
    ZilchAchievementRankDelivery,
    ZilchAchievementUnlock,
    ZilchCommunityGame,
    ZilchCommunityMilestone,
    ZilchCommunityParticipant,
    ZilchCommunityRecipient,
    ZilchCommunityState,
)
from app.zilch_achievements import (
    ZILCH_ACHIEVEMENT_BY_KEY,
    ZILCH_ACHIEVEMENT_CATALOG_VERSION,
    ZILCH_ACHIEVEMENT_NAMESPACE,
    ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
    ZILCH_ACHIEVEMENTS,
    ZilchAchievementError,
    _criterion_is_satisfied,
    _register_evaluation,
    acknowledge_zilch_award,
    acknowledge_zilch_rank_upgrade,
    get_zilch_achievement_profile,
    pending_zilch_awards,
    recover_deleted_zilch_achievement_sources,
    recover_pending_zilch_achievement_evaluations,
    register_zilch_result_for_achievements,
    remove_zilch_result_from_achievements,
    resync_zilch_achievement_catalog,
    zilch_achievement_definitions_payload,
    zilch_achievement_points_for_keys,
    zilch_achievement_rank_for_points,
    zilch_achievement_rank_legend_payload,
)
from app.zilch_engine import ZILCH_RULESET_VERSION
from app.zilch_results import build_zilch_result_payload
from app.zilch_solo_objective import (
    ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
    ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
    ZILCH_SOLO_SPRINT_TARGET_SCORE,
)
from app.zilch_state import (
    configure_zilch_cpu_game,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_start_roll,
    start_zilch_game,
)


class ZilchAchievementPersistenceTestCase(TestCase):
    """Awards are isolated, explicit, idempotent and reversible by source."""

    def setUp(self) -> None:
        # ``new_zilch_game`` registers its state in the process-local game
        # registry. Keep each database fixture from leaking its finished test
        # tables into a later app lifespan, where recovery would otherwise
        # replay them against a different temporary database.
        self.initial_game_ids = set(games)
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temporary_directory.name) / "zilch-achievements.sqlite3"
        self.environment = patch.dict(
            os.environ,
            {
                "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.database_path}",
                "ROLLTHEDICE_TURNSTILE_SITE_KEY": "",
                "ROLLTHEDICE_TURNSTILE_SECRET": "",
                "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "",
            },
        )
        self.environment.start()
        configure_database(Path(self.temporary_directory.name))
        upgrade_database(main.BASE)
        self.sequence = 0

    def tearDown(self) -> None:
        for game_id in set(games) - self.initial_game_ids:
            games.pop(game_id, None)
        self.environment.stop()
        configure_database(main.DATA_DIR)
        self.temporary_directory.cleanup()

    def _user(self, username: str, *, role: str = "user"):
        return create_user(username, f"{username}-secure-password-123", role=role, must_change_password=False)

    @staticmethod
    def _player(player_id: str, name: str, user_id: int | None) -> dict:
        return {"id": player_id, "name": name, "user_id": user_id, "ws": None}

    def _store(self, game: dict) -> str:
        """Store without finalizer registration to prove there is no backfill."""

        payload = build_zilch_result_payload(game)
        finished_at = datetime.fromisoformat(str(payload["finished_at"]).replace("Z", "+00:00"))
        result = persist_completed_game_result(
            game_id=payload["game_id"],
            game_name=payload["game_name"],
            game_type=ZILCH_GAME_TYPE,
            mode=payload["mode"],
            hardcore=False,
            finished_at=finished_at,
            snapshot=payload,
            participants=[
                {
                    "position": participant["position"],
                    "player_key": participant["player_key"],
                    "display_name": participant["display_name"],
                    "team": None,
                    "points": int(payload["totals"][participant["participant_id"]]),
                    "user_id": participant.get("user_id"),
                }
                for participant in payload["participants"]
            ],
        )
        self.assertTrue(result.succeeded, result)
        return str(payload["game_id"])

    def _competitive_game(self, one, two, *, game_id: str | None = None) -> dict:
        self.sequence += 1
        game = new_zilch_game(game_id or f"zilch-award-hvh-{self.sequence}", "Achievement fixture", 2)
        join_zilch_player(game, self._player("p1", one.username, one.id))
        join_zilch_player(game, self._player("p2", two.username, two.id))
        start_zilch_game(game)
        record_zilch_start_roll(game, "p1", 6)
        record_zilch_start_roll(game, "p2", 2)
        game["_total_points"] = {"p1": 10_000, "p2": 9_700}
        game["_round_points"] = {"p1": 0, "p2": 0}
        game["_zilch_zilch_streaks"] = {"p1": 0, "p2": 0}
        game["_zilch_boards"] = {
            "p1": {
                "player_id": "p1",
                "round_points": 0,
                "total_points": 10_000,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 1,
                        "round": 1,
                        "event": "bank",
                        "points": 8_000,
                        "total_after": 8_000,
                        "rolls_used": 2,
                        "committed_holds": [
                            {
                                "id": "hold-straight-hot",
                                "hot_dice": True,
                                "combination_type": "straight",
                            }
                        ],
                    },
                    {
                        "turn_id": 3,
                        "round": 2,
                        "event": "zilch",
                        "reason": "no_scoring_option",
                        "discarded_points": 150,
                        "penalty": 0,
                        "total_after": 8_000,
                        "zilch_streak": 1,
                        "rolls_used": 1,
                        "committed_holds": [],
                    },
                    {
                        "turn_id": 5,
                        "round": 3,
                        "event": "bank",
                        "points": 2_000,
                        "total_after": 10_000,
                        "rolls_used": 2,
                        "committed_holds": [],
                    },
                ],
            },
            "p2": {
                "player_id": "p2",
                "round_points": 0,
                "total_points": 9_700,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 2,
                        "round": 1,
                        "event": "bank",
                        "points": 9_700,
                        "total_after": 9_700,
                        "rolls_used": 2,
                        "committed_holds": [],
                    }
                ],
            },
        }
        game["_zilch_final_round"] = {
            "triggered_by": "p1",
            "target_score": 10_000,
            "pending_player_ids": [],
        }
        finish_zilch_game(game)
        return game

    def _cpu_game(self, human, *, strategy: str = "normal") -> dict:
        self.sequence += 1
        game_id = f"zilch-award-cpu-{self.sequence}"
        game = new_zilch_game(game_id, "CPU award fixture", 2)
        cpu = configure_zilch_cpu_game(game, host_user_id=human.id, cpu_strategy=strategy)
        cpu_id = str(cpu["id"])
        join_zilch_player(game, self._player("human", human.username, human.id))
        start_zilch_game(game)
        record_zilch_start_roll(game, "human", 6)
        record_zilch_start_roll(game, cpu_id, 2)
        game["_total_points"] = {"human": 10_000, cpu_id: 9_500}
        game["_round_points"] = {"human": 0, cpu_id: 0}
        game["_zilch_zilch_streaks"] = {"human": 0, cpu_id: 0}
        game["_zilch_boards"] = {
            "human": {
                "player_id": "human",
                "round_points": 0,
                "total_points": 10_000,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 1,
                        "round": 1,
                        "event": "bank",
                        "points": 10_000,
                        "total_after": 10_000,
                        "rolls_used": 1,
                        "committed_holds": [],
                    }
                ],
            },
            cpu_id: {
                "player_id": cpu_id,
                "round_points": 0,
                "total_points": 9_500,
                "zilch_streak": 0,
                "rounds": [
                    {
                        "turn_id": 2,
                        "round": 1,
                        "event": "bank",
                        "points": 9_500,
                        "total_after": 9_500,
                        "rolls_used": 1,
                        "committed_holds": [],
                    }
                ],
            },
        }
        game["_zilch_final_round"] = {
            "triggered_by": "human",
            "target_score": 10_000,
            "pending_player_ids": [],
        }
        finish_zilch_game(game)
        return game

    def _solo_game(
        self,
        human,
        *,
        game_id: str | None = None,
        participant_id: str = "solo-human",
    ) -> dict:
        self.sequence += 1
        return {
            "_id": game_id or f"zilch-award-solo-{self.sequence}",
            "_name": "Solo Sprint",
            "_game_type": ZILCH_GAME_TYPE,
            "_mode": "1",
            "_play_mode": "solo",
            "_started": False,
            "_finished": True,
            "_aborted": False,
            "_started_at": "2026-09-03T12:00:00+00:00",
            "_finished_at": "2026-09-03T12:02:00+00:00",
            "_target_score": ZILCH_SOLO_SPRINT_TARGET_SCORE,
            "_zilch_ruleset": ZILCH_RULESET_VERSION,
            "_participants": [
                {
                    "id": participant_id,
                    "name": human.username,
                    "type": "human",
                    "connection_player_id": participant_id,
                    "user_id": human.id,
                    "cpu_strategy": None,
                }
            ],
            "_total_points": {participant_id: 10_000},
            "_round_points": {participant_id: 0},
            "_zilch_zilch_streaks": {participant_id: 0},
            "_zilch_boards": {
                participant_id: {
                    "player_id": participant_id,
                    "round_points": 0,
                    "total_points": 10_000,
                    "zilch_streak": 0,
                    "rounds": [
                        {
                            "turn_id": 1,
                            "round": 1,
                            "event": "bank",
                            "points": 10_000,
                            "total_after": 10_000,
                            "rolls_used": 3,
                            "committed_holds": [],
                        }
                    ],
                }
            },
            "_zilch_start_roll": None,
            "_zilch_final_round": None,
            "_zilch_outcome": {"status": "completed"},
            "_zilch_solo_objective": {
                "id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
                "version": ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
                "parameters": {},
                "progress": {
                    "target_score": 10_000,
                    "total_points": 10_000,
                    "turns": 1,
                    "rolls": 3,
                    "zilchs": 0,
                    "hot_dice_events": 0,
                    "highest_banked_round": 10_000,
                    "active_duration_seconds": 120,
                },
                "outcome": "completed",
            },
            "_zilch_solo_metrics": {
                "target_score": 10_000,
                "total_points": 10_000,
                "turns": 1,
                "rolls": 3,
                "zilchs": 0,
                "hot_dice_events": 0,
                "highest_banked_round": 10_000,
                "active_duration_seconds": 120,
                "remaining_points": 0,
            },
        }

    @staticmethod
    def _keys(profile: dict) -> set[str]:
        return {str(item["key"]) for item in profile["unlocked"]}

    def test_catalog_is_namespaced_localized_and_has_isolated_points_and_ranks(self) -> None:
        catalog = zilch_achievement_definitions_payload()

        self.assertEqual(catalog["version"], 2)
        self.assertNotIn("player", catalog)
        self.assertEqual(len(catalog["definitions"]), 74)
        self.assertEqual({item["key"] for item in catalog["definitions"]}, set(ZILCH_ACHIEVEMENT_BY_KEY))
        self.assertEqual(catalog["points_possible"], ZILCH_ACHIEVEMENT_POINTS_POSSIBLE)
        self.assertEqual(
            ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
            sum(definition.points for definition in ZILCH_ACHIEVEMENTS),
        )
        for definition in catalog["definitions"]:
            self.assertTrue(definition["key"].startswith(ZILCH_ACHIEVEMENT_NAMESPACE))
            self.assertTrue(definition["title_key"].startswith("zilch.achievement."))
            self.assertTrue(definition["description_key"].startswith("zilch.achievement."))
            if definition["category"] == "community":
                self.assertEqual(definition["points"], 0)
            else:
                self.assertGreater(definition["points"], 0)
            self.assertNotIn("rank", definition)
        legend = zilch_achievement_rank_legend_payload()
        self.assertEqual(legend["points_possible"], ZILCH_ACHIEVEMENT_POINTS_POSSIBLE)
        self.assertEqual(len(legend["ranks"]), 10)
        self.assertEqual(legend["ranks"][0]["minimum_points"], 0)
        self.assertEqual(
            [item["minimum_points"] for item in legend["ranks"]],
            sorted(item["minimum_points"] for item in legend["ranks"]),
        )
        keys = ["zilch.first_game", "zilch.first_game", "zilch.unknown"]
        self.assertEqual(zilch_achievement_points_for_keys(keys), 1)
        self.assertEqual(zilch_achievement_rank_for_points(-50)["key"], "newbie")
        self.assertEqual(
            zilch_achievement_rank_for_points(ZILCH_ACHIEVEMENT_POINTS_POSSIBLE + 50)["key"],
            "godmode",
        )

    def test_abandoned_solo_evidence_never_qualifies_for_personal_awards(self) -> None:
        abandoned = {
            "schema_version": 2,
            "ruleset": ZILCH_RULESET_VERSION,
            "play_mode": "solo",
            "outcome": "abandoned",
            "history_complete": True,
        }

        self.assertFalse(
            any(
                _criterion_is_satisfied(definition, [abandoned])
                for definition in ZILCH_ACHIEVEMENTS
                if definition.criterion != "community_games"
            )
        )

    def test_every_personal_criterion_has_a_measurable_satisfying_fact_path(self) -> None:
        multiplayer = {
            "schema_version": 1,
            "ruleset": ZILCH_RULESET_VERSION,
            "play_mode": "multiplayer",
            "outcome": "win",
            "history_complete": True,
            "banked_rounds": [5_000, 3_000, 2_000],
            "highest_banked_round": 5_000,
            "final_score": 15_000,
            "combination_types": [
                "straight",
                "three_pairs",
                "nothing_bonus",
                "three_ones",
                "two_triples",
                "double_triple",
                "four_of_a_kind",
                "five_of_a_kind",
                "six_of_a_kind",
            ],
            "hot_dice_events": 5,
            "zilch_count": 20,
            "zilch_penalty_points": 1_000,
            "max_discarded_points": 2_000,
            "score_margin": 3_000,
            "max_deficit_before_finish": 3_000,
            "won_start_roll": False,
            "game_turns": 50,
        }
        close_win = {**multiplayer, "score_margin": 100, "zilch_count": 0}
        exact_score = {**multiplayer, "final_score": 10_000}
        fast_win = {**multiplayer, "game_turns": 12}
        cpu_wins = [
            {
                **multiplayer,
                "play_mode": "cpu",
                "cpu_strategy": strategy,
            }
            for strategy in ("conservative", "normal", "aggressive")
        ]
        solo = {
            **multiplayer,
            "schema_version": 2,
            "play_mode": "solo",
            "outcome": "completed",
            "cpu_strategy": None,
            "objective_id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
            "objective_version": ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
            "turn_count": 12,
            "roll_count": 30,
            "zilch_count": 0,
        }
        facts = [multiplayer] * 500 + [close_win, exact_score, fast_win, *cpu_wins, solo]

        unsatisfied = [
            definition.key
            for definition in ZILCH_ACHIEVEMENTS
            if definition.criterion != "community_games"
            and not _criterion_is_satisfied(definition, facts)
        ]
        self.assertEqual(unsatisfied, [])

    def test_escalating_matching_dice_awards_do_not_treat_two_triple_ones_as_a_sixling(self) -> None:
        facts = {
            "schema_version": 1,
            "ruleset": ZILCH_RULESET_VERSION,
            "play_mode": "multiplayer",
            "outcome": "win",
            "history_complete": True,
            "combination_types": ["double_triple"],
        }
        sixling = ZILCH_ACHIEVEMENT_BY_KEY["zilch.first_double_triple"]
        fourling = ZILCH_ACHIEVEMENT_BY_KEY["zilch.first_four_of_a_kind"]
        fuenfling = ZILCH_ACHIEVEMENT_BY_KEY["zilch.first_five_of_a_kind"]

        self.assertFalse(_criterion_is_satisfied(sixling, [facts]))
        self.assertTrue(_criterion_is_satisfied(sixling, [{**facts, "combination_types": ["six_of_a_kind"]}]))
        self.assertTrue(_criterion_is_satisfied(fourling, [{**facts, "combination_types": ["four_of_a_kind"]}]))
        self.assertTrue(_criterion_is_satisfied(fuenfling, [{**facts, "combination_types": ["five_of_a_kind"]}]))

    def test_achievement_migration_upgrades_and_downgrades_without_touching_result_tables(self) -> None:
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")

        before = set(inspect(get_engine()).get_table_names())
        self.assertTrue(
            {
                "completed_games",
                "game_participants",
                "zilch_achievement_evaluations",
                "zilch_achievement_evidence",
                "zilch_achievement_unlocks",
                "zilch_achievement_deliveries",
            }
            <= before
        )
        command.downgrade(config, "20260903_0016")
        downgraded = set(inspect(get_engine()).get_table_names())
        self.assertIn("completed_games", downgraded)
        self.assertIn("game_participants", downgraded)
        self.assertFalse({name for name in downgraded if name.startswith("zilch_achievement_")})
        command.upgrade(config, "head")
        upgraded = set(inspect(get_engine()).get_table_names())
        self.assertTrue(
            {
                "zilch_achievement_evaluations",
                "zilch_achievement_evidence",
                "zilch_achievement_unlocks",
                "zilch_achievement_deliveries",
                "zilch_community_state",
                "zilch_community_games",
                "zilch_community_participants",
                "zilch_community_milestones",
                "zilch_community_recipients",
            }
            <= upgraded
        )
        unlock_columns = {item["name"] for item in inspect(get_engine()).get_columns("zilch_achievement_unlocks")}
        self.assertIn("source_community_recipient_id", unlock_columns)

    def test_community_migration_bootstraps_only_explicit_completed_evaluations(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        registered_game_id = self._store(self._competitive_game(mani, preview))
        unregistered_game_id = self._store(self._competitive_game(mani, preview))
        register_zilch_result_for_achievements(registered_game_id)

        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")
        command.downgrade(config, "20260904_0018")
        command.upgrade(config, "head")

        with session_scope() as db:
            state = db.get(ZilchCommunityState, 1)
            self.assertEqual(state.qualified_games, 1)
            self.assertEqual(state.achievement_catalog_version, 0)
            self.assertEqual(set(db.scalars(select(ZilchCommunityGame.game_id))), {registered_game_id})
            self.assertEqual(
                set(db.scalars(select(ZilchCommunityParticipant.user_id))),
                {mani.id, preview.id},
            )
            self.assertNotIn(unregistered_game_id, set(db.scalars(select(ZilchCommunityGame.game_id))))
            self.assertFalse(list(db.scalars(select(ZilchCommunityMilestone))))
            self.assertFalse(list(db.scalars(select(ZilchCommunityRecipient))))

    def test_catalog_resync_enriches_only_registered_source_evidence_and_is_idempotent(self) -> None:
        mani = self._user("EnrichmentMani", role="admin")
        opponent = self._user("EnrichmentOpponent")
        registered_game_id = self._store(
            self._competitive_game(mani, opponent, game_id="zilch-enrichment-registered")
        )
        unregistered_game_id = self._store(
            self._competitive_game(mani, opponent, game_id="zilch-enrichment-unregistered")
        )
        register_zilch_result_for_achievements(registered_game_id)

        derived_keys = {
            "max_discarded_points",
            "turn_count",
            "roll_count",
            "opponent_final_score",
            "score_margin",
            "max_deficit_before_finish",
            "won_start_roll",
            "game_turns",
        }
        source_dependent_awards = {
            "zilch.hvh_comeback_1000",
            "zilch.hvh_win_under_20_turns",
            "zilch.hvh_win_under_14_turns",
        }
        with session_scope() as db:
            evidence_rows = list(
                db.scalars(
                    select(ZilchAchievementEvidence).where(
                        ZilchAchievementEvidence.source_game_id == registered_game_id
                    )
                )
            )
            self.assertEqual(len(evidence_rows), 2)
            for evidence in evidence_rows:
                legacy_facts = json.loads(evidence.facts_json)
                for key in derived_keys:
                    legacy_facts.pop(key, None)
                evidence.facts_json = json.dumps(legacy_facts, sort_keys=True)
            for unlock in list(
                db.scalars(
                    select(ZilchAchievementUnlock).where(
                        ZilchAchievementUnlock.user_id == mani.id,
                        ZilchAchievementUnlock.achievement_key.in_(source_dependent_awards),
                    )
                )
            ):
                db.delete(unlock)
            state = db.get(ZilchCommunityState, 1)
            state.achievement_catalog_version = ZILCH_ACHIEVEMENT_CATALOG_VERSION - 1

        rollout = resync_zilch_achievement_catalog()
        self.assertEqual(rollout["status"], "resynchronized")
        self.assertEqual(rollout["evidence_enriched"], 2)
        self.assertTrue(source_dependent_awards <= self._keys(get_zilch_achievement_profile(mani.id)))
        with session_scope() as db:
            registered_evidence = list(
                db.scalars(
                    select(ZilchAchievementEvidence).where(
                        ZilchAchievementEvidence.source_game_id == registered_game_id
                    )
                )
            )
            self.assertEqual(len(registered_evidence), 2)
            for evidence in registered_evidence:
                self.assertTrue(derived_keys <= set(json.loads(evidence.facts_json)))
            self.assertFalse(
                list(
                    db.scalars(
                        select(ZilchAchievementEvidence).where(
                            ZilchAchievementEvidence.source_game_id == unregistered_game_id
                        )
                    )
                )
            )
            serialized_after_rollout = {row.id: row.facts_json for row in registered_evidence}

        second = resync_zilch_achievement_catalog()
        self.assertEqual(second["status"], "already_current")
        self.assertEqual(second["evidence_enriched"], 0)
        with session_scope() as db:
            self.assertEqual(
                {
                    row.id: row.facts_json
                    for row in db.scalars(
                        select(ZilchAchievementEvidence).where(
                            ZilchAchievementEvidence.source_game_id == registered_game_id
                        )
                    )
                },
                serialized_after_rollout,
            )

    def test_catalog_resync_rejects_changed_user_mapping_and_rolls_back_everything(self) -> None:
        mani = self._user("EnrichmentAtomic", role="admin")
        opponent = self._user("EnrichmentAtomicOpponent")
        stranger = self._user("EnrichmentStranger")
        first_game_id = self._store(
            self._competitive_game(mani, opponent, game_id="zilch-enrichment-atomic-first")
        )
        second_game_id = self._store(
            self._competitive_game(mani, opponent, game_id="zilch-enrichment-atomic-second")
        )
        register_zilch_result_for_achievements(first_game_id)
        register_zilch_result_for_achievements(second_game_id)

        with session_scope() as db:
            evidence_rows = list(
                db.scalars(
                    select(ZilchAchievementEvidence)
                    .where(
                        ZilchAchievementEvidence.source_game_id.in_({first_game_id, second_game_id})
                    )
                    .order_by(ZilchAchievementEvidence.id)
                )
            )
            for evidence in evidence_rows:
                legacy_facts = json.loads(evidence.facts_json)
                legacy_facts.pop("score_margin", None)
                evidence.facts_json = json.dumps(legacy_facts, sort_keys=True)
            mismatched = next(
                row
                for row in evidence_rows
                if row.source_game_id == second_game_id and row.user_id == mani.id
            )
            mismatched.user_id = stranger.id
            state = db.get(ZilchCommunityState, 1)
            previous_version = ZILCH_ACHIEVEMENT_CATALOG_VERSION - 1
            state.achievement_catalog_version = previous_version

        with self.assertRaisesRegex(
            ZilchAchievementError,
            "zilch_achievement_evidence_user_mismatch",
        ):
            resync_zilch_achievement_catalog()

        with session_scope() as db:
            self.assertEqual(
                db.get(ZilchCommunityState, 1).achievement_catalog_version,
                previous_version,
            )
            first_evidence = list(
                db.scalars(
                    select(ZilchAchievementEvidence).where(
                        ZilchAchievementEvidence.source_game_id == first_game_id
                    )
                )
            )
            self.assertTrue(first_evidence)
            self.assertTrue(
                all("score_margin" not in json.loads(row.facts_json) for row in first_evidence)
            )

    def test_community_rollout_reconstructs_exact_threshold_and_resyncs_catalog(self) -> None:
        early = self._user("MigrationEarly", role="admin")
        late = self._user("MigrationLate")
        deleted_only = self._user("MigrationDeleted")
        no_game = self._user("MigrationNoGame")
        config = Config(str(main.BASE / "alembic.ini"))
        config.set_main_option("script_location", str(main.BASE / "alembic"))
        config.set_main_option("sqlalchemy.url", f"sqlite:///{self.database_path}")
        command.downgrade(config, "20260904_0018")

        started_at = datetime(2026, 8, 1, 12, 0, tzinfo=timezone.utc)
        users_by_id = {
            early.id: early,
            late.id: late,
            deleted_only.id: deleted_only,
        }

        def facts(user_id: int) -> str:
            return json.dumps(
                {
                    "schema_version": 2,
                    "ruleset": ZILCH_RULESET_VERSION,
                    "play_mode": "solo",
                    "participant_id": f"solo-{user_id}",
                    "final_score": ZILCH_SOLO_SPRINT_TARGET_SCORE,
                    "outcome": "completed",
                    "cpu_strategy": None,
                    "banked_rounds": [ZILCH_SOLO_SPRINT_TARGET_SCORE],
                    "combination_types": [],
                    "history_complete": True,
                    "highest_banked_round": ZILCH_SOLO_SPRINT_TARGET_SCORE,
                    "hot_dice_events": 0,
                    "zilch_count": 0,
                    "zilch_penalty_points": 0,
                    "target_score": ZILCH_SOLO_SPRINT_TARGET_SCORE,
                    "objective_id": ZILCH_SOLO_SPRINT_OBJECTIVE_ID,
                    "objective_version": ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION,
                    "turn_count": 1,
                    "roll_count": 3,
                },
                sort_keys=True,
            )

        def insert_evidence(connection, *, game_id: str, user_id: int, registered_at: datetime) -> None:
            participant_id = f"solo-{user_id}"
            source_payload = build_zilch_result_payload(
                self._solo_game(
                    users_by_id[user_id],
                    game_id=game_id,
                    participant_id=participant_id,
                )
            )
            completed = connection.execute(
                text(
                    """
                    INSERT INTO completed_games
                        (game_id, game_type, game_name, finished_at, mode, hardcore,
                         snapshot_json, imported_from_legacy, created_at)
                    VALUES
                        (:game_id, 'zilch', :game_name, :finished_at, :mode, 0,
                         :snapshot_json, 0, :created_at)
                    """
                ),
                {
                    "game_id": game_id,
                    "game_name": source_payload["game_name"],
                    "finished_at": datetime.fromisoformat(
                        str(source_payload["finished_at"]).replace("Z", "+00:00")
                    ),
                    "mode": source_payload["mode"],
                    "snapshot_json": json.dumps(source_payload),
                    "created_at": registered_at,
                },
            )
            source_participant = source_payload["participants"][0]
            connection.execute(
                text(
                    """
                    INSERT INTO game_participants
                        (game_id, position, player_key, display_name, team, points,
                         user_id, assigned_at, assigned_by_user_id)
                    VALUES
                        (:game_id, :position, :player_key, :display_name, NULL, :points,
                         :user_id, NULL, NULL)
                    """
                ),
                {
                    "game_id": completed.lastrowid,
                    "position": source_participant["position"],
                    "player_key": source_participant["player_key"],
                    "display_name": source_participant["display_name"],
                    "points": source_payload["totals"][participant_id],
                    "user_id": user_id,
                },
            )
            evaluation = connection.execute(
                text(
                    """
                    INSERT INTO zilch_achievement_evaluations
                        (game_id, game_type, result_schema_version, ruleset, status,
                         attempts, registered_at, evaluated_at, last_error)
                    VALUES
                        (:game_id, 'zilch', 2, :ruleset, 'completed',
                         1, :registered_at, :registered_at, NULL)
                    """
                ),
                {
                    "game_id": game_id,
                    "ruleset": ZILCH_RULESET_VERSION,
                    "registered_at": registered_at,
                },
            )
            connection.execute(
                text(
                    """
                    INSERT INTO zilch_achievement_evidence
                        (evaluation_id, source_game_id, user_id, result_schema_version,
                         ruleset, play_mode, facts_json, recorded_at)
                    VALUES
                        (:evaluation_id, :game_id, :user_id, 2,
                         :ruleset, 'solo', :facts_json, :recorded_at)
                    """
                ),
                {
                    "evaluation_id": evaluation.lastrowid,
                    "game_id": game_id,
                    "user_id": user_id,
                    "ruleset": ZILCH_RULESET_VERSION,
                    "facts_json": facts(user_id),
                    "recorded_at": registered_at,
                },
            )

        with get_engine().begin() as connection:
            for ordinal in range(1, 102):
                insert_evidence(
                    connection,
                    game_id=f"migration-qualified-{ordinal:03d}",
                    user_id=early.id if ordinal <= 100 else late.id,
                    registered_at=started_at + timedelta(seconds=ordinal),
                )
            deleted_game_id = "migration-deleted-source"
            insert_evidence(
                connection,
                game_id=deleted_game_id,
                user_id=deleted_only.id,
                registered_at=started_at,
            )
            connection.execute(
                text(
                    """
                    INSERT INTO deleted_games
                        (game_id, game_type, game_name, finished_at, mode, hardcore,
                         deleted_at, deleted_by_user_id, reason)
                    VALUES
                        (:game_id, 'zilch', 'Deleted rollout source', :finished_at,
                         '1', 0, :deleted_at, :deleted_by_user_id, 'migration fixture')
                    """
                ),
                {
                    "game_id": deleted_game_id,
                    "finished_at": started_at,
                    "deleted_at": started_at + timedelta(minutes=1),
                    "deleted_by_user_id": early.id,
                },
            )

        command.upgrade(config, "head")

        with session_scope() as db:
            state = db.get(ZilchCommunityState, 1)
            self.assertEqual(state.qualified_games, 101)
            self.assertEqual(state.achievement_catalog_version, 0)
            self.assertIsNone(
                db.scalar(
                    select(ZilchCommunityGame).where(
                        ZilchCommunityGame.game_id == deleted_game_id
                    )
                )
            )
            self.assertEqual(
                db.scalar(select(func.count()).select_from(ZilchCommunityParticipant)),
                101,
            )
            milestone = db.scalar(
                select(ZilchCommunityMilestone).where(
                    ZilchCommunityMilestone.achievement_key == "zilch.community_games_100"
                )
            )
            self.assertEqual(milestone.reached_ordinal, 100)
            self.assertEqual(milestone.trigger_game_id, "migration-qualified-100")
            self.assertEqual(
                set(
                    db.scalars(
                        select(ZilchCommunityRecipient.user_id).where(
                            ZilchCommunityRecipient.milestone_id == milestone.id
                        )
                    )
                ),
                {early.id},
            )

        late_community = next(
            item
            for item in get_zilch_achievement_profile(late.id)["locked"]
            if item["key"] == "zilch.community_games_100"
        )
        self.assertTrue(late_community["missed"])
        self.assertNotIn("progress", late_community)

        rollout = resync_zilch_achievement_catalog()
        self.assertEqual(rollout["status"], "resynchronized")
        self.assertEqual(rollout["to_version"], ZILCH_ACHIEVEMENT_CATALOG_VERSION)
        early_keys = self._keys(get_zilch_achievement_profile(early.id))
        self.assertIn("zilch.community_games_100", early_keys)
        self.assertIn("zilch.games_played_100", early_keys)
        self.assertNotIn(
            "zilch.community_games_100",
            self._keys(get_zilch_achievement_profile(late.id)),
        )
        self.assertFalse(get_zilch_achievement_profile(deleted_only.id)["unlocked"])
        self.assertFalse(get_zilch_achievement_profile(no_game.id)["unlocked"])

        acknowledged = acknowledge_zilch_award(early.id, "zilch.first_game")
        with session_scope() as db:
            personal_unlock = db.scalar(
                select(ZilchAchievementUnlock).where(
                    ZilchAchievementUnlock.user_id == early.id,
                    ZilchAchievementUnlock.achievement_key == "zilch.first_game",
                )
            )
            personal_delivery = db.scalar(
                select(ZilchAchievementDelivery).where(
                    ZilchAchievementDelivery.unlock_id == personal_unlock.id
                )
            )
            personal_delivery_id = personal_delivery.id
            self.assertIsNotNone(personal_delivery.acknowledged_at)
            self.assertTrue(acknowledged["acknowledged_at"])

        command.downgrade(config, "20260904_0018")
        with get_engine().connect() as connection:
            self.assertEqual(
                connection.execute(
                    text(
                        "SELECT COUNT(*) FROM zilch_achievement_unlocks "
                        "WHERE achievement_key = 'zilch.community_games_100'"
                    )
                ).scalar_one(),
                0,
            )
            preserved_delivery = connection.execute(
                text(
                    "SELECT id, acknowledged_at FROM zilch_achievement_deliveries "
                    "WHERE id = :delivery_id"
                ),
                {"delivery_id": personal_delivery_id},
            ).one()
            self.assertEqual(preserved_delivery.id, personal_delivery_id)
            self.assertIsNotNone(preserved_delivery.acknowledged_at)

        command.upgrade(config, "head")
        second_rollout = resync_zilch_achievement_catalog()
        self.assertEqual(second_rollout["status"], "resynchronized")
        self.assertIn(
            "zilch.community_games_100",
            self._keys(get_zilch_achievement_profile(early.id)),
        )
        self.assertEqual(resync_zilch_achievement_catalog()["status"], "already_current")
        with get_engine().connect() as connection:
            self.assertFalse(connection.execute(text("PRAGMA foreign_key_check")).all())
            self.assertEqual(
                connection.execute(
                    text(
                        "SELECT COUNT(*) FROM zilch_achievement_deliveries "
                        "WHERE id = :delivery_id AND acknowledged_at IS NOT NULL"
                    ),
                    {"delivery_id": personal_delivery_id},
                ).scalar_one(),
                1,
            )

    def test_explicit_multiplayer_registration_is_idempotent_and_delivers_awards(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        game_id = self._store(self._competitive_game(mani, preview))

        # A typed result alone never causes a historic or on-read backfill.
        self.assertFalse(get_zilch_achievement_profile(mani.id)["unlocked"])
        registration = register_zilch_result_for_achievements(game_id)
        self.assertEqual(registration.status, "evaluated")
        self.assertTrue(registration.new_unlocks_by_user[mani.id])
        self.assertEqual(
            {item["rank_after"]["points"] for item in registration.new_unlocks_by_user[mani.id]},
            {zilch_achievement_points_for_keys(item["key"] for item in registration.new_unlocks_by_user[mani.id])},
        )
        mani_keys = self._keys(get_zilch_achievement_profile(mani.id))
        self.assertTrue(
            {
                "zilch.first_game",
                "zilch.first_hvh_win",
                "zilch.banked_round_500",
                "zilch.banked_round_1000",
                "zilch.banked_round_1500",
                "zilch.banked_round_2000",
                "zilch.exact_10000",
                "zilch.first_straight",
                "zilch.first_hot_dice",
                "zilch.hvh_comeback_1000",
                "zilch.hvh_win_under_20_turns",
                "zilch.hvh_win_under_14_turns",
            }
            <= mani_keys
        )
        profile = get_zilch_achievement_profile(mani.id)
        self.assertEqual(profile["player"], {"id": mani.id, "username": "Mani"})
        self.assertEqual(profile["points"], zilch_achievement_points_for_keys(mani_keys))
        self.assertEqual(profile["points_possible"], ZILCH_ACHIEVEMENT_POINTS_POSSIBLE)
        self.assertEqual(profile["rank"]["points"], profile["points"])
        with session_scope() as db:
            evidence = next(
                row
                for row in db.scalars(
                    select(ZilchAchievementEvidence).where(
                        ZilchAchievementEvidence.source_game_id == game_id
                    )
                )
                if json.loads(row.facts_json)["participant_id"] == "p1"
            )
            facts = json.loads(evidence.facts_json)
            self.assertEqual(facts["game_turns"], 4)
            self.assertEqual(facts["score_margin"], 300)
            self.assertEqual(facts["max_deficit_before_finish"], 1_700)
            self.assertTrue(facts["won_start_roll"])

        repeated = register_zilch_result_for_achievements(game_id)
        self.assertEqual(repeated.status, "already_evaluated")
        pending = pending_zilch_awards(mani.id)
        self.assertEqual({item["key"] for item in pending["awards"]}, mani_keys)
        self.assertEqual(pending["points"], profile["points"])
        self.assertEqual(pending["rank"], profile["rank"])
        self.assertEqual({item["source_kind"] for item in pending["awards"]}, {"game"})
        first_ack = acknowledge_zilch_award(mani.id, "zilch.first_game")
        second_ack = acknowledge_zilch_award(mani.id, "zilch.first_game")
        self.assertEqual(first_ack, second_ack)
        self.assertNotIn("zilch.first_game", {item["key"] for item in pending_zilch_awards(mani.id)["awards"]})
        with session_scope() as db:
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(ZilchAchievementEvaluation)
                    .where(ZilchAchievementEvaluation.game_id == game_id)
                ),
                1,
            )
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(ZilchAchievementUnlock)
                    .where(ZilchAchievementUnlock.user_id == mani.id)
                ),
                len(mani_keys),
            )
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(ZilchAchievementDelivery)
                    .join(ZilchAchievementUnlock)
                    .where(ZilchAchievementUnlock.user_id == mani.id)
                ),
                len(mani_keys),
            )

    def test_rank_upgrade_delivery_reconstructs_the_latest_transition_once(self) -> None:
        mani = self._user("Mani", role="admin")
        positive_definitions = [definition for definition in ZILCH_ACHIEVEMENTS if definition.points > 0]
        self.assertTrue(positive_definitions)
        base_time = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)
        keys: set[str] = set()
        previous_rank = zilch_achievement_rank_for_points(0)
        first_transition: tuple[int, object, dict, dict] | None = None
        second_transition: tuple[int, object, dict, dict] | None = None
        for index, definition in enumerate(positive_definitions, start=1):
            keys.add(definition.key)
            current_rank = zilch_achievement_rank_for_points(zilch_achievement_points_for_keys(keys))
            if current_rank["key"] != previous_rank["key"]:
                transition = (index, definition, previous_rank, current_rank)
                if first_transition is None:
                    first_transition = transition
                else:
                    second_transition = transition
                    break
            previous_rank = current_rank
        self.assertIsNotNone(first_transition)
        self.assertIsNotNone(second_transition)
        assert first_transition is not None
        assert second_transition is not None

        def add_unlocks(start_index: int, through_index: int) -> None:
            with session_scope() as db:
                for index, definition in enumerate(
                    positive_definitions[start_index - 1:through_index],
                    start=start_index,
                ):
                    db.add(
                        ZilchAchievementUnlock(
                            user_id=mani.id,
                            achievement_key=definition.key,
                            definition_version=definition.definition_version,
                            source_evidence_id=None,
                            source_community_recipient_id=None,
                            source_game_id=f"retro-rank-{index}",
                            unlocked_at=base_time + timedelta(minutes=index),
                        )
                    )

        add_unlocks(1, first_transition[0])
        pending = pending_zilch_awards(mani.id)
        first_card = pending["rank_upgrade"]
        self.assertIsNotNone(first_card)
        assert first_card is not None
        self.assertEqual(first_card["previous"]["key"], first_transition[2]["key"])
        self.assertEqual(first_card["current"]["key"], first_transition[3]["key"])
        self.assertEqual(first_card["source_game_id"], f"retro-rank-{first_transition[0]}")
        with session_scope() as db:
            delivery = db.scalar(
                select(ZilchAchievementRankDelivery).where(ZilchAchievementRankDelivery.user_id == mani.id)
            )
            self.assertIsNotNone(delivery)
            assert delivery is not None
            self.assertIsNone(delivery.acknowledged_at)

        first_acknowledgement = acknowledge_zilch_rank_upgrade(mani.id)
        self.assertEqual(first_acknowledgement, acknowledge_zilch_rank_upgrade(mani.id))
        self.assertEqual(first_acknowledgement["rank_key"], first_transition[3]["key"])
        self.assertIsNone(pending_zilch_awards(mani.id)["rank_upgrade"])

        add_unlocks(first_transition[0] + 1, second_transition[0])
        updated_pending = pending_zilch_awards(mani.id)
        second_card = updated_pending["rank_upgrade"]
        self.assertIsNotNone(second_card)
        assert second_card is not None
        self.assertEqual(second_card["previous"]["key"], second_transition[2]["key"])
        self.assertEqual(second_card["current"]["key"], second_transition[3]["key"])
        self.assertEqual(second_card["source_game_id"], f"retro-rank-{second_transition[0]}")
        self.assertNotEqual(second_card["current"]["key"], first_acknowledgement["rank_key"])

    def test_cpu_result_has_only_the_human_as_evidence_and_recipient(self) -> None:
        mani = self._user("Mani", role="admin")
        game_id = self._store(self._cpu_game(mani, strategy="normal"))

        register_zilch_result_for_achievements(game_id)

        keys = self._keys(get_zilch_achievement_profile(mani.id))
        self.assertIn("zilch.first_cpu_win", keys)
        self.assertIn("zilch.cpu_win_normal", keys)
        with session_scope() as db:
            evidence = list(
                db.scalars(select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id))
            )
            self.assertEqual([row.user_id for row in evidence], [mani.id])
            self.assertFalse(
                list(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id.is_(None))))
            )

    def test_community_milestone_is_exactly_once_zero_point_and_freezes_recipients(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        veteran = self._user("Veteran")
        outsider = self._user("Outsider")
        first_game_id = self._store(self._competitive_game(mani, preview))
        register_zilch_result_for_achievements(first_game_id)
        prior_game_id = self._store(self._competitive_game(preview, veteran))
        register_zilch_result_for_achievements(prior_game_id)
        points_before = get_zilch_achievement_profile(mani.id)["points"]

        # The migration can seed an existing registered basis.  Put this
        # isolated fixture immediately before the first public threshold;
        # the next finalizer must own ordinal 100 exactly once.
        with session_scope() as db:
            state = db.get(ZilchCommunityState, 1)
            self.assertIsNotNone(state)
            state.qualified_games = 99

        trigger_game_id = self._store(self._competitive_game(mani, preview))
        registration = register_zilch_result_for_achievements(trigger_game_id)
        community_key = "zilch.community_games_100"
        self.assertIn(community_key, {item["key"] for item in registration.new_unlocks_by_user[mani.id]})
        registration_award = next(
            item for item in registration.new_unlocks_by_user[mani.id] if item["key"] == community_key
        )
        self.assertIsNone(registration_award["source_game_id"])
        self.assertEqual(registration_award["presentation_game_id"], trigger_game_id)
        veteran_registration_award = next(
            item for item in registration.new_unlocks_by_user[veteran.id] if item["key"] == community_key
        )
        self.assertIsNone(veteran_registration_award["source_game_id"])
        self.assertIsNone(veteran_registration_award["presentation_game_id"])
        mani_profile = get_zilch_achievement_profile(mani.id)
        community_award = next(item for item in mani_profile["unlocked"] if item["key"] == community_key)
        self.assertEqual(community_award["points"], 0)
        self.assertEqual(community_award["source_kind"], "community")
        self.assertIsNone(community_award["source_game_id"])
        self.assertEqual(community_award["presentation_game_id"], trigger_game_id)
        pending_community_award = next(
            item for item in pending_zilch_awards(mani.id)["awards"] if item["key"] == community_key
        )
        self.assertIsNone(pending_community_award["source_game_id"])
        self.assertEqual(pending_community_award["presentation_game_id"], trigger_game_id)
        veteran_community_award = next(
            item for item in get_zilch_achievement_profile(veteran.id)["unlocked"] if item["key"] == community_key
        )
        self.assertIsNone(veteran_community_award["source_game_id"])
        self.assertIsNone(veteran_community_award["presentation_game_id"])
        veteran_pending_award = next(
            item for item in pending_zilch_awards(veteran.id)["awards"] if item["key"] == community_key
        )
        self.assertIsNone(veteran_pending_award["source_game_id"])
        self.assertIsNone(veteran_pending_award["presentation_game_id"])
        self.assertEqual(mani_profile["points"], points_before)
        self.assertNotIn(community_key, self._keys(get_zilch_achievement_profile(outsider.id)))

        with session_scope() as db:
            state = db.get(ZilchCommunityState, 1)
            self.assertEqual(state.qualified_games, 100)
            milestone = db.scalar(
                select(ZilchCommunityMilestone).where(
                    ZilchCommunityMilestone.achievement_key == community_key
                )
            )
            self.assertIsNotNone(milestone)
            self.assertEqual(milestone.reached_ordinal, 100)
            self.assertEqual(milestone.trigger_game_id, trigger_game_id)
            self.assertEqual(
                set(
                    db.scalars(
                        select(ZilchCommunityRecipient.user_id).where(
                            ZilchCommunityRecipient.milestone_id == milestone.id
                        )
                    )
                ),
                {mani.id, preview.id, veteran.id},
            )
            community_unlock = db.scalar(
                select(ZilchAchievementUnlock).where(
                    ZilchAchievementUnlock.user_id == mani.id,
                    ZilchAchievementUnlock.achievement_key == community_key,
                )
            )
            self.assertIsNotNone(community_unlock.source_community_recipient_id)
            self.assertIsNone(community_unlock.source_evidence_id)

        repeated = register_zilch_result_for_achievements(trigger_game_id)
        self.assertEqual(repeated.status, "already_evaluated")
        with session_scope() as db:
            self.assertEqual(db.get(ZilchCommunityState, 1).qualified_games, 100)
            self.assertEqual(
                db.scalar(
                    select(func.count())
                    .select_from(ZilchCommunityGame)
                    .where(ZilchCommunityGame.game_id == trigger_game_id)
                ),
                1,
            )

        # Joining after the threshold does not retroactively change its
        # frozen audience, even once the new account has a completed game.
        partner = self._user("Partner")
        late_game_id = self._store(self._competitive_game(outsider, partner))
        register_zilch_result_for_achievements(late_game_id)
        self.assertNotIn(community_key, self._keys(get_zilch_achievement_profile(outsider.id)))
        with session_scope() as db:
            self.assertEqual(db.get(ZilchCommunityState, 1).qualified_games, 101)

        # Personal source cleanup must not erase the global ledger or an
        # award whose frozen recipient is independent of that result.
        remove_zilch_result_from_achievements(trigger_game_id)
        retained_profile = get_zilch_achievement_profile(mani.id)
        self.assertIn(community_key, self._keys(retained_profile))
        retained_community_award = next(
            item for item in retained_profile["unlocked"] if item["key"] == community_key
        )
        self.assertIsNone(retained_community_award["source_game_id"])
        self.assertEqual(retained_community_award["presentation_game_id"], trigger_game_id)
        retained_pending_award = next(
            item for item in pending_zilch_awards(mani.id)["awards"] if item["key"] == community_key
        )
        self.assertIsNone(retained_pending_award["source_game_id"])
        self.assertEqual(retained_pending_award["presentation_game_id"], trigger_game_id)
        with session_scope() as db:
            self.assertEqual(db.get(ZilchCommunityState, 1).qualified_games, 101)
            self.assertIsNotNone(
                db.scalar(
                    select(ZilchCommunityGame).where(
                        ZilchCommunityGame.game_id == trigger_game_id
                    )
                )
            )

    def test_solo_registration_and_source_deletion_revoke_unlocks_and_delivery(self) -> None:
        mani = self._user("Mani", role="admin")
        game_id = self._store(self._solo_game(mani))

        register_zilch_result_for_achievements(game_id)
        keys = self._keys(get_zilch_achievement_profile(mani.id))
        self.assertIn("zilch.solo_sprint_completed", keys)
        self.assertIn("zilch.solo_sprint_without_zilch", keys)

        removed = remove_zilch_result_from_achievements(game_id)
        self.assertEqual(removed["affected_user_ids"], [mani.id])
        self.assertEqual(set(removed["revoked_by_user"][mani.id]), keys)
        self.assertFalse(get_zilch_achievement_profile(mani.id)["unlocked"])
        with session_scope() as db:
            self.assertFalse(
                list(
                    db.scalars(
                        select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id)
                    )
                )
            )
            self.assertIsNone(
                db.scalar(select(ZilchAchievementEvaluation).where(ZilchAchievementEvaluation.game_id == game_id))
            )
            self.assertFalse(
                list(db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.user_id == mani.id)))
            )
            self.assertFalse(list(db.scalars(select(ZilchAchievementDelivery))))

    def test_tombstone_recovery_cleans_only_deleted_zilch_sources_after_interrupted_cleanup(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        deleted_game_id = self._store(self._solo_game(mani))
        retained_game_id = self._store(self._solo_game(preview))
        register_zilch_result_for_achievements(deleted_game_id)
        register_zilch_result_for_achievements(retained_game_id)

        # Simulate the narrow failure window after the durable result deletion
        # has committed its typed tombstone but before the award cleanup call.
        deleted = delete_completed_game(
            game_id=deleted_game_id,
            admin_user_id=mani.id,
            reason="Transient award cleanup failure fixture",
        )
        self.assertEqual(deleted["game_type"], ZILCH_GAME_TYPE)
        self.assertTrue(get_zilch_achievement_profile(mani.id)["unlocked"])

        recovery = recover_deleted_zilch_achievement_sources()
        self.assertEqual(recovery["processed"], 1)
        self.assertEqual([item["game_id"] for item in recovery["cleaned"]], [deleted_game_id])
        self.assertFalse(recovery["failed"])
        self.assertFalse(get_zilch_achievement_profile(mani.id)["unlocked"])
        self.assertTrue(get_zilch_achievement_profile(preview.id)["unlocked"])
        with session_scope() as db:
            self.assertFalse(
                list(
                    db.scalars(
                        select(ZilchAchievementEvidence).where(
                            ZilchAchievementEvidence.source_game_id == deleted_game_id
                        )
                    )
                )
            )
            self.assertTrue(
                list(
                    db.scalars(
                        select(ZilchAchievementEvidence).where(
                            ZilchAchievementEvidence.source_game_id == retained_game_id
                        )
                    )
                )
            )
        self.assertEqual(recover_deleted_zilch_achievement_sources()["processed"], 0)

    def test_pending_recovery_processes_only_explicit_registration_and_partial_history_fails_closed(self) -> None:
        mani = self._user("Mani", role="admin")
        preview = self._user("Preview")
        ignored_game_id = self._store(self._competitive_game(mani, preview, game_id="zilch-unregistered-history"))
        game_id = self._store(self._competitive_game(mani, preview, game_id="zilch-pending-award"))
        with session_scope() as db:
            row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game_id))
            self.assertIsNotNone(row)
            payload = json.loads(row.snapshot_json)
            # Historic v1 loss history may not contain committed holds.  The
            # typed result remains valid, but combination/Hot-Dice awards are
            # deliberately unknown rather than treated as false or true.
            payload["boards"]["p1"]["rounds"][1].pop("committed_holds")
            row.snapshot_json = json.dumps(payload)

        self.assertEqual(_register_evaluation(game_id), "registered")
        recovery = recover_pending_zilch_achievement_evaluations()
        self.assertEqual(recovery["processed"], 1)
        self.assertEqual(recovery["completed"], [game_id])
        self.assertNotIn("zilch.first_hot_dice", self._keys(get_zilch_achievement_profile(mani.id)))
        self.assertNotIn("zilch.first_straight", self._keys(get_zilch_achievement_profile(mani.id)))
        with session_scope() as db:
            registered_sources = set(db.scalars(select(ZilchAchievementEvidence.source_game_id)))
        self.assertEqual(registered_sources, {game_id})
        self.assertNotIn(ignored_game_id, registered_sources)
