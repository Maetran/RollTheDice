#!/usr/bin/env bash
set -Eeuo pipefail

# Run on the origin checkout. Default: inspect only. This helper never changes
# DNS, Cloudflare, the firewall, Docker, application data or the existing cert.
APPLY="${APPLY:-0}"
SOURCE="${SOURCE:-deploy/nginx/rollthedice.conf}"
TARGET="${TARGET:-/etc/nginx/sites-available/rollthedice}"
STAGING="${STAGING:-/etc/nginx/conf.d/hausdepp-acme-staging.conf}"
WEBROOT="${WEBROOT:-/var/lib/letsencrypt}"
RENEW_HOOK="${RENEW_HOOK:-/etc/letsencrypt/renewal-hooks/deploy/rollthedice-nginx-reload.sh}"
DOMAIN="hausdepp.zockdiewandan.online"
CERTIFICATE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
activation_backup=""
staging_created=0
probe_path=""
probe_response_file=""
probe_status_file=""
probe_sequence=0

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
sudo_run() { sudo -n "$@"; }

wait_for_readiness() {
  local label="$1"
  local check="$2"
  local attempt
  # systemctl reload acknowledges the HUP signal before every new worker is
  # accepting connections. Both staged HTTP-01 and final TLS can briefly reach
  # the previous vhost. Each gate allows ten requests of at most three seconds
  # plus nine one-second pauses, then rolls back.
  for attempt in {1..10}; do
    if "$check"; then
      return 0
    fi
    if [[ "$attempt" -lt 10 ]]; then
      printf 'Waiting for %s after Nginx reload (%s/10).\n' "$label" "$attempt" >&2
      sleep 1
    fi
  done
  fail "$label did not become ready after the bounded Nginx reload wait"
}

probe_public_http01() {
  local random
  # This uses public DNS and Cloudflare, with no local --resolve shortcut and
  # no redirect following. HTTP success alone never authorises certificate
  # issuance: compare the exact response bytes, including any trailing newline.
  # Every attempt has a fresh path as well as a fresh token: an old worker's
  # cached 404 must never pin later attempts to that negative edge response.
  if [[ -n "$probe_path" ]]; then sudo_run rm -f -- "$probe_path" || return 1; fi
  probe_sequence=$((probe_sequence + 1))
  random="$(openssl rand -hex 16)" || return 1
  [[ "$random" =~ ^[0-9a-f]{32}$ ]] || return 1
  probe="hausdepp-$random-$probe_sequence"
  probe_path="$WEBROOT/.well-known/acme-challenge/$probe"
  printf '%s' "$probe" | sudo_run tee "$probe_path" >/dev/null || return 1
  if curl --noproxy '*' --connect-timeout 2 --max-time 3 --fail --silent --show-error \
    --header 'Cache-Control: no-cache' --output "$probe_response_file" --write-out '%{http_code}' \
    "http://$DOMAIN/.well-known/acme-challenge/$probe" >"$probe_status_file"; then
    [[ "$(< "$probe_status_file")" == "200" ]] || return 1
    printf '%s' "$probe" | cmp -s - "$probe_response_file"
  else
    return 1
  fi
}

probe_origin_https() {
  curl --noproxy '*' --connect-timeout 2 --max-time 3 --fail --silent --show-error \
    --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/health" >/dev/null
}

wait_for_origin_https() {
  wait_for_readiness 'Verified Hausdepp HTTPS' probe_origin_https
}

[[ "$APPLY" == "0" || "$APPLY" == "1" ]] || fail "APPLY must be exactly 0 or 1"
[[ "$TARGET" == /etc/nginx/sites-available/?* ]] || fail "Unsafe Nginx target"
[[ "$STAGING" == /etc/nginx/conf.d/hausdepp-acme-staging.conf ]] || fail "Unsafe staging path"
[[ "$WEBROOT" == /var/lib/letsencrypt ]] || fail "Unsafe ACME webroot"
[[ "$RENEW_HOOK" == /etc/letsencrypt/renewal-hooks/deploy/rollthedice-nginx-reload.sh ]] || fail "Unsafe renewal hook"
[[ -f "$SOURCE" ]] || fail "Missing versioned Nginx configuration: $SOURCE"
grep -Fq "server_name $DOMAIN;" "$SOURCE" || fail "Nginx source lacks the Hausdepp host"
grep -Fq "$CERTIFICATE" "$SOURCE" || fail "Nginx source lacks the separate Hausdepp certificate"
for command_name in sudo nginx certbot openssl curl dig systemctl cmp mktemp sleep; do
  command -v "$command_name" >/dev/null || fail "Missing command: $command_name"
done
sudo_run true
sudo_run test -f "$TARGET" || fail "Missing active Nginx configuration"
sudo_run nginx -t
sudo_run systemctl is-enabled --quiet certbot.timer || fail "certbot.timer must be enabled"
sudo_run systemctl is-active --quiet certbot.timer || fail "certbot.timer must be active"
[[ -n "$(dig +short A "$DOMAIN")" ]] || fail "Hausdepp has no public IPv4 DNS answer"

printf 'Cloudflare proxy stays enabled; edge A/AAAA answers may differ from the origin.\n'
printf 'Certificate: separate %s lineage using HTTP-01 webroot %s.\n' "$DOMAIN" "$WEBROOT"
printf 'Existing apex/www/ZDWA/Zilch certificate and all application data stay untouched.\n'
if [[ "$APPLY" == "0" ]]; then
  printf 'DRY RUN ONLY. APPLY=1 stages HTTP-01, proves public reachability, issues TLS and installs Nginx.\n'
  exit 0
fi

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$probe_path" ]]; then sudo_run rm -f -- "$probe_path"; fi
  if [[ -n "$probe_response_file" ]]; then rm -f -- "$probe_response_file"; fi
  if [[ -n "$probe_status_file" ]]; then rm -f -- "$probe_status_file"; fi
  if [[ "$status" != "0" && -n "$activation_backup" ]]; then
    sudo_run cp -a -- "$activation_backup" "$TARGET"
    printf 'Activation failed; restored %s. The separately issued certificate may remain.\n' "$activation_backup" >&2
  fi
  if [[ "$staging_created" == "1" ]]; then sudo_run rm -f -- "$STAGING"; fi
  if [[ "$status" != "0" ]]; then
    if sudo_run nginx -t; then sudo_run systemctl reload nginx; fi
  fi
  exit "$status"
}
trap cleanup EXIT

timestamp="$(date -u +%Y%m%d-%H%M%S)"
activation_backup="${TARGET}.backup-hausdepp-${timestamp}"
sudo_run cp -a -- "$TARGET" "$activation_backup"
sudo_run install -d -m 0755 "$WEBROOT/.well-known/acme-challenge"

# A completed previous activation already has the permanent ACME location.
# Do not introduce a second matching vhost during a safe repeat invocation.
if ! sudo_run grep -Fq "server_name $DOMAIN;" "$TARGET"; then
  if sudo_run test -e "$STAGING"; then fail "Unrecognised existing staging file: $STAGING"; fi
  staging_created=1
  sudo_run tee "$STAGING" >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name hausdepp.zockdiewandan.online;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/letsencrypt;
        default_type text/plain;
        add_header Cache-Control "no-store" always;
        try_files $uri =404;
    }
    location / { return 404; }
}
NGINX
  sudo_run nginx -t
  sudo_run systemctl reload nginx
fi

# Public proof exercises Cloudflare, DNS and origin routing. Never bypass TLS
# validation or disable the proxy/firewall to get a certificate issued.
probe_response_file="$(mktemp)"
probe_status_file="$(mktemp)"
wait_for_readiness 'Public HTTP-01 exact-token proof' probe_public_http01

sudo_run certbot certonly --webroot --webroot-path "$WEBROOT" --non-interactive \
  --cert-name "$DOMAIN" --keep-until-expiring -d "$DOMAIN"
sudo_run openssl x509 -in "$CERTIFICATE" -noout -checkhost "$DOMAIN" >/dev/null \
  || fail "Hausdepp certificate does not cover its hostname"
sudo_run openssl x509 -in "$CERTIFICATE" -noout -checkend 604800 >/dev/null \
  || fail "Hausdepp certificate expires within seven days"

# ACME renewal uses the permanent HTTP location; only this tiny deploy hook
# reloads the validated Nginx configuration after a successful renewal.
sudo_run install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo_run tee "$RENEW_HOOK" >/dev/null <<'HOOK'
#!/bin/sh
set -eu
/usr/sbin/nginx -t
/bin/systemctl reload nginx
HOOK
sudo_run chmod 0755 "$RENEW_HOOK"
if [[ "$staging_created" == "1" ]]; then
  sudo_run rm -f -- "$STAGING"
  staging_created=0
fi
SOURCE="$SOURCE" TARGET="$TARGET" bash scripts/install_nginx_config.sh

wait_for_origin_https
# Re-prove the permanent HTTP challenge route after removing the staging
# vhost. Only then may Certbot exercise its automatic renewal configuration.
wait_for_readiness 'Permanent HTTP-01 exact-token proof' probe_public_http01
sudo_run certbot renew --dry-run --cert-name "$DOMAIN"
printf 'Hausdepp TLS activated; backup: %s\n' "$activation_backup"
printf 'Next: deploy the tested public app. Public smoke must pass before release notifications.\n'
