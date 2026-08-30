#!/usr/bin/env bash
set -euo pipefail

SOURCE="${SOURCE:-deploy/nginx/rollthedice.conf}"
TARGET="${TARGET:-/etc/nginx/sites-available/rollthedice}"

if [[ ! -f "$SOURCE" ]]; then
  echo "Missing Nginx source config: $SOURCE" >&2
  exit 1
fi

backup="${TARGET}.backup-$(date +%Y%m%d-%H%M%S)"
if sudo test -f "$TARGET"; then
  sudo cp -a -- "$TARGET" "$backup"
  echo "Created $backup"
fi

sudo install -m 0644 -- "$SOURCE" "$TARGET"
if ! sudo nginx -t; then
  if sudo test -f "$backup"; then
    sudo cp -a -- "$backup" "$TARGET"
  fi
  echo "Nginx validation failed; previous configuration restored." >&2
  exit 1
fi

sudo systemctl reload nginx
echo "Nginx configuration installed and reloaded."
