"""ZDWA design choice: availability, account choice, one-time prompt,
anonymous visible time per look, and the server-computed field previews."""

import asyncio
import os
import tempfile
import unittest
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import select

from app import analytics, game_engine, main
from app.analytics import AnalyticsDesignBucket, dashboard_stats, normalize_batch, persist_batches
from app.api_auth import DesignPreferenceRequest, auth_claim_design_prompt, auth_me, auth_update_design
from app.auth import create_user, login, resolve_session
from app.database import configure_database, session_scope, upgrade_database
from app.models import User
from app.security import utcnow
from app.zdwa_design import ZDWA_DESIGN_ENV, design_payload, zdwa_design_available
from tests.support import GameStateTestCase
from tests.test_user_accounts import request_for


def identity(*, is_owner: bool, design: str = "new", pending: bool = True):
    return SimpleNamespace(user_id=7, username="Mani", is_owner=is_owner, zdwa_design=design,
                           zdwa_design_prompt_pending=pending)


class DesignAvailabilityTests(unittest.TestCase):
    def test_everyone_gets_the_2026_design_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop(ZDWA_DESIGN_ENV, None)
            self.assertTrue(zdwa_design_available(None))
            self.assertTrue(zdwa_design_available(identity(is_owner=False)))
            self.assertEqual(design_payload(None), {"zdwa_2026_available": True})
            self.assertEqual(design_payload(identity(is_owner=False, design="old")),
                             {"zdwa_2026_available": True, "zdwa": "old", "prompt_pending": True})

    def test_owner_mode_limits_the_audience(self):
        with patch.dict(os.environ, {ZDWA_DESIGN_ENV: "owner"}):
            self.assertTrue(zdwa_design_available(identity(is_owner=True)))
            self.assertFalse(zdwa_design_available(identity(is_owner=False)))
            self.assertFalse(zdwa_design_available(None))
            self.assertFalse(design_payload(identity(is_owner=False))["prompt_pending"])

    def test_kill_switch_and_unknown_values_disable_the_design(self):
        for value in ("off", "OFF", "everyone", "public", ""):
            with self.subTest(value=value), patch.dict(os.environ, {ZDWA_DESIGN_ENV: value}):
                self.assertFalse(zdwa_design_available(identity(is_owner=True)))
                self.assertFalse(design_payload(identity(is_owner=True))["prompt_pending"])

    def test_unknown_stored_values_fall_back_to_the_new_design(self):
        self.assertEqual(design_payload(identity(is_owner=False, design="retro"))["zdwa"], "new")


class AccountActionPageTests(unittest.TestCase):
    """Password and email action pages never ask /api/auth/me, so the served
    document carries the server switch for their inline head script."""

    ROUTES = (main.password_forgot_page, main.password_reset_page,
              main.email_confirmation_page, main.registration_confirmation_page)

    def render(self, mode, route=main.password_forgot_page, *, session=None):
        env = {"ROLLTHEDICE_SITE_ORIGIN": "http://testserver", ZDWA_DESIGN_ENV: mode}
        with patch.dict(os.environ, env), patch.object(main, "resolve_session", return_value=session) as resolved:
            response = route(request_for())
        return response, response.body.decode("utf-8"), resolved.call_count

    def test_every_action_page_states_availability_before_its_head_script(self):
        for route in self.ROUTES:
            with self.subTest(route=route.__name__):
                response, html, lookups = self.render("all", route)
                self.assertIn('<html data-design-available="true" lang="de" data-game="zdwa">', html)
                self.assertLess(html.index("data-design-available"), html.index("r.dataset.design="))
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(response.headers["referrer-policy"], "no-referrer")
                self.assertTrue(response.headers["content-type"].startswith("text/html"))
                self.assertEqual(lookups, 0)

    def test_the_server_switch_reaches_action_pages(self):
        _response, html, lookups = self.render("off")
        self.assertIn('data-design-available="false"', html)
        self.assertEqual(lookups, 0)
        self.assertIn('data-design-available="false"', self.render("owner")[1])
        self.assertIn('data-design-available="false"', self.render("owner", session=identity(is_owner=False))[1])
        self.assertIn('data-design-available="true"', self.render("owner", session=identity(is_owner=True))[1])


class DesignAccountTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/design.sqlite",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        os.environ.pop(ZDWA_DESIGN_ENV, None)
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        user = create_user("DesignPlayer", "a-secure-password-123", must_change_password=False)
        self.user_id = user.id
        # Simulate an account from before the 2026 design (the migration leaves NULL).
        with session_scope() as db:
            db.get(User, user.id).zdwa_design_prompted_at = None
        self.identity, token = login(request_for(), user.username, "a-secure-password-123")
        self.request = request_for(cookie=f"rollthedice_session={token}", csrf=self.identity.csrf_token)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def me(self):
        return resolve_session(self.request)

    def test_new_accounts_are_not_asked(self):
        fresh = create_user("FreshPlayer", "a-secure-password-123", must_change_password=False)
        identity, token = login(request_for(), fresh.username, "a-secure-password-123")
        request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
        self.assertEqual(design_payload(resolve_session(request)),
                         {"zdwa_2026_available": True, "zdwa": "new", "prompt_pending": False})
        self.assertEqual(auth_claim_design_prompt(request), {"show": False})

    def test_accounts_created_while_the_design_is_withheld_are_asked_after_the_release(self):
        for mode in ("owner", "off"):
            with self.subTest(mode=mode):
                with patch.dict(os.environ, {ZDWA_DESIGN_ENV: mode}):
                    early = create_user(f"Early{mode}", "a-secure-password-123", must_change_password=False)
                with session_scope() as db:
                    self.assertIsNone(db.get(User, early.id).zdwa_design_prompted_at)
                identity, token = login(request_for(), early.username, "a-secure-password-123")
                request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
                self.assertTrue(design_payload(resolve_session(request))["prompt_pending"])
                self.assertEqual(auth_claim_design_prompt(request), {"show": True})

    def test_accounts_start_with_the_new_design_and_a_pending_question(self):
        payload = design_payload(self.me())
        self.assertEqual(payload, {"zdwa_2026_available": True, "zdwa": "new", "prompt_pending": True})

    def test_the_question_is_claimed_exactly_once(self):
        self.assertEqual(auth_claim_design_prompt(self.request), {"show": True})
        self.assertEqual(auth_claim_design_prompt(self.request), {"show": False})
        self.assertFalse(design_payload(self.me())["prompt_pending"])

    def test_disabled_design_never_claims_the_question(self):
        with patch.dict(os.environ, {ZDWA_DESIGN_ENV: "off"}):
            self.assertEqual(auth_claim_design_prompt(self.request), {"show": False})
        self.assertEqual(auth_claim_design_prompt(self.request), {"show": True})

    def test_choosing_a_design_is_stored_and_answers_the_question(self):
        self.assertEqual(auth_update_design(DesignPreferenceRequest(zdwa_design="old"), self.request),
                         {"zdwa_design": "old"})
        state = self.me()
        self.assertEqual(state.zdwa_design, "old")
        self.assertFalse(state.zdwa_design_prompt_pending)
        self.assertEqual(auth_claim_design_prompt(self.request), {"show": False})
        auth_update_design(DesignPreferenceRequest(zdwa_design="new"), self.request)
        self.assertEqual(self.me().zdwa_design, "new")

    def test_design_changes_require_csrf(self):
        with self.assertRaises(HTTPException):
            auth_update_design(DesignPreferenceRequest(zdwa_design="old"),
                               request_for(cookie=self.request.headers["cookie"]))
        with session_scope() as db:
            self.assertEqual(db.get(User, self.user_id).zdwa_design, "new")

    def test_me_reports_design_for_accounts_and_guests(self):
        from starlette.responses import Response

        signed_in = auth_me(self.request, Response())
        self.assertEqual(signed_in["user"]["design"]["zdwa"], "new")
        # The choice lives in `design`, not in the gameplay preferences contract.
        self.assertNotIn("zdwa_design", signed_in["user"]["preferences"])
        guest = auth_me(request_for(), Response())
        self.assertEqual(guest["design"], {"zdwa_2026_available": True})


class DesignUsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/usage.sqlite"})
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.now = utcnow()

    def tearDown(self):
        if analytics._queue is not None:
            asyncio.run(analytics.stop_analytics())
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    @staticmethod
    def engagement(event_id, *, look, page="/spiel/ROOM", game="zdwa", active_ms=15000):
        return {"id": event_id * 32, "page_id": "b" * 32, "type": "engagement", "page": page,
                "game": game, "active_ms": active_ms, "look": look}

    def test_visible_time_is_summed_per_look_and_area_without_duplicates(self):
        raw = {"session_id": "a" * 32, "events": [
            self.engagement("1", look="zdwa:new:dark"),
            self.engagement("2", look="zdwa:new:dark", page="/regeln", active_ms=4000),
            self.engagement("3", look="zdwa:old:classic", active_ms=9000),
            self.engagement("4", look="zilch:lcars", page="/zilch/spiel/ROOM", game="zilch", active_ms=7000),
        ]}
        batch = normalize_batch(raw, now=self.now)
        persist_batches([batch, batch])
        stats = dashboard_stats(7, now=self.now + timedelta(seconds=1))["design_usage"]
        looks = {row["look"]: row for row in stats["looks"]}
        self.assertEqual(looks["zdwa:new:dark"], {"look": "zdwa:new:dark", "game": "zdwa", "seconds": 19,
                                                  "table_seconds": 15})
        self.assertEqual(looks["zdwa:old:classic"]["seconds"], 9)
        self.assertEqual(looks["zilch:lcars"]["table_seconds"], 7)
        zilch_only = dashboard_stats(7, "zilch", now=self.now + timedelta(seconds=1))["design_usage"]
        self.assertEqual([row["look"] for row in zilch_only["looks"]], ["zilch:lcars"])
        self.assertIsNone(zilch_only["zdwa_account_choices"])

    def test_unknown_or_mismatched_looks_are_ignored(self):
        raw = {"session_id": "a" * 32, "events": [
            self.engagement("1", look="zdwa:neon:dark"),
            self.engagement("2", look="zilch:lcars"),
            self.engagement("3", look="Mani"),
        ]}
        persist_batches([normalize_batch(raw, now=self.now)])
        with session_scope() as db:
            self.assertEqual(db.scalars(select(AnalyticsDesignBucket)).all(), [])

    def test_account_choices_are_counted(self):
        create_user("NewLook", "a-secure-password-123", must_change_password=False)
        old = create_user("OldLook", "a-secure-password-123", must_change_password=False)
        with session_scope() as db:
            db.get(User, old.id).zdwa_design = "old"
        stats = dashboard_stats(7, now=self.now)["design_usage"]
        self.assertEqual(stats["zdwa_account_choices"]["old"], 1)
        self.assertGreaterEqual(stats["zdwa_account_choices"]["new"], 1)


class FieldPreviewTests(GameStateTestCase):
    def previews(self, g):
        return {(p["row"], p["col"]): p["points"] for p in game_engine.compute_field_previews(g)}

    def test_no_previews_before_the_first_roll(self):
        g = self.make_game()
        self.assertEqual(game_engine.compute_field_previews(g), [])

    def test_previews_follow_column_order_and_scoring(self):
        g = self.make_game()
        g["_rolls_used"] = 1
        g["_turn"]["roll_index"] = 1
        g["_dice"] = [5, 5, 5, 2, 2]

        previews = self.previews(g)

        # Abwärts starts at 1, Aufwärts at 60, Frei and the first-roll ❗ are open.
        self.assertEqual(previews[(0, "down")], 0)
        self.assertNotIn((1, "down"), previews)
        self.assertEqual(previews[(15, "up")], 0)
        self.assertNotIn((14, "up"), previews)
        self.assertEqual(previews[(4, "free")], 15)
        self.assertEqual(previews[(13, "free")], 55)
        self.assertEqual(previews[(13, "ang")], 55)

    def test_active_announcement_limits_previews_to_the_announced_field(self):
        g = self.make_game()
        g["_rolls_used"] = 2
        g["_turn"]["roll_index"] = 2
        g["_dice"] = [1, 2, 3, 4, 6]
        g["_announced_row4"] = "kenter"

        previews = self.previews(g)

        self.assertEqual(previews.get((12, "ang")), 35)
        self.assertNotIn((12, "free"), previews)

    def test_late_poker_without_announcement_previews_zero(self):
        g = self.make_game()
        g["_rolls_used"] = 2
        g["_dice"] = [4, 4, 4, 4, 2]
        g["_turn"]["roll_index"] = 2
        g["_turn"]["first4oak_roll"] = 1

        self.assertEqual(self.previews(g)[(14, "free")], 0)

    def test_filled_cells_are_never_previewed(self):
        g = self.make_game()
        g["_rolls_used"] = 1
        g["_turn"]["roll_index"] = 1
        g["_dice"] = [6, 6, 6, 6, 6]
        g["_scoreboards"]["p1"]["15,free"] = 90

        self.assertNotIn((15, "free"), self.previews(g))


if __name__ == "__main__":
    unittest.main()
