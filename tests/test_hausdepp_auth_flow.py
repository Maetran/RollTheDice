"""One shared account, with product-bound Hausdepp presentation and recovery."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlencode, urlsplit

from starlette.testclient import TestClient

from app import main
from app.account_context import account_action_url
from app.auth import create_user, login
from app.database import configure_database, upgrade_database
from app.product_hosts import HAUSDEPP_ORIGIN, safe_hausdepp_path
from tests.test_user_accounts import request_for

APEX = 'https://zockdiewandan.online'


class HausdeppAuthFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            'ROLLTHEDICE_DATABASE_URL': f'sqlite:///{self.temp.name}/auth.sqlite3',
            'ROLLTHEDICE_SITE_ORIGIN': APEX,
            'ROLLTHEDICE_ZILCH_ORIGIN': 'https://zilch.zockdiewandan.online',
            'ROLLTHEDICE_COOKIE_DOMAIN': '', 'ROLLTHEDICE_COOKIE_SECURE': '0',
            'ROLLTHEDICE_EMAIL_ENABLED': '1', 'ROLLTHEDICE_RESEND_API_KEY': 'test-only',
            'ROLLTHEDICE_EMAIL_FROM': 'account@example.test',
            'ROLLTHEDICE_TURNSTILE_SITE_KEY': '', 'ROLLTHEDICE_TURNSTILE_SECRET': '',
            'ROLLTHEDICE_PASSKEYS_ENABLED': '0',
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.client = TestClient(main.app, base_url=HAUSDEPP_ORIGIN)
        self.delivery = patch('app.email_delivery.send_account_email')
        self.mail = self.delivery.start()
        self.direct_delivery = patch('app.email_accounts.send_account_email', self.mail)
        self.direct_delivery.start()

    def tearDown(self):
        self.client.close()
        self.direct_delivery.stop()
        self.delivery.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def post(self, path, data, csrf=None):
        return self.client.post(path, json=data, headers={'Origin': HAUSDEPP_ORIGIN, **({'X-CSRF-Token': csrf} if csrf else {})})

    def mailed_action(self):
        target = urlsplit(self.mail.call_args.kwargs['action_url'])
        self.assertEqual(f'{target.scheme}://{target.netloc}', HAUSDEPP_ORIGIN)
        self.assertEqual(parse_qs(target.query)['app'], ['hausdepp'])
        self.assertNotIn('token', target.query)
        return target, parse_qs(target.fragment)['token'][0]

    def test_house_auth_pages_keep_product_identity_and_protected_settings(self):
        for path in ('/hausdepp/anmelden', '/zilch/anmelden', '/passwort-vergessen?app=hausdepp',
                     '/registrierung/bestaetigen', '/passwort-zuruecksetzen', '/email-bestaetigen'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertIn('data-game="hausdepp"', response.text)
            self.assertIn('/static/hausdepp.css?', response.text)
            self.assertNotIn('/static/zilch.css?', response.text)
            self.assertIn('no-store', response.headers['cache-control'])
            self.assertIn('noindex', response.headers['x-robots-tag'])
        for origin in (HAUSDEPP_ORIGIN, APEX, 'https://zilch.zockdiewandan.online'):
            forgot = self.client.get(f'{origin}/passwort-vergessen?app=hausdepp')
            self.assertEqual(forgot.status_code, 200)
            self.assertIn('data-game="hausdepp"', forgot.text)
            private = self.client.get(f'{origin}/hausdepp/konto/einstellungen', follow_redirects=False)
            self.assertTrue(private.headers['location'].startswith('/hausdepp/anmelden?'))
        legacy = self.client.get(f'{APEX}/zilch/anmelden?' + urlencode({'return_to': '/auth/continue?app=hausdepp&path=%2Fhausdepp%2Fkonto'}))
        self.assertEqual(legacy.status_code, 200)
        self.assertIn('data-game="hausdepp"', legacy.text)
        response = self.client.get('/hausdepp/konto/einstellungen?push=1', follow_redirects=False)
        self.assertEqual(response.status_code, 303)
        target = urlsplit(response.headers['location'])
        self.assertEqual(target.path, '/hausdepp/anmelden')
        self.assertEqual(parse_qs(target.query)['return_to'], ['/hausdepp/konto/einstellungen?push=1'])
        self.assertFalse(target.netloc)
        user = create_user('HouseSettings', 'test-password-123', must_change_password=False)
        _identity, token = login(request_for(), user.username, 'test-password-123')
        self.client.cookies.set('rollthedice_session', token)
        self.assertEqual(self.client.get('/hausdepp/konto/einstellungen').status_code, 200)
        for file in ('hausdepp-login.html', 'hausdepp-settings.html', 'hausdepp-email-action.html'):
            self.assertEqual(self.client.get(f'/static/{file}').status_code, 404)

    def test_registration_email_completion_and_reset_retain_shared_identity_and_house_context(self):
        response = self.post('/api/auth/register', {'username': 'HouseEmail', 'email': 'house@example.test',
                             'preferred_language': 'en', 'account_app': 'hausdepp',
                             'return_to': '/auth/continue?' + urlencode({'app': 'hausdepp', 'path': '/hausdepp/konto/einstellungen'})})
        self.assertEqual(response.status_code, 202, response.text)
        target, token = self.mailed_action()
        self.assertEqual(target.path, '/registrierung/bestaetigen')
        self.assertEqual(parse_qs(target.query)['return_to'], ['/hausdepp/konto/einstellungen'])
        self.assertEqual(self.post('/api/auth/registration/inspect', {'token': token}).json(), {'valid': True})
        completed = self.post('/api/auth/registration/complete', {'token': token, 'password': 'first-password-123'})
        self.assertEqual(completed.status_code, 200, completed.text)
        original_id = completed.json()['user']['id']
        self.assertEqual(self.client.get('/api/auth/me').json()['user']['id'], original_id)
        self.assertEqual(self.post('/api/auth/registration/complete', {'token': token, 'password': 'second-password-123'}).status_code, 400)
        response = self.post('/api/auth/password-reset', {'email': 'house@example.test', 'account_app': 'hausdepp',
                             'return_to': '//evil.example/steal'})
        self.assertEqual(response.status_code, 202)
        target, token = self.mailed_action()
        self.assertEqual(target.path, '/passwort-zuruecksetzen')
        self.assertEqual(parse_qs(target.query)['return_to'], ['/hausdepp'])
        reset = self.post('/api/auth/password-reset/complete', {'token': token, 'password': 'new-password-123'})
        self.assertEqual(reset.status_code, 200)
        self.assertFalse(self.client.get('/api/auth/me').json()['authenticated'])
        self.assertEqual(self.post('/api/auth/password-reset/complete', {'token': token, 'password': 'other-password-123'}).status_code, 400)
        logged = self.post('/api/auth/login', {'username': 'HouseEmail', 'password': 'new-password-123'})
        self.assertEqual(logged.status_code, 200)
        self.assertEqual(logged.json()['user']['id'], original_id)

    def test_email_change_requires_current_account_proof_and_csrf_then_links_to_house_settings(self):
        create_user('HouseChange', 'test-password-123', must_change_password=False)
        user = self.post('/api/auth/login', {'username': 'HouseChange', 'password': 'test-password-123'}).json()['user']
        payload = {'email': 'change@example.test', 'current_password': 'test-password-123', 'account_app': 'hausdepp'}
        self.assertEqual(self.post('/api/auth/email', payload).status_code, 403)
        self.assertEqual(self.post('/api/auth/email', {**payload, 'current_password': 'wrong-password'}, user['csrf_token']).status_code, 400)
        self.assertEqual(self.post('/api/auth/email', payload, user['csrf_token']).status_code, 202)
        target, token = self.mailed_action()
        self.assertEqual(parse_qs(target.query)['return_to'], ['/hausdepp/konto/einstellungen'])
        self.assertEqual(self.post('/api/auth/email/confirm', {'token': token}).status_code, 200)
        self.assertTrue(self.client.get('/api/auth/email').json()['email_confirmed'])
        self.assertEqual(self.post('/api/auth/email/confirm', {'token': token}).status_code, 400)

    def test_mail_context_unwraps_only_a_single_relative_valid_house_continuation(self):
        for target in ("/hausdepp/konto/einstellungen", "/hausdepp/spiel/invited-room?seat=2", "/hausdepp"):
            continuation = "/auth/continue?" + urlencode({"app": "hausdepp", "path": target})
            url = account_action_url("/passwort-zuruecksetzen", "x"*32, "de", app="hausdepp", return_to=continuation)
            self.assertEqual(parse_qs(urlsplit(url).query)["return_to"], [target])
        bad = (
            "https://evil.example/auth/continue?app=hausdepp&path=/hausdepp/konto",
            "//evil.example/auth/continue?app=hausdepp&path=/hausdepp/konto",
            "/auth/continue?app=zilch&path=/hausdepp/konto",
            "/auth/continue?app=hausdepp&path=https%3A%2F%2Fevil.example",
            "/auth/continue?app=hausdepp&path=%2F%2Fevil.example",
            "/auth/continue?app=hausdepp&path=%2Fhausdepp%2F..%2Fkonto",
            "/auth/continue?app=hausdepp&path=%2Fhausdepp%2Fkonto&path=%2Fhausdepp",
            "/auth/continue?app=hausdepp&path=%2Fhausdepp%2Fkonto&app=hausdepp",
            "/auth/continue?app=hausdepp&path=%2Fauth%2Fcontinue%3Fapp%3Dhausdepp%26path%3D%2Fhausdepp%2Fkonto",
            "/auth/continue?app=hausdepp&path=/hausdepp/konto#fragment",
            "/auth/continue?app=hausdepp&path=/hausdepp/spiel/%252f%252fevil",
            "/auth/continue?app=hausdepp&path=%2Fhausdepp%2Fkonto%0A",
            "/auth/continue?app=hausdepp&path=%2Fhausdepp%2Fkonto%7F",
            "/auth/continue?app=hausdepp&path=%2Fhausdepp%2Fkonto%5Cother",
        )
        for value in bad:
            with self.subTest(value=value):
                url = account_action_url("/passwort-zuruecksetzen", "x"*32, "de", app="hausdepp", return_to=value)
                self.assertEqual(parse_qs(urlsplit(url).query)["return_to"], ["/hausdepp"])

    def test_mail_tokens_never_cross_from_a_local_or_staging_environment_into_production(self):
        for origin in ("http://127.0.0.1:8059", "https://staging.example.test", "https://zockdiewandan.online:8443"):
            with self.subTest(origin=origin), patch.dict(os.environ, {"ROLLTHEDICE_SITE_ORIGIN": origin}):
                target = urlsplit(account_action_url("/passwort-zuruecksetzen", "x"*32, "en", app="hausdepp"))
                self.assertEqual(f"{target.scheme}://{target.netloc}", origin)
                self.assertEqual(parse_qs(target.fragment)["token"], ["x"*32])

    def test_return_paths_are_strict_and_unknown_products_or_cross_origin_posts_fail(self):
        for unsafe in ('https://evil.example', '//evil.example', '/hausdepp/../konto', '/hausdepp/konto#outside',
                       '/hausdepp/konto/einstellungen/other', '/api/auth/me', '/hausdepp/spiel/%252f%252fevil'):
            with self.subTest(unsafe=unsafe):
                response = self.client.get('/hausdepp/anmelden?' + urlencode({'return_to': unsafe}), follow_redirects=False)
                self.assertEqual(response.status_code, 303)
                self.assertEqual(response.headers['location'], '/hausdepp/anmelden?return_to=%2Fhausdepp')
                self.assertEqual(safe_hausdepp_path(unsafe), '/hausdepp')
                self.assertEqual(parse_qs(urlsplit(account_action_url('/passwort-zuruecksetzen', 'x'*32, 'de', app='hausdepp', return_to=unsafe)).query)['return_to'], ['/hausdepp'])
        self.assertEqual(self.post('/api/auth/register', {'username': 'NoProduct', 'email': 'no@example.test', 'account_app': 'evil'}).status_code, 422)
        response = self.client.post('/api/auth/password-reset', json={'email': 'test@example.test'}, headers={'Origin': 'https://evil.example'})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(self.mail.called)
