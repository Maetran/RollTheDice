"""An inspecting CPU spends its own shown original card between comparable choices.

Each case uses a real engine table and the CPU's own DTO plus memory only. The
comparison with ``_own_shown_card`` disabled shows what the unchanged policy
would play, so every positive case proves an actual change of the decision.
"""

import json
from dataclasses import replace

import pytest

import app.watten_cpu as cpu_policy
from app.watten_cpu import CpuBudget, decide
from app.watten_cpu_memory import memory_from_storage, memory_to_storage, new_memory, observe
from app.watten_cpu_skill import CpuSkill
from app.watten_engine import start_match
from tests.test_watten_cpu_memory import Table, cpu_recipe, explicit_deal

SEEDS = range(6)


@pytest.fixture(autouse=True)
def no_bids(monkeypatch):
    # These cases are about card choice; an optional bid must not replace it.
    monkeypatch.setattr(cpu_policy, "_should_bid", lambda *_args: False)
    monkeypatch.setattr(cpu_policy, "_bloedeln_coin", lambda *_args: False)


def two_player(a, b, deal_id="shown"):
    """A deals and announces colour (A's bottom), B strike (B's bottom) and leads."""
    table = Table(start_match(cpu_recipe(2, "ladinisch"), deal_id, explicit_deal(a, b), first_dealer="A"))
    table.ready()
    return table


def four_player_blind(a, b, c, d, deal_id="shown-blind", bloedeln=None):
    """A deals (colour), B strike and first lead; teams A+C against B+D."""
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), deal_id, explicit_deal(a, b, c, d), first_dealer="A"))
    table.ready(bloedeln=bloedeln)
    return table


def choose(table, player, seed, *, hidden=False, memory=None):
    if hidden:
        with pytest.MonkeyPatch.context() as patch:
            patch.setattr(cpu_policy, "_own_shown_card", lambda _ctx: None)
            return choose(table, player, seed, memory=memory)
    decision = decide(table.view(player), memory or table.memories[player], seed=seed, budget=CpuBudget(24)).decision
    assert decision.kind == "play_card"
    return decision.value


def context(table, player, memory=None):
    return cpu_policy._prepare(table.view(player), memory or table.memories[player], ())


# A: colour announcer, shows bells-U (trump bells); B: strike announcer, shows hearts-K (strike K).
SEQUENCE_A = ("bells-10", "bells-9", "bells-8", "acorns-A", "bells-U")
RECHTER_B = ("bells-K", "leaves-7", "leaves-8", "hearts-7", "hearts-K")


def test_own_role_entry_is_the_shown_card_and_only_while_still_held():
    table = two_player(SEQUENCE_A, RECHTER_B)
    assert table.memories["A"].inspected == table.memories["B"].inspected == ("hearts-K", "bells-U")
    # inspected = (strike card, colour card): each seat uses only its own role's card.
    assert cpu_policy._own_shown_card(context(table, "A")) == "bells-U"
    assert cpu_policy._own_shown_card(context(table, "B")) == "hearts-K"
    table.play("B", "hearts-K")
    # Spent: the card is no longer in B's hand, so nothing is preferred any more.
    assert cpu_policy._own_shown_card(context(table, "B")) is None


def test_missing_memory_of_the_inspection_never_invents_a_shown_card():
    table = two_player(SEQUENCE_A, RECHTER_B)
    table.play("B", "bells-K")
    # A fresh memory after the closed window knows neither the shown cards nor the call.
    fresh = observe(new_memory("A"), table.view("A"))
    assert fresh.inspected is None
    assert cpu_policy._own_shown_card(context(table, "A", fresh)) is None
    for seed in SEEDS:
        assert choose(table, "A", seed, memory=fresh) == choose(table, "A", seed, memory=fresh, hidden=True)


def test_same_party_inspectors_have_nothing_to_hide_from_each_other():
    # The engine seats four-player partners opposite, so dealer and next (the
    # inspectors) are always opponents. The guard stays for any other seating.
    table = two_player(SEQUENCE_A, RECHTER_B)
    ctx = context(table, "A")
    assert cpu_policy._own_shown_card(ctx) == "bells-U"
    ctx.parties = (0, 0)
    assert cpu_policy._own_shown_card(ctx) is None


def test_surely_lost_trick_keeps_the_shown_trump_as_candidate_and_spends_it():
    table = two_player(SEQUENCE_A, RECHTER_B)
    table.play("B", "bells-K")  # Rechter: A must follow trump and cannot win.
    ctx = context(table, "A")
    options = cpu_policy._options(ctx)
    legal = cpu_policy._own_legal(ctx, options)
    assert set(legal) == {"bells-10", "bells-9", "bells-8", "bells-U"}
    # The early hopeless reduction keeps the cheapest card and the shown card.
    assert cpu_policy._conserve_hopeless(ctx, legal, options) == ("bells-8", "bells-U")
    for seed in SEEDS:
        assert choose(table, "A", seed, hidden=True) == "bells-8"
        assert choose(table, "A", seed) == "bells-U"
    # A restart restores the same private memory and therefore the same choice.
    restored = memory_from_storage(json.loads(json.dumps(memory_to_storage(table.memories["A"]))))
    assert choose(table, "A", 0, memory=restored) == "bells-U"


def test_reviewer_case_unknown_trumps_between_are_weighed_by_close_rollouts():
    # Strike 7 (B shows hearts-7), trump bells (A shows bells-U). bells-9 and
    # bells-10 are unknown to A and lie between bells-8 and bells-U.
    table = two_player(("bells-8", "acorns-A", "acorns-K", "acorns-7", "bells-U"),
                       ("hearts-A", "hearts-K", "leaves-A", "leaves-10", "hearts-7"))
    assert (table.memories["A"].strike, table.memories["A"].suit) == ("7", "bells")
    table.play("B", "hearts-A")
    ctx = context(table, "A")
    models = tuple(model for model, *_ in cpu_policy._options(ctx))
    # Both trumps surely take the trick as last card, so they are comparable.
    assert cpu_policy._sure_trick(ctx, "bells-8", models) and cpu_policy._sure_trick(ctx, "bells-U", models)
    assert cpu_policy._comparable_shown(ctx, "bells-8", "bells-U", models)
    unchanged = [choose(table, "A", seed, hidden=True) for seed in range(8)]
    chosen = [choose(table, "A", seed) for seed in range(8)]
    assert unchanged == ["bells-8"] * 8
    assert set(chosen) <= {"bells-8", "bells-U"} and chosen.count("bells-U") >= 6


def test_lower_shown_trump_is_spent_only_while_the_trick_stays_sure():
    # A shows the low bells-8 and also holds bells-U; strike 7.
    hand = ("bells-U", "acorns-A", "acorns-K", "leaves-7", "bells-8")
    for lead, expected in (("hearts-A", "bells-8"), ("bells-9", "bells-U")):
        table = two_player(hand, ("bells-9", "hearts-A", "leaves-A", "leaves-10", "hearts-7"), f"lower-{lead}")
        table.play("B", lead)
        ctx = context(table, "A")
        models = tuple(model for model, *_ in cpu_policy._options(ctx))
        # On hearts-A both trumps surely win; on the bells-9 trump lead only Unter wins.
        assert cpu_policy._comparable_shown(ctx, "bells-U", "bells-8", models) == (lead == "hearts-A")
        for seed in SEEDS:
            assert choose(table, "A", seed) == expected
        # Without the preference the sure trick is kept the same way.
        assert {choose(table, "A", seed, hidden=True) for seed in SEEDS} == {expected}


def test_clearly_worse_rollout_lost_sure_win_or_strong_preferences_keep_the_chosen_card():
    table = two_player(("bells-8", "acorns-A", "acorns-K", "acorns-7", "bells-U"),
                       ("hearts-A", "hearts-K", "leaves-A", "leaves-10", "hearts-7"))
    table.play("B", "hearts-A")
    ctx = context(table, "A")
    models = tuple(model for model, *_ in cpu_policy._options(ctx))
    skill = CpuSkill()
    prefer = cpu_policy._prefer_shown

    def pick(scores, preferences=None, floor=0.0):
        return prefer(ctx, "bells-8", scores, preferences or {"bells-8": 0.0, "bells-U": 0.0}, models, skill, floor)

    assert pick({"bells-8": 0.70, "bells-U": 0.70}) == "bells-U"
    assert pick({"bells-8": 0.70, "bells-U": 0.70 - skill.near_best}) == "bells-U"
    # Clearly worse rollout, and a sampled sure win, are never given up.
    assert pick({"bells-8": 0.70, "bells-U": 0.70 - skill.near_best - 0.01}) == "bells-8"
    assert pick({"bells-8": 1.0, "bells-U": 1.0 - skill.near_best / 2}) == "bells-8"
    # Soft customs: one repeated blind-opening attribute (0.5 x partnership)
    # is outweighed, two (1.0 x partnership) are not.
    half, full = 0.5 * skill.partnership, 1.0 * skill.partnership
    assert pick({"bells-8": 0.7, "bells-U": 0.7}, {"bells-8": 0.0, "bells-U": -half}) == "bells-U"
    assert pick({"bells-8": 0.7, "bells-U": 0.7}, {"bells-8": 0.0, "bells-U": -full}) == "bells-8"
    # Reviewer regression: best .60, chosen .57, shown .53 lies outside the
    # checked candidate window (.60 - near_best) although close to the choice.
    best = 0.60
    assert skill.near_best == pytest.approx(0.045)
    assert pick({"bells-8": 0.57, "bells-U": 0.53}, floor=best - skill.near_best) == "bells-8"
    assert pick({"bells-8": 0.57, "bells-U": 0.56}, floor=best - skill.near_best) == "bells-U"
    # A misplay replacement uses the mistaken card itself as floor: never worse.
    assert pick({"bells-8": 0.50, "bells-U": 0.49}, floor=0.50) == "bells-8"
    assert pick({"bells-8": 0.50, "bells-U": 0.50}, floor=0.50) == "bells-U"
    # A strike is no substitute for a shown trump, whatever the scores.
    assert prefer(ctx, "acorns-7", {"acorns-7": 0.7, "bells-U": 0.9}, {"acorns-7": 0.0, "bells-U": 0.0},
                  models, skill, 0.0) == "acorns-7"


BLIND_A = ("bells-10", "bells-9", "bells-8", "bells-O", "bells-U")      # shows bells-U: trump bells
BLIND_B = ("hearts-A", "leaves-A", "leaves-10", "hearts-K", "hearts-7")  # shows hearts-7: strike 7


def test_safe_partner_trick_spends_shown_trump_but_never_overtakes_with_it():
    # Partner C takes hearts-A with the Rechter: A is last, cannot beat it and discards.
    table = four_player_blind(BLIND_A, BLIND_B, ("bells-7", "acorns-9", "acorns-8", "leaves-9", "acorns-10"),
                              ("leaves-U", "leaves-O", "acorns-U", "acorns-O", "hearts-O"))
    table.play("B", "hearts-A")
    table.play("C", "bells-7")
    table.play("D", "leaves-U")
    for seed in SEEDS:
        assert choose(table, "A", seed, hidden=True) == "bells-8"
        assert choose(table, "A", seed) == "bells-U"
    # Partner C surely wins with bells-10: only the shown Unter would overtake it.
    table = overtake_table("no-overtake")
    for seed in SEEDS:
        assert choose(table, "A", seed) != "bells-U"


def overtake_table(deal_id):
    table = four_player_blind(("bells-9", "bells-8", "leaves-8", "acorns-K", "bells-U"), BLIND_B,
                              ("bells-10", "acorns-9", "acorns-8", "leaves-9", "acorns-10"),
                              ("leaves-U", "leaves-O", "acorns-U", "acorns-O", "hearts-O"), deal_id)
    table.play("B", "hearts-A")
    table.play("C", "bells-10")
    table.play("D", "leaves-U")
    ctx = context(table, "A")
    options = cpu_policy._options(ctx)
    spared = cpu_policy._spare_partner_trick(ctx, cpu_policy._own_legal(ctx, options), options)
    assert "bells-U" not in spared and "bells-8" in spared
    return table


def test_equal_strikes_in_a_blind_opening_lead_spend_the_shown_strike():
    # B shows hearts-K (strike K) and also holds acorns-K and leaves-K.
    table = four_player_blind(("bells-10", "bells-9", "leaves-A", "acorns-A", "bells-8"),
                              ("acorns-K", "leaves-K", "hearts-7", "acorns-7", "hearts-K"),
                              ("hearts-A", "hearts-O", "acorns-9", "acorns-8", "leaves-9"),
                              ("hearts-10", "acorns-10", "leaves-10", "leaves-U", "acorns-U"), "blind-strike-3K")
    assert table.memories["B"].inspected == ("hearts-K", "bells-8")
    unchanged = {seed: choose(table, "B", seed, hidden=True) for seed in range(30)}
    chosen = {seed: choose(table, "B", seed) for seed in range(30)}
    strike_leads = [seed for seed, card in unchanged.items() if card.endswith("-K")]
    assert strike_leads, "the fixed seeds must include a strike lead"
    for seed in range(30):
        if seed in strike_leads:
            assert unchanged[seed] != "hearts-K" and chosen[seed] == "hearts-K"
        else:
            assert chosen[seed] == unchanged[seed]


def test_bloedeln_opening_keeps_forced_bottoms_and_still_spends_the_shown_trump():
    table = four_player_blind(BLIND_A, ("bells-K", "leaves-A", "leaves-10", "hearts-K", "hearts-7"),
                              ("bells-7", "acorns-9", "acorns-8", "leaves-9", "acorns-10"),
                              ("leaves-U", "leaves-O", "acorns-U", "acorns-O", "hearts-O"), "shown-bloedeln")
    table.act("C", "request_bloedeln")
    table.act("D", "preplay_accept")
    forced = dict(table.state.play.forced_opening)
    assert set(forced) == {2, 3}
    table.play("B", "bells-K")
    # C and D's public bottoms follow automatically; A must follow trump and cannot beat bells-K.
    assert [(item["seat"], item["card"]) for item in table.view("A")["current_trick"]["cards"]] == [
        (1, "bells-K"), (2, forced[2]), (3, forced[3])]
    for seed in SEEDS:
        assert choose(table, "A", seed, hidden=True) == "bells-8"
        assert choose(table, "A", seed) == "bells-U"


def test_misplay_never_overrides_the_shown_partner_protection():
    table = overtake_table("misplay")
    for seed in range(20):
        decision = decide(table.view("A"), table.memories["A"], seed=seed, budget=CpuBudget(12),
                          skill=replace(CpuSkill(), mistake_rate=0.1)).decision
        assert decision.value != "bells-U"


def test_beating_the_trick_is_not_sure_while_opponents_with_live_threats_follow():
    # Trick 2 of a blind four: A leads trump, B (strike announcer, shows hearts-7)
    # plays second. Its strike beats the current trick, but the unknown Rechter
    # bells-7 may still sit with an opponent who follows.
    table = four_player_blind(BLIND_A, BLIND_B, ("acorns-9", "acorns-8", "leaves-9", "acorns-10", "acorns-U"),
                              ("leaves-U", "leaves-O", "acorns-K", "acorns-O", "hearts-O"), "pending-threat")
    for player, card in (("B", "hearts-A"), ("C", "acorns-9"), ("D", "leaves-U"), ("A", "bells-8"), ("A", "bells-9")):
        table.play(player, card)
    assert table.state.play.current_player_id == "B"
    ctx = context(table, "B")
    models = tuple(model for model, *_ in cpu_policy._options(ctx))
    assert cpu_policy._own_shown_card(ctx) == "hearts-7"
    (model,) = models
    best = model.strength("bells-9", "bells-9")
    assert model.strength("hearts-7", "bells-9") > best
    # C and D still follow; contrast: as the last card a winning trump is sure
    # (see the two-player reviewer case above).
    assert [seat for seat, _ in ctx.trick] == [0]
    assert not cpu_policy._sure_trick(ctx, "hearts-7", models)


@pytest.mark.parametrize(("shown_score", "expected"), ((0.53, "bells-8"), (0.56, "bells-U")))
def test_policy_never_swaps_to_a_shown_card_outside_the_candidate_window(monkeypatch, shown_score, expected):
    table = two_player(("bells-8", "acorns-A", "acorns-K", "acorns-7", "bells-U"),
                       ("hearts-A", "hearts-K", "leaves-A", "leaves-10", "hearts-7"), f"window-{shown_score}")
    table.play("B", "hearts-A")
    values = {"acorns-K": 0.60, "bells-8": 0.57, "bells-U": shown_score, "acorns-A": 0.2, "acorns-7": 0.2}
    monkeypatch.setattr(cpu_policy, "_rollout", lambda _ctx, _world, first: values[first])
    # Equal soft preferences for both trumps make the .57 card the choice over the .60 one.
    real = cpu_policy._tactical_preference
    monkeypatch.setattr(cpu_policy, "_tactical_preference",
                        lambda ctx, card, models, skill: real(ctx, card, models, skill) + (0.05 if card in {"bells-8", "bells-U"} else 0))
    skill = replace(CpuSkill(), mistake_rate=0.0)
    decision = decide(table.view("A"), table.memories["A"], seed=1, budget=CpuBudget(24), skill=skill).decision
    assert decision.value == expected
