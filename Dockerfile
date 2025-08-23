# Basisimage
FROM python:3.11-slim

# Arbeitsverzeichnis
WORKDIR /app

# Systemabhängigkeiten (nur minimal nötig)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Dependencies installieren
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Projektdateien kopieren (ohne data/, siehe .dockerignore)
COPY main.py models.py rules.py ./
COPY static ./static

# Port für HTTP & WS
EXPOSE 8000

# Startkommando
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]