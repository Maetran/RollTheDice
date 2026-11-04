"""Disposable card knowledge from one CPU seat's public observations only."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from .hausdepp_engine import card_rank, make_deck

_DECK = frozenset(make_deck())


def _public(view: Mapping[str, Any]) -> tuple:
    """Select public DTO fields; hands, private peeks and evidence are never read."""
    players = tuple((player["id"], player["hand_count"], bool(player["finished"]), bool(player.get("withdrawn")))
                    for player in view["players"])
    return (view["version"], view["viewer_id"], view["phase"], view["deck_count"], players,
            tuple(view["discard"]), view["current_player_id"])


@dataclass(repr=False)
class PublicKnowledge:
    """Known cards form a lower bound; missing observations always lose knowledge.

    The accepted-command selector supplies consecutive personal DTOs. Nothing
    is restored from storage or inferred from a private hand or hand-size drop.
    """

    _position: tuple | None = None
    _known: dict[str, set[str]] = field(default_factory=dict)
    # Cards seen face up on a cleared pile this round; None once a gap or a
    # face-down removal (a departure) makes the count unreliable.
    _burned: set[str] | None = None
    _burn_version: int | None = None

    def clear(self) -> None:
        self._position = None
        self._known.clear()

    def _count_burns(self, before: Mapping[str, Any], after: Mapping[str, Any]) -> None:
        """Remember every publicly cleared card, exactly as an attentive person could."""
        version, count = after.get("version"), after.get("burned_count")
        if version == self._burn_version:
            return  # duplicate delivery
        if count == 0 and after.get("phase") in {"peeking", "playing"}:
            self._burned, self._burn_version = set(), version
            return
        if (self._burned is None or self._burn_version != before.get("version") or version != before["version"] + 1
                or before.get("viewer_id") != after.get("viewer_id")):
            self._burned = self._burn_version = None
            return
        event = after.get("last_event") or {}
        if count != before.get("burned_count"):
            cards = [*before.get("discard", []), *(event.get("cards") or [])]
            if (not event.get("burn_reason") or event.get("type") not in {"play", "afterthrow", "gamble"}
                    or event.get("burned_count") != len(cards) or not set(cards) <= _DECK
                    or self._burned & set(cards) or len(self._burned) + len(cards) != count):
                self._burned = self._burn_version = None
                return
            self._burned.update(cards)
        self._burn_version = version

    def counted_hand(self, view: Mapping[str, Any], player_id: str) -> tuple[str, ...] | None:
        """The last opposing hand, deduced from public cards in a two-hand endgame.

        Valid only at the exact observed version, with an empty stock, no
        departures, every other seat finished empty-handed and a burn count
        that matches the public counter. Otherwise ``None``.
        """
        if (self._burned is None or self._burn_version != view.get("version") or view.get("deck_count") != 0
                or view.get("phase") != "playing" or view.get("withdrawn_ids")
                or len(self._burned) != view.get("burned_count")):
            return None
        players = view.get("players", [])
        others = [player for player in players if player.get("id") != view.get("viewer_id")]
        target = next((player for player in others if player.get("id") == player_id), None)
        if (target is None or target.get("finished") or target.get("withdrawn")
                or any(player.get("withdrawn") or player.get("finished") is not True and player is not target
                       or player.get("finished") and player.get("hand_count") != 0 for player in others)):
            return None
        visible = set(view.get("hand", [])) | set(view.get("discard", []))
        unseen = _DECK - visible - self._burned
        if len(visible) != len(view.get("hand", [])) + len(view.get("discard", [])) or len(unseen) != target.get("hand_count"):
            return None
        return tuple(sorted(unseen))

    def observe(self, before: Mapping[str, Any], after: Mapping[str, Any]) -> None:
        self._count_burns(before, after)
        previous, current = _public(before), _public(after)
        version, viewer, phase, stock, players, *_ = current
        if current == self._position:
            return  # duplicate delivery, never count a packet twice
        if (phase != "playing" or stock != 0 or previous[2:4] != ("playing", 0)
                or viewer is None or previous[1] != viewer or version != previous[0] + 1
                or tuple((player[0], player[2:]) for player in previous[4])
                != tuple((player[0], player[2:]) for player in players)
                or any(player[3] for player in players)):
            self.clear()
            return
        if self._position != previous:
            self.clear()
        event = after["last_event"]
        actor, action = event["player_id"], event["type"]
        if actor not in {player[0] for player in players} or action not in {"pickup", "play", "afterthrow"}:
            self.clear()
            return
        if actor != viewer:
            known = self._known.setdefault(actor, set())
            if action == "pickup":
                cards = before["discard"]
                if len(cards) != event["picked_up_count"]:
                    raise ValueError("hausdepp_cpu_invalid_public_pickup")
                for card in cards:
                    card_rank(card)
                known.update(cards)
            else:
                known.difference_update(event["cards"])
        if any(len(self._known.get(player_id, ())) > hand_count for player_id, hand_count, *_ in players):
            raise ValueError("hausdepp_cpu_invalid_public_knowledge")
        self._position = current

    def exact_hand(self, view: Mapping[str, Any], player_id: str) -> tuple[str, ...] | None:
        """Return a complete observed hand only at the exact observed version."""
        current = _public(view)
        if current != self._position or current[2:4] != ("playing", 0):
            return None
        player = next((player for player in current[4] if player[0] == player_id), None)
        known = self._known.get(player_id, set())
        if player is None or player[2] or player[3] or not known or len(known) != player[1]:
            return None
        return tuple(sorted(known))
