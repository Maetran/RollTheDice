# RollTheDice

RollTheDice is a lightweight multiplayer dice game with a FastAPI backend and a static HTML/CSS/JS frontend. It supports German and English, single-player, 2-player, 3-player, 2v2 team games, Hardcore mode, chat, emoji reactions, leaderboards, account achievement milestones, and read-only replay views for completed games.

ZDWA is the public game. The repository also contains an intentionally private,
playable Zilch preview: its own six-dice, 10,000-point state,
server-authoritative scoring, Quick Holds, banking, and competitive start-roll/
final-reply handling. By default, only the authenticated admin
account whose normalized username is `mani` can open it. A second private test
account can be admitted only through the explicit
`ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES` allowlist; it receives no admin rights.
Play modes `solo | cpu | multiplayer` and participant types `human | cpu` stay
separate from WebSocket connections. The preview supports two authenticated
humans in `multiplayer`, or one authenticated host against a real `cpu`
participant in `cpu` mode. The CPU has no account, session, resume token, or
WebSocket; it uses the same server-side dice and scoring path as a human and
differs only through its conservative, normal, or aggressive decision policy.
It also supports a genuine one-human `solo` Sprint: the fixed, versioned
objective `reach_10000_fewest_turns` (v1) starts directly with a normal turn,
ends at at least 10,000 banked points, and records turns, rolls, Zilchs, Hot
Dice, highest banked round, and active time. There is no opponent, CPU,
start roll, final reply, or fabricated winner/tie in Solo. A confirmed
abandonment remains a private `abandoned` result; pause and restart downtime
do not count as active time. Future comparison order is turns, rolls, Zilchs,
then active duration (all ascending). Private, server-calculated Zilch
statistics keep Solo, human-vs-human, and human-vs-CPU separate. The three
private leaderboards are the best compatible Solo Sprint per active account,
human-vs-human wins, and wins against each individual CPU strategy; they never
feed a ZDWA ranking.
Finished private Zilch games are stored as a separate, versioned result payload
with a private read-only history; they do not enter any ZDWA scorecard, replay,
statistic, achievement, or leaderboard path. Private Zilch awards use their
own protected namespace instead: they award neither **Ehrenberg-Marken** nor
ZDWA titles, ranks, stars, profile values, or public ranking positions. They
are considered only when the Zilch finalizer explicitly registers a newly
persisted authoritative result after the award rollout; older history is never
rescanned or backfilled. They can be revoked when the source result is deleted
and remain visible only in Zilch context. The protected Zilch app has its own
lobby, game view, history, result report, statistics, leaderboards, awards,
private player-award context, and in-app rule guide. Its
CSS-only wood-table, paper-card, and dice direction is isolated from ZDWA.
Manual dice selection, additional Solo objectives/challenges, further Zilch
award categories, and public release are deliberately deferred.

Localization conventions and terminology are documented in [docs/LOCALIZATION.md](docs/LOCALIZATION.md).
The private Zilch award boundary, evidence source, delivery lifecycle, and
version-1 catalog are documented in
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
- Achievement milestones for special scoring plays, exact final scores, multiplayer victory margins, daily streaks, office-hour game counts, exact upper-section 60s, and Hardcore progress; every achievement awards 1–10 **Ehrenberg-Marken**, the achievement currency named after Ehrenberg in Reutte. When a game unlocks several achievements, each one is presented and acknowledged separately before the final standings; a genuine title increase then receives its own celebratory **LEVEL UP!** card. Profiles show the total, and the player overview includes a sortable Ehrenberg-Marken ranking. The calculated total also assigns an account-only title from Newbie through Godmode with star insignia, shown consistently beside player names in the lobby, live game, chat, profiles, replays, and rankings. Clicking an insignia opens the rank legend at `/rangabzeichen` (as an overlay during live play). Rollout-sensitive gameplay goals, including multiplayer and upper-section-60 goals, start from their introduction while score-based goals and Hardcore game counts remain historical
- Private Zilch awards are a separate, preview-only collection: they are based
  on newly persisted, validated Zilch results registered by the finalizer, have
  their own private delivery and acknowledgement state, are revocable with
  their source result, and never award Ehrenberg-Marken or alter ZDWA titles,
  profiles, rankings, statistics, achievements, or leaderboards
- Progressive Web App support with content-hashed asset and service-worker versions
- Readiness endpoint and container healthcheck for migration-safe deployments
- Docker Compose setup for local machines, servers, and Raspberry Pi

## Public page URLs

User-facing navigation uses short routes without implementation details:

- `/` lobby
- `/spiel/{game_id}` active player view
- `/zilch` protected internal Zilch lobby (not public or indexable)
- `/zilch/spiel/{game_id}` protected Zilch game view (not public or indexable)
- `/zilch/historie` protected own Zilch history (not public or indexable)
- `/zilch/ergebnis/{game_id}` protected, read-only Zilch result report (not public or indexable)
- `/zilch/statistiken` protected own Zilch statistics (not public or indexable)
- `/zilch/bestenlisten` protected Zilch leaderboards (not public or indexable)
- `/zilch/erfolge` protected private Zilch awards (not public or indexable)
- `/zilch/spieler/{username}` protected Zilch-context player-award view (not
  public or indexable)
- `/zilch/regeln` protected in-app Zilch rule guide (not public or indexable)
- `/spiel/{game_id}/zuschauen` spectator view
- `/regeln`, `/rangabzeichen`, `/spieler`, `/spieler/{username}`, `/konto`, and `/admin`
- `/ergebnis/{game_id}` completed-game view
- `/robots.txt` crawler rules and `/sitemap.xml` for the stable, indexable public pages

JavaScript, styles, and icons remain under `/static/`; these asset paths are not
used for browser navigation. Legacy `*.html` links redirect to the matching
public route so existing bookmarks and older installed app versions keep working.
The private Zilch routes above are server-authorized implementation routes,
remain outside public navigation and the sitemap, and always send `noindex`.

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

Self-registration is protected by persistent SQLite rate limits without any
extra service. For a public deployment, create a Cloudflare Turnstile widget
for the production hostname and set both `ROLLTHEDICE_TURNSTILE_SITE_KEY` and
`ROLLTHEDICE_TURNSTILE_SECRET` in `.env`. Local development leaves both values
empty and does not show a CAPTCHA. A partial Turnstile configuration is rejected
at startup so registration cannot silently run with broken protection.

Zilch is not a public feature. Keep `ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES`
empty in normal production operation. An authorized `Mani` account can test a
private Solo Sprint or CPU game alone. For an explicitly private two-browser human test, set
the variable to a comma-separated list of normalized account usernames; those
accounts gain only Zilch-preview access, not an admin role. Admin `Mani`
continues to require both the normalized name and `is_admin=true`, even if
someone mistakenly puts `mani` in the allowlist. CPU action pacing is an
operator-only setting: `ROLLTHEDICE_ZILCH_CPU_DELAY_SECONDS` defaults to 0.55
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
their authenticated human seat; process downtime and explicit pauses are
excluded from the stored active duration.

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
├── requirements.txt
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI assembly and thin HTTP/WebSocket routes
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
│       ├── sw.js            # Service worker
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
asset versions. Zilch JavaScript and CSS are deliberately not part of the public
service-worker precache: the browser obtains them only after the protected shell
has been served, while `/zilch` routes remain network-only so a logout or policy
change cannot reveal a stale private view.

## Multi-game foundation

The shared account, session cookie, roles, player identities, chat, rejoin,
WebSocket transport, and active-game persistence can serve more than one game.
Game-specific state creation, join/start setup, gameplay actions, lobby progress,
snapshots, and terminal-result finalization are selected through a small
registry. Existing ZDWA flows remain behind their adapter; Zilch has separate
modules and cannot call ZDWA scoring or completion code. `CompletedGame` now
stores an explicit `game_type`; all older records are migrated to `zdwa`, while
private Zilch results use a versioned `zilch-house-v1` JSON payload. The private
Zilch Alpha is deliberately `noindex`, guarded on every relevant page, API,
detail lookup, and WebSocket connection, and defaults to admin `Mani` only
unless its explicit preview allowlist is configured.

The architecture boundary is documented in
[docs/MULTIGAME_FOUNDATION.md](docs/MULTIGAME_FOUNDATION.md); the confirmed
internal rule contract is in [docs/ZILCH_RULES.md](docs/ZILCH_RULES.md). Neither
document is a public Zilch rules page. The private `/zilch/regeln` view is a
localized in-app projection of that contract; Zilch remains outside the
player-facing ZDWA rules and public SEO.

## Plain Docker

```bash
docker build -t rollthedice .
docker run -d --name rollthedice --restart=unless-stopped \
  -p 8000:8000 \
  -v "$(pwd)/data:/app/data" \
  rollthedice
```
