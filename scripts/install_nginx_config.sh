#!/usr/bin/env bash
set -euo pipefail

SOURCE="${SOURCE:-deploy/nginx/rollthedice.conf}"
TARGET="${TARGET:-/etc/nginx/sites-available/rollthedice}"
CERTIFICATE="${CERTIFICATE:-/etc/letsencrypt/live/zockdiewandan.online/fullchain.pem}"
HAUSDEPP_CERTIFICATE="${HAUSDEPP_CERTIFICATE:-/etc/letsencrypt/live/hausdepp.zockdiewandan.online/fullchain.pem}"

if [[ ! -f "$SOURCE" ]]; then
  echo "Missing Nginx source config: $SOURCE" >&2
  exit 1
fi

# A normal config install must never expose a product host with a certificate
# that does not cover it. Hausdepp has a separate webroot lineage; the older
# DNS-only helper only applies to the historical ZDWA/Zilch migration.
for product_host in zdwa.zockdiewandan.online zilch.zockdiewandan.online hausdepp.zockdiewandan.online; do
  product_certificate="$CERTIFICATE"
  activation_helper="scripts/activate_subdomains.sh"
  if [[ "$product_host" == "hausdepp.zockdiewandan.online" ]]; then
    product_certificate="$HAUSDEPP_CERTIFICATE"
    activation_helper="scripts/activate_hausdepp.sh"
  fi
  if grep -Fq "$product_host" "$SOURCE"; then
    if ! sudo test -r "$product_certificate" \
      || ! sudo openssl x509 -in "$product_certificate" -noout -checkhost "$product_host" >/dev/null; then
      echo "Certificate does not cover $product_host; use $activation_helper first." >&2
      exit 1
    fi
  fi
done

backup="${TARGET}.backup-$(date +%Y%m%d-%H%M%S)"
had_target=0
if sudo test -f "$TARGET"; then
  had_target=1
  sudo cp -a -- "$TARGET" "$backup"
  echo "Created $backup"
fi

restore_previous_config() {
  if [[ "$had_target" == "1" ]]; then
    sudo cp -a -- "$backup" "$TARGET"
  else
    sudo rm -f -- "$TARGET"
  fi
}

sudo install -m 0644 -- "$SOURCE" "$TARGET"
if ! sudo nginx -t; then
  restore_previous_config
  echo "Nginx validation failed; previous configuration restored." >&2
  exit 1
fi

if ! sudo systemctl reload nginx; then
  restore_previous_config
  if sudo nginx -t; then
    sudo systemctl reload nginx || true
  fi
  echo "Nginx reload failed; previous configuration restored." >&2
  exit 1
fi
echo "Nginx configuration installed and reloaded."
