# 🎲 RollTheDice

RollTheDice ist ein leichtgewichtiges Multiplayer-Würfelspiel.  
Verwendet **FastAPI** (Python) für das Backend und ein statisches HTML/JS-Frontend.  
Läuft einfach in Docker – auf Raspberry Pi, Hetzner oder Docker Desktop.

---

## 🚀 Features

- Web-Lobby zum Erstellen/Beitreten von Spielen mit mehreren Spielern oder Teams  
- Interaktives Frontend (HTML/JS) mit FastAPI  
- REST API + WebSocket Unterstützung  
- Persistente Daten in `./data` (Bestenlisten, Statistiken)  
- Läuft auf x86_64 und arm64 (Raspberry Pi)
- Progressive Web App (PWA) mit Offline-Unterstützung
- Chat-Funktion mit Emoji-Unterstützung
- Detaillierte Spielstatistiken und Bestenlisten

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

## 📁 Projektstruktur

```
RollTheDice/
├── Dockerfile                 # Docker-Konfiguration
├── docker-compose.yml         # Docker Compose Konfiguration
├── requirements.txt           # Python-Abhängigkeiten
├── manifest.webmanifest       # PWA Manifest
├── app/
│   ├── main.py               # Hauptanwendung (FastAPI)
│   ├── models.py             # Datenmodelle
│   ├── rules.py              # Spielregeln
│   └── static/               # Frontend-Dateien
│       ├── index.html        # Lobby
│       ├── room.html         # Spielraum
│       ├── game_view.html    # Spielansicht
│       ├── rules.html        # Spielregeln
│       ├── chat.js           # Chat-Funktionalität
│       ├── emoji.js          # Emoji-Unterstützung
│       ├── lobby.js          # Lobby-Logik
│       ├── room.js           # Spielraum-Logik
│       ├── scoreboard.js     # Bestenlisten-Logik
│       ├── style.css         # Styling
│       ├── sw.js            # Service Worker (PWA)
│       └── favicon.svg       # Favicon
└── data/                    # Persistente Daten
    ├── leaderboard_recent.json  # Aktuelle Bestenliste (letzte 7 Tage)
    ├── leaderboard_alltime.json # Ewige Bestenliste
    └── stats.json           # Spielstatistiken
```

---

## 💾 Datenpersistenz

- Die Anwendung speichert folgende Daten im `./data`-Verzeichnis:
  - `leaderboard_recent.json`: Bestenliste der letzten 7 Tage
  - `leaderboard_alltime.json`: Ewige Bestenliste
  - `stats.json`: Allgemeine Spielstatistiken

- **Wichtig**: Das `./data`-Verzeichnis wird bei Updates nicht überschrieben und bleibt auch nach Neustarts des Containers erhalten.

## 🛠 Entwicklungshinweise

- Quellcode: `app/`
- Frontend: `app/static/`
- Persistente Daten: `data/`
- `.dockerignore` schließt nicht benötigte Dateien aus (z.B. venv, git, etc.)

### Sicherung der Daten
- Die Spielstände werden automatisch im `./data`-Verzeichnis gespeichert
- Für ein Backup einfach den gesamten `./data`-Ordner sichern
- Die Daten werden im JSON-Format gespeichert und können einfach eingesehen werden

---

## 🔄 Update der Anwendung

Nach einem Update des Codes:

```bash
git pull
docker compose up -d --build
```

**Wichtig**: Die Spielstände und Bestenlisten bleiben bei Updates erhalten, da sie im `./data`-Verzeichnis gespeichert werden, das nicht von Git überschrieben wird.

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