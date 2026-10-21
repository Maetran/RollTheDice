"""CPU memory keeps exactly one seat's permitted observations and fails closed."""

import copy
import json

import pytest

from app.watten_cards import DealtCards, make_deck
from app.watten_cpu_memory import (
    RETIRED_DEAL_LIMIT,
    CpuMemory,
    WattenCpuMemoryError,
    memory_from_storage,
    memory_to_storage,
    new_memory,
    observe,
    read_personal_view,
)
from app.watten_engine import (
    EngineCommand,
    EngineRecipe,
    SeatBinding,
    announcement_roles,
    apply_command,
    next_deal,
    start_match,
    storage_payload,
)
from app.watten_play import PlayProfile, legal_cards
from app.watten_rules import round_roles
from app.watten_views import cpu_view
from tests.test_watten_engine import actor, command, dealt
from tests.test_watten_views import blind_deal


def cpu_recipe(count=4, determination="normal", blind=False, critical=False, **options):
    bindings = tuple(SeatBinding(player, None) for player in "ABCD"[:count])
    return EngineRecipe(PlayProfile(count, determination, blind, critical), bindings,
                        (("A", "C"), ("B", "D")) if count == 4 else None, **options)


def explicit_deal(*hands):
    used = {card for hand in hands for card in hand}
    stock = tuple(card for card in make_deck() if card not in used)
    return DealtCards(tuple(tuple(hand) for hand in hands), stock, tuple(hand[-1] for hand in hands))


class Table:
    """Engine-driven table: every CPU memory observes each accepted state once."""

    def __init__(self, state, observers=None):
        self.state = state
        self.memories = {player: new_memory(player) for player in observers or state.recipe.seats}
        self.observe(())

    def view(self, player):
        return cpu_view(self.state, player_id=player)

    def observe(self, events):
        for player in self.memories:
            self.memories[player] = observe(self.memories[player], self.view(player), events)

    def _apply(self, player, request, **options):
        transition = apply_command(self.state, actor(self.state, player), request, **options)
        self.state = transition.state
        events = tuple((transition.ack.deal_id, *event) for event in transition.public_events)
        self.observe(events)
        return transition, events

    def act(self, player, kind, value=None, **options):
        return self._apply(player, command(self.state, player, kind, value), **options)

    def propose(self, player, proposal):
        return self._apply(player, EngineCommand(**proposal.command_fields()))

    def ready(self, strike="7", suit="bells", *, bloedeln=False):
        state = self.state
        roles = announcement_roles(state)
        if state.recipe.profile.determination == "normal":
            self.act(state.recipe.seats[roles.strike_announcer], "announce_strike", strike)
            self.act(state.recipe.seats[roles.suit_announcer], "announce_colour", suit)
            return
        for kind in ("show_ready", "inspection_ack"):
            for seat in sorted(state.inspectors):
                self.act(state.recipe.seats[seat], kind)
        if bloedeln is True and self.state.preplay_request is None:
            seat = next(seat for seat in range(len(state.recipe.seats)) if seat not in state.inspectors)
            self.act(state.recipe.seats[seat], "request_bloedeln")
        if self.state.preplay_request is not None and self.state.preplay_request.kind == "bloedeln" and bloedeln is not None:
            self.act(state.recipe.seats[self.state.preplay_request.responder],
                     "preplay_accept" if bloedeln else "preplay_decline")

    def play(self, player, card=None):
        options = legal_cards(self.state.play, self.state.bid_state, player)
        assert options and (card is None or card in options)
        return self.act(player, "play_card", card or options[0])

    def finish(self):
        while self.state.phase == "play":
            self.play(self.state.play.current_player_id)

    def next_deal(self, deal_id, deal):
        self.state = next_deal(self.state, deal_id, deal)
        self.observe(())


def restored(memory):
    return memory_from_storage(json.loads(json.dumps(memory_to_storage(memory))))


@pytest.mark.parametrize("count", (2, 3, 4))
def test_normal_call_is_remembered_from_one_time_events_and_survives_restart(count):
    table = Table(start_match(cpu_recipe(count), "normal-memory", dealt(count), first_dealer="A"))
    assert all(memory.strike is None and memory.suit is None for memory in table.memories.values())
    table.ready("9", "hearts")
    for player, memory in table.memories.items():
        assert (memory.strike, memory.suit) == ("9", "hearts")
        assert "hearts" not in repr(memory) and "9" not in repr(memory)
        assert restored(memory) == memory
        # Restart: the restored memory re-observes the same current view idempotently.
        assert observe(restored(memory), table.view(player)) == memory
    # The current DTO alone no longer carries the call; a lost memory cannot rebuild it.
    assert observe(new_memory("A"), table.view("A")).suit is None


@pytest.mark.parametrize("critical", (False, True))
def test_blind_inspection_window_is_remembered_only_by_its_own_inspectors(critical):
    table = Table(start_match(cpu_recipe(4, "ladinisch", True, critical), "window", blind_deal(), first_dealer="A"))
    table.act("A", "show_ready")
    table.act("B", "show_ready")
    for player in "AB":
        assert table.memories[player].inspected == ("hearts-9", "bells-8")
        assert (table.memories[player].strike, table.memories[player].suit) == ("9", "bells")
    table.act("A", "inspection_ack")
    table.act("B", "inspection_ack")
    assert all(cpu_view(table.state, player_id=player)["inspection"] is None for player in "ABCD")
    for player in "AB":
        assert table.memories[player].inspected == ("hearts-9", "bells-8")
        assert restored(table.memories[player]) == table.memories[player]
    for player in "CD":
        memory = table.memories[player]
        assert (memory.strike, memory.suit, memory.inspected) == (None, None, None)
    # Never reconstruct a closed window: a fresh inspector memory knows no call.
    late = observe(new_memory("A"), table.view("A"))
    assert (late.strike, late.suit, late.inspected) == (None, None, None)


def test_blind_call_events_and_wrong_event_bindings_fail_closed():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "blind-events", blind_deal(), first_dealer="A"))
    table.ready()
    memory, view = table.memories["C"], table.view("C")
    deal_id = table.state.deal_id
    for event, code in (((deal_id, "strike_announced", 1, "9"), "unpermitted_call"),
                        ((deal_id, "colour_announced", 0, "bells"), "unpermitted_call"),
                        (("other-deal", "watten_thanks", 0, None), "event_deal_mismatch"),
                        ((deal_id, "watten_thanks", 0, None), "invalid_event"),
                        ((deal_id, "secret_call", 0, "9"), "invalid_event"),
                        ((deal_id, "watten_thanks", 0), "invalid_event")):
        with pytest.raises(WattenCpuMemoryError, match=code):
            observe(memory, view, (event,))


def test_blind_cpu_view_rejects_knower_sending_a_reverse_partner_signal():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "blind-signal-contract", blind_deal(), first_dealer="A"))
    table.ready()
    table.act("B", "bid")
    view = table.view("A")
    assert "partner_feedback" not in view["actions"]
    reverse_action = copy.deepcopy(view)
    reverse_action["actions"].append("partner_feedback")
    with pytest.raises(WattenCpuMemoryError):
        read_personal_view(reverse_action, player_id="A")
    for viewer in ("A", "C"):
        reverse_feedback = copy.deepcopy(table.view(viewer))
        reverse_feedback["feedback"] = [{"sender": "A", "recipient": "C", "value": "good", "sequence": 1}]
        with pytest.raises(WattenCpuMemoryError):
            read_personal_view(reverse_feedback, player_id=viewer)
    table.act("C", "partner_feedback", "good")
    assert read_personal_view(table.view("A"), player_id="A").partner_feedback == "good"
    assert read_personal_view(table.view("C"), player_id="C").own_feedback == "good"


def test_blind_offer_and_answer_actions_cannot_be_forged_for_other_seats():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "bid-rights", blind_deal(), first_dealer="A"))
    table.ready()
    table.play("B", "hearts-O")
    assert read_personal_view(table.view("C"), player_id="C").actions == ("play_card", "bid")
    wrong_turn = copy.deepcopy(table.view("D"))
    wrong_turn["actions"].append("bid")
    with pytest.raises(WattenCpuMemoryError):
        read_personal_view(wrong_turn, player_id="D")
    table.act("C", "bid")
    wrong_answer = copy.deepcopy(table.view("D"))
    wrong_answer["actions"].append("respond_counter")
    with pytest.raises(WattenCpuMemoryError):
        read_personal_view(wrong_answer, player_id="D")
    wrong_decider = copy.deepcopy(table.view("B"))
    wrong_decider["bid"]["pending"]["decider"] = "D"
    with pytest.raises(WattenCpuMemoryError):
        read_personal_view(wrong_decider, player_id="B")


def test_open_events_must_match_roles_values_and_existing_knowledge():
    table = Table(start_match(cpu_recipe(2), "open-events", dealt(2), first_dealer="A"))
    _, events = table.act("B", "announce_strike", "9")
    assert events == (("open-events", "strike_announced", 1, "9"),)
    memory, view = table.memories["A"], table.view("A")
    assert observe(memory, view, events) == memory
    for event, code in ((("open-events", "strike_announced", 0, "9"), "invalid_event"),
                        (("open-events", "strike_announced", 1, "K"), "knowledge_conflict"),
                        (("open-events", "colour_announced", 1, "bells"), "invalid_event"),
                        (("open-events", "colour_announced", 0, "purple"), "invalid_event")):
        with pytest.raises(WattenCpuMemoryError, match=code):
            observe(memory, view, (event,))
    with pytest.raises(WattenCpuMemoryError, match="invalid_event"):
        observe(memory, view, [events[0]])


@pytest.mark.parametrize("critical", (False, True))
def test_weli_reference_names_only_the_sole_strike_and_weli_colour_card_means_bells(critical):
    # Weli shown as the strike card: the sole strike with any trump suit.
    strike_weli = dealt(4, bottoms=("hearts-8", "bells-6", "leaves-8", "acorns-8"))
    table = Table(start_match(cpu_recipe(4, "ladinisch", True, critical, show_rechter=True), "weli-strike",
                              strike_weli, first_dealer="A"))
    table.ready()
    assert table.view("A")["reference_card"] == {"face": "card", "card": "bells-6"}
    assert (table.memories["A"].strike, table.memories["A"].suit) == ("weli", "hearts")
    # A restarted knower relying only on the matching reference learns no trump suit.
    late = observe(new_memory("A"), table.view("A"))
    assert (late.strike, late.suit) == ("weli", None)
    assert table.state.thanks == (() if critical else (1,))
    assert table.memories["C"].thanks == table.state.thanks and table.memories["C"].strike is None
    # Weli shown as the colour card means bells; the reference is the matching card.
    colour_weli = dealt(4, bottoms=("bells-6", "leaves-9", "hearts-8", "acorns-8"))
    table = Table(start_match(cpu_recipe(4, "ladinisch", True, critical, show_rechter=True), "weli-colour",
                              colour_weli, first_dealer="A"))
    table.ready()
    assert table.memories["B"].inspected == ("leaves-9", "bells-6")
    assert (table.memories["B"].strike, table.memories["B"].suit) == ("9", "bells")
    late = observe(new_memory("B"), table.view("B"))
    assert (late.strike, late.suit) == ("9", "bells")
    assert table.view("C")["reference_card"] == {"face": "back"}


def test_duplicate_observations_are_idempotent_and_stale_or_retired_views_fail_closed():
    table = Table(start_match(cpu_recipe(2), "first", dealt(2), first_dealer="A"))
    table.ready()
    early_view = table.view("A")
    table.play("B")
    memory, view = table.memories["A"], table.view("A")
    assert observe(memory, view) == memory
    with pytest.raises(WattenCpuMemoryError, match="stale_observation"):
        observe(memory, early_view)
    table.finish()
    table.next_deal("second", dealt(2))
    with pytest.raises(WattenCpuMemoryError, match="stale_observation"):
        observe(table.memories["A"], view)
    tampered = copy.deepcopy(table.view("A"))
    tampered["dealer_seat"] = 0
    roles = round_roles(tampered["profile"]["player_count"], 0, determination=tampered["profile"]["determination"])
    tampered["announcement_roles"] = {"strike": roles.strike_announcer, "colour": roles.suit_announcer,
                                     "first_player": roles.first_player}
    # Keep the forged DTO internally consistent to exercise the memory's dealer check.
    tampered["actions"] = []
    with pytest.raises(WattenCpuMemoryError, match="knowledge_conflict"):
        observe(table.memories["A"], tampered)


def test_new_deal_drops_previous_private_cards_calls_and_plays():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "deal-1", blind_deal(), first_dealer="A"))
    table.ready()
    table.finish()
    before = table.memories["A"]
    assert before.inspected and before.plays and before.winners
    table.next_deal("deal-2", dealt(4))
    after = table.memories["A"]
    assert after.deal_id == "deal-2" and after.retired_deals == ("deal-1",)
    assert (after.strike, after.suit, after.inspected, after.plays, after.winners, after.thanks) == (
        None, None, None, (), (), ())
    # The new dealer B and inspector C get their own window only.
    table.act("B", "show_ready")
    table.act("C", "show_ready")
    assert table.memories["C"].inspected is not None and table.memories["A"].inspected is None


def test_accepted_schoeneres_resets_blind_memory_with_the_same_deal_and_rejects_old_revision():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True, schoeneres_enabled=True),
                              "same-round", blind_deal(), first_dealer="A"))
    table.ready()
    old_view = table.view("A")
    assert table.memories["A"].inspected is not None
    table.act("A", "request_schoeneres")
    hands = list(table.state.deal.hands)
    pool = (*table.state.deal.stock, *hands[0], *hands[1])
    hands[0], hands[1] = pool[:5], pool[5:10]
    table.act("B", "preplay_accept", replacement_deal=explicit_deal(*hands))
    for memory in table.memories.values():
        assert memory.deal_id == "same-round" and memory.deal_revision == 1
        assert (memory.strike, memory.suit, memory.inspected, memory.thanks, memory.plays, memory.winners) == (
            None, None, None, (), (), ())
        assert restored(memory) == memory
    stale = copy.deepcopy(old_view)
    stale["opportunity"] = table.state.opportunity + 10
    with pytest.raises(WattenCpuMemoryError, match="stale_observation"):
        observe(table.memories["A"], stale)
    with pytest.raises(WattenCpuMemoryError, match="unpermitted_call"):
        observe(table.memories["A"], table.view("A"), (("same-round", "colour_announced", 0, "bells"),))


def test_schlagwechsel_resets_call_roles_and_next_events_follow_the_swapped_announcers():
    table = Table(start_match(cpu_recipe(2), "swap", dealt(2), first_dealer="A"))
    table.act("B", "request_schlagwechsel")
    table.act("A", "preplay_accept")
    assert table.memories["A"].deal_revision == 1
    assert table.memories["A"].announcement_roles == (0, 1, 1)
    table.ready("9", "hearts")
    assert all((memory.strike, memory.suit) == ("9", "hearts") for memory in table.memories.values())
    assert all(restored(memory) == memory for memory in table.memories.values())


def test_old_cpu_memory_storage_and_personal_views_default_to_revision_zero():
    table = Table(start_match(cpu_recipe(2), "legacy-revision", dealt(2), first_dealer="A"))
    payload = memory_to_storage(table.memories["A"])
    payload.pop("deal_revision")
    payload.pop("announcement_roles")
    assert memory_from_storage(payload) == table.memories["A"]
    view = table.view("A")
    for key in ("deal_revision", "announcement_roles", "preplay"):
        view.pop(key)
    view["options"].pop("schoeneres_enabled")
    assert observe(table.memories["A"], view) == table.memories["A"]


@pytest.mark.parametrize("bad_count", (True, -1, 6, "1", None))
def test_public_trick_counts_reject_invalid_types_and_counts(bad_count):
    table = Table(start_match(cpu_recipe(2), "strict-piles", dealt(2), first_dealer="A"))
    view = table.view("A")
    view["seats"][0]["tricks_won"] = bad_count
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        read_personal_view(view, player_id="A")


def test_public_trick_counts_match_the_completed_public_tricks_and_legacy_fields_default_to_zero():
    table = Table(start_match(cpu_recipe(2), "counted-piles", dealt(2), first_dealer="A"))
    table.ready()
    table.play("B")
    table.play("A")
    view = table.view("A")
    winner = table.state.play.tricks[0].winner
    counts = tuple(int(seat == winner) for seat in range(2))
    assert read_personal_view(view, player_id="A").tricks_won == counts
    forged = copy.deepcopy(view)
    forged["seats"][winner]["tricks_won"] = 0
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        read_personal_view(forged, player_id="A")
    for item in view["seats"]:
        item.pop("tricks_won")
    assert read_personal_view(view, player_id="A").tricks_won == (0, 0)


@pytest.mark.parametrize("mutate", (
    lambda view: view.update(deal_revision=True),
    lambda view: view.update(deal_revision=-1),
    lambda view: view["announcement_roles"].update(strike=True),
    lambda view: view["announcement_roles"].update(colour=1),
    lambda view: view["announcement_roles"].update(first_player=0),
    lambda view: view["announcement_roles"].update(secret_call="hearts-7"),
    lambda view: view["preplay"].update(hidden_hands=[]),
    lambda view: view["preplay"].update(pending={"kind": "schoeneres", "requester": 0, "responder": 1}),
    lambda view: view["preplay"].update(bloedeln_cards=[{"seat": 0, "card": "hearts-7"}]),
    lambda view: view["options"].update(schoeneres_enabled="true"),
))
def test_preplay_and_revision_dto_extensions_fail_closed(mutate):
    table = Table(start_match(cpu_recipe(2), "strict-preplay", dealt(2), first_dealer="A"))
    view = table.view("A")
    mutate(view)
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        read_personal_view(view, player_id="A")


def test_retired_deals_are_bounded():
    memory = CpuMemory("A")
    retired = tuple(f"old-{index}" for index in range(RETIRED_DEAL_LIMIT))
    assert CpuMemory("A", retired_deals=retired).retired_deals == retired
    with pytest.raises(WattenCpuMemoryError):
        CpuMemory("A", retired_deals=(*retired, "one-more"))
    assert memory_to_storage(memory)["deal_id"] is None


@pytest.mark.parametrize("history", (False, True))
def test_public_plays_are_kept_independently_of_history_option_without_fetching_an_archive(history):
    def run(trick_history):
        table = Table(start_match(cpu_recipe(4, trick_history=trick_history), "plays", dealt(), first_dealer="A"))
        table.ready()
        table.finish()
        return table

    table = run(history)
    plays = {card for *_, card in table.memories["C"].plays}
    assert plays == set(table.state.play.plays)
    assert len(table.memories["C"].winners) == len(table.state.play.tricks)
    assert table.memories["C"] == run(not history).memories["C"]
    # A completed round makes all played tricks public, also with the option off.
    late = observe(new_memory("C"), table.view("C"))
    assert len(late.winners) == len(table.state.play.tricks)


def test_round_summary_is_terminal_display_data_and_never_supplies_a_blind_cpu_call():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "blind-review", blind_deal(), first_dealer="A"))
    table.ready()
    active = table.view("C")
    summary = {"strike_rank": "9", "trump_suit": "bells", "rechter": "bells-9"}
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        read_personal_view({**active, "round_summary": summary}, player_id="C")
    table.finish()
    terminal = table.view("C")
    assert terminal["round_summary"] == summary and terminal["trick_history"]
    assert read_personal_view(terminal, player_id="C").finished
    # A restarted observer sees the round review without learning a reusable call.
    late = observe(new_memory("C"), terminal)
    assert (late.strike, late.suit, late.inspected) == (None, None, None)
    for invalid in ({**summary, "rechter": "hearts-9"}, {**summary, "trump_suit": "violet"},
                    {**summary, "stock": []}):
        with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
            read_personal_view({**terminal, "round_summary": invalid}, player_id="C")
    table.next_deal("blind-after-review", blind_deal("secret"))
    assert "round_summary" not in table.view("C")
    assert (table.memories["C"].strike, table.memories["C"].suit) == (None, None)


@pytest.mark.parametrize("bad", (
    "not-a-dict", {"schema": 1},
))
def test_non_dto_inputs_fail_closed(bad):
    with pytest.raises(WattenCpuMemoryError):
        observe(new_memory("A"), bad)


def test_engine_state_storage_payload_foreign_or_extended_views_are_rejected():
    table = Table(start_match(cpu_recipe(2), "inputs", dealt(2), first_dealer="A"))
    table.ready()
    memory = table.memories["A"]
    with pytest.raises(WattenCpuMemoryError, match="view_required"):
        observe(memory, table.state)
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        observe(memory, storage_payload(table.state))
    with pytest.raises(WattenCpuMemoryError, match="foreign_view"):
        observe(memory, table.view("B"))
    for key, value in (("stock", list(table.state.deal.stock)), ("hands", []), ("call", {})):
        leaked = {**table.view("A"), key: value}
        with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
            observe(memory, leaked)
    opponent = copy.deepcopy(table.view("A"))
    opponent["hand"].append({"card": table.state.play.hands[1][0]})
    with pytest.raises(WattenCpuMemoryError):
        observe(memory, opponent)


@pytest.mark.parametrize("count,determination,blind,player", (
    (3, "normal", False, "A"), (3, "normal", False, "C"),
    (4, "normal", False, "C"), (4, "normal", False, "D"),
    (2, "ladinisch", False, "A"), (2, "ladinisch", False, "B"),
    (4, "ladinisch", False, "A"), (4, "ladinisch", False, "C"),
    (4, "ladinisch", True, "A"), (4, "ladinisch", True, "C"),
))
def test_hidden_precall_hand_cannot_be_supplied_as_face_up_cards(count, determination, blind, player):
    table = Table(start_match(cpu_recipe(count, determination, blind), "early-hand", dealt(count), first_dealer="A"))
    leaked = table.view(player)
    assert leaked["hand"] == [{"back": True}] * 5
    leaked["hand"] = [{"card": card} for card in table.state.deal.hands[table.state.recipe.seats.index(player)]]
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        observe(new_memory(player), leaked)


@pytest.mark.parametrize("count,determination,blind", (
    (2, "normal", False), (3, "normal", False), (4, "normal", False),
    (2, "ladinisch", False), (4, "ladinisch", False), (4, "ladinisch", True),
))
def test_actual_personal_views_remain_valid_across_precall_and_play(count, determination, blind):
    table = Table(start_match(cpu_recipe(count, determination, blind), "valid-views", dealt(count), first_dealer="A"))
    table.ready()
    for player in table.state.recipe.seats:
        assert table.view(player)["hand"] == [
            {"card": card} for card in table.state.play.hands[table.state.recipe.seats.index(player)]]
        assert observe(restored(table.memories[player]), table.view(player)) == table.memories[player]


@pytest.mark.parametrize("count,determination,blind,started", (
    (4, "ladinisch", True, True), (4, "normal", False, False),
    (3, "normal", False, False), (4, "ladinisch", False, False),
))
def test_partner_cards_require_open_play_after_the_call(count, determination, blind, started):
    recipe = cpu_recipe(count, determination, blind, **({} if blind else {"open_partner_hand": True}))
    table = Table(start_match(recipe, "partner-leak", dealt(count), first_dealer="A"))
    if started:
        table.ready()
    leaked = table.view("A")
    assert leaked["partner_hand"] is None
    leaked["options"]["open_partner_hand"] = True
    hands = table.state.play.hands if table.state.play else table.state.deal.hands
    leaked["partner_hand"] = {"player_id": "C", "cards": list(hands[2])}
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        observe(new_memory("A"), leaked)


def test_two_player_view_cannot_enable_a_partner_hand_option():
    table = Table(start_match(cpu_recipe(2), "no-partner", dealt(2), first_dealer="A"))
    leaked = table.view("A")
    leaked["options"]["open_partner_hand"] = True
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        observe(new_memory("A"), leaked)


@pytest.mark.parametrize("count,determination", ((3, "normal"), (4, "normal"), (4, "ladinisch")))
def test_actual_open_partner_cards_remain_valid_after_the_call(count, determination):
    table = Table(start_match(cpu_recipe(count, determination, open_partner_hand=True), "open-partner",
                              dealt(count), first_dealer="A"))
    table.ready()
    assert table.view("A")["partner_hand"] == {"player_id": "C", "cards": list(table.state.play.hands[2])}
    for player in table.state.recipe.seats:
        assert observe(table.memories[player], table.view(player)) == table.memories[player]


@pytest.mark.parametrize("mutation", ("closed_window", "missing_action", "missing_cards", "wrong_action"))
def test_original_inspection_cards_require_the_current_inspection_ack_window(mutation):
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "inspection-leak", blind_deal(), first_dealer="A"))
    table.act("A", "show_ready")
    table.act("B", "show_ready")
    leaked = table.view("A")
    assert leaked["inspection"] is not None and leaked["actions"] == ["inspection_ack"]
    if mutation == "closed_window":
        original = leaked["inspection"]
        table.act("A", "inspection_ack")
        leaked = table.view("A")
        assert leaked["inspection"] is None and leaked["actions"] == []
        leaked["inspection"] = original
    elif mutation == "missing_action":
        leaked["actions"] = []
    elif mutation == "missing_cards":
        leaked["inspection"] = None
    else:
        leaked["actions"] = ["play_card"]
    with pytest.raises(WattenCpuMemoryError, match="invalid_view"):
        observe(new_memory("A"), leaked)


@pytest.mark.parametrize("field,value", (("strike", "9"), ("suit", "bells"), ("strike", "weli")))
@pytest.mark.parametrize("player", ("C", "D"))
def test_blind_noninspector_cannot_restore_a_received_call(field, value, player):
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "blind-stored-call", blind_deal(), first_dealer="A"))
    table.ready()
    payload = memory_to_storage(table.memories[player])
    assert (payload["strike"], payload["suit"], payload["inspected"]) == (None, None, None)
    payload[field] = value
    with pytest.raises(WattenCpuMemoryError, match="invalid_memory"):
        memory_from_storage(payload)


def _stored_memory():
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "stored", blind_deal(), first_dealer="A"))
    table.ready()
    for _ in range(5):
        table.play(table.state.play.current_player_id)
    return memory_to_storage(table.memories["A"])


@pytest.mark.parametrize("mutate", (
    lambda value: value.update(extra=1),
    lambda value: value.pop("winners"),
    lambda value: value.update(schema=2),
    lambda value: value.update(schema=True),
    lambda value: value.update(kind="watten_engine"),
    lambda value: value.update(seat=True),
    lambda value: value.update(seat=7),
    lambda value: value.update(strike="6"),
    lambda value: value.update(suit="leaves"),
    lambda value: value.update(inspected=["hearts-9", "hearts-9"]),
    lambda value: value.update(inspected=["bells-8", "hearts-9"]),
    lambda value: value.update(thanks=[2]),
    lambda value: value.update(opportunity=-1),
    lambda value: value.update(retired_deals=["stored"]),
    lambda value: value["plays"].append(dict(value["plays"][0])),
    lambda value: value["plays"].reverse(),
    lambda value: value["plays"][0].update(card="joker"),
    lambda value: value["plays"][0].update(extra=True),
    lambda value: value["plays"][1].update(seat=0),
    lambda value: value["winners"].append({"trick": 1, "seat": 0}),
    lambda value: value["winners"][0].update(seat=(value["winners"][0]["seat"] + 1) % 4),
    lambda value: value["profile"].update(blind="yes"),
    lambda value: value["profile"].update(player_count=3),
    lambda value: value.update(deal_id=None),
))
def test_malformed_memory_storage_fails_closed(mutate):
    payload = _stored_memory()
    assert memory_from_storage(copy.deepcopy(payload)) is not None
    mutate(payload)
    with pytest.raises(WattenCpuMemoryError, match="invalid_memory"):
        memory_from_storage(payload)
