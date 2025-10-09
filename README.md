# 🎲 RollTheDice

RollTheDice is a lightweight multiplayer dice game.  
Uses **FastAPI** (Python) for the backend and serves a static HTML/JS frontend.  
Runs easily in Docker – on Raspberry Pi, Hetzner, or Docker Desktop.

---

## 🚀 Features

- Web lobby to create/join games with multiple players or teams  
- Interactive frontend (HTML/JS) with FastAPI  
- REST API + WebSocket support  
- Persistent data in `./data` (leaderboards, stats)  
- Runs on x86_64 and arm64 (Raspberry Pi)
- Progressive Web App (PWA) with offline support
- Built-in chat with emoji support
- Detailed game statistics and leaderboards

---

## 📦 Requirements

- [Docker](https://www.docker.com/) with **Compose** plugin  
- Git (if cloning directly from GitHub)

---

## 🔨 Setup & Run (Docker Compose)

Clone the repository and start the app:

\```bash
git clone https://github.com/Maetran/RollTheDice.git
cd RollTheDice
docker compose up -d --build
\```

This will:
- build the image from the included `Dockerfile`
- start the container
- mount `./data` as a persistent volume

---

## 🌐 Access the App

Open your browser:

- Game lobby: `http://localhost:8000/`  
- API docs (Swagger UI): `http://localhost:8000/docs`

👉 On Raspberry Pi / server: replace `localhost` with the device’s IP, e.g.  
`http://192.168.1.64:8000/`

---

## 🔄 Update Workflow

After pulling new changes:

\```bash
git pull
docker compose up -d --build
\```

This rebuilds the image and restarts the container while keeping existing data in `./data`.

---

## 📁 Project Structure

```
RollTheDice/
├── Dockerfile                 # Docker configuration
├── docker-compose.yml         # Docker Compose configuration
├── requirements.txt           # Python dependencies
├── manifest.webmanifest       # PWA manifest
├── app/
│   ├── main.py               # Main application (FastAPI)
│   ├── models.py             # Data models
│   ├── rules.py              # Game rules
│   └── static/               # Frontend files
│       ├── index.html        # Lobby
│       ├── room.html         # Game room
│       ├── game_view.html    # Game view
│       ├── rules.html        # Game rules
│       ├── chat.js           # Chat functionality
│       ├── emoji.js          # Emoji support
│       ├── lobby.js          # Lobby logic
│       ├── room.js           # Game room logic
│       ├── scoreboard.js     # Leaderboard logic
│       ├── style.css         # Styling
│       ├── sw.js             # Service Worker (PWA)
│       └── favicon.svg       # Favicon
└── data/                     # Persistent data
    ├── leaderboard_recent.json  # Current leaderboard (last 7 days)
    ├── leaderboard_alltime.json # All-time leaderboard
    └── stats.json            # Game statistics
```

---

## 💾 Data Persistence

- The application stores the following data in the `./data` directory:
  - `leaderboard_recent.json`: Leaderboard for the last 7 days
  - `leaderboard_alltime.json`: All-time leaderboard
  - `stats.json`: General game statistics

- **Important**: The `./data` directory is not overwritten during updates and persists across container restarts.

## 🛠 Development Notes

- Source code: `app/`
- Frontend: `app/static/`
- Persistent data: `data/`
- `.dockerignore` excludes unnecessary files (e.g., venv, git, etc.)

### Data Backup
- Game data is automatically saved in the `./data` directory
- For backup, simply copy the entire `./data` folder
- Data is stored in JSON format and can be easily viewed

---

## 🔄 Updating the Application

After updating the code:

```bash
git pull
docker compose up -d --build
```

**Important**: Game data and leaderboards are preserved during updates as they are stored in the `./data` directory, which is not overwritten by Git.

## 🧪 Optional: Ohne Docker Compose ausführen

If you prefer plain Docker:

\```bash
docker build -t rollthedice .
docker run -d --name rollthedice --restart=unless-stopped \
  -p 8000:8000 \
  -v "$(pwd)/data:/app/data" \
  rollthedice
\```

---

## 🤝 Contributing

Contributions welcome!  
Fork the repo, implement your feature/fix, and open a Pull Request.