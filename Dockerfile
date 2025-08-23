FROM python:3.13-slim

# Optional: tini für sauberes Signal-Handling
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt || \
    pip install --no-cache-dir uvicorn fastapi "uvicorn[standard]"

# Code kopieren: das Verzeichnis "app" (mit __init__.py, main.py, static/ …)
# kommt dann im Container nach /app/app
COPY app /app/app

# Datenverzeichnis (wird beim Run zusätzlich als Volume gemountet)
RUN mkdir -p /app/data

# Sicherheitshalber PYTHONPATH setzen, damit /app im Import-Pfad ist
ENV PYTHONPATH=/app

# Expose (nur Doku)
EXPOSE 8000

# Startbefehl (kein --reload im Container)
ENTRYPOINT ["/usr/bin/tini","-g","--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]