# RollTheDice

RollTheDice is a lightweight multiplayer dice game with a FastAPI backend and a static HTML/CSS/JS frontend. It supports German and English, single-player, 2-player, 3-player, 2v2 team games, Hardcore mode, chat, emoji reactions, leaderboards, account achievement milestones, and read-only replay views for completed games.

ZDWA is the established game. The repository also contains the public
**Zilch die Wand an**: its own six-dice, 10,000-point state,
server-authoritative scoring, direct dice selection, banking, and competitive start-roll/
final-reply handling. Production runs with
`ROLLTHEDICE_ZILCH_ACCESS_MODE=public`, so guests and active accounts can
open Zilch. Guests can start and play a table, but receive no account-linked
history, statistics, leaderboard row, or achievements. The older
`ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` allowlist belongs only to the fail-closed
`preview` rollback mode and never grants admin rights.
Play modes `solo | cpu | multiplayer` and participant types `human | cpu` stay
separate from WebSocket connections. Zilch supports two humans (guests or
accounts) in `multiplayer`, or one guest/account host against a real `cpu`
participant in `cpu` mode. The CPU has no account, session, resume token, or
WebSocket; it uses the same server-side dice and scoring path as a human and
differs only through its conservative, normal, or aggressive decision policy.
Their public base bank goals are 500, 650, and 850 points respectively before
the same bounded score- and dice-position adjustments: conservative remains
cautious, normal secures solid rounds sooner, and aggressive still pursues
larger rounds without routinely gambling away a playable score.
It also supports a genuine one-human `solo` Sprint: the fixed, versioned
objective `reach_10000_fewest_turns` (v1) starts directly with a normal turn,
ends at at least 10,000 banked points. The server retains turns, rolls, Zilchs,
Hot Dice, highest banked round, and active time only as private completed-Solo
metrics for compatible standings; the live room deliberately keeps its score
view to the paper score sheet and current Solo target instead of showing
running counters. There is no opponent, CPU, start roll, final reply, or
fabricated winner/tie in Solo. A confirmed abandonment remains a private
`abandoned` result; pause and restart downtime do not count as active time.
Future comparison order is turns, rolls, Zilchs, then active duration (all
ascending). Account-bound, server-calculated Zilch statistics keep Solo,
human-vs-human, and human-vs-CPU separate, but deliberately curate useful
completed-game summaries and standings rather than exposing every retained
engine counter. The public leaderboards cover the best compatible Solo Sprint
per active account, human-vs-human wins, wins against each individual CPU
strategy, and the separate Zilch achievement score; they never feed a ZDWA
ranking.
Finished Zilch games are stored as a separate, versioned result payload with a
personal read-only history for linked accounts. A detail is readable only by
its linked human participants, and the HTTP projection omits internal user IDs.
Guest results remain in the live session but are intentionally not exposed as
an account history or result URL. Zilch results do
not enter any ZDWA scorecard, replay,
statistic, achievement, or leaderboard path. Zilch awards use their
own protected namespace instead: personal awards are worth 1–10 Zilch points
and contribute to a Zilch-only rank. They award no **Ehrenberg-Marken** and
never alter ZDWA titles, ranks, stars, profile values, or public ranking
positions. They
show their complete Zilch rank legend, including stars and minimum points,
directly in the Zilch awards collection; the legend remains fully separate
from ZDWA rank badges. In the Zilch lobby, live rooms, and leaderboards, an
authenticated player's current Zilch badge appears beside their username; that
username opens the player's Zilch collection, while the current account opens
its own collection. Reaching a new Zilch rank also unlocks a distinct, animated
rank-up card after its award cards; the server reconstructs and queues each
account's last genuine upward transition once, so existing players receive the
same celebration on their next private Zilch visit. They
are considered only when the Zilch finalizer explicitly registers a newly
persisted authoritative result after the original award rollout. Older,
unregistered history is never scanned or backfilled; a versioned catalog
update may resynchronize only the explicit evidence that was already accepted
by that rollout. During that bounded pass, each completed registration loads
only its exact, still-present typed source result by the registered game ID and
enriches its evidence with newly derivable facts. It never enumerates the
general `CompletedGame` history, and any source, seat, user, or existing-fact
mismatch aborts the atomic rollout. Awards can be revoked when the source result is deleted and
remain visible only in Zilch context. The Zilch app has its own lobby, game
view, history, result report, statistics, leaderboards, awards, a safe public
player-award context, and in-app rule guide. Its account mirrors the ZDWA
structure with separate private statistics, awards, and settings tabs; language
and password controls stay with the account rather than the game room. Its
first-party wood-table texture, paper-card, and dice direction is isolated from ZDWA.
The Zilch lobby mirrors ZDWA's identity pattern, while the compact
game header keeps Lobby, ZDWA, and Rules explicit. Logout is deliberately
available only inside the Zilch account page. The ZDWA↔Zilch switch keeps the
same isolated dimensions, padding, and type size in both page and game headers;
on narrow phones both sides use its square icon-only form.
The compact setup starts a default game with one click; advanced room protection
stays optional, and a completed game can be restarted directly with the same mode.
In a two-person Zilch room, **Share game** creates a clean invitation link for
the other human seat. It deliberately never includes a room code, account
session, or resume credential; protected rooms still ask invitees for their code.
The Zilch lobby also lists live human-versus-human tables with both players.
**Watch** opens their read-only live view: spectators can follow the board and
the social room, while rolling, holding, and banking remain limited to the two
seated players. CPU, Solo, waiting, and finished tables never expose a spectator
seat; protected live tables still require their room code.

Production keeps `https://zockdiewandan.online` as ZDWA's canonical origin so
existing installed PWAs, bookmarks, and origin-bound resume data remain valid.
`https://zdwa.zockdiewandan.online` is only an HTTPS alias and redirects back to
that origin. Zilch is served from `https://zilch.zockdiewandan.online` with clean
root-relative routes; the legacy `/zilch/...` routes on the main origin remain
available during the migration. The Apex and Zilch origins proxy the same
application process and mounted `data/` directory; the `zdwa` alias only
redirects. Existing account sessions are promoted
to a separate parent-domain cookie through a fixed, allowlisted handoff without
creating a second database session. Zilch now has its own installable PWA on
its canonical origin, with a separate manifest and a network-only service
worker that never caches private rooms or API data. It notifies users about a
new deployed version and offers installation again after a new version even if
the prior prompt was dismissed (otherwise it snoozes for seven days). The ZDWA
PWA stays unchanged: when it opens Zilch, it uses the same-origin `/zilch`
compatibility route so iOS does not wrap the handoff in an external browser
sheet; conversely, an installed Zilch PWA opens the private, same-origin
`/zdwa` bridge so its return to ZDWA remains in the app window. That bridge
keeps Zilch's network-only worker, is `noindex`, and is never used by ordinary
browser navigation, which still uses ZDWA's canonical Apex origin. The public
Zilch lobby and rule guide are canonical, indexable pages.
A player selects scoring dice directly or
uses one of up to eight compact, single-group suggestions (for example one or
two ones, one or two fives, a triple, or a four-of-a-kind). Mixed combinations
are not summarized into suggestion cards, while a deliberately assembled valid
selection remains server-verified. For twos through sixes, every matching die
after the third doubles that face's triple value; ones keep their fixed
1,000-point triple and any extra held ones stay individual 100-point dice,
while three pairs score 1,500. The selection stays reversible
until **Roll again** or **Bank** validates and commits it atomically. Previously
held dice remain immutable; invalid dependent dice are removed when a selection
is reduced. The **Combined score** action beneath the score sheet selects all
currently scoring dice in one tap; when a named special roll such as three
pairs produces Hot Dice, the action names that roll and adds its Free Roll
stamp, while remaining optional until the next action. **Current roll** shows
the already-held points and the exact currently
selected score separately; their sum is the value that would be banked, never
a predicted combined selection. In a live two-person room, both sides see the
same server-confirmed recommendations and current-roll tile, including the
active player's committed round points and current valid draft; only the active
player can change that draft, and it remains reversible until they roll again
or bank. On the active game page, keys 1–6 toggle the
corresponding selectable dice, Q/W/E/R/T/Z/U/I
activate the visible suggestions in order, Space performs the enabled start or
regular roll, and B banks only when permitted. A Zilch keeps the authoritative
final rack visible until the next actual roll. CPU rolls use the same landing
presentation, with readable pauses between decisions. Form fields, open dialogs,
and modifier chords suppress these
shortcuts. Stacked, internally scrollable spiral score sheets with ruled paper
and offset page edges keep the active player in front and the opponent total visible. The resulting
turns are recorded there, while chat and short-lived emoji reactions remain separate
from the score history and are echoed to every connected participant,
including the sender.
Each third consecutive Zilch deducts 500 points (the third, sixth, ninth, and
so on), never below zero; banking points resets that personal streak.

Localization conventions and terminology are documented in [docs/LOCALIZATION.md](docs/LOCALIZATION.md).
The private Zilch award boundary, evidence source, delivery lifecycle, and
expanded points/rank catalog are documented in
[docs/ACCOUNT_STATISTICS.md](docs/ACCOUNT_STATISTICS.md).

## Features

- Responsive lobby and game room with fixed mobile controls and sticky chat
- Anonymous live count of connected visitors across lobby, games, spectator views, and other app pages
- REST API for lobby, games, leaderboard, and replay data
- WebSocket game room for rolling, scoring, chat, spectators, and corrections
- Restart-safe live games plus typed completed-game persistence in `./data`;
  ZDWA aggregates and private Zilch results/statistics/leaderboards stay
  separate
- User accounts, admin management, public profiles, search, and player rankings
- Audited deletion of invalid ZDWA results with automatic statistic updates;
  private Zilch deletion never mutates ZDWA aggregates and revokes only the
  affected private Zilch-derived award state
- Self-registration from the lobby with immutable usernames
- Personal statistics split into Normal, Hardcore, and overall results, with a selectable score chart and median
- Achievement milestones for special scoring plays, exact final scores, multiplayer victory margins, daily streaks, office-hour game counts, exact upper-section 60s, and Hardcore progress; every achievement awards 1–10 **Ehrenberg-Marken**, the achievement currency named after Ehrenberg in Reutte. When a game unlocks several achievements, each one is presented and acknowledged separately before the final standings; a genuine title increase then receives its own celebratory **LEVEL UP!** card. Completed-game replays show the achievements that were durably and unambiguously unlocked by that exact game, grouped by participant; account-only milestones and unlocks predating source-game attribution are deliberately not assigned retroactively. Profiles show the total, and the player overview includes a sortable Ehrenberg-Marken ranking. The calculated total also assigns an account-only title from Newbie through Godmode with star insignia, shown consistently beside player names in the lobby, live game, chat, profiles, replays, and rankings. Clicking an insignia opens the rank legend at `/rangabzeichen` (as an overlay during live play). Rollout-sensitive gameplay goals, including multiplayer and upper-section-60 goals, start from their introduction while score-based goals and Hardcore game counts remain historical
- Zilch awards are a separate collection: 74 namespaced
  goals cover first games, scoring, combinations, risk, career progress,
  duels, CPU play, Solo efficiency, and community milestones. Personal goals
  award 1–10 Zilch points and a Zilch-only rank; community milestones award
  exactly 0 points and go only to eligible accounts present when the shared
  threshold is reached. Personal source-based awards are revocable with their
  source result, while reached community milestones retain their frozen
  recipient set. A durable per-game participant ledger preserves the historical
  minimum-one-game eligibility independently of later result deletion. A
  separately acknowledged, animated rank-up card follows earned award cards;
  each account's latest genuine rank transition is reconstructed once for an
  equally visible retrospective delivery. Catalog
  upgrades enrich and resynchronize only already registered Zilch evidence by
  loading each exact, still-present typed source by its registered ID; they
  never scan general completed-game history. Nothing awards Ehrenberg-Marken
  or alters ZDWA titles,
  profiles, rankings, statistics, achievements, or leaderboards
- Isolated Progressive Web Apps with content-hashed asset and service-worker
  versions; Zilch update/install notices keep a seven-day dismissal snooze per
  deployed version without caching private game data
- Readiness endpoint and container healthcheck for migration-safe deployments
- Docker Compose setup for local machines, servers, and Raspberry Pi

## Public page URLs

User-facing navigation uses short routes without implementation details:

- `https://zockdiewandan.online/` canonical ZDWA origin
- `https://zdwa.zockdiewandan.online/` redirect-only ZDWA alias
- `https://zilch.zockdiewandan.online/` public Zilch origin; the Zilch paths
  listed below lose their `/zilch` prefix on this host

- `/` lobby
- `/spiel/{game_id}` active player view
- `/zilch` public Zilch lobby (canonical host: `zilch.zockdiewandan.online/`)
- `/zilch/anmelden` direct, noindex sign-in and registration entry for Zilch
- `/zilch/spiel/{game_id}` protected Zilch game view (`noindex`)
- `/zilch/spiel/{game_id}/zuschauen` protected, read-only Zilch spectator view (`noindex`)
- `/zilch/historie` protected own Zilch history (`noindex`)
- `/zilch/ergebnis/{game_id}` participant-bound, read-only Zilch result report (`noindex`)
- `/zilch/statistiken` protected own Zilch statistics (`noindex`)
- `/zilch/bestenlisten` public Zilch leaderboards (`noindex`)
- `/zilch/konto` protected Zilch account with private statistics, awards, and settings
- `/zilch/erfolge` protected private Zilch awards (`noindex`)
- `/zilch/spieler/{username}` public Zilch-context player-award view without result evidence (`noindex`)
- `/zilch/regeln` public in-app Zilch rule guide (canonical on the Zilch subdomain)
- `/spiel/{game_id}/zuschauen` spectator view
- `/regeln`, `/rangabzeichen`, `/spieler`, `/spieler/{username}`, `/konto`, and `/admin`
- `/ergebnis/{game_id}` completed-game view
- `/robots.txt` crawler rules and `/sitemap.xml` for the stable, indexable public pages

JavaScript, styles, and icons remain under `/static/`; these asset paths are not
used for browser navigation. Legacy `*.html` links redirect to the matching
public route so existing bookmarks and older installed app versions keep working.
Personal Zilch routes are server-authorized implementation routes and always
send `noindex`. The Zilch root and `/regeln` are the only Zilch URLs in the
Zilch-host sitemap.

## Product delivery gate

Every user-visible change ships with documentation, localization, and search
visibility checks. The mandatory process is defined in
[docs/PRODUCT_DELIVERY.md](docs/PRODUCT_DELIVERY.md): update this README,
update the player-facing rules when gameplay changes, translate every visible
string, and register every evergreen public page in the SEO registry. The
automated `scripts/check_product_delivery.py` runs as part of `npm run lint`
and CI, so sitemap, robots, canonical metadata, Open Graph data, achievement
translations, and documentation cannot silently drift apart.

## Requirements

- Docker with the Compose plugin
- Git, if cloning from GitHub
- Optional for local development: Python 3.12+ or 3.13 with the packages from `requirements.txt`

## Run With Docker Compose

```bash
git clone https://github.com/Maetran/RollTheDice.git
cd RollTheDice
docker compose up -d --build
```

For the first administrator, copy `.env.example` to `.env`, set a temporary
username and password, and start the container. There is no default admin
password. After the first successful login, remove
`ROLLTHEDICE_ADMIN_PASSWORD` from `.env`. Set
`ROLLTHEDICE_COOKIE_SECURE=1` for a public HTTPS deployment.

For the production product-host split also set the following values before the
container is recreated:

```dotenv
ROLLTHEDICE_COOKIE_DOMAIN=zockdiewandan.online
ROLLTHEDICE_SITE_ORIGIN=https://zockdiewandan.online
ROLLTHEDICE_ZILCH_ORIGIN=https://zilch.zockdiewandan.online
FORWARDED_ALLOW_IPS=172.18.0.1
```

The last value must be the actual direct Docker bridge gateway observed on the
server, not a client network or `*`. The production-only Compose override keeps
port 8000 bound to loopback. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for
the preflight, certificate activation, rollback, and verification sequence.

Self-registration is protected by persistent SQLite rate limits without any
extra service. For a public deployment, create a Cloudflare Turnstile widget
for the production hostname and set both `ROLLTHEDICE_TURNSTILE_SITE_KEY` and
`ROLLTHEDICE_TURNSTILE_SECRET` in `.env`. Local development leaves both values
empty and does not show a CAPTCHA. A partial Turnstile configuration is rejected
at startup so registration cannot silently run with broken protection.

Zilch is public. Production sets `ROLLTHEDICE_ZILCH_ACCESS_MODE=public`; this
allows guest play without weakening session, CSRF, WebSocket-origin, room-code,
or result-ownership checks. Guest CPU/Solo hosts receive a random, session-local
capability whose hash alone is persisted; it only permits their one human seat.
Keep `ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` empty in normal production operation.
It is used only with the deliberately restrictive `preview` rollback mode,
where explicitly named test accounts gain Zilch access without receiving an
admin role. CPU action pacing is an
operator-only setting: `ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS` defaults to 0.9
seconds and is bounded to 0–5 seconds; it never changes dice odds or scoring.

Open:

- Lobby: `http://localhost:8000/`
- API docs: `http://localhost:8000/docs`

On a server or Raspberry Pi, replace `localhost` with the device IP.

## Update

```bash
git pull
docker compose up -d --build
```

Game data is stored in `./data` and is preserved across rebuilds. Waiting and
running games are restored after an application restart; connected human
players appear offline until they rejoin with their locally stored resume token.
A CPU is never a connection and never appears offline. Its process-local runner
is not serialized; after recovery or rejoin the authoritative state schedules
at most one eligible, unpaused CPU turn. A terminal game is first retained as
an active recovery snapshot, then stored idempotently as a typed result, and
removed from active storage only after the write succeeds. Finished Zilch games
use their own private `zilch-house-v1` payload and never enter ZDWA history.
Solo active states persist their fixed Objective/metrics and resume only with
their linked account seat or the guest's local resume/capability session; process downtime and explicit pauses are
excluded from the stored active duration.

Waiting, running, and paused rooms share a one-hour inactivity deadline. If
no server-accepted room action occurs in that time, the room is aborted,
connected players and spectators receive its terminal snapshot, and the active
record is removed without creating a completed result.

Production deployment details, including the IONOS SSH target and mandatory
leaderboard backup rules, are documented in `docs/DEPLOYMENT.md`. Use
`scripts/deploy_zdwa.sh` for the guarded production deploy.

## Local Development

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Install `requirements-dev.txt` when running the HTTP integration tests.

Useful checks:

```bash
python3 -m py_compile app/main.py app/rules.py
node --check app/static/scoreboard.js
node --input-type=module --check < app/static/room.js
python3 scripts/sync_static_versions.py --check
pytest --cov --cov-report=term-missing
ruff check .
bandit -q -r app scripts -c pyproject.toml
vulture app scripts tests --min-confidence 80
pip-audit -r requirements-dev.txt --progress-spinner off
npm run test:browser
git diff --check
```

## Project Structure

```text
RollTheDice/
├── Dockerfile
├── docker-compose.yml
├── manifest.webmanifest
├── manifest-en.webmanifest
├── zilch-manifest.webmanifest
├── zilch-manifest-en.webmanifest
├── requirements.txt
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI assembly and thin HTTP/WebSocket routes
│   ├── product_hosts.py     # Fixed product origins and safe cross-host handoff paths
│   ├── site_seo.py          # Public-page registry plus robots/sitemap rendering
│   ├── models.py            # User, session, active/completed-game, and participant models
│   ├── database.py          # Database configuration and Alembic upgrades
│   ├── active_games.py      # Restart-safe snapshots of waiting and running games
│   ├── auth.py              # Password, session, and role logic
│   ├── api_auth.py          # Login, password, and admin-user API
│   ├── api_users.py         # Profiles, stats, search, ranking, and assignments
│   ├── game_history.py      # Typed completed results and legacy ZDWA JSON import
│   ├── game_state.py        # Live-game state, boards, timeouts, and connection state
│   ├── game_engine.py       # Turn validation, rolls, suggestions, and score projections
│   ├── game_websocket.py    # WebSocket coordinator; action handlers live in game_ws_*.py
│   ├── game_results.py      # ZDWA result projection and statistic persistence
│   ├── zilch_results.py     # Private, versioned Zilch result payload/projection
│   ├── zilch_cpu_strategy.py # Pure conservative/normal/aggressive CPU policy
│   ├── zilch_cpu_runner.py  # Cancellable trusted CPU-turn runner
│   ├── zilch_solo_objective.py # Pure versioned Solo Sprint objective/metrics
│   ├── zilch_statistics.py  # Private Zilch-only statistics and leaderboard service
│   ├── leaderboard_service.py # Leaderboard aggregation and replay/profile reads
│   ├── leaderboard_storage.py # Locked legacy-JSON compatibility storage
│   ├── rules.py             # Server-side subtotal and total calculations
│   └── static/
│       ├── index.html       # Lobby
│       ├── room.html        # Game room shell
│       ├── game_view.html   # Read-only leaderboard replay view
│       ├── rules.html       # Player-facing game rules
│       ├── emoji.js         # Emoji reactions
│       ├── room.js          # Generated, bundled game-room client
│       ├── scoreboard.js    # Scoreboard renderer and read-only replay renderer
│       ├── lobby.css        # Generated, schlankes Styling für die Landing-Page
│       ├── style.css        # Generated, minified shared styling für Spiel-/Kontoseiten
│       ├── sw.js            # ZDWA cache-first service worker
│       ├── zilch-sw.js      # Zilch network-only service worker
│       ├── favicon.png
│       └── icons/
├── frontend/                # Authored JS/CSS split by lobby, room, i18n, and style concern
├── alembic/                 # Versioned database schema migrations
├── scripts/
│   ├── deploy_zdwa.sh       # Guarded production deployment
│   ├── install_nginx_config.sh # Validated installation of production proxy limits
│   ├── prune_data_backups.sh # Keeps five deploy backups; manual use is dry-run-first
│   ├── build-static.mjs     # Bundles/minifies frontend sources into app/static
│   ├── check_product_delivery.py # Documentation, localization, and SEO delivery gate
│   └── sync_static_versions.py # Content-hashed PWA/asset version synchronization
└── data/                    # Persistent runtime data, ignored by Git
    ├── leaderboard_recent.json
    ├── leaderboard_alltime.json
    ├── stats.json
    └── rollthedice.sqlite3  # Accounts, active games, sessions, and completed-game history
```

## Data

The application writes leaderboard JSON files and its SQLite database to
`./data`. Copy the complete directory only while the container is stopped; the
deployment script handles this automatically. Existing JSON snapshots are
imported idempotently by `game_id`. Historical user statistics can only include
the snapshots that still exist in the capped legacy lists.

After changing authored files under `frontend/`, run `npm run build:static`.
It bundles and minifies the browser assets, then writes one deterministic content
version to all asset references and the service-worker cache. For direct changes
to static HTML, images, or a manifest, `npm run sync:assets` is sufficient. CI
rejects stale generated files; CI and the deployment guard reject unsynchronized
asset versions. The protected Zilch shell uses the local
`app/static/zilch-wood-table-v1.jpg` texture; it must remain a bundled first-party
asset so the game room never depends on an external image host. A finished Zilch
room keeps the score sheet and result panel equally sized and exposes every next
destination as a full-width action instead of a raw inline link. Newly unlocked
private Zilch awards are attributed by their durable source game ID and only
appear in that live end screen; older pending deliveries remain in the normal
reload-safe award queue. Zilch JavaScript
and CSS are deliberately not part of the ZDWA
service-worker precache: the browser obtains them only after the protected shell
has been served, while Zilch routes remain network-only so a logout or policy
change cannot reveal a stale account view.

## Multi-game foundation

The shared account, session cookie, roles, player identities, chat, rejoin,
WebSocket transport, and active-game persistence can serve more than one game.
Game-specific state creation, join/start setup, gameplay actions, lobby progress,
snapshots, and terminal-result finalization are selected through a small
registry. Existing ZDWA flows remain behind their adapter; Zilch has separate
modules and cannot call ZDWA scoring or completion code. `CompletedGame` now
stores an explicit `game_type`; all older records are migrated to `zdwa`, while
personal Zilch results use a versioned `zilch-house-v1` JSON payload. Zilch is
public for guest and account play; account-bound results, history, statistics,
awards, and result lookup stay private. Only its canonical lobby and rule guide
are indexable; all rooms and personal routes remain `noindex`.

The architecture boundary is documented in
[docs/MULTIGAME_FOUNDATION.md](docs/MULTIGAME_FOUNDATION.md); the confirmed
internal rule contract is in [docs/ZILCH_RULES.md](docs/ZILCH_RULES.md). Neither
document is the authoritative game contract. The public `/regeln` view is its
localized in-app projection. Personalized Zilch pages stay out of the sitemap
and public SEO.

## Plain Docker

```bash
docker build -t rollthedice .
docker run -d --name rollthedice --restart=unless-stopped \
  -p 8000:8000 \
  -v "$(pwd)/data:/app/data" \
  rollthedice
```
