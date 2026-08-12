# RollTheDice

RollTheDice is a lightweight multiplayer dice game with a FastAPI backend and a static HTML/CSS/JS frontend. It supports single-player, 2-player, 3-player, 2v2 team games, Hardcore mode, chat, emoji reactions, leaderboards, and read-only replay views for completed games.

## Features

- Responsive lobby and game room
- REST API for lobby, games, leaderboard, and replay data
- WebSocket game room for rolling, scoring, chat, spectators, and corrections
- Persistent leaderboards and stats in `./data`
- Progressive Web App support via manifest and service worker
- Docker Compose setup for local machines, servers, and Raspberry Pi

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

Useful checks:

```bash
python3 -m py_compile app/main.py app/rules.py
node --check app/static/scoreboard.js
node --input-type=module --check < app/static/room.js
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
│       ├── favicon.svg
│       └── icons/
└── data/                    # Persistent runtime data, ignored by Git
    ├── leaderboard_recent.json
    ├── leaderboard_alltime.json
    └── stats.json
```

## Data

The application writes leaderboard and stats files to `./data`. Backups can be made by copying that directory. The files are JSON and can be inspected manually when needed.

## Plain Docker

```bash
docker build -t rollthedice .
docker run -d --name rollthedice --restart=unless-stopped \
  -p 8000:8000 \
  -v "$(pwd)/data:/app/data" \
  rollthedice
```
