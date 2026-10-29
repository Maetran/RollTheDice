"""Isolated deterministic four-seat fixture for the real CPU reveal browser test.

Only the test server uses this factory. The production engine, transport,
checkpoint and CPU scheduler still execute normally; the seeded deal and CPU
card choices guarantee a human winning the first trick without retrying games.
"""

from types import SimpleNamespace

from scripts.browser_test_app import create_application as browser_application


def create_application():
    app = browser_application()
    from app import watten_cpu, watten_runtime
    from app.watten_cards import DealtCards, make_deck

    watten_runtime._RANDOM = SimpleNamespace(randrange=lambda _count: 0, shuffle=lambda _cards: None)
    watten_cpu._bloedeln_coin = lambda *_args: False
    watten_runtime_game = watten_runtime.cryptographic_deal

    def deal(count, dealer):
        if count != 4 or dealer != 0:
            return watten_runtime_game(count, dealer)
        human = ("hearts-7", "bells-8", "bells-9", "acorns-8", "hearts-9")
        strike_bottom = "leaves-7"
        pool = [card for card in make_deck() if card not in (*human, strike_bottom)]
        hands = (human, (*pool[:4], strike_bottom), tuple(pool[4:9]), tuple(pool[9:14]))
        return DealtCards(hands, tuple(pool[14:]), tuple(hand[-1] for hand in hands))

    watten_runtime.cryptographic_deal = deal
    choose = watten_cpu._choose

    def choose_legal_card(ctx, seed, budget, skill):
        snap = ctx.snap
        if snap.phase == "play" and "play_card" in snap.actions:
            card = watten_cpu._own_legal(ctx, watten_cpu._options(ctx))[0]
            return watten_cpu.CpuProposal(snap.player_id, snap.deal_id, snap.opportunity, snap.phase, "play_card", card)
        return choose(ctx, seed, budget, skill)

    watten_cpu._choose = choose_legal_card
    return app
