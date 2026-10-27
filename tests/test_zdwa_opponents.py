from sqlalchemy import delete

from app.database import session_scope
from app.models import AccountProgressOrigin, User
from app.zdwa_opponents import favorite_opponents
from tests.test_account_progress import store  # noqa: F401
from tests.test_dice_account_merge import merge, zdwa_game


def test_threshold_wins_losses_draws_and_no_invented_results(store):  # noqa: F811
    with session_scope() as db:
        db.execute(delete(AccountProgressOrigin))
        db.get(User, 1).is_active = True
        for index in range(10):
            zdwa_game(db, f"duel-{index}", [(1, 100), (2, 90)])
        assert favorite_opponents(db, 1) == []
        zdwa_game(db, "draw", [(1, 100), (2, 100)])
        zdwa_game(db, "loss", [(1, 90), (2, 100)])
        # Two non-winners have no direct match outcome.
        zdwa_game(db, "three", [(1, 80), (2, 90), (3, 100)])
        # Team partner is never an opponent; opponent counts only once.
        zdwa_game(db, "team", [(1, 100), (3, 100), (2, 90), (4, 90)],
                  mode="2v2", teams=["A", "A", "B", "B"])
        row = favorite_opponents(db, 1)[0]
        assert (row["user_id"], row["games"], row["wins"], row["losses"], row["draws"]) == (2, 13, 11, 1, 1)


def test_merged_accounts_are_counted_once_and_names_are_current(store):  # noqa: F811
    with session_scope() as db:
        db.execute(delete(AccountProgressOrigin))
        db.get(User, 1).is_active = True
        for index in range(11):
            zdwa_game(db, f"merged-{index}", [(1, 100), (2, 100), (3, 80)])
        merge(db, 1, 2)
        db.get(User, 3).username = "Renamed"
        rows = favorite_opponents(db, 2)
        assert rows == [{"user_id": 3, "username": "Renamed", "games": 11,
                         "wins": 11, "losses": 0, "draws": 0}]


def test_merged_opposite_teams_are_ambiguous_for_both_accounts(store):  # noqa: F811
    with session_scope() as db:
        db.execute(delete(AccountProgressOrigin))
        db.get(User, 1).is_active = True
        for index in range(11):
            zdwa_game(db, f"opposite-teams-{index}", [(3, 100), (1, 100), (2, 90), (4, 90)],
                      mode="2v2", teams=["A", "A", "B", "B"])
        merge(db, 1, 2)
        assert all(row["user_id"] != 2 for row in favorite_opponents(db, 3))
        assert favorite_opponents(db, 2) == []
