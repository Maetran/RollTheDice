"""Native accepted transitions, durable bid observations and public provenance."""

import json
from collections import Counter
from copy import deepcopy
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from itertools import count
from types import SimpleNamespace

import pytest

from app import watten_runtime as runtime_module
from app.watten_bidding import retourschneider_candidate
from app.watten_cpu_runtime import observe_cpu_memories
from app.watten_engine import EngineActor, EngineCommand
from app.watten_evidence import BidEvidence, evidence_from_payload, evidence_to_payload
from app.watten_match_evidence import terminal_evidence
from app.watten_play import legal_cards
from app.watten_recipe import WattenRecipe
from app.watten_results import result_payload
from app.watten_rules import round_roles
from app.watten_runtime import (
    _apply_engine_command,
    admit_account,
    apply_runtime_action,
    configure_watten_game,
    new_watten_game,
    restore_watten_json,
    serialize_watten_game,
    snapshot_watten,
)


@pytest.fixture(autouse=True)
def deterministic_deal(monkeypatch):
    monkeypatch.setattr(runtime_module, "_RANDOM", SimpleNamespace(randrange=lambda _count: 0, shuffle=lambda _deck: None))
    from app import watten_round_runtime

    monkeypatch.setattr(watten_round_runtime, "utcnow", lambda: runtime_module.utcnow() + timedelta(seconds=10))


class NativeMatch:
    def __init__(self, players=2, *, cpus=(), target=7, determination="normal", blind=False, start=True,
                 game_id="native-public-evidence", schoeneres=False):
        self.numbers = count()
        self.expected = Counter()
        self.game = new_watten_game(game_id, "Evidence", players)
        recipe = WattenRecipe(players, determination, blind, False, target_points=target, cpu_seats=cpus,
                              schoeneres_enabled=schoeneres)
        configure_watten_game(self.game, recipe, SimpleNamespace(user_id=1, username="Human 1"), None)
        for index, seat in enumerate(seat for seat in range(players) if seat not in cpus):
            identity = SimpleNamespace(user_id=index + 1, username=f"Human {index + 1}")
            candidate, player = admit_account(self.game, identity, self.runtime.room.revision, None)
            self.install(candidate)
            self.room("watten_take_seat", account=identity.user_id, player=player, seat=seat,
                      team=seat % 2 if players == 4 else None)
        if start:
            self.room("watten_start")

    @property
    def runtime(self):
        return self.game["_watten"]

    @property
    def engine(self):
        return self.runtime.engine

    def install(self, candidate):
        # The production checkpoint does this observation in its DB transaction.
        # These pure tests have no result/grant writer or account database.
        candidate["_watten"] = observe_cpu_memories(candidate["_watten"])
        self.game = candidate

    def room(self, action, *, account=1, player="p1", **values):
        data = {"action": action, "command_id": f"room-{next(self.numbers)}", "revision": self.runtime.room.revision,
                "lifecycle_revision": self.runtime.lifecycle_revision, **values}
        candidate, *_ = apply_runtime_action(self.game, account, player, data)
        self.install(candidate)

    def command(self, player, kind, value=None):
        private = next((item.sequence for item in self.engine.feedback if item.sender == player), 0) if kind == "partner_feedback" else None
        return EngineCommand(f"engine-{next(self.numbers)}", self.engine.deal_id, self.engine.opportunity,
                             self.engine.phase, kind, value, private)

    def apply(self, player, command):
        binding = next(item for item in self.engine.recipe.bindings if item.player_id == player)
        if binding.account_id is None:
            outcome = _apply_engine_command(self.game, EngineActor(player, None), command)
        else:
            data = {"action": "watten_command", "command_id": command.command_id, "deal_id": command.deal_id,
                    "opportunity": command.opportunity, "phase": command.phase, "kind": command.kind,
                    "value": command.value, "private_opportunity": command.private_opportunity,
                    "lifecycle_revision": self.runtime.lifecycle_revision}
            outcome = apply_runtime_action(self.game, binding.account_id, player, data)
        candidate, _ack, replayed, private = outcome
        if not replayed:
            field = "initiated" if command.kind == "bid" else (
                {"hold": "held", "counter": "countered", "go": "went"}.get(command.value) if command.kind == "respond" else None)
            if field:
                self.expected[player, field] += 1
        self.install(candidate)
        return replayed, private

    def act(self, player, kind, value=None):
        command = self.command(player, kind, value)
        self.apply(player, command)
        return command

    def ready(self):
        if self.engine.phase == "strike":
            roles = round_roles(len(self.engine.recipe.seats), self.engine.dealer_seat, determination="normal")
            self.act(self.engine.recipe.seats[roles.strike_announcer], "announce_strike", "7")
            self.act(self.engine.recipe.seats[roles.suit_announcer], "announce_colour", "bells")
        elif self.engine.phase == "show_ready":
            for seat in sorted(self.engine.inspectors):
                self.act(self.engine.recipe.seats[seat], "show_ready")
            for seat in sorted(self.engine.inspectors):
                self.act(self.engine.recipe.seats[seat], "inspection_ack")
        if self.engine.bloedeln_decisions is not None:
            before = self.runtime.bid_counters
            # This driver explicitly declines through each bound human/CPU actor,
            # including the newly eligible pair after the dealer rotates.
            for seat, player in enumerate(self.engine.recipe.seats):
                if seat not in self.engine.inspectors and seat not in dict(self.engine.bloedeln_decisions):
                    self.act(player, "bloedeln_decline")
            assert len(self.engine.bloedeln_decisions) == 2
            assert self.runtime.bid_counters == before
        assert self.engine.phase == "play"

    def card(self):
        player = self.engine.play.current_player_id
        self.act(player, "play_card", legal_cards(self.engine.play, self.engine.bid_state, player)[0])

    def respond(self, value):
        player = self.engine.parties.decider(1 - self.engine.bid_state.pending.party)
        return player, self.act(player, "respond", value)

    def next_deal(self):
        self.room("watten_next_deal", deal_id=self.engine.deal_id, opportunity=self.engine.opportunity)

    def finish(self):
        for _ in range(240):
            if self.engine.phase == "match_complete":
                return
            if self.engine.phase == "deal_complete":
                candidate = retourschneider_candidate(self.engine.ledger)
                if candidate is not None:
                    self.act(candidate[0], "retourschneider", "decline")
                self.next_deal()
                self.ready()
            self.card()
        raise AssertionError("Native match did not finish")

    def restart(self):
        self.game = restore_watten_json(json.dumps(serialize_watten_game(self.game)))

    def assert_counts(self):
        for item in self.runtime.bid_counters:
            for field in ("initiated", "countered", "held", "went"):
                assert getattr(item, field) == self.expected[item.player_id, field]


@pytest.mark.parametrize("players,determination,blind,cpus", (
    (2, "normal", False, (1,)), (2, "ladinisch", False, (1,)),
    (3, "normal", False, (1,)), (4, "ladinisch", True, (1, 2, 3)),
))
def test_real_multi_deal_chains_restart_replay_and_exact_terminal_public_evidence(players, determination, blind, cpus):
    match = NativeMatch(players, cpus=cpus, determination=determination, blind=blind)
    assert all(item.initiated == item.countered == item.held == item.went == 0 for item in match.runtime.bid_counters)
    match.ready()
    match.card()
    card_player = match.engine.play.current_player_id
    bidder = match.engine.parties.decider(match.engine.parties.party_of(card_player)) if blind else card_player
    bid_command = match.act(bidder, "bid")
    before = match.runtime.bid_counters
    assert match.apply(bidder, bid_command)[0]
    assert match.runtime.bid_counters == before
    match.restart()  # an actual pending public chain survives version 3
    match.respond("counter")
    held_by, held_command = match.respond("hold")
    match.assert_counts()
    before = match.runtime.bid_counters
    assert match.apply(held_by, held_command)[0]
    assert match.runtime.bid_counters == before
    while match.engine.phase == "play":
        match.card()
    assert match.engine.phase == "deal_complete"
    match.next_deal()
    assert match.runtime.bid_counters == before
    match.ready()
    match.card()
    card_player = match.engine.play.current_player_id
    bidder = match.engine.parties.decider(match.engine.parties.party_of(card_player)) if blind else card_player
    match.act(bidder, "bid")
    match.respond("counter")
    match.respond("go")
    match.assert_counts()
    match.restart()
    match.finish()
    match.assert_counts()
    original = deepcopy(result_payload(match.game))
    match.game["_watten_result"] = deepcopy(original)
    match.game["_completion_persisted"] = True
    finished = datetime.fromisoformat(match.game["_finished_at"])
    evidence = terminal_evidence(match.game, finished_at=finished)
    assert evidence.source == "public_match_v1" and evidence.bids.complete
    assert evidence.bids.players == match.runtime.bid_counters
    assert evidence.profile.determination == determination and evidence.profile.blind == blind
    assert evidence.started_at == datetime.fromisoformat(match.game["_started_at"])
    assert [item.is_cpu for item in evidence.roster] == [seat in cpus for seat in range(players)]
    assert result_payload(match.game) == original == match.game["_watten_result"]
    public = evidence_to_payload(evidence)
    forbidden = {"account_id", "user_id", "call", "hand", "hands", "feedback", "cpu_memories", "inspection", "stock"}

    def inspect(value):
        if isinstance(value, dict):
            assert not forbidden.intersection(value)
            for item in value.values():
                inspect(item)
        elif isinstance(value, list):
            for item in value:
                inspect(item)

    inspect(public)
    match.restart()
    assert terminal_evidence(match.game, finished_at=finished) == evidence


@pytest.mark.parametrize("version", (1, 2))
def test_legacy_running_counters_remain_unknown_through_bids_next_deal_and_finish(version):
    match = NativeMatch()
    raw = serialize_watten_game(match.game)
    raw["_watten"]["schema_version"] = version
    raw["_watten"].pop("bid_counters")
    raw["_watten"].pop("round_review_started_at")
    if version == 1:
        raw["_watten"].pop("cpu_memories")
    match.game = restore_watten_json(json.dumps(raw))
    assert match.runtime.bid_counters is None
    match.ready()
    match.card()
    match.act(match.engine.play.current_player_id, "bid")
    match.respond("go")
    match.next_deal()
    match.ready()
    match.restart()
    assert match.runtime.bid_counters is None
    match.finish()
    evidence = terminal_evidence(match.game, finished_at=datetime.fromisoformat(match.game["_finished_at"]))
    assert evidence.bids == BidEvidence()


@pytest.mark.parametrize("version", (1, 2))
def test_legacy_waiting_room_gets_fresh_complete_counters_only_on_start(version):
    match = NativeMatch(cpus=(1,), start=False)
    raw = serialize_watten_game(match.game)
    raw["_watten"]["schema_version"] = version
    raw["_watten"].pop("bid_counters")
    raw["_watten"].pop("round_review_started_at")
    if version == 1:
        raw["_watten"].pop("cpu_memories")
    match.game = restore_watten_json(json.dumps(raw))
    assert match.runtime.bid_counters is None
    match.room("watten_start")
    assert len(match.runtime.bid_counters) == 2
    match.restart()
    assert all(item.initiated == 0 for item in match.runtime.bid_counters)


def test_private_partner_advice_and_delivery_ack_do_not_touch_counters_or_public_views():
    match = NativeMatch(4, cpus=(2, 3))
    match.ready()
    match.act(match.engine.play.current_player_id, "bid")
    before_counts = match.runtime.bid_counters
    before_public = snapshot_watten(match.game)
    before_updated = match.game["_updated_at"]
    player = match.engine.recipe.seats[2]  # actual CPU, account=None
    opponent = match.engine.recipe.seats[1]
    before_opponent = snapshot_watten(match.game, opponent)
    command = match.command(player, "partner_feedback", "good")
    replayed, private = match.apply(player, command)
    assert not replayed and private == {player, match.engine.recipe.seats[0]}
    assert match.runtime.bid_counters == before_counts
    assert snapshot_watten(match.game) == before_public
    assert snapshot_watten(match.game, opponent) == before_opponent
    assert match.game["_updated_at"] == before_updated
    deliveries = [item.delivery_id for item in match.runtime.deliveries if item.participant_id == "p1"]
    match.room("watten_delivery_ack", delivery_ids=deliveries)
    assert match.runtime.bid_counters == before_counts
    assert "bid_counters" not in snapshot_watten(match.game)


@pytest.mark.parametrize("damage", (
    lambda data: data.pop("bid_counters"),
    lambda data: data.update(schema_version=True),
    lambda data: data.update(schema_version=5),
    lambda data: data.update(unexpected=True),
    lambda data: data.update(bid_counters={}),
    lambda data: data["bid_counters"][0].update(initiated=True),
    lambda data: data["bid_counters"][0].update(held=-1),
    lambda data: data["bid_counters"][0].update(extra=0),
    lambda data: data["bid_counters"].reverse(),
    lambda data: data["bid_counters"].append(data["bid_counters"][0]),
    lambda data: data["bid_counters"][0].update(initiated=1),
    lambda data: data["bid_counters"][0].update(countered=1),
    lambda data: data["bid_counters"][0].update(went=1),
    lambda data: data.update(schema_version=2),  # v2 cannot smuggle the new field
))
def test_version_three_rejects_malformed_or_inconsistent_counter_storage(damage):
    match = NativeMatch()
    raw = serialize_watten_game(match.game)
    assert raw["_watten"]["schema_version"] == 4
    damage(raw["_watten"])
    with pytest.raises(ValueError):
        restore_watten_json(json.dumps(raw))


def test_terminal_producer_rejects_unfinished_wrong_timestamp_naive_time_and_conflicting_v1():
    match = NativeMatch(target=3)
    with pytest.raises(ValueError, match="not_finished"):
        terminal_evidence(match.game, finished_at=datetime.now(timezone.utc))
    match.ready()
    match.finish()
    finished = datetime.fromisoformat(match.game["_finished_at"])
    for invalid in (finished.replace(tzinfo=None), finished + timedelta(seconds=1),
                    finished.astimezone(timezone(timedelta(hours=1)))):
        with pytest.raises(ValueError, match="timestamp"):
            terminal_evidence(match.game, finished_at=invalid)
    match.game["_watten_result"] = deepcopy(result_payload(match.game))
    match.game["_watten_result"]["participants"][0]["name"] = "Other history"
    with pytest.raises(ValueError, match="conflict"):
        terminal_evidence(match.game, finished_at=finished)
    match.game["_watten_result"] = None
    match.game["_started_at"] = (finished + timedelta(seconds=1)).isoformat()
    with pytest.raises(ValueError):
        terminal_evidence(match.game, finished_at=finished)


def test_complete_journal_is_not_derived_from_evicted_retry_commands():
    match = NativeMatch()
    match.ready()
    match.card()
    match.act(match.engine.play.current_player_id, "bid")
    match.respond("hold")
    # Eviction is immaterial: only the acceptance-time journal is authoritative.
    match.game["_watten"] = replace(match.runtime, engine=replace(match.engine, ack_cache=()))
    match.restart()
    match.assert_counts()
    assert sum(item.initiated for item in match.runtime.bid_counters) == 1
    assert sum(item.held for item in match.runtime.bid_counters) == 1


def test_rejected_commands_and_client_supplied_counter_claims_have_no_authority():
    match = NativeMatch()
    match.ready()
    before = match.runtime
    player = match.engine.play.current_player_id
    other = next(item for item in match.engine.recipe.seats if item != player)
    with pytest.raises(ValueError, match="card_turn_required"):
        match.act(other, "bid")
    assert match.runtime == before
    binding = next(item for item in match.engine.recipe.bindings if item.player_id == player)
    command = match.command(player, "play_card", legal_cards(match.engine.play, match.engine.bid_state, player)[0])
    data = {"action": "watten_command", "command_id": command.command_id, "deal_id": command.deal_id,
            "opportunity": command.opportunity, "phase": command.phase, "kind": command.kind,
            "value": command.value, "private_opportunity": None,
            "lifecycle_revision": match.runtime.lifecycle_revision, "bid_counters": []}
    with pytest.raises(ValueError):
        apply_runtime_action(match.game, binding.account_id, player, data)
    assert match.runtime == before


def test_opening_bid_then_schoeneres_preserves_accepted_journal_and_terminal_evidence():
    match = NativeMatch(target=3, schoeneres=True)
    match.ready()
    player = match.engine.play.current_player_id
    match.act(player, "bid")
    match.respond("hold")
    match.act(player, "request_schoeneres")
    responder = match.engine.recipe.seats[match.engine.preplay_request.responder]
    accepted = match.act(responder, "preplay_accept")
    assert match.engine.discarded_bid_increases == 1 and match.engine.bid_state.accepted_stake == 2
    assert match.apply(responder, accepted)[0]
    assert match.engine.discarded_bid_increases == 1
    match.assert_counts()
    match.restart()
    match.ready()
    match.act(match.engine.play.current_player_id, "bid")
    match.respond("counter")
    match.respond("go")
    assert match.engine.phase == "match_complete" and not match.engine.play.plays and not match.engine.play.tricks
    match.assert_counts()
    evidence = terminal_evidence(match.game, finished_at=datetime.fromisoformat(match.game["_finished_at"]))
    assert evidence.bids.complete and evidence.bids.discarded_bid_increases == 1
    payload = evidence_to_payload(evidence)
    assert evidence_from_payload(payload) == evidence
    for invalid in (True, -1, "1", 0):
        forged = deepcopy(payload)
        forged["bids"]["discarded_bid_increases"] = invalid
        with pytest.raises(ValueError):
            evidence_from_payload(forged)
    match.restart()
    assert match.engine.discarded_bid_increases == 1


def test_counter_only_claim_cannot_explain_a_held_raised_deal():
    match = NativeMatch()
    match.ready()
    match.card()
    match.act(match.engine.play.current_player_id, "bid")
    match.respond("counter")
    match.respond("hold")
    while match.engine.phase == "play":
        match.card()
    raw = serialize_watten_game(match.game)
    counters = raw["_watten"]["bid_counters"]
    for item in counters:
        item.update(initiated=0, held=0, countered=0, went=0)
    counters[0]["countered"] = 2
    # Aggregate stake increments alone fit; no initial bid or closing hold did.
    with pytest.raises(ValueError, match="bid_counters"):
        restore_watten_json(json.dumps(raw))
