"""Private, evidence-based opponent records for completed ZDWA games."""
from collections import defaultdict

from sqlalchemy import select

from .dice_progress import original_seat_tiebreak, owners_for_progress, selected_zdwa_seats
from .models import User


def favorite_opponents(db, owner_id: int) -> list[dict]:
    selected = selected_zdwa_seats(db, owner_id)
    ids = {seat.user_id for game, _ in selected for seat in game.participants if seat.user_id is not None}
    owners = owners_for_progress(db, ids)
    active = {user.id: user for user in db.scalars(select(User).where(
        User.id.in_(set(owners.values())), User.is_active.is_(True),
    ))}
    totals = defaultdict(lambda: {"wins": 0, "losses": 0, "draws": 0})
    for game, own in selected:
        seats = game.participants
        mode = str(game.mode).lower()
        if mode not in {"2", "3", "2v2"} or len(seats) != (4 if mode == "2v2" else int(mode)):
            continue
        if mode == "2v2":
            teams = {team: [seat for seat in seats if seat.team == team] for team in ("A", "B")}
            if any(len(group) != 2 or len({seat.points for seat in group}) != 1 for group in teams.values()):
                continue
            if own.team not in teams:
                continue
        highest = max(seat.points for seat in seats)
        grouped = defaultdict(list)
        for seat in seats:
            if seat.user_id is not None:
                grouped[owners.get(seat.user_id, seat.user_id)].append(seat)

        def unambiguous(group):
            return (len({seat.points == highest for seat in group}) == 1
                    and (mode != "2v2" or len({seat.team for seat in group}) == 1))

        if not unambiguous(grouped[owner_id]):
            continue
        for opponent_id, group in grouped.items():
            if opponent_id == owner_id or opponent_id not in active or not unambiguous(group):
                continue
            seat = min(group, key=lambda item: (-item.points, original_seat_tiebreak(item)))
            if mode == "2v2" and seat.team == own.team:
                continue
            # Only a match winner can beat another player. A tie at the top
            # is a draw; two non-winners do not have a recorded direct result.
            if own.points == highest and seat.points == highest:
                outcome = "draws"
            elif own.points == highest:
                outcome = "wins"
            elif seat.points == highest:
                outcome = "losses"
            else:
                continue
            totals[opponent_id][outcome] += 1
    result = []
    for opponent_id, counts in totals.items():
        games = sum(counts.values())
        if games > 10:
            result.append({"user_id": opponent_id, "username": active[opponent_id].username,
                           "games": games, **counts})
    return sorted(result, key=lambda row: (-row["games"], row["username"].casefold(), row["user_id"]))
