FROM python:3.13-slim

# kleine Init-Binary fuer saubere Signals (optional)
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# **Hier korrekt kopieren: kompletter Ordner app/**
COPY app /app/app

# Datenverzeichnis im Container (wird gemountet)
RUN mkdir -p /app/data

# Python findet das Paket "app"
ENV PYTHONPATH=/app

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini","-g","--"]
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]