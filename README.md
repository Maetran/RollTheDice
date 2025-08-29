# 🎲 RollTheDice

RollTheDice is a lightweight multiplayer dice game.  
It uses **FastAPI** (Python) for the backend and serves a static HTML/JS frontend.  
Runs easily in Docker – on Raspberry Pi, Hetzner, or Docker Desktop.

---

## 🚀 Features

- Web lobby to create/join games with multiple players or teams  
- Interactive frontend (HTML/JS) served by FastAPI  
- REST API + WebSocket support  
- Persistent data in `./data` (leaderboards, stats)  
- Runs on x86_64 and arm64 (Raspberry Pi)

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

\```
RollTheDice/
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
├── app/
│   ├── main.py
│   ├── models.py
│   ├── rules.py
│   ├── static/
│   │   ├── index.html
│   │   ├── room.html
│   │   ├── lobby.js
│   │   ├── scoreboard.js
│   │   └── style.css
│   └── ...
└── data/                # persisted: leaderboard, stats, etc.
\```

---

## 🛠 Development Notes

- Source code: `app/`  
- Static frontend: `app/static/`  
- Persistent data: `data/`  
- `.dockerignore` excludes unnecessary files (e.g. venv, git, etc.)

---

## 🧪 Optional: Run without Compose

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