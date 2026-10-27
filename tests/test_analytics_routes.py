"""The private dashboard never has an alternate unprotected document entry."""

import os
from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app import main


class AnalyticsRouteTests(IsolatedAsyncioTestCase):
    PRODUCT_HOSTS = ("zilch", "hausdepp", "watten")

    async def test_dashboard_login_keeps_fixed_destination_and_private_headers(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver") as client:
            with patch("app.main.resolve_session", return_value=None):
                response = await client.get("/admin/dashboard")
            self.assertEqual(response.status_code, 303)
            self.assertEqual(response.headers["location"], "/zilch/anmelden?return_to=%2Fadmin%2Fdashboard")
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn("noindex", response.headers["x-robots-tag"])

    async def test_denied_reader_gets_useful_account_return_without_statistics(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver") as client:
            with patch("app.main.resolve_session", return_value=object()), \
                    patch("app.main.require_analytics", side_effect=HTTPException(403, "analytics_access_required")):
                response = await client.get("/admin/dashboard")
            self.assertEqual(response.status_code, 403)
            self.assertIn('href="/konto"', response.text)
            self.assertIn("Dashboard-Zugriff erforderlich", response.text)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertNotIn("overviewMetrics", response.text)

    async def test_static_dashboard_redirects_to_authorized_route(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver") as client:
            response = await client.get("/static/dashboard.html")
            self.assertEqual(response.status_code, 308)
            self.assertEqual(response.headers["location"], "/admin/dashboard")
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIn("noindex", response.headers["x-robots-tag"])
            denied = await client.get("/static/dashboard-denied.html")
            self.assertEqual(denied.status_code, 404)

    async def test_zilch_dashboard_uses_shared_apex(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="https://zilch.zockdiewandan.online") as client:
            response = await client.get("/admin/dashboard")
            self.assertEqual(response.status_code, 308)
            self.assertEqual(response.headers["location"], "https://zockdiewandan.online/admin/dashboard")

    async def test_pwa_dashboard_bridge_keeps_the_private_guard_and_same_origin_login(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1"}):
            for product in self.PRODUCT_HOSTS:
                with self.subTest(product=product):
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                                 base_url=f"https://{product}.zockdiewandan.online") as client:
                        with patch("app.main.resolve_session", return_value=None), \
                                patch("app.main.require_analytics") as guard:
                            response = await client.get("/zdwa/admin/dashboard")
                        self.assertEqual(response.status_code, 303)
                        self.assertEqual(response.headers["location"],
                                         "/zdwa/anmelden?return_to=%2Fzdwa%2Fadmin%2Fdashboard")
                        self.assertEqual(response.headers["cache-control"], "no-store")
                        self.assertIn("noindex", response.headers["x-robots-tag"])
                        guard.assert_not_called()
                        self.assertNotIn("overviewMetrics", response.text)

    async def test_pwa_dashboard_bridge_rechecks_reader_authority_and_keeps_document_exits_inside_app(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1"}):
            for product in self.PRODUCT_HOSTS:
                with self.subTest(product=product):
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                                 base_url=f"https://{product}.zockdiewandan.online") as client:
                        with patch("app.main.resolve_session", return_value=object()), \
                                patch("app.main.require_analytics") as guard:
                            response = await client.get("/zdwa/admin/dashboard")
                        self.assertEqual(response.status_code, 200)
                        guard.assert_called_once()
                        self.assertIn("overviewMetrics", response.text)
                        self.assertIn('data-zdwa-pwa-bridge="true"', response.text)
                        self.assertIn('href="/zdwa"', response.text)
                        self.assertIn('href="/zdwa/konto"', response.text)
                        self.assertNotIn('href="/"', response.text)
                        self.assertNotIn('href="/konto"', response.text)
                        self.assertIn(f'data-pwa-product="{product}"', response.text)
                        self.assertIn(f'href="/{product}-manifest.webmanifest?', response.text)
                        self.assertEqual(response.headers["cache-control"], "no-store")
                        self.assertIn("noindex", response.headers["x-robots-tag"])
                        with patch("app.main.resolve_session", return_value=object()), \
                                patch("app.main.require_analytics",
                                      side_effect=HTTPException(403, "analytics_access_required")) as denied_guard:
                            denied = await client.get("/zdwa/admin/dashboard")
                        denied_guard.assert_called_once()
                        self.assertEqual(denied.status_code, 403)
                        self.assertIn("Dashboard-Zugriff erforderlich", denied.text)
                        self.assertIn('data-zdwa-pwa-bridge="true"', denied.text)
                        self.assertIn(f'data-pwa-product="{product}"', denied.text)
                        self.assertIn(f'href="/{product}-manifest.webmanifest?', denied.text)
                        self.assertEqual(denied.headers["cache-control"], "no-store")
                        self.assertIn("noindex", denied.headers["x-robots-tag"])
                        self.assertNotIn("overviewMetrics", denied.text)

    async def test_pwa_dashboard_signin_accepts_only_its_fixed_return_and_keeps_product_manifest(self):
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1"}):
            for product in self.PRODUCT_HOSTS:
                with self.subTest(product=product):
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                                 base_url=f"https://{product}.zockdiewandan.online") as client:
                        destination = "/zdwa/anmelden?return_to=%2Fzdwa%2Fadmin%2Fdashboard"
                        response = await client.get(destination)
                        self.assertEqual(response.status_code, 200)
                        self.assertIn('id="zilchLoginForm"', response.text)
                        self.assertIn('data-zdwa-pwa-bridge="true"', response.text)
                        self.assertIn(f'data-pwa-product="{product}"', response.text)
                        self.assertIn(f'href="/{product}-manifest.webmanifest?', response.text)
                        if product == "hausdepp":
                            self.assertIn('rel="apple-touch-icon" type="image/png" '
                                          'href="/static/icons/hausdepp-apple-touch-icon-180-v2.png?', response.text)
                            self.assertNotIn("/static/icons/zilch-apple-touch-icon-180.png", response.text)
                        self.assertEqual(response.headers["cache-control"], "no-store")
                        self.assertIn("noindex", response.headers["x-robots-tag"])
                        for query in ("", "?return_to=https://evil.invalid", "?return_to=/admin",
                                      "?return_to=//evil.invalid", "?return_to=/zdwa/admin/dashboard&return_to=/admin",
                                      "?return_to=/admin&return_to=/zdwa/admin/dashboard"):
                            normalized = await client.get(f"/zdwa/anmelden{query}")
                            self.assertEqual(normalized.status_code, 303, query)
                            self.assertEqual(normalized.headers["location"], destination)
                            self.assertEqual(normalized.headers["cache-control"], "no-store")

    async def test_dashboard_bridge_does_not_open_an_apex_alias_or_a_disabled_watten_host(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url="https://zockdiewandan.online") as client:
            for path in ("/zdwa/admin/dashboard", "/zdwa/anmelden"):
                self.assertEqual((await client.get(path)).status_code, 404)
        with patch.dict(os.environ, {"ROLLTHEDICE_WATTEN_PUBLIC_BETA": "0"}):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                         base_url="https://watten.zockdiewandan.online") as client:
                with patch("app.main.resolve_session", side_effect=AssertionError("Must gate before accounts")):
                    for path in ("/zdwa/admin/dashboard", "/zdwa/anmelden"):
                        response = await client.get(path)
                        self.assertEqual(response.status_code, 503)
                        self.assertEqual(response.headers["cache-control"], "no-store")
                        self.assertIn("noindex", response.headers["x-robots-tag"])
