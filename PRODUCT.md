# RollTheDice

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Players use ZDWA and Zilch on phones, tablets and desktop browsers. Mission
Control serves the founder and explicitly authorized analytics viewers.

## Product Purpose

RollTheDice offers two dice games. Its private Mission Control dashboard helps
authorized viewers understand measured visits, gameplay activity and server
resources, with prominent KPIs and detailed interactive analysis.

## Operating Context

Mission Control lives at `/admin/dashboard`. Viewers choose a UTC calendar
window and game filter; visible dashboards refresh every 30 seconds. Dashboard
appearance is independent of the two games' appearance.

## Capabilities and Constraints

- Preserve existing Mission Control and LCARS designs. NEXUS is an additional
  design selected through the dashboard's UI switcher.
- Support phone, tablet and desktop use, German and English, accessible charts
  and tables, keyboard operation and reduced motion.
- Allow individual metrics and analysis panels to be starred and shown in a
  reserved area at the top. Store favorites locally for the verified viewer.
- Visits are anonymous browser-tab sessions, not unique people. Visible active
  time, saved game results and sitewide HTTP counts are separate measurements.
- Unknown, missing, stale and incomplete measurements must remain explicit.
- Keep authentication, explicit analytics access, noindex and no-store.
- Follow `docs/PRODUCT_DELIVERY.md` for documentation, translations, versioning
  and verification. No game rules change in the dashboard work.

## Brand Commitments

Preserve RollTheDice, ZDWA, Zilch and Mission Control naming. The requested new
dashboard design should feel distinctly nerdy and ambitious, with strong UX.

## Evidence on Hand

`app/analytics.py` defines metrics; `frontend/dashboard.js` renders them.
`tests/browser/analytics-dashboard.spec.js` contains labeled synthetic telemetry
for interaction and viewport testing, separate from real authorization tests.
Do not invent performance, popularity, conversion or user-count claims.

## Product Principles

- Explain each number well enough to support a decision.
- Let viewers prioritize their own monitoring workspace.
- Preserve working interactions and previous design choices.
- Show live state and measurement limits honestly.
