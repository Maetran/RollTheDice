#!/usr/bin/env bash
set -Eeuo pipefail

# Enable the already-certified public beta. DNS, Cloudflare, certificates,
# application data and every other product vhost remain owned by their setup.
APPLY="${APPLY:-0}"
SOURCE="${SOURCE:-deploy/nginx/watten-public.conf}"
TARGET="/etc/nginx/conf.d/watten-reserved.conf"
DOMAIN="watten.zockdiewandan.online"
CERTIFICATE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
backup=""
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
sudo_run() { sudo -n "$@"; }

[[ "$APPLY" == "0" || "$APPLY" == "1" ]] || fail 'APPLY must be exactly 0 or 1'
[[ -f "$SOURCE" ]] || fail 'Missing versioned public configuration'
grep -Fq '# Managed Watten public beta.' "$SOURCE" || fail 'Unrecognised public source'
grep -Fq "server_name $DOMAIN;" "$SOURCE" || fail 'Missing dedicated Watten vhost'
grep -Fq "$CERTIFICATE" "$SOURCE" || fail 'Missing separate Watten certificate'
for command_name in sudo curl openssl python3; do
  command -v "$command_name" >/dev/null || fail "Missing command: $command_name"
done
sudo_run true
sudo_run test -f "$TARGET" || fail 'Install the managed Watten reservation first'
sudo_run grep -Eq '^# Managed Watten (reservation|public beta)\.' "$TARGET" || fail 'Refusing to replace an unmanaged configuration'
sudo_run openssl x509 -in "$CERTIFICATE" -noout -checkhost "$DOMAIN" >/dev/null
sudo_run openssl x509 -in "$CERTIFICATE" -noout -checkend 86400 >/dev/null
sudo_run nginx -t
# The application must advertise public access before exposing its vhost.
curl --noproxy '*' --connect-timeout 2 --max-time 5 -fsS -H "Host: $DOMAIN" \
  http://127.0.0.1:8000/api/auth/me | python3 -c 'import json,sys; p=json.load(sys.stdin); assert p.get("game_access",{}).get("watten_public") is True, "Public Watten beta is not enabled"'
if [[ "$APPLY" == "0" ]]; then
  printf 'DRY RUN: certified public Watten backend and managed vhost ready. Use APPLY=1 to publish.\n'
  exit 0
fi
restore_on_failure() {
  local status=$?
  trap - EXIT
  if [[ "$status" != "0" && -n "$backup" ]]; then
    sudo_run cp -a -- "$backup" "$TARGET"
    if sudo_run nginx -t; then sudo_run systemctl reload nginx; fi
    printf 'Activation failed; restored the previous Watten vhost from %s.\n' "$backup" >&2
  fi
  exit "$status"
}
trap restore_on_failure EXIT
backup="${TARGET}.backup-public-$(date -u +%Y%m%d-%H%M%S)"
sudo_run cp -a -- "$TARGET" "$backup"
sudo_run install -m 0644 -- "$SOURCE" "$TARGET"
sudo_run nginx -t
sudo_run systemctl reload nginx
# Retry the real Cloudflare edge during Nginx worker handover, with verified TLS.
curl --noproxy '*' --retry 9 --retry-delay 1 --retry-all-errors --connect-timeout 3 --max-time 8 \
  -fsS "https://$DOMAIN/api/auth/me" | python3 -c 'import json,sys; p=json.load(sys.stdin); assert p.get("game_access",{}).get("watten_public") is True'
printf 'Watten public beta enabled. Previous vhost: %s\n' "$backup"
