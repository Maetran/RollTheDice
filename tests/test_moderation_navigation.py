import asyncio
import os
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException, WebSocketDisconnect
from sqlalchemy import select

from app import main
from app.admin_help import (
    claim_help_request,
    clear_help_origin,
    create_help_request,
    has_active_help_claim,
    resolve_help_request,
)
from app.admin_help_navigation import end_help_assignment, enter_help_game, return_from_help
from app.api_moderation import BanRequest, create_ban, remove_ban
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_realtime import broadcast
from app.game_state import check_timeout_and_abort, multiplayer_pause_reason
from app.game_websocket import MessageRateLimiter, _receive_messages
from app.game_ws_session import GameSocketSession, handle_session_action
from app.models import AdminHelpRequest, User, UserBan
from app.moderation import account_bans, admin_help_blocked, apply_ban, revoke_bans, user_play_banned
from app.product_hosts import safe_zilch_path
from app.security import utcnow
from tests.support import GameStateTestCase
from tests.test_game_websocket import RecordingSocket
from tests.test_user_accounts import request_for


class ModerationNavigationTests(GameStateTestCase):
    def setUp(self):
        super().setUp()
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            'ROLLTHEDICE_DATABASE_URL': f'sqlite:///{self.temp.name}/db.sqlite',
            'ROLLTHEDICE_COOKIE_DOMAIN': '', 'ROLLTHEDICE_COOKIE_SECURE': '0',
            'ROLLTHEDICE_ZILCH_ACCESS_MODE': 'public',
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.admin = create_user('HelpAdmin', 'secure-password-123', role='admin', must_change_password=False)
        self.player = create_user('HelpPlayer', 'secure-password-123', must_change_password=False)
        self.identity, token = login(request_for(), 'HelpAdmin', 'secure-password-123')
        self.request = request_for(cookie=f'rollthedice_session={token}', csrf=self.identity.csrf_token)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()
        super().tearDown()

    def test_duration_expiry_permanent_and_revocation_are_separate_and_auditable(self):
        for days in [3, 5, 7, 14, 30, 60, None]:
            with session_scope() as db:
                ban = apply_ban(db, self.player.id, self.admin.id, scope='play', days=days, reason='Repeated disruption')
                self.assertEqual(ban.expires_at is None, days is None)
            self.assertTrue(user_play_banned(self.player.id))
            self.assertTrue(admin_help_blocked(self.player.id))
        with session_scope() as db:
            rows = list(db.scalars(select(UserBan)))
            self.assertEqual(len(rows), 7)
            self.assertEqual(sum(row.revoked_at is None for row in rows), 1)
            revoke_bans(db, self.player.id, 'play', self.admin.id)
            ban = apply_ban(db, self.player.id, self.admin.id, scope='help', days=3, reason='Misuse')
        self.assertFalse(user_play_banned(self.player.id))
        self.assertTrue(admin_help_blocked(self.player.id))
        with session_scope() as db:
            db.get(UserBan, ban.id).expires_at = utcnow() - timedelta(seconds=1)
        self.assertEqual(account_bans(self.player.id), [])

    def test_ban_requires_admin_csrf_and_rejects_admin_targets_and_invalid_duration(self):
        with self.assertRaises(HTTPException) as exc:
            asyncio.run(create_ban(self.player.id, BanRequest(scope='play', days=3, reason='Reason'), request_for()))
        self.assertEqual(exc.exception.status_code, 401)
        with self.assertRaises(HTTPException):
            asyncio.run(create_ban(self.admin.id, BanRequest(scope='play', days=3, reason='Reason'), self.request))
        with self.assertRaises(HTTPException):
            with session_scope() as db:
                apply_ban(db, self.player.id, self.admin.id, scope='play', days=4, reason='Reason')
        result = asyncio.run(create_ban(self.player.id, BanRequest(scope='help', days=7, reason='Reason'), self.request))
        self.assertEqual(result['ban']['scope'], 'help')
        remove_ban(self.player.id, 'help', self.request)
        self.assertEqual(account_bans(self.player.id), [])

    def test_play_ban_blocks_create_and_old_resume_tokens_without_blocking_login(self):
        game = self.make_game()
        game['_players'][0].update(user_id=self.player.id, resume_token='old-token')
        with session_scope() as db:
            apply_ban(db, self.player.id, self.admin.id, scope='play', days=3, reason='Reason')
        identity, token = login(request_for(), 'HelpPlayer', 'secure-password-123')
        self.assertEqual(identity.user_id, self.player.id)
        with self.assertRaises(HTTPException) as exc:
            asyncio.run(main.api_games_create(main.CreateReq(name='Blocked', mode=2),
                        request_for(cookie=f'rollthedice_session={token}')))
        self.assertEqual(exc.exception.detail, 'account_play_banned')
        socket = RecordingSocket()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=None)
        self.assertTrue(asyncio.run(handle_session_action(session, 'rejoin_game', {
            'player_id': 'p1', 'resume_token': 'old-token',
        })))
        self.assertEqual(socket.messages[-1]['error_code'], 'account_play_banned')

    def test_help_assignment_preserves_own_game_pauses_until_return_and_scopes_private_access(self):
        target = self.make_game(name='Private help')
        target['_players'][0]['user_id'] = self.player.id
        target['_passphrase'] = 'secret'
        own = self.make_game(name='Own game')
        own['_players'][0]['user_id'] = self.admin.id
        own['_scoreboards']['p1'] = {'1,down': 3}
        request, _ = create_help_request(target['_id'], self.player.id)
        claim = claim_help_request(request['id'], self.admin.id, own['_id'])
        urls = asyncio.run(enter_help_game(self.identity, claim))
        self.assertIn('/zuschauen?help_request=', urls['help_url'])
        self.assertIn(own['_id'], urls['return_url'])
        self.assertIn('Admin-Einsatz', multiplayer_pause_reason(own))
        own['_last_activity'] = utcnow() - timedelta(hours=2)
        self.assertFalse(check_timeout_and_abort(own))
        self.assertTrue(has_active_help_claim(self.admin.id, target['_id']))
        self.assertFalse(has_active_help_claim(self.admin.id, own['_id']))
        details = main.game_info(target['_id'], self.request, passphrase=None, check=0)
        self.assertTrue(details['admin_help_access'])
        self.assertFalse(details['locked'])
        socket = RecordingSocket()
        socket.cookies = self.request.cookies
        session = GameSocketSession(websocket=socket, game=target, auth_identity=self.identity)
        self.assertFalse(asyncio.run(handle_session_action(session, 'spectate_game', {})))
        self.assertTrue(session.is_admin_help_spectator)
        asyncio.run(return_from_help(self.identity, claim))
        self.assertFalse(own.get('_admin_help_away'))
        self.assertEqual(own['_scoreboards']['p1'], {'1,down': 3})
        resolve_help_request(request['id'], self.admin.id, 'resolved')
        asyncio.run(end_help_assignment(request['id']))
        self.assertFalse(has_active_help_claim(self.admin.id, target['_id']))
        self.assertEqual(socket.close_codes, [1000])
        self.assertFalse(target['_spectators'])

    def test_zilch_spectator_auth_continuation_is_safe_and_keeps_suffix(self):
        self.assertEqual(safe_zilch_path('/spiel/table/zuschauen'), '/spiel/table/zuschauen')
        for path in ['/spiel/../zuschauen', '/spiel/%2fsecret/zuschauen', '/spiel/a/b/zuschauen']:
            self.assertEqual(safe_zilch_path(path), '/')

    def _helping_spectator(self):
        target = self.make_game(name='Private help')
        target['_players'][0]['user_id'] = self.player.id
        target['_passphrase'] = 'secret'
        request, _ = create_help_request(target['_id'], self.player.id)
        claim_help_request(request['id'], self.admin.id)
        socket = RecordingSocket()
        socket.cookies = self.request.cookies
        session = GameSocketSession(websocket=socket, game=target, auth_identity=self.identity)
        self.assertFalse(asyncio.run(handle_session_action(session, 'spectate_game', {})))
        return target, request, socket, session

    def test_help_spectator_cannot_rejoin_edit_roll_pause_or_end_the_game(self):
        target, _request, socket, session = self._helping_spectator()
        original_dice = list(target['_dice'])
        actions = ['rejoin_game', 'join_game', 'roll_dice', 'superadmin_activate', 'pause_game', 'end_game']
        socket.receive_json = AsyncMock(side_effect=[{'action': action, 'player_id': 'p1', 'board_id': 'p1'}
                                                     for action in actions] + [WebSocketDisconnect()])
        with self.assertRaises(WebSocketDisconnect):
            asyncio.run(_receive_messages(session, limiter=MessageRateLimiter(), finalize_game=lambda _game: None))
        self.assertEqual([message.get('error') for message in socket.messages[-len(actions):]], ['Nur fuer Spieler'] * len(actions))
        self.assertIsNone(session.player_id)
        self.assertEqual(target['_dice'], original_dice)
        self.assertFalse(target['_finished'])
        self.assertFalse(target['_aborted'])
        self.assertFalse(target.get('_superadmins'))

    def test_logout_before_help_spectate_cannot_use_the_stale_socket_identity(self):
        target = self.make_game()
        target['_players'][0]['user_id'] = self.player.id
        target['_passphrase'] = 'secret'
        request, _ = create_help_request(target['_id'], self.player.id)
        claim_help_request(request['id'], self.admin.id)
        socket = RecordingSocket()
        socket.cookies = {}
        session = GameSocketSession(websocket=socket, game=target, auth_identity=self.identity)
        self.assertTrue(asyncio.run(handle_session_action(session, 'spectate_game', {})))
        self.assertFalse(session.is_spectator)
        self.assertFalse(any('scoreboard' in message for message in socket.messages))
        self.assertEqual(socket.close_codes, [1008])

    def test_private_broadcast_rechecks_logout_and_role_revocation_without_an_incoming_frame(self):
        for mutation in ['logout', 'role']:
            with self.subTest(mutation=mutation):
                target, request, socket, _session = self._helping_spectator()
                if mutation == 'logout':
                    socket.cookies = {}
                else:
                    with session_scope() as db:
                        db.get(User, self.admin.id).role = 'user'
                asyncio.run(broadcast(target, {'private_update': 'must not leak'}))
                self.assertFalse(any('private_update' in message for message in socket.messages))
                self.assertEqual(socket.close_codes, [1000])
                self.assertFalse(target['_spectators'])
                with session_scope() as db:
                    db.get(User, self.admin.id).role = 'admin'
                resolve_help_request(request['id'], self.admin.id, 'resolved')

    def test_active_game_ban_disconnects_immediately_and_blocks_buffered_gameplay(self):
        game = self.make_game()
        socket = RecordingSocket()
        game['_players'][0].update(user_id=self.player.id, ws=socket)
        asyncio.run(create_ban(self.player.id, BanRequest(scope='play', days=3, reason='Reason'), self.request))
        self.assertEqual(socket.messages[-1]['error_code'], 'account_play_banned')
        self.assertEqual(socket.close_codes, [1008])
        buffered = RecordingSocket()
        buffered.receive_json = AsyncMock(return_value={'action': 'roll_dice'})
        session = GameSocketSession(websocket=buffered, game=game, auth_identity=None, player_id='p1')
        original_dice = list(game['_dice'])
        asyncio.run(_receive_messages(session, limiter=MessageRateLimiter(), finalize_game=lambda _game: None))
        self.assertEqual(buffered.messages[-1]['error_code'], 'account_play_banned')
        self.assertEqual(game['_dice'], original_dice)

    def test_closed_help_socket_does_not_strand_away_marker(self):
        for failure in [RuntimeError('already closed'), OSError('transport closed'), WebSocketDisconnect()]:
            with self.subTest(failure=type(failure).__name__):
                target, request, socket, _session = self._helping_spectator()
                own = self.make_game(name='Own game')
                own['_players'][0]['user_id'] = self.admin.id
                claim = claim_help_request(request['id'], self.admin.id, own['_id'])
                asyncio.run(enter_help_game(self.identity, claim))
                socket.close = AsyncMock(side_effect=failure)
                resolve_help_request(request['id'], self.admin.id, 'resolved')
                asyncio.run(end_help_assignment(request['id']))
                self.assertFalse(target['_spectators'])
                self.assertFalse(own.get('_admin_help_away'))
                self.assertFalse(has_active_help_claim(self.admin.id, target['_id']))

    def test_return_and_reopen_restore_origin_but_expired_claim_cannot_pause_own_game(self):
        target, request, _socket, _session = self._helping_spectator()
        own = self.make_game(name='Own game')
        own['_players'][0]['user_id'] = self.admin.id
        claim = claim_help_request(request['id'], self.admin.id, own['_id'])
        asyncio.run(enter_help_game(self.identity, claim))
        asyncio.run(return_from_help(self.identity, claim))
        clear_help_origin(request['id'], self.admin.id)
        reopened = claim_help_request(request['id'], self.admin.id, own['_id'])
        self.assertEqual(reopened['origin_game_id'], own['_id'])
        asyncio.run(enter_help_game(self.identity, reopened))
        self.assertTrue(own.get('_admin_help_away'))
        asyncio.run(return_from_help(self.identity, reopened))
        with session_scope() as db:
            db.get(AdminHelpRequest, request['id']).claimed_at = utcnow() - timedelta(hours=2)
        with self.assertRaises(HTTPException):
            claim_help_request(request['id'], self.admin.id, own['_id'])
        with self.assertRaises(HTTPException):
            asyncio.run(enter_help_game(self.identity, reopened))
        self.assertFalse(own.get('_admin_help_away'))
        self.assertFalse(has_active_help_claim(self.admin.id, target['_id']))

    def test_stale_claim_projection_cannot_pause_own_game_even_after_another_claim_for_same_target(self):
        target, request, _socket, _session = self._helping_spectator()
        own = self.make_game(name='Own game')
        own['_players'][0]['user_id'] = self.admin.id
        stale = claim_help_request(request['id'], self.admin.id, own['_id'])
        resolve_help_request(request['id'], self.admin.id, 'resolved')
        another, _ = create_help_request(target['_id'], self.player.id)
        claim_help_request(another['id'], self.admin.id)
        with self.assertRaises(HTTPException):
            asyncio.run(enter_help_game(self.identity, stale))
        self.assertFalse(own.get('_admin_help_away'))

    def test_closed_banned_socket_does_not_fail_durable_ban_or_skip_other_connections(self):
        for failure in [RuntimeError('already closed'), OSError('transport closed'), WebSocketDisconnect()]:
            with self.subTest(failure=type(failure).__name__):
                game = self.make_game()
                closed = RecordingSocket()
                closed.close = AsyncMock(side_effect=failure)
                other = RecordingSocket()
                game['_players'][0].update(user_id=self.player.id, ws=closed)
                game['_spectators'].append({'user_id': self.player.id, 'ws': other})
                result = asyncio.run(create_ban(self.player.id, BanRequest(scope='play', days=3, reason='Reason'), self.request))
                self.assertEqual(result['ban']['scope'], 'play')
                self.assertTrue(user_play_banned(self.player.id))
                self.assertEqual(other.close_codes, [1008])
