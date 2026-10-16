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
Its development build covers the lobby, table, complete house rules and a
dedicated private account area. UI and UX have not been accepted by the owner;
continued local development is authorized.

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
- Use one shared game picker with named game icons and an explicit active-game
  state instead of a direct two-game toggle. Resolve entries through the shared
  browser/PWA route helpers and preserve server-confirmed access. Installed
  apps retain their origin and worker; the private Hausdepp destination is not
  made public by the picker. Preserve existing dice-table leave flows.
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
- Give the Hausdepp lobby clear table status, occupied seats and waiting-state
  guidance. Shared table links preserve access checks and resume the same seat.
  Keep its rules page useful through a quick start, anchors, concise examples
  and a glossary in German and English.
- Keep `/hausdepp/konto` within the shared account: show only the current
  account's completed-round statistics and paginated private history. Use actual
  stored results; distinguish empty history and failed loading. General account
  settings remain shared. Preserve descriptive round counts alongside the
  separately credited experience totals.
- Deliver the owner-approved 100 Hausdepp achievements and 24 fixed rank
  thresholds: 10 experience points per completed round, one-time achievement
  rewards of 10/25/50/100, Einstein at zero and Hausdepp at 5,000. Each rank has
  an original bilingual saying, including Newton's downhill/natural-laws line.
  Keep lasting rank separate from the round loser, and consolidate skipped
  ranks in a durable account-only notice. No detailed historical feat can be
  invented from a result lacking evidence; private peek evidence stays private.
- Count every non-Hausdepp seat in a completed round as a round win. Keep the
  standings private, filterable by 2–6 participants, and show tied win totals at
  the same place. Computers do not have ranked accounts.
- Support an optional HAUSDEPP tournament at the same table: each round loss
  appends one letter and the first eighth loss immediately ends the session.
  Preserve seats, rotate dealers clockwise, require a host action for the next
  deal, and persist every round once with a distinct result ID. Ending a session
  preserves completed-round credit; unfinished tournaments grant no final feats.
- Keep public ZDWA/Zilch discovery canonical and consistent with visible text.
  Hausdepp remains authenticated, noindex/nofollow and outside sitemaps; a
  reserved hostname or structured metadata does not grant public access.
- Keep development releases in version 2.x. Version 3 is reserved for the
  later major suite launch; a development version is not a claimed deployment.

## Brand Commitments

Preserve RollTheDice, ZDWA, Zilch and Mission Control naming. The requested new
dashboard design should feel distinctly nerdy and ambitious, with strong UX.
Hausdepp keeps its familiar house-game name. Its selected Stammtisch direction
uses the established walnut table, double-headed German Tell-pattern cards and
a red, black and ivory patterned back. It has its own visual identity, large
readable hand cards, and mobile-first portrait and landscape layouts. The
Stammtisch direction is chosen; implementation is still subject to UI and UX
acceptance, including card quality.

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
