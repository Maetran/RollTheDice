"""The private dashboard never has an alternate unprotected document entry."""

from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app import main


class AnalyticsRouteTests(IsolatedAsyncioTestCase):
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
