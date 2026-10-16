# RollTheDice

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Players use ZDWA and Zilch on phones, tablets and desktop browsers. Mission
Control serves the founder and explicitly authorized analytics viewers.
The founder also tests Hausdepp privately, initially against server-controlled
computer players; additional human seats use local test accounts only.

## Product Purpose

RollTheDice offers ZDWA and Zilch, with Hausdepp being developed as a third game
under the suite's shared account and game selection. Its private Mission Control dashboard helps
authorized viewers understand measured visits, gameplay activity and server
resources, with prominent KPIs and detailed interactive analysis.

## Operating Context

Mission Control lives at `/admin/dashboard`. Viewers choose a UTC calendar
window and game filter; visible dashboards refresh every 30 seconds. Dashboard
appearance is independent of the two games' appearance.
Hausdepp uses protected `/hausdepp` routes and a separate card-table design.
Its first playable increment covers the lobby, table and complete house rules.

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
- Keep Hausdepp bound to the permanent founder account on the server. Ordinary
  administrators and delegated owners do not gain access. Keep its pages and
  outcomes private and out of public activity, ranking and release audiences.
- Support 2–5 Hausdepp participants, at most 6, including computer opponents;
  there is no solo mode. Share account, chat, reactions and reconnection.
- Put Hausdepp's full house rules in `docs/HAUSDEPP.md`. The stock is a direct
  action: gamble before hand play, or refill all missing cards to three after
  playing. The oldest pending refill controls stock access; later players may
  already play hand cards but cannot draw or gamble until earlier debts settle.
  Show the responsible player a gently pulsing red draw reminder, static with
  reduced motion. Active bottom inspection belongs to its designated player;
  show a short nonblocking deal. Tapping a sorted, fanned hand card plays it
  immediately. The open pile is the direct pickup action. Show opponents as
  exactly their number of card backs, keeping all faces private. Clean card
  edges through individually measured render geometry. Make receiving cards
  visible from source pile to destination hand, without delaying gameplay.
- Plan Hausdepp points and achievements without inventing award conditions.
  The confirmed ironic achievement progression goes from clever names to
  the highest lasting title, Hausdepp; its exact list and thresholds remain open.
- Keep development releases in version 2.x. Version 3 is reserved for the
  later major suite launch; a development version is not a claimed deployment.

## Brand Commitments

Preserve RollTheDice, ZDWA, Zilch and Mission Control naming. The requested new
dashboard design should feel distinctly nerdy and ambitious, with strong UX.
Hausdepp keeps its familiar house-game name. Its selected Stammtisch direction
uses the established walnut table, double-headed German Tell-pattern cards and
a red, black and ivory patterned back. It has its own visual identity, large
readable hand cards, and mobile-first portrait and landscape layouts.

## Evidence on Hand

`app/analytics.py` defines metrics; `frontend/dashboard.js` renders them.
`tests/browser/analytics-dashboard.spec.js` contains labeled synthetic telemetry
for interaction and viewport testing, separate from real authorization tests.
Do not invent performance, popularity, conversion or user-count claims.
`docs/HAUSDEPP.md` records the owner-confirmed card rules and future scope;
`docs/HAUSDEPP_ASSETS.md` records the card references, licensing and provenance.

## Product Principles

- Explain each number well enough to support a decision.
- Let viewers prioritize their own monitoring workspace.
- Preserve working interactions and previous design choices.
- Show live state and measurement limits honestly.
