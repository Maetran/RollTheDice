\# 🎲 RollTheDice

RollTheDice is a small web application to play dice games with multiple teams.  
It is built with **FastAPI**, **Uvicorn**, and a lightweight static frontend.  
The app is designed to run easily inside a Docker container \(works on Raspberry Pi and Docker Desktop\).

---

\## 🚀 Features

\- Web interface with interactive tables for Team A and Team B  
\- Static frontend served directly by FastAPI  
\- Player buttons below each team table  
\- Data persisted inside `/app/data` \(can be mounted as a volume\)  
\- Ready to run on Raspberry Pi \(arm64\) or any x86\_64 machine  

---

\## 📦 Requirements

\- \[Docker\]\(https://www.docker.com/\) installed  
\- Git installed \(if you want to clone the repo directly on the server\)  

---

\## 🔨 Build Instructions

Clone the repository:

\```bash
git clone https://github.com/Maetran/RollTheDice.git
cd RollTheDice
\```

Build the Docker image:

\```bash
docker build -t wuerfler .
\```

---

\## ▶️ Run the Container

Run with data volume mounted:

\```bash
docker run -d \
  --name wuerfler \
  -p 8000:8000 \
  -v "\$(pwd)/data:/app/data" \
  wuerfler
\```

Check logs:

\```bash
docker logs -f wuerfler
\```

Stop the container:

\```bash
docker stop wuerfler
docker rm wuerfler
\```

---

\## 🌐 Access the App

Open your browser at:

\- `http://localhost:8000/` → serves `index.html`  
\- `http://localhost:8000/docs` → interactive API docs \(FastAPI Swagger UI\)  

If you run this on a Raspberry Pi in your local network, replace `localhost` with the Pi’s IP, e.g.:  
`http://192.168.1.64:8000/`

---

\## 🛠 Development Notes

\- The application code lives under `app/`  
\- Static frontend files are in `app/static/`  
\- Data \(e.g. game state\) is written to `data/`  
\- `.dockerignore` excludes unnecessary files \(e.g. venv, git, etc.\)  

---

\## 🤝 Contributing

Contributions are welcome\! Please fork the repo and submit a pull request.  
