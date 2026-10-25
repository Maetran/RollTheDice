"""Independent review proof against the coordinator's native merge boundary."""
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app import account_merge, main
from app.database import configure_database, session_scope, upgrade_database
from app.models import ActiveGame, GameAccountMembership, User
from app.security import utcnow
from app.watten_recipe import WattenRecipe
from app.watten_room import SeatReservation
from app.watten_runtime import configure_watten_game, new_watten_game, persist_watten_game


@pytest.fixture
def store(tmp_path):
    with patch.dict('os.environ', {'ROLLTHEDICE_DATABASE_URL': f'sqlite:///{tmp_path}/reservation.sqlite'}):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        with session_scope() as db:
            now = utcnow()
            db.add_all(User(id=i, username=f'Reserved{i}', username_normalized=f'reserved{i}',
                            password_hash='unused', created_at=now, updated_at=now) for i in (2, 3))
        yield
    configure_database(main.DATA_DIR)


def test_expired_reservation_alone_does_not_keep_a_source_at_a_native_table(store):
    game = new_watten_game('merge-expired-reservation', 'Reservation review', 2)
    configure_watten_game(game, WattenRecipe(2, 'normal', False, False),
                          SimpleNamespace(user_id=2, username='Reserved2'), None)
    expires = utcnow() + timedelta(minutes=1)
    runtime = game['_watten']
    game['_watten'] = replace(runtime, room=replace(runtime.room, reservations=(SeatReservation(3, 1, expires),)))
    persist_watten_game(game, creating=True)
    with session_scope() as db:
        assert set(db.scalars(select(GameAccountMembership.user_id))) == {2, 3}
    with patch('app.account_merge.utcnow', return_value=expires + timedelta(seconds=1)), session_scope() as db:
        row = db.scalar(select(ActiveGame))
        assert account_merge._active_checkpoint_accounts(db, row.game_id, row.state_json) == ({2}, True)
        account_merge.ensure_no_pending_games(db, (3,))
