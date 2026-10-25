"""Engine-finished goals and additive, immutable catalogue-proof upgrades."""

import json
from copy import deepcopy
from unittest import TestCase

from sqlalchemy import select

from app.database import session_scope
from app.game_history import delete_completed_game
from app.models import (
    CompletedGame,
    ZilchAchievementDelivery,
    ZilchAchievementEvidence,
    ZilchAchievementUnlock,
    ZilchCommunityState,
)
from app.zilch_achievements import (
    ZILCH_ACHIEVEMENT_BY_KEY,
    ZILCH_ACHIEVEMENT_CATALOG_VERSION,
    ZilchAchievementError,
    _banked_turn_hot_dice_proof,
    _criterion_is_satisfied,
    _facts_from_evidence,
    _progress_for_definition,
    acknowledge_zilch_award,
    get_zilch_achievement_profile,
    recover_deleted_zilch_achievement_sources,
    register_zilch_result_for_achievements,
    resync_zilch_achievement_catalog,
)
from app.zilch_engine import bank_allowed, roll_zilch_turn, select_zilch_option
from app.zilch_results import (
    build_zilch_result_payload,
    finalize_zilch_result,
    validate_stored_zilch_result_payload,
)
from app.zilch_state import (
    advance_after_zilch_turn,
    current_zilch_turn,
    finish_zilch_game,
    join_zilch_player,
    new_zilch_game,
    record_zilch_bank,
    record_zilch_loss,
    record_zilch_start_roll,
    start_zilch_game,
    sync_zilch_turn,
)
from tests import test_zilch_achievements as persistence_support

PROOF = "banked_turn_hot_dice_v1"
SMALL = "zilch.no_small_change"
HOT = "zilch.double_hot_dice_turn"


class BankedTurnAchievementTests(TestCase):
    # Reuse only the isolated database harness, not its inherited test methods.
    setUp = persistence_support.ZilchAchievementPersistenceTestCase.setUp
    tearDown = persistence_support.ZilchAchievementPersistenceTestCase.tearDown
    _user = persistence_support.ZilchAchievementPersistenceTestCase._user
    _store = persistence_support.ZilchAchievementPersistenceTestCase._store

    def hold(self, game, turn, dice, kind, points):
        values = iter(dice)
        turn, evaluation = roll_zilch_turn(turn, randint_fn=lambda _a, _b: next(values))
        sync_zilch_turn(game, turn)
        self.assertFalse(evaluation.zilch or evaluation.third_roll_threshold_zilch)
        option = next(item for item in evaluation.options if item.combination_type == kind and item.points == points)
        turn = select_zilch_option(turn, option.option_id).turn
        sync_zilch_turn(game, turn)
        return turn

    def play_turn(self, game, turn, recipe):
        if recipe in {"double", "single", "double_then_zilch"}:
            for _ in range(1 if recipe == "single" else 2):
                turn = self.hold(game, turn, [1, 2, 3, 4, 5, 6], "straight", 2000)
            self.assertFalse(bank_allowed(turn)[0])
            turn = self.hold(game, turn, [5, 2, 3, 4, 6, 2], "single_five", 50)
            self.assertTrue(bank_allowed(turn)[0])
            if recipe == "double_then_zilch":
                # Six non-scoring dice instead earn the consolation 500.
                values = iter([2, 2, 3, 4, 6])
                turn, evaluation = roll_zilch_turn(turn, randint_fn=lambda _a, _b: next(values))
                self.assertTrue(evaluation.zilch)
                sync_zilch_turn(game, turn)
                record_zilch_loss(game, turn, reason="no_scoring_option")
                return
        elif recipe == "1100":
            turn = self.hold(game, turn, [1, 1, 1, 2, 3, 4], "three_ones", 1000)
            self.assertFalse(bank_allowed(turn)[0])
            turn = self.hold(game, turn, [1, 2, 3], "single_one", 100)
        else:
            face = 4 if recipe == "400" else 5
            turn = self.hold(game, turn, [face, face, face, 2, 3, 6], "three_of_a_kind", face * 100)
        self.assertEqual(bank_allowed(turn), (True, None))
        record_zilch_bank(game, turn)

    def legal_game(self, recipe="1100", *, first=None, opponent_first=None):
        self.sequence += 1
        one, two = self._user(f"BankWinner{self.sequence}"), self._user(f"BankOther{self.sequence}")
        game = new_zilch_game(f"bank-proof-{self.sequence}", "Engine proof", 2)
        for player_id, user in (("p1", one), ("p2", two)):
            join_zilch_player(game, {"id": player_id, "name": user.username, "user_id": user.id, "ws": None})
        start_zilch_game(game)
        record_zilch_start_roll(game, "p1", 6)
        record_zilch_start_roll(game, "p2", 2)
        for step in range(100):
            turn = current_zilch_turn(game)
            selected = first if step == 0 and first else recipe
            if turn.player_id == "p2":
                selected = opponent_first if step == 1 and opponent_first else "500"
            self.play_turn(game, turn, selected)
            if advance_after_zilch_turn(game, turn.player_id):
                finish_zilch_game(game)
                break
        else:
            self.fail("Legal game did not reach its real final-reply completion")
        payload = build_zilch_result_payload(game)
        self.assertIsNotNone(validate_stored_zilch_result_payload(payload, expected_game_id=game["_id"]))
        self.assertTrue(game["_finished"])
        return game, one, two

    def facts(self, game_id, user_id):
        with session_scope() as db:
            evidence = db.scalar(select(ZilchAchievementEvidence).where(
                ZilchAchievementEvidence.source_game_id == game_id, ZilchAchievementEvidence.user_id == user_id,
            ))
            self.assertIsNotNone(evidence)
            return _facts_from_evidence(evidence)

    @staticmethod
    def keys(user_id):
        return {item["key"] for item in get_zilch_achievement_profile(user_id)["unlocked"]}

    def test_five_real_engine_matches_finish_persist_and_award_only_the_proven_goals(self):
        fixtures = (
            ("1100", None, 11000, 5000, 0, True, False),
            ("1100", "400", 10300, 5000, 0, False, False),
            ("double", None, 12150, 1500, 2, False, True),
            ("single", None, 10250, 2500, 1, True, False),
            ("1100", "double_then_zilch", 11000, 5500, 0, True, False),
        )
        for recipe, first, own_total, other_total, maximum, small, hot in fixtures:
            with self.subTest(recipe=recipe, first=first):
                game, one, two = self.legal_game(recipe, first=first)
                payload = build_zilch_result_payload(game)
                self.assertEqual(payload["totals"], {"p1": own_total, "p2": other_total})
                result = finalize_zilch_result(game)
                self.assertTrue(result["result_persisted"], result)
                self.assertFalse(result["achievement_sync_pending"], result)
                facts = self.facts(game["_id"], one.id)
                self.assertEqual(facts[PROOF], maximum)
                self.assertEqual(SMALL in self.keys(one.id), small)
                self.assertEqual(HOT in self.keys(one.id), hot)
                self.assertNotIn(SMALL, self.keys(two.id))
                self.assertEqual(_progress_for_definition(ZILCH_ACHIEVEMENT_BY_KEY[HOT], [facts]),
                                 {"current": maximum, "target": 2})

    def test_floor_500_tie_and_other_modes_do_not_weaken_the_human_win_condition(self):
        game, one, _two = self.legal_game("500", opponent_first="400")
        self.assertTrue(finalize_zilch_result(game)["result_persisted"])
        facts = self.facts(game["_id"], one.id)
        self.assertEqual(facts["banked_rounds"], [500] * 20)
        self.assertIn(SMALL, self.keys(one.id))
        definition = ZILCH_ACHIEVEMENT_BY_KEY[SMALL]
        for changes in ({"outcome": "tie"}, {"outcome": "loss"}, {"play_mode": "cpu"},
                        {"play_mode": "solo", "outcome": "completed"}, {"banked_rounds": [2500] * 4}):
            self.assertFalse(_criterion_is_satisfied(definition, [{**facts, **changes}]), changes)

    def test_unknown_loss_holds_do_not_erase_complete_banked_turn_proof(self):
        game, one, _two = self.legal_game("double", first="double_then_zilch")
        game["_zilch_boards"]["p1"]["rounds"][0].pop("committed_holds")
        self.assertTrue(finalize_zilch_result(game)["result_persisted"])
        facts = self.facts(game["_id"], one.id)
        self.assertFalse(facts["history_complete"])
        self.assertIsNone(facts["hot_dice_events"])
        self.assertEqual(facts[PROOF], 2)
        self.assertIn(HOT, self.keys(one.id))

    def test_strict_bank_proof_rejects_partial_or_malformed_new_evidence_only(self):
        game, one, _two = self.legal_game("double")
        self._store(game)
        register_zilch_result_for_achievements(game["_id"])
        rounds = build_zilch_result_payload(game)["boards"]["p1"]["rounds"]
        self.assertEqual(_banked_turn_hot_dice_proof(rounds), 2)
        changed = deepcopy(build_zilch_result_payload(game))
        changed["boards"]["p1"]["rounds"][0]["committed_holds"][0]["roll_id"] = True
        # Old typed-result acceptance is unchanged; the new goal alone needs
        # the stronger bank-local proof and cannot use this malformed hold.
        self.assertIsNotNone(validate_stored_zilch_result_payload(changed, expected_game_id=game["_id"]))
        self.assertIsNone(_banked_turn_hot_dice_proof(changed["boards"]["p1"]["rounds"]))
        mutations = (
            lambda bank: bank.pop("committed_holds"),
            lambda bank: bank.update(committed_holds=[]),
            lambda bank: bank["committed_holds"][0].update(hot_dice=1),
            lambda bank: bank["committed_holds"][0].pop("hot_dice"),
            lambda bank: bank["committed_holds"][0].update(roll_id=True),
            lambda bank: bank["committed_holds"][0].update(roll_id=-1),
            lambda bank: bank["committed_holds"][1].update(roll_id=1),
            lambda bank: bank["committed_holds"][0].update(turn_id=2),
            lambda bank: bank["committed_holds"][0].update(points=-2000),
            lambda bank: bank["committed_holds"][-1].update(requires_confirmation=True),
        )
        for mutation in mutations:
            changed = deepcopy(rounds)
            mutation(changed[0])
            self.assertIsNone(_banked_turn_hot_dice_proof(changed))
        valid = self.facts(game["_id"], one.id)
        for invalid in (None, True, -1, 2.0, "2", {}, []):
            with self.subTest(invalid=invalid):
                row = ZilchAchievementEvidence(
                    result_schema_version=1, ruleset=valid["ruleset"], play_mode="multiplayer",
                    facts_json=json.dumps({**valid, PROOF: invalid}),
                )
                read = _facts_from_evidence(row)
                self.assertIsNotNone(read)
                self.assertEqual(read[PROOF], invalid)
                self.assertFalse(_criterion_is_satisfied(ZILCH_ACHIEVEMENT_BY_KEY[HOT], [read]))
                self.assertIsNone(_progress_for_definition(ZILCH_ACHIEVEMENT_BY_KEY[HOT], [read]))
                self.assertTrue(_criterion_is_satisfied(ZILCH_ACHIEVEMENT_BY_KEY["zilch.banked_round_500"], [read]))

    def rewind_catalog(self):
        with session_scope() as db:
            db.get(ZilchCommunityState, 1).achievement_catalog_version = ZILCH_ACHIEVEMENT_CATALOG_VERSION - 1

    def test_registered_enrichment_is_additive_and_idempotent_without_scanning_unregistered_games(self):
        game, one, _two = self.legal_game("double")
        game_id = self._store(game)
        register_zilch_result_for_achievements(game_id)
        acknowledge_zilch_award(one.id, "zilch.first_game")
        unregistered, _other, _last = self.legal_game("double")
        self._store(unregistered)
        with session_scope() as db:
            for row in db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.achievement_key == HOT)):
                db.delete(row)
            db.flush()
            previous = {}
            for row in db.scalars(select(ZilchAchievementEvidence)):
                facts = json.loads(row.facts_json)
                facts.pop(PROOF)
                previous[row.id] = facts
                row.facts_json = json.dumps(facts)
            old_unlocks = {row.id: (row.achievement_key, row.unlocked_at, row.source_game_id)
                           for row in db.scalars(select(ZilchAchievementUnlock))}
            old_deliveries = {row.id: row.acknowledged_at for row in db.scalars(select(ZilchAchievementDelivery))}
        self.rewind_catalog()
        result = resync_zilch_achievement_catalog()
        self.assertEqual(result["evidence_enriched"], 2)
        with session_scope() as db:
            after = {}
            for row in db.scalars(select(ZilchAchievementEvidence)):
                values = json.loads(row.facts_json)
                self.assertEqual({key: values[key] for key in previous[row.id]}, previous[row.id])
                after[row.id] = row.facts_json
                self.assertEqual(row.source_game_id, game_id)
            self.assertEqual({row.id: (row.achievement_key, row.unlocked_at, row.source_game_id)
                              for row in db.scalars(select(ZilchAchievementUnlock)) if row.id in old_unlocks}, old_unlocks)
            self.assertEqual({row.id: row.acknowledged_at for row in db.scalars(select(ZilchAchievementDelivery))
                              if row.id in old_deliveries}, old_deliveries)
        self.assertEqual(self.facts(game_id, one.id)[PROOF], 2)
        self.assertIn(HOT, self.keys(one.id))
        self.assertEqual(resync_zilch_achievement_catalog()["status"], "already_current")
        with session_scope() as db:
            self.assertEqual({row.id: row.facts_json for row in db.scalars(select(ZilchAchievementEvidence))}, after)

    def test_sealed_none_or_conflicting_old_facts_roll_back_the_whole_catalog(self):
        first, _one, _two = self.legal_game("double")
        second, _three, _four = self.legal_game("double")
        for game in (first, second):
            register_zilch_result_for_achievements(self._store(game))
        with session_scope() as db:
            originals = {row.id: row.facts_json for row in db.scalars(select(ZilchAchievementEvidence))}
        for conflict in (PROOF, "hot_dice_events"):
            with self.subTest(conflict=conflict):
                with session_scope() as db:
                    for row in db.scalars(select(ZilchAchievementEvidence)):
                        values = json.loads(originals[row.id])
                        values.pop(PROOF)
                        if row.source_game_id == second["_id"]:
                            values[conflict] = None if conflict == PROOF else 999
                        row.facts_json = json.dumps(values)
                    before = {row.id: row.facts_json for row in db.scalars(select(ZilchAchievementEvidence))}
                self.rewind_catalog()
                with self.assertRaisesRegex(ZilchAchievementError, "zilch_achievement_source_changed"):
                    resync_zilch_achievement_catalog()
                with session_scope() as db:
                    self.assertEqual(db.get(ZilchCommunityState, 1).achievement_catalog_version,
                                     ZILCH_ACHIEVEMENT_CATALOG_VERSION - 1)
                    self.assertEqual({row.id: row.facts_json for row in db.scalars(select(ZilchAchievementEvidence))}, before)

    def test_tombstoned_source_is_not_enriched_and_cleanup_remains_idempotent(self):
        game, one, _two = self.legal_game("double")
        game_id = self._store(game)
        register_zilch_result_for_achievements(game_id)
        delete_completed_game(game_id=game_id, admin_user_id=one.id, reason="Proof cleanup test")
        self.rewind_catalog()
        self.assertEqual(resync_zilch_achievement_catalog()["evidence_enriched"], 0)
        self.assertNotIn(HOT, self.keys(one.id))
        self.assertEqual(recover_deleted_zilch_achievement_sources()["processed"], 1)
        self.assertEqual(recover_deleted_zilch_achievement_sources()["processed"], 0)

    def test_a_missing_non_tombstoned_source_aborts_upgrade_instead_of_silently_skipping(self):
        game, _one, _two = self.legal_game("double")
        register_zilch_result_for_achievements(self._store(game))
        with session_scope() as db:
            db.delete(db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"])))
        self.rewind_catalog()
        with self.assertRaisesRegex(ZilchAchievementError, "zilch_achievement_catalog_source_missing"):
            resync_zilch_achievement_catalog()
