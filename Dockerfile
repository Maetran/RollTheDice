# --- base ---
FROM python:3.13-slim

# kleines init, saubere Signals
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# requirements zuerst für layer-caching
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt || \
    pip install --no-cache-dir uvicorn fastapi "uvicorn[standard]"

# >>> WICHTIG: sowohl app/ als auch static/ kopieren <<<
COPY . /app

# Data-Verzeichnis (wird zusätzlich per Volume gemountet)

# non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]