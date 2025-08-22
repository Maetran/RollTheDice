# ---- Base image (läuft auch auf Raspberry Pi 4/5, ARM64) ----
FROM python:3.13-slim

# Keine .pyc, sofortiges Logging
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Systempakete (optional klein halten)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini \
 && rm -rf /var/lib/apt/lists/*

# Arbeitsverzeichnis
WORKDIR /app

# Zuerst nur Requirements kopieren (Layer-Caching)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt \
 || pip install --no-cache-dir uvicorn fastapi "uvicorn[standard]"

# Rest der App kopieren
COPY app /app

# Nicht als root laufen
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

# Port-Deklaration (Dokumentation)
EXPOSE 8000

# Hinweis: Daten werden in /app/data geschrieben.
# Am besten beim 'docker run' einen Bind-Mount setzen: -v $(pwd)/app/data:/app/data

# Einstiegspunkt: tini sorgt für sauberes Signal-Handling
ENTRYPOINT ["/usr/bin/tini", "--"]

# Startbefehl (kein --reload im Container)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]