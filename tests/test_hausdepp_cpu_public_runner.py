"""The real asynchronous CPU path retains accepted public observations."""

import asyncio
from copy import deepcopy

import pytest

from app import hausdepp_cpu_runner as runner
from app import hausdepp_engine as engine
from app import hausdepp_gameplay as gameplay
from app.hausdepp_cpu_strategy import choose_cpu_action
from tests.test_hausdepp_cpu_knowledge import command
from tests.test_hausdepp_cpu_knowledge import table_factory as shared_table_factory
from tests.test_hausdepp_cpu_strategy import ScriptedRandom
from tests.test_hausdepp_engine import scenario

table_factory = shared_table_factory


@pytest.mark.parametrize("seats", [2, 3, 4, 6])
def test_real_runner_learns_its_own_clearance_and_plays_the_known_pair_block(table_factory, monkeypatch, seats):
    # The unchanged policy sheds 6, completes the human 9 to four, then
    # blocks the fully observed pair of Unters with its retained king.
    state = scenario([["hearts-6", "bells-8", "hearts-K", "hearts-A", "hearts-9", "bells-9", "leaves-9"],
                      ["acorns-9"], *([] for _ in range(seats - 2))],
                     discard=["bells-U", "leaves-U"], current="p1")
    game = table_factory(state)
    monkeypatch.setenv("ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS", "0")
    monkeypatch.setattr(runner, "multiplayer_pause_reason", lambda _game: None)
    monkeypatch.setattr(runner, "Random", lambda _seed: ScriptedRandom())
    events, observed_pair = [], []

    async def published(current, **_kwargs):
        event = deepcopy(current["_hausdepp"]["last_event"])
        events.append(event)
        if len(events) == 1:
            assert event["cards"] == ["hearts-6"]
            command(current, "p1", "play", ["acorns-9"])
        elif len(events) == 2:
            view = engine.project_state(current["_hausdepp"], "p0")
            assert choose_cpu_action(view)["cards"] == ["bells-8"]
        elif len(events) == 3:
            view = engine.project_state(current["_hausdepp"], "p0")
            observed_pair.append(runner._memories_for(current)["p0"].public.exact_hand(view, "p1"))
            current["_aborted"] = True

    monkeypatch.setattr(gameplay, "publish_hausdepp_transition", published)
    command(game, "p1", "pickup")
    asyncio.run(runner._run(game))
    assert len(events) == 3, (events, game["_hausdepp"])
    assert [event["player_id"] for event in events] == ["p0", "p0", "p0"]
    assert [event["cards"] for event in events] == [
        ["hearts-6"], ["bells-9", "hearts-9", "leaves-9"], ["hearts-K"]]
    assert events[1]["burn_reason"] == "four_of_a_kind"
    assert observed_pair == [("bells-U", "leaves-U")]
    assert game["_hausdepp"]["version"] == state["version"] + 5
    assert game["_id"] not in runner._MEMORIES  # runner finalization discards an aborted table
