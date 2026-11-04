"""Blind rank preservation respects the seat's view and the actual engine."""

from collections import Counter
from dataclasses import replace

import pytest

import app.watten_cpu as cpu
from app.watten_cpu import CpuBudget, decide
from app.watten_cpu_skill import CpuSkill, skill_for_completed_games
from app.watten_engine import start_match
from app.watten_play import legal_cards
from tests.test_watten_cpu_memory import Table, cpu_recipe, explicit_deal


def king_table(*, alternative_call=False):
    # The bottom cards of A/B determine the hidden call; reordering only
    # those opponents' hands changes it without changing C's personal view.
    a = ("bells-A", "bells-K", "hearts-7", "leaves-8", "acorns-9")
    b = ("hearts-K", "hearts-9", "hearts-A", "bells-7", "leaves-10")
    d = ("leaves-9", "leaves-O", "hearts-U", "acorns-O", "acorns-K")
    if alternative_call:
        # Also swap a hidden card between A and D, preserving all public data.
        a, d = ((a[0], d[0], a[2], a[4], a[3]), (a[1], *d[1:]))
        b = (b[0], b[4], b[2], b[3], b[1])
    deal = explicit_deal(a, b, ("acorns-8", "bells-9", "hearts-10", "leaves-K", "acorns-A"),
                         d)
    table = Table(start_match(cpu_recipe(4, "ladinisch", True), "rank-preservation", deal, first_dealer="A"))
    table.ready()
    table.play("B", "hearts-K")
    return table


@pytest.mark.parametrize("repeat_score,expected", ((0.51, "bells-9"), (0.8, "leaves-K")))
def test_blind_partner_prefers_a_new_rank_unless_repeating_is_clearly_better(monkeypatch, repeat_score, expected):
    table = king_table()
    ctx = cpu._prepare(table.view("C"), table.memories["C"], ())
    options = cpu._options(ctx)
    assert ctx.memory.strike is None and cpu._blind_repeated_possible_strike(ctx, "leaves-K", options)
    assert "leaves-K" in legal_cards(table.state.play, table.state.bid_state, "C")
    monkeypatch.setattr(cpu, "_should_bid", lambda *_args: False)
    monkeypatch.setattr(cpu, "_rollout", lambda _ctx, _world, card: repeat_score if card == "leaves-K"
                        else 0.5 if card == "bells-9" else 0.0)
    choice = decide(table.view("C"), table.memories["C"], seed=7, budget=CpuBudget(8),
                    skill=CpuSkill(mistake_rate=0)).decision
    assert choice.value == expected
    table.propose("C", choice)


def test_different_hidden_calls_produce_the_same_personal_decisions():
    first, second = king_table(), king_table(alternative_call=True)
    assert first.state.call != second.state.call
    assert first.state.play.hands[0] != second.state.play.hands[0]
    assert first.view("C") == second.view("C")
    assert first.memories["C"] == second.memories["C"]
    for seed in range(8):
        assert decide(first.view("C"), first.memories["C"], seed=seed, budget=CpuBudget(8)) == decide(
            second.view("C"), second.memories["C"], seed=seed, budget=CpuBudget(8))


def test_experience_changes_how_often_blind_partner_retains_a_possible_strike(monkeypatch):
    table = king_table()
    monkeypatch.setattr(cpu, "_should_bid", lambda *_args: False)
    monkeypatch.setattr(cpu, "_rollout", lambda _ctx, _world, card: 0.54 if card == "leaves-K"
                        else 0.5 if card == "bells-9" else 0.0)

    def outcomes(completed):
        skill = skill_for_completed_games(completed)
        return Counter(decide(table.view("C"), table.memories["C"], seed=seed, budget=CpuBudget(8),
                              skill=skill).decision.value for seed in range(100))

    beginner, experienced = outcomes(0), outcomes(75)
    assert beginner["leaves-K"] > experienced["leaves-K"]
    assert experienced["bells-9"] > beginner["bells-9"]


def test_later_trick_is_protected_when_repeated_rank_is_still_a_possible_call():
    table = king_table()
    for player, card in (("C", "leaves-K"), ("D", "leaves-O"), ("A", "bells-A"), ("B", "hearts-9")):
        table.play(player, card)
    ctx = cpu._prepare(table.view("C"), table.memories["C"], ())
    assert len(ctx.winners) == 1
    assert cpu._blind_repeated_possible_strike(ctx, "bells-9", cpu._options(ctx))


def test_known_announcer_does_not_receive_the_blind_partner_preference():
    table = king_table()
    for player, card in (("C", "bells-9"), ("D", "leaves-9")):
        table.play(player, card)
    ctx = cpu._prepare(table.view("A"), table.memories["A"], ())
    assert ctx.memory.strike is not None and "bells-K" in ctx.hand
    assert not cpu._blind_repeated_possible_strike(ctx, "bells-K", cpu._options(ctx))


def test_blind_misplay_can_still_repeat_a_rank_but_is_engine_legal(monkeypatch):
    table = king_table()
    monkeypatch.setattr(cpu, "_should_bid", lambda *_args: False)
    monkeypatch.setattr(cpu, "_rollout", lambda _ctx, _world, card: 0.49 if card == "leaves-K" else 0.5)
    original = cpu._occasional_misplay

    class AlwaysMistake:
        def below(self, _bound):
            return 0

    def force_mistake(ctx, legal, selected, scores, models, _stream, skill):
        return original(ctx, legal, selected, scores, models, AlwaysMistake(), skill)

    monkeypatch.setattr(cpu, "_occasional_misplay", force_mistake)
    choice = decide(table.view("C"), table.memories["C"], seed=1, budget=CpuBudget(8),
                    skill=CpuSkill(mistake_rate=0.1)).decision
    assert choice.value == "leaves-K"
    assert choice.value in legal_cards(table.state.play, table.state.bid_state, "C")
    table.propose("C", choice)


def test_hopeless_trick_compares_only_cheapest_repeated_and_fresh_ranks():
    table = king_table()
    ctx = cpu._prepare(table.view("C"), table.memories["C"], ())
    order = {"leaves-K": 0, "bells-9": 1, "acorns-8": 2}

    class Model:
        def __init__(self, strike):
            self.call = cpu.WattenCall(strike, "bells")
            self.order = order

        def winner(self, _cards):
            return 0

        def strength(self, _card, _led):
            return (0, 0)

    options = [(Model("K"), None, None), (Model("9"), None, None)]
    assert cpu._conserve_hopeless(ctx, ("leaves-K", "bells-9", "acorns-8"), options) == (
        "leaves-K", "bells-9")


def test_blind_simulated_forced_bottom_takes_priority_over_rank_preference():
    table = king_table()
    ctx = cpu._prepare(table.view("C"), table.memories["C"], ())
    ctx.snap = replace(ctx.snap, bloedeln_cards=((ctx.seat, "leaves-K"),))
    hands = [["bells-A"], ["hearts-9"], list(ctx.hand), ["leaves-O"]]
    choice = cpu._simulated_card(ctx.model("K", "hearts"), ctx.seat, hands, ctx.trick, ctx)
    assert choice == "leaves-K"
