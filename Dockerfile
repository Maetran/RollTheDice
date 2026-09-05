FROM python:3.13-slim

# kleine Init-Binary fuer saubere Signals (optional)
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies
COPY requirements.txt .
COPY manifest.webmanifest /app/manifest.webmanifest
COPY manifest-en.webmanifest /app/manifest-en.webmanifest
COPY zilch-manifest.webmanifest /app/zilch-manifest.webmanifest
COPY zilch-manifest-en.webmanifest /app/zilch-manifest-en.webmanifest
RUN pip install --no-cache-dir -r requirements.txt

# **Hier korrekt kopieren: kompletter Ordner app/**
COPY app /app/app
COPY alembic /app/alembic
COPY alembic.ini /app/alembic.ini

# Datenverzeichnis im Container (wird gemountet)
RUN mkdir -p /app/data

# Python findet das Paket "app"
ENV PYTHONPATH=/app

EXPOSE 8000

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2).read()"]

ENTRYPOINT ["/usr/bin/tini","-g","--"]
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000","--ws-max-size","65536"]
