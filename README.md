# RollTheDice

Two dice games. One account. A table for your next game night.

- [Play ZDWA — Zock die Wand an](https://zockdiewandan.online/)
- [Play Zilch — Zilch die Wand an](https://zilch.zockdiewandan.online/)

RollTheDice is a self-hostable, real-time game platform with German and English
interfaces. Play in your browser or install either game as a Progressive Web App.
Guests can play; accounts add personal history, statistics, achievements and
community features.

## The games

| | ZDWA | Zilch |
| --- | --- | --- |
| Dice | Five | Six |
| Goal | Build the best score across the score sheet | Bank 10,000 points before your opponent |
| Modes | Solo, two or three players, 2v2 teams; Normal or Hardcore | Two players, three CPU difficulty styles, or Solo Sprint |
| Solo challenge | Complete your own score sheet | Reach 10,000 in as few turns as possible |
| Progress | Ehrenberg-Marken, titles and rank badges | Separate Zilch points, ranks and achievements |
| Rules | [ZDWA guide](https://zockdiewandan.online/regeln) | [Zilch guide](https://zilch.zockdiewandan.online/regeln) |

Both games use server-authoritative dice and scoring. Zilch has its own rules
engine, results and rankings: its points never affect ZDWA standings.

## Contents

- [Quick start](#quick-start)
- [Playing together](#playing-together)
- [Accounts and progress](#accounts-and-progress)
- [Lobby chat](#lobby-chat)
- [Push notifications](#push-notifications)
- [Release notes and feedback](#release-notes-and-feedback)
- [Progressive Web Apps](#progressive-web-apps)
- [Local development](#local-development)
- [Architecture](#architecture)
- [Data and deployment](#data-and-deployment)
- [Documentation](#documentation)
- [Product delivery gate](#product-delivery-gate)

## Quick start

You need Docker with the Compose plugin and Git.

```bash
git clone https://github.com/Maetran/RollTheDice.git
cd RollTheDice
cp .env.example .env
```

For the first administrator, set `ROLLTHEDICE_ADMIN_USERNAME` and a strong
temporary `ROLLTHEDICE_ADMIN_PASSWORD` in `.env`. There is no default password.
Set `ROLLTHEDICE_ZILCH_ACCESS_MODE=public` to allow guests and accounts into Zilch.

```bash
docker compose up -d --build
```

Open [ZDWA](http://localhost:8000/), [Zilch](http://localhost:8000/zilch), or the
[API documentation](http://localhost:8000/docs).

After the first successful administrator login, remove the bootstrap password
from `.env` and recreate the container. Game data lives in the mounted
`./data` directory and survives container rebuilds.

For an internet-facing server, follow the
[deployment guide](docs/DEPLOYMENT.md) before exposing the application. It covers
HTTPS, secure cookies, the reverse proxy, trusted forwarding and registration
protection.

## Playing together

- Create a table quickly, or add an optional room code.
- Share an invitation link without exposing room codes or resume credentials.
- Rejoin your seat after a disconnect; active games also survive server restarts.
- Chat and send quick reactions in the game room.
- Watch eligible multiplayer tables in a read-only spectator view.
- Leave a game through **Pause**, **Return to Lobby**, or **Stay in Game**.
  Pausing preserves the table until its displayed deadline. Returning to the
  lobby ends the room for everyone without creating a completed result.
- Switch between games from lobbies and app pages. Live game rooms deliberately
  have no game switcher.

Waiting, running and paused rooms expire after one hour without a
server-accepted room action. They are then aborted without a completed result.

### Zilch at the table

Select scoring dice directly or use compact suggestions. Selections remain
reversible until **Roll again** or **Bank** commits them; **Combined score**
selects all currently scoring dice in one action. Hot Dice, the competitive
start roll and the final reply are handled by the server.

CPU opponents use the same dice and scoring path as humans, with conservative,
normal or aggressive decisions. Solo Sprint has no opponent or final reply;
its private metrics exclude pauses and server downtime.

Keyboard controls include 1–6 for dice, Space to roll, B to bank, and
Q/W/E/R/T/Z/U/I for visible suggestions. Shortcuts are disabled while typing or
using dialogs. See the [full Zilch rule contract](docs/ZILCH_RULES.md).

## Accounts and progress

One account works across both games, with shared language and comfort settings.
Usernames are immutable; administrators manage accounts and moderation.

**ZDWA** offers public profiles and rankings, Normal/Hardcore statistics, score
charts and completed-game replays. Achievement milestones award
**Ehrenberg-Marken**, which contribute to titles and star insignia. Newly earned
awards are celebrated individually, followed by a **LEVEL UP!** card for a
genuine title increase.

**Zilch** offers personal history, participant-only result reports, statistics
split by Solo/human/CPU play, and separate leaderboards. Its 74 namespaced
achievements cover scoring, risk, duels, CPU play, Solo efficiency and community
milestones. Personal awards contribute Zilch points; community milestones have a
fixed eligible audience and award no personal points. An animated rank-up card
follows earned award cards; the latest genuine rank transition also supports
one-time retrospective delivery for existing accounts.

Guest play creates no account-linked history, statistics, ranking or
achievements. Administrative result deletion is audited; affected derived
statistics and revocable awards are updated within the correct game's boundary.

Details: [account statistics and achievement lifecycle](docs/ACCOUNT_STATISTICS.md).

## Lobby chat

Both lobbies share one compact, expandable chat above their leaderboard section.

- Signed-in accounts can read and write; guests cannot.
- Each message identifies its sender and originating game: `zdwa` or `zilch`.
- Filters show ZDWA only, Zilch only, or both.
- A player's first active chat connection announces that they have connected.
- The server freezes each message's eligible account audience when it is sent.
  Later logins cannot reveal messages sent while an account was disconnected,
  signed out or had chat disabled.
- Eligible history is retained for three days; older messages and audience
  records are permanently deleted.
- Chat and lobby-only message popups have separate account settings, both on
  by default and shared across devices.

Flood protection allows **400 characters per message** and **five messages per
account per 30 seconds**, shared across tabs and reconnects. Administrators can
mute an account (read-only) or exclude it from lobby chat, and remove either
restriction.

Game-room chat is separate: text survives reconnects in the active room state;
quick reactions also appear in each connected participant's live chat.

## Push notifications

Push is optional. Register each device from account settings and grant browser
permission. Invitations, reminders and app update alerts have separate switches;
reminders and update alerts are **off by default**. The account-wide off switch removes every stored device
subscription, even when used from a browser that cannot itself receive push.

| | Player invitations | Daily play reminders |
| --- | --- | --- |
| Trigger | A seated player clicks **Notify players** in a public waiting room | The server, only after a separate opt-in |
| Eligibility | Room still has an open seat; recipient opted in and is not already seated | Account has played neither ZDWA nor Zilch today |
| Timing | Any time, including after the recipient has already played | A new random time between 17:00 and 21:00, Europe/Zurich |
| Limits | One attempt per sender per minute across both games; one dispatch per room per ten minutes | At most one reminder attempt per account per Swiss calendar day |
| Click destination | The specific room, with normal join/rejoin checks | The selected game's lobby |

A valid human roll or scoring action counts as playing; finishing a game is not
required. Login, chat, spectating and CPU actions do not count. Existing
completed results are also checked. Activity and opt-out are checked again
immediately before dispatch.

Reminder schedules are stable across restarts. There is no overnight catch-up,
and durable daily claims prevent repeat attempts after failures or preference
changes. Each game has **32 German/English variants**: pub-table banter for
Zilch, cheerful challenges for ZDWA. The rotation advances with reminder
attempts, so skipped days do not skip texts. If both products are registered,
they alternate; the chosen game's subscribed devices receive the same message.

Invitation senders get brief in-app feedback, not a push themselves, and never
see recipient identities. Private, full, started and Solo rooms do not send
invitations. Clicking an invitation to a full or started room does not
automatically switch the recipient into spectator mode.

Production requires the three VAPID settings in the
[Web Push operations guide](docs/DEPLOYMENT.md#web-push). Push-service acceptance
does not guarantee when a device displays a notification.

### App update alerts

After a successful production deployment, opted-in accounts receive a short
German or English release notice. Backend-only updates say **“Stability
improvements”**; usability releases have a reviewed feature summary, such as
**“New: lobby chat.”** Clicking opens the matching game's lobby.

Release publication is tied to a healthy deploy, never a process restart.
Durable claims allow one attempt per account and Git revision, across the chosen
game's registered devices. For shared releases, only the most recently registered
eligible product is selected, avoiding duplicate alerts from both PWAs.
The eligible audience and devices are frozen at publication; later opt-ins do
not receive old releases. Consent is checked again before each device, and
pending releases expire after 24 hours. Play activity and invitation filters do
not suppress separately enabled update alerts.

### Private invitation allowlist

Account settings offer **All players** (the existing default) or **Selected
players only**. Add up to 100 existing usernames, one per line. Only the actual
authenticated sender can satisfy the list, not another player seated at their
table. An empty allowlist blocks every invitation.

The private, one-way list is shared across games and devices and affects only
player invitations. It is the foundation for a future friendlist; mutual friend
requests and public friendship profiles are not implemented.

## Release notes and feedback

After a successful release, a short, player-friendly **What's new?** dialog
explains the most important changes in German or English. It appears in the
lobby or account, never over a game room. **Got it** saves the acknowledgement
to your account across both games and all devices; guests acknowledge in their
current browser. **Later** or Escape defers the message for that page visit.
If you've missed several updates, only the latest relevant release pops up.

Revisit the **last ten releases** under **Account → Settings → News & versions**.
The first announcement also introduces lobby chat, invitation allowlists and
optional PWA push notifications. In-app notes do not require browser push
permission and do not change any notification preference.

**Help & more details**, collapsed beneath the history, links to
[GitHub issues](https://github.com/Maetran/RollTheDice/issues) and the more detailed
[changelog](CHANGELOG.md). To report a problem, describe what happened, the game,
your device and steps to reproduce it. A GitHub account is required; never share
passwords or private room codes.

Authors maintain the bilingual title and bullets in `app/release-notice.json`
alongside the short push summaries. The deploy archives those exact texts after
the application is healthy; restarting the server does not publish a release.
See the [release authoring guide](docs/DEPLOYMENT.md#spielerfreundliche-release-notes).

## Progressive Web Apps

Each game has its own installable PWA, manifest and versioned assets.

- ZDWA stays on `zockdiewandan.online`, preserving existing installations,
  bookmarks and origin-bound resume data.
- Zilch uses `zilch.zockdiewandan.online` and a network-only service worker;
  private room and API data are not cached.
- `zdwa.zockdiewandan.online` is a redirect-only alias.
- Installed PWAs keep game switching inside their existing app window:
  ZDWA uses the same-origin `/zilch` compatibility routes; Zilch uses the private
  `/zdwa` bridge. Account navigation preserves the currently selected game.
- Ordinary browser navigation uses each game's canonical origin.
- Zilch provides version-aware update/install notices. Dismissed install
  prompts snooze for seven days unless a new version is deployed.

On iPhone and iPad, enable push from the installed home-screen app.

The canonical lobbies and public rule pages are indexable. Personal pages,
temporary rooms and compatibility bridges stay `noindex`; the SEO registry
generates the corresponding sitemaps.

## Local development

Use Python 3.12+ (CI uses 3.13) and Node.js 22.

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements-dev.txt
npm ci
npx playwright install chromium
```

Start the application:

```bash
ROLLTHEDICE_ZILCH_ACCESS_MODE=public \
  uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Environment variables are read by the application; Compose loads `.env`
automatically, while a direct Uvicorn launch requires exporting the variables
you need. Leave Turnstile and VAPID settings empty for ordinary local work.
Never use production push subscriptions for tests.

### Frontend workflow

Edit JavaScript and CSS in `frontend/`, then rebuild the committed assets:

```bash
npm run build:static
```

For changes only to static HTML, images or manifests, use `npm run sync:assets`.
The build creates deterministic content hashes for assets and service workers.
Generated files under `app/static/` must be committed alongside their sources.

### Quality checks

```bash
npm run lint
npm run test:backend
npm run test:browser
git diff --check
```

Browser tests start a separate server on port 8010 with a disposable SQLite
database. CI also runs security and dependency checks; see
[the quality workflow](.github/workflows/quality.yml).

## Architecture

FastAPI serves static pages, REST endpoints and WebSocket rooms. SQLAlchemy and
Alembic manage SQLite persistence. Browser code uses native JavaScript modules,
bundled with esbuild; no separate frontend application server is required.

```text
app/
  main.py                 HTTP routes, lifecycle and application assembly
  game_websocket.py       Shared realtime coordinator
  game_ws_*.py            Session, gameplay, social and admin actions
  game_registry.py        Game-specific adapters
  game_engine.py          ZDWA turn/scoring engine
  zilch_*.py              Zilch engine, CPU, Solo, results and achievements
  lobby_chat.py           Audience-scoped cross-game chat
  web_push.py             Subscriptions, preferences and room invitations
  push_reminders.py       Activity-aware daily scheduler
  push_reminder_copy.py   Bilingual reminder catalog
  game_activity.py        Minimal cross-game play-day evidence
  models.py               Accounts, sessions, game and community data
  product_hosts.py        Canonical origins and safe handoffs
  site_seo.py             Public-page registry, robots and sitemaps
  static/                 HTML, generated browser assets and PWA workers
frontend/                 Authored JavaScript and CSS
alembic/                  Versioned database migrations
tests/                    Backend and browser regression suites
scripts/                  Builds, validation, backups and deployment
docs/                     Rules, architecture and operations
data/                     Runtime SQLite/JSON data; never committed
```

The shared account, session, chat, rejoin and transport infrastructure does not
mix game rules or result processing. Completed results carry an explicit
`game_type`; private Zilch payloads never enter ZDWA aggregates.
See [the multi-game foundation](docs/MULTIGAME_FOUNDATION.md).

## Data and deployment

The SQLite database stores accounts, sessions, active-game recovery snapshots,
typed completed results, achievements, chat audiences and push subscriptions.
Legacy ZDWA leaderboard JSON files remain in `data/` for compatibility.

Back up the **entire data directory while the application is stopped**, including
SQLite WAL files when present. Do not replace or delete it during an update.
Completed results are finalized idempotently; active recovery state is retained
until persistence succeeds.

For production, use the guarded deployment workflow:

```bash
scripts/deploy_zdwa.sh
```

It checks the remote worktree, briefly stops the service for a consistent backup,
fast-forwards the selected branch, verifies asset versions, rebuilds the
container and checks `/api/health`. After success it retains the five newest
deployment backups. Startup applies Alembic migrations before readiness.

The documented deployment uses one application process behind Nginx and a
loopback-bound container port. The two canonical origins share that process and
one data directory. Do not add application workers without redesigning the
process-local realtime room ownership.

See [deployment, host setup and rollback](docs/DEPLOYMENT.md) for the complete
preflight and production verification procedure.

## Documentation

- [Player rules: ZDWA](https://zockdiewandan.online/regeln) ·
  [Zilch](https://zilch.zockdiewandan.online/regeln)
- [Zilch rule contract](docs/ZILCH_RULES.md)
- [Multi-game architecture](docs/MULTIGAME_FOUNDATION.md)
- [Statistics, achievements and ranks](docs/ACCOUNT_STATISTICS.md)
- [Localization conventions](docs/LOCALIZATION.md)
- [Deployment and operations](docs/DEPLOYMENT.md)

## Product delivery gate

Every visible change ships as a complete German/English product increment:
update this README, update player rules when behavior changes, and keep
canonical URLs, Open Graph metadata and indexing policy correct.

The mandatory [product delivery standard](docs/PRODUCT_DELIVERY.md) is enforced
through `npm run lint` and CI. Backend tests and, for visible changes, browser
tests are required before committing and deploying.
