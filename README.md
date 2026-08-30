# RollTheDice

RollTheDice is a lightweight multiplayer dice game with a FastAPI backend and a static HTML/CSS/JS frontend. It supports German and English, single-player, 2-player, 3-player, 2v2 team games, Hardcore mode, chat, emoji reactions, leaderboards, and read-only replay views for completed games.

Localization conventions and terminology are documented in [docs/LOCALIZATION.md](docs/LOCALIZATION.md).

## Features

- Responsive lobby and game room with fixed mobile controls and sticky chat
- Anonymous live count of connected visitors across lobby, games, spectator views, and other app pages
- REST API for lobby, games, leaderboard, and replay data
- WebSocket game room for rolling, scoring, chat, spectators, and corrections
- Restart-safe waiting/running games plus persistent completed games, leaderboards, and stats in `./data`
- User accounts, admin management, public profiles, search, and player rankings
- Audited permanent deletion of invalid completed games with automatic statistic updates
- Self-registration from the lobby with immutable usernames
- Personal statistics split into Normal, Hardcore, and overall results, with a selectable score chart and median
- Progressive Web App support with content-hashed asset and service-worker versions
- Readiness endpoint and container healthcheck for migration-safe deployments
- Docker Compose setup for local machines, servers, and Raspberry Pi

## Public page URLs

User-facing navigation uses short routes without implementation details:

- `/` lobby
- `/spiel/{game_id}` active player view
- `/spiel/{game_id}/zuschauen` spectator view
- `/regeln`, `/spieler`, `/spieler/{username}`, `/konto`, and `/admin`
- `/ergebnis/{game_id}` completed-game view

JavaScript, styles, and icons remain under `/static/`; these asset paths are not
used for browser navigation. Legacy `*.html` links redirect to the matching
public route so existing bookmarks and older installed app versions keep working.

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

Open:

- Lobby: `http://localhost:8000/`
- API docs: `http://localhost:8000/docs`

On a server or Raspberry Pi, replace `localhost` with the device IP.

## Update

```bash
git pull
docker compose up -d --build
```

Game data is stored in `./data` and is preserved across rebuilds.
Waiting and running games are restored after an application restart; connected
players appear offline until they rejoin with their locally stored resume token.

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
│   ├── main.py              # FastAPI routes, WebSocket game loop, lobby and leaderboard state
│   ├── models.py            # User, session, active/completed-game, and participant models
│   ├── database.py          # Database configuration and Alembic upgrades
│   ├── active_games.py      # Restart-safe snapshots of waiting and running games
│   ├── auth.py              # Password, session, and role logic
│   ├── api_auth.py          # Login, password, and admin-user API
│   ├── api_users.py         # Profiles, stats, search, ranking, and assignments
│   ├── game_history.py      # Complete results and legacy JSON import
│   ├── rules.py             # Server-side subtotal and total calculations
│   └── static/
│       ├── index.html       # Lobby
│       ├── room.html        # Game room shell
│       ├── game_view.html   # Read-only leaderboard replay view
│       ├── rules.html       # Player-facing game rules
│       ├── chat.js          # Chat client
│       ├── emoji.js         # Emoji reactions
│       ├── room.js          # Game room WebSocket client
│       ├── scoreboard.js    # Scoreboard renderer and read-only replay renderer
│       ├── style.css        # Shared styling
│       ├── sw.js            # Service worker
│       ├── favicon.png
│       └── icons/
├── alembic/                 # Versioned database schema migrations
├── scripts/
│   ├── deploy_zdwa.sh       # Guarded production deployment
│   ├── install_nginx_config.sh # Validated installation of production proxy limits
│   ├── prune_data_backups.sh # Keeps five deploy backups; manual use is dry-run-first
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

After changing a file under `app/static/` or either manifest, run
`npm run sync:assets` (or `python3 scripts/sync_static_versions.py`). This writes
one deterministic content version to all asset references and the service-worker
cache. The deploy script rejects unsynchronized versions.

## Plain Docker

```bash
docker build -t rollthedice .
docker run -d --name rollthedice --restart=unless-stopped \
  -p 8000:8000 \
  -v "$(pwd)/data:/app/data" \
  rollthedice
```
