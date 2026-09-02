"""Pure scoring rules for a ZDWA dice roll.

These functions intentionally do not access application state. They can be
used by the WebSocket flow, score suggestions, and isolated unit tests.
"""

from collections import Counter


def _counts(dice) -> Counter:
    """Count non-zero dice faces."""
    return Counter(die for die in dice if die)


def has_n_of_a_kind(dice, n: int) -> bool:
    """Return whether at least ``n`` dice show the same face."""
    return any(count >= n for count in _counts(dice).values())


def score_field_value(field_key: str, dice) -> int:
    """Calculate the score for one writable field from a dice roll."""
    counts = _counts(dice)
    total = sum(die for die in dice if die)
    if field_key in {"1", "2", "3", "4", "5", "6"}:
        face = int(field_key)
        return counts.get(face, 0) * face
    if field_key in {"max", "min"}:
        return total
    if field_key == "kenter":
        return 35 if len(counts) == 5 else 0
    if field_key == "full":
        if not counts:
            return 0
        face = counts.most_common(1)[0][0]
        return 40 + 3 * face if sorted(counts.values()) in ([2, 3], [5]) else 0
    if field_key == "poker":
        return next((50 + 4 * face for face, count in counts.items() if count >= 4), 0)
    if field_key == "60":
        return next((60 + 5 * face for face, count in counts.items() if count == 5), 0)
    return 0


def poker_points_allowed(
    dice,
    col: str,
    *,
    roll_index: int,
    first4oak_roll,
    announced_poker: bool = False,
    correction: bool = False,
) -> bool:
    """Check whether poker points are valid in the current write context."""
    has_four = has_n_of_a_kind(dice, 4)
    if not has_four:
        return False
    if has_n_of_a_kind(dice, 5) or (col == "ang" and announced_poker):
        return True
    try:
        roll = int(roll_index or 0)
    except (TypeError, ValueError):
        roll = 0
    first = first4oak_roll
    if (not first if correction else first is None):
        first = roll
    try:
        first = int(first)
    except (TypeError, ValueError):
        return False
    return bool(first and (first if correction else roll) == first)
