"""Private, immutable loss-mark series; game rules remain in the match engine.

Humans bind by account and CPUs by logical seat, never temporary participant
IDs or display names. Each room has one atomically linked successor. Its last
completed-room marker therefore makes result retries idempotent without an
unbounded cross-room log or a second database transaction.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from .watten_bidding import nockerl

MAX_TOURNAMENT_TARGET = 9_007_199_254_740_991


def valid_target(value: object) -> bool:
    return value is None or type(value) is int and 1 <= value <= MAX_TOURNAMENT_TARGET


def _groups(count: int) -> tuple[tuple[int, ...], ...]:
    return ((0, 2), (1, 3)) if count == 4 else tuple((seat,) for seat in range(count))


def _identity(account: int | None, seat: int) -> str:
    return f"h:{account}" if account is not None else f"c:{seat}"


@dataclass(frozen=True, slots=True)
class NockerlSeries:
    series_id: str
    bindings: tuple[str, ...]
    counts: tuple[int, ...]
    target: int | None = None
    completed_games: int = 0
    last_game_id: str | None = None
    continuation_locked: bool = False

    def __post_init__(self):
        if (type(self.series_id) is not str or not 1 <= len(self.series_id) <= 160
                or type(self.bindings) is not tuple or len(self.bindings) not in {2, 3, 4}
                or any(type(token) is not str or token not in {f"c:{seat}"} and not (
                    token.startswith("h:") and token[2:].isascii() and token[2:].isdecimal()
                    and int(token[2:]) > 0 and str(int(token[2:])) == token[2:])
                       for seat, token in enumerate(self.bindings))
                or len(set(self.bindings)) != len(self.bindings)
                or type(self.counts) is not tuple or len(self.counts) != len(_groups(len(self.bindings)))
                or any(type(value) is not int or value < 0 for value in self.counts)
                or not valid_target(self.target) or self.target is not None and len(self.bindings) == 3
                or type(self.completed_games) is not int or self.completed_games < 0
                or type(self.continuation_locked) is not bool
                or (self.completed_games == 0) != (self.last_game_id is None)
                or (self.last_game_id is not None and (type(self.last_game_id) is not str or not 1 <= len(self.last_game_id) <= 160))
                or self.completed_games == 0 and any(self.counts)
                or not self.completed_games <= sum(self.counts) <= self.completed_games * 4
                or self.target is not None and sum(value >= self.target for value in self.counts) > 1):
            raise ValueError("watten_invalid_nockerl_series")

    @property
    def finished(self) -> bool:
        return self.target is not None and any(value >= self.target for value in self.counts)

    @property
    def roster_locked(self) -> bool:
        return self.target is not None or self.continuation_locked

    def seat_for_account(self, account: int) -> int | None:
        token = f"h:{account}"
        return self.bindings.index(token) if token in self.bindings else None


def _occupant_bindings(room) -> tuple[str, ...] | None:
    occupants = {cpu.seat: _identity(None, cpu.seat) for cpu in room.cpus}
    occupants.update({member.seat: _identity(member.account_id, member.seat)
                      for member in room.members if member.seat is not None})
    if set(occupants) != set(range(room.recipe.player_count)):
        return None
    return tuple(occupants[seat] for seat in range(room.recipe.player_count))


def bind_room_series(room):
    """Called before a deliberate start after every seat is actually occupied."""
    bindings = _occupant_bindings(room)
    if bindings is None:
        raise ValueError("watten_seats_incomplete")
    previous = room.series
    target = room.recipe.tournament_nockerl_target
    groups = _groups(len(bindings))
    if previous is None:
        series = NockerlSeries(room.room_id, bindings, (0,) * len(groups), target)
    else:
        if previous.finished:
            raise ValueError("watten_tournament_finished")
        if previous.roster_locked and (bindings != previous.bindings or target != previous.target):
            raise ValueError("watten_tournament_roster_locked")
        old = {frozenset(previous.bindings[seat] for seat in seats): count
               for seats, count in zip(_groups(len(previous.bindings)), previous.counts)}
        keys = tuple(frozenset(bindings[seat] for seat in seats) for seats in groups)
        if set(keys) == set(old) and target == previous.target:
            series = replace(previous, bindings=bindings, counts=tuple(old[key] for key in keys))
        else:
            # Different people/teams never inherit another team's loss marks.
            series = NockerlSeries(room.room_id, bindings, (0,) * len(groups), target)
    return replace(room, series=series)


def complete_room_series(room, engine):
    """Called in the same candidate/result transaction as a terminal engine."""
    if engine.phase != "match_complete" or room.status != "finished":
        raise ValueError("watten_series_result_not_finished")
    room = bind_room_series(room) if room.series is None else room
    series = room.series
    engine_bindings = tuple(_identity(binding.account_id, seat) for seat, binding in enumerate(engine.recipe.bindings))
    if engine_bindings != series.bindings:
        raise ValueError("watten_series_roster_mismatch")
    if series.last_game_id == room.room_id:
        return room
    if series.finished or _occupant_bindings(room) != series.bindings:
        raise ValueError("watten_tournament_roster_locked")
    counts = list(series.counts)
    groups = _groups(len(series.bindings))
    for members, amount, _reason in nockerl(engine.ledger):
        seats = frozenset(engine.recipe.seats.index(player) for player in members)
        index = next((index for index, group in enumerate(groups) if frozenset(group) == seats), None)
        if index is None:
            raise ValueError("watten_series_roster_mismatch")
        counts[index] += amount
    return replace(room, series=replace(series, counts=tuple(counts), completed_games=series.completed_games + 1,
                                        last_game_id=room.room_id))


def series_to_payload(series: NockerlSeries | None) -> dict | None:
    return None if series is None else {"id": series.series_id, "bindings": list(series.bindings),
        "counts": list(series.counts), "target": series.target, "completed_games": series.completed_games,
        "last_game_id": series.last_game_id, "continuation_locked": series.continuation_locked}


def series_from_payload(value: object) -> NockerlSeries | None:
    if value is None:
        return None
    if type(value) is dict and "continuation_locked" not in value:
        value = {**value, "continuation_locked": False}
    if (type(value) is not dict or set(value) != {"id", "bindings", "counts", "target", "completed_games", "last_game_id", "continuation_locked"}
            or type(value["bindings"]) is not list or type(value["counts"]) is not list):
        raise ValueError("watten_invalid_nockerl_series")
    return NockerlSeries(value["id"], tuple(value["bindings"]), tuple(value["counts"]), value["target"],
                         value["completed_games"], value["last_game_id"], value["continuation_locked"])


def public_series(room) -> dict | None:
    series = room.series
    if series is None:
        return None
    pending = False
    if room.status == "waiting" and not series.roster_locked:
        if _occupant_bindings(room) is None:
            pending = True
        else:
            series = bind_room_series(room).series
    groups = _groups(len(series.bindings))
    losers = tuple(seat for seats, count in zip(groups, series.counts)
                   if series.target is not None and count >= series.target for seat in seats)
    return {"id": series.series_id, "target": series.target,
            "nockerl": [{"seats": list(seats), "count": 0 if pending else count} for seats, count in zip(groups, series.counts)],
            "finished": series.finished, "winner_seats": [seat for seat in range(len(series.bindings)) if losers and seat not in losers],
            "loser_seats": list(losers), "teams_locked": series.roster_locked, "pending_roster": pending}


def public_score_history(engine) -> list[dict]:
    """Only scored rounds and their public ledger, with no invented timestamps."""
    if engine is None:
        return []
    accounts = engine.ledger.accounts
    totals = [0] * len(accounts)
    choice = engine.ledger.retourschneider

    def seats(members):
        return [engine.recipe.seats.index(player) for player in members]

    result = []
    for number, scored in enumerate(engine.ledger.applied_results, start=1):
        winning = scored.roles.parties[scored.winning_party]
        for index, account in enumerate(accounts):
            if set(account.members) <= set(winning):
                totals[index] += scored.points
        reset = None
        if choice is not None and choice.accepted and scored.deal_id == choice.after_deal_id:
            index = next(index for index, account in enumerate(accounts) if account.members == choice.members)
            reset = {"seats": seats(choice.members), "erased_points": totals[index]}
            totals[index] = 0
        result.append({"round": number, "winning_seats": seats(winning), "points": scored.points, "reason": scored.reason,
                       "scores": [{"seats": seats(account.members), "points": total} for account, total in zip(accounts, totals)],
                       "retourschneider_reset": reset})
    return result
