#!/usr/bin/env bash
set -Eeuo pipefail

# Production-only activation helper.  The default is deliberately a dry run;
# APPLY=1 is required before this script changes Nginx or the certificate.
ACTION="${ACTION:-activate}"
APPLY="${APPLY:-0}"
SOURCE="${SOURCE:-deploy/nginx/rollthedice.conf}"
TARGET="${TARGET:-/etc/nginx/sites-available/rollthedice}"
BACKUP="${BACKUP:-}"
CERT_NAME="${CERT_NAME:-zockdiewandan.online}"
EXPECTED_IPV4="${EXPECTED_IPV4:-217.154.16.72}"
EXPECTED_TTL="${EXPECTED_TTL:-3600}"
TURNSTILE_HOSTNAMES_CONFIRMED="${TURNSTILE_HOSTNAMES_CONFIRMED:-0}"
COOKIE_TRUST_ZONE_CONFIRMED="${COOKIE_TRUST_ZONE_CONFIRMED:-0}"
CONTAINER_NAME="${CONTAINER_NAME:-rollthedice}"
EXPECTED_ZILCH_ACCESS_MODE="${EXPECTED_ZILCH_ACCESS_MODE:-authenticated}"

BASE_DOMAIN="zockdiewandan.online"
DOMAINS=(
  "zockdiewandan.online"
  "www.zockdiewandan.online"
  "zdwa.zockdiewandan.online"
  "zilch.zockdiewandan.online"
)
SUBDOMAINS=(
  "zdwa.zockdiewandan.online"
  "zilch.zockdiewandan.online"
)
PUBLIC_RESOLVERS=("1.1.1.1" "8.8.8.8" "9.9.9.9")
REQUIRED_HEADERS=(
  "strict-transport-security"
  "x-content-type-options"
  "x-frame-options"
  "referrer-policy"
  "permissions-policy"
  "content-security-policy"
)

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

sudo_run() {
  sudo -n "$@"
}

require_safe_target() {
  case "$TARGET" in
    /etc/nginx/sites-available/?*) ;;
    *) fail "Refusing unsafe Nginx target: $TARGET" ;;
  esac
}

dns_query() {
  local dns_server="$1"
  local record_type="$2"
  local dns_name="$3"
  local response

  if ! response="$(dig +time=5 +tries=2 +noall +comments +answer "@$dns_server" "$record_type" "$dns_name")"; then
    fail "DNS query failed: $dns_server $record_type $dns_name"
  fi
  if ! grep -q 'status: NOERROR' <<<"$response"; then
    fail "DNS response is not NOERROR: $dns_server $record_type $dns_name"
  fi
  awk -v wanted="$record_type" '$4 == wanted {print $5}' <<<"$response" | sort -u
}

authoritative_ttls() {
  local dns_server="$1"
  local dns_name="$2"
  local response

  if ! response="$(dig +time=5 +tries=2 +noall +comments +answer "@$dns_server" A "$dns_name")"; then
    fail "Authoritative TTL query failed: $dns_server $dns_name"
  fi
  if ! grep -q 'status: NOERROR' <<<"$response"; then
    fail "Authoritative TTL response is not NOERROR: $dns_server $dns_name"
  fi
  awk '$4 == "A" {print $2}' <<<"$response" | sort -u
}

check_dns() {
  local authoritative_list
  local dns_server
  local dns_name
  local ipv4_answer
  local ipv6_answer
  local ttl_answer

  log "== DNS gate =="
  authoritative_list="$(dig +short NS "$BASE_DOMAIN" | sed '/^$/d')"
  [[ -n "$authoritative_list" ]] || fail "No authoritative nameservers found for $BASE_DOMAIN"

  while IFS= read -r dns_server; do
    [[ -n "$dns_server" ]] || continue
    for dns_name in "${SUBDOMAINS[@]}"; do
      ipv4_answer="$(dns_query "$dns_server" A "$dns_name")"
      [[ "$ipv4_answer" == "$EXPECTED_IPV4" ]] \
        || fail "$dns_server returns unexpected A records for $dns_name: ${ipv4_answer:-<none>}"
      ipv6_answer="$(dns_query "$dns_server" AAAA "$dns_name")"
      [[ -z "$ipv6_answer" ]] \
        || fail "$dns_server still returns AAAA records for $dns_name: $ipv6_answer"
      ttl_answer="$(authoritative_ttls "$dns_server" "$dns_name")"
      [[ "$ttl_answer" == "$EXPECTED_TTL" ]] \
        || fail "$dns_server returns unexpected A TTL for $dns_name: ${ttl_answer:-<none>}"
    done
    log "authoritative $dns_server: ready"
  done <<<"$authoritative_list"

  for dns_server in "${PUBLIC_RESOLVERS[@]}"; do
    for dns_name in "${SUBDOMAINS[@]}"; do
      ipv4_answer="$(dns_query "$dns_server" A "$dns_name")"
      [[ "$ipv4_answer" == "$EXPECTED_IPV4" ]] \
        || fail "$dns_server still returns unexpected A records for $dns_name: ${ipv4_answer:-<none>}"
      ipv6_answer="$(dns_query "$dns_server" AAAA "$dns_name")"
      [[ -z "$ipv6_answer" ]] \
        || fail "$dns_server still returns AAAA records for $dns_name: $ipv6_answer"
    done
    log "recursive $dns_server: ready"
  done
}

container_env_value() {
  local variable_name="$1"
  local matching_line
  matching_line="$(
    sudo_run docker inspect "$CONTAINER_NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep -E "^${variable_name}=" \
      | tail -n 1 \
      || true
  )"
  printf '%s' "${matching_line#*=}"
}

check_runtime() {
  local state
  local health
  local data_mount
  local expected_data_source
  local published_ports
  local docker_gateway
  local forwarded_allow_ips
  local cookie_domain
  local cookie_secure
  local configured_site_origin
  local configured_zilch_origin
  local zilch_access_mode
  local entry

  log "== Runtime and persistence gate =="
  state="$(sudo_run docker inspect "$CONTAINER_NAME" --format '{{.State.Status}}')"
  health="$(sudo_run docker inspect "$CONTAINER_NAME" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')"
  [[ "$state" == "running" && "$health" == "healthy" ]] \
    || fail "$CONTAINER_NAME must be running and healthy (state=$state health=$health)"

  data_mount="$(
    sudo_run docker inspect "$CONTAINER_NAME" \
      --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Type}}|{{.Source}}|{{.RW}}{{end}}{{end}}'
  )"
  expected_data_source="$(pwd -P)/data"
  [[ "$data_mount" == "bind|${expected_data_source}|true" ]] \
    || fail "Expected the writable production bind ${expected_data_source} at /app/data, got: ${data_mount:-<none>}"
  log "persistent /app/data bind mount: ready"

  published_ports="$(
    sudo_run docker inspect "$CONTAINER_NAME" \
      --format '{{range $bindings := index .HostConfig.PortBindings "8000/tcp"}}{{println .HostIp}}{{end}}' \
      | sed '/^$/d' \
      | sort -u
  )"
  [[ "$published_ports" == "127.0.0.1" ]] \
    || fail "Container port 8000 must be bound only to 127.0.0.1, got: ${published_ports:-<none>}"
  log "container port 8000 loopback binding: ready"

  docker_gateway="$(
    sudo_run docker inspect "$CONTAINER_NAME" \
      --format '{{range .NetworkSettings.Networks}}{{println .Gateway}}{{end}}' \
      | sed '/^$/d' \
      | sort -u
  )"
  [[ -n "$docker_gateway" && "$docker_gateway" != *$'\n'* ]] \
    || fail "Expected exactly one Docker gateway, got: ${docker_gateway:-<none>}"
  forwarded_allow_ips="$(container_env_value FORWARDED_ALLOW_IPS | tr -d '[:space:]')"
  if [[ "$forwarded_allow_ips" != "$docker_gateway" ]]; then
    fail "FORWARDED_ALLOW_IPS must trust the observed Docker gateway $docker_gateway exactly"
  fi
  log "trusted proxy $docker_gateway: ready"

  cookie_domain="$(container_env_value ROLLTHEDICE_COOKIE_DOMAIN)"
  [[ "$cookie_domain" == "$BASE_DOMAIN" || "$cookie_domain" == ".$BASE_DOMAIN" ]] \
    || fail "ROLLTHEDICE_COOKIE_DOMAIN must be $BASE_DOMAIN for the handoff"
  cookie_secure="$(container_env_value ROLLTHEDICE_COOKIE_SECURE | tr '[:upper:]' '[:lower:]')"
  case "$cookie_secure" in
    1|true|yes|on) ;;
    *) fail "ROLLTHEDICE_COOKIE_SECURE must be enabled for the shared cookie" ;;
  esac
  configured_site_origin="$(container_env_value ROLLTHEDICE_SITE_ORIGIN)"
  [[ "$configured_site_origin" == "https://zockdiewandan.online" ]] \
    || fail "Unexpected ROLLTHEDICE_SITE_ORIGIN: ${configured_site_origin:-<unset>}"
  configured_zilch_origin="$(container_env_value ROLLTHEDICE_ZILCH_ORIGIN)"
  [[ "$configured_zilch_origin" == "https://zilch.zockdiewandan.online" ]] \
    || fail "Unexpected ROLLTHEDICE_ZILCH_ORIGIN: ${configured_zilch_origin:-<unset>}"
  log "shared-session cookie domain: ready"

  zilch_access_mode="$(container_env_value ROLLTHEDICE_ZILCH_ACCESS_MODE)"
  [[ "$zilch_access_mode" == "$EXPECTED_ZILCH_ACCESS_MODE" ]] \
    || fail "Unexpected Zilch access mode: ${zilch_access_mode:-<unset>} (expected $EXPECTED_ZILCH_ACCESS_MODE)"
  log "Zilch access mode $zilch_access_mode: confirmed"

  for entry in "${DOMAINS[@]}"; do
    [[ "$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' -H "Host: $entry" http://127.0.0.1:8000/api/health)" == "200" ]] \
      || fail "Backend health check failed with Host: $entry"
  done

  [[ "$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' -H 'Host: zilch.zockdiewandan.online' http://127.0.0.1:8000/)" == "303" ]] \
    || fail "The deployed app is not yet serving the unauthenticated Zilch-host handoff"
  [[ "$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' -H 'Host: zilch.zockdiewandan.online' http://127.0.0.1:8000/sw.js)" == "404" ]] \
    || fail "The Zilch host must not expose the root-scoped service worker"
  [[ "$(curl --noproxy '*' -sS -o /dev/null -w '%{http_code}' -H 'Host: zilch.zockdiewandan.online' http://127.0.0.1:8000/manifest.webmanifest)" == "404" ]] \
    || fail "The Zilch host must not expose the ZDWA manifest"
  log "host routing and PWA isolation: ready"
}

check_turnstile() {
  local registration_config
  registration_config="$(curl --noproxy '*' -fsS http://127.0.0.1:8000/api/auth/registration-config)"
  if grep -q '"turnstile_enabled"[[:space:]]*:[[:space:]]*true' <<<"$registration_config"; then
    log "Turnstile is enabled. Registration remains on the apex; confirm its existing apex/www hostname policy."
    if [[ "$APPLY" == "1" && "$TURNSTILE_HOSTNAMES_CONFIRMED" != "1" ]]; then
      fail "Set TURNSTILE_HOSTNAMES_CONFIRMED=1 only after checking the widget hostname allowlist"
    fi
  else
    log "Turnstile is disabled; no external hostname allowlist gate applies."
  fi
}

check_cookie_trust_zone() {
  log "== Shared-cookie trust-zone gate =="
  log "Confirm that every active *.$BASE_DOMAIN DNS name is controlled and trusted; a Domain cookie reaches all of them."
  if [[ "$APPLY" == "1" && "$COOKIE_TRUST_ZONE_CONFIRMED" != "1" ]]; then
    fail "Set COOKIE_TRUST_ZONE_CONFIRMED=1 only after auditing the complete DNS zone"
  fi
}

test_pending_nginx_config() {
  local candidate_config
  candidate_config="$(mktemp)"
  {
    printf 'events {}\nhttp {\n'
    sed -n '1,$p' "$SOURCE"
    printf '\n}\n'
  } >"$candidate_config"
  if ! sudo_run nginx -t -c "$candidate_config"; then
    rm -f -- "$candidate_config"
    fail "Pending Nginx source failed its isolated syntax test"
  fi
  rm -f -- "$candidate_config"
  log "pending Nginx source syntax: ready"
}

check_certbot_scheduler() {
  log "== Certificate scheduler gate =="
  if sudo_run systemctl is-enabled --quiet certbot.timer \
    && sudo_run systemctl is-active --quiet certbot.timer; then
    log "active certbot.timer: ready"
    return
  fi
  if sudo_run test -r /etc/cron.d/certbot; then
    log "readable /etc/cron.d/certbot renewal job: ready"
    return
  fi
  fail "No active certbot.timer or readable /etc/cron.d/certbot renewal job found"
}

check_source_and_host() {
  local dns_name

  [[ -f "$SOURCE" ]] || fail "Missing versioned Nginx config: $SOURCE"
  for dns_name in "${DOMAINS[@]}"; do
    grep -Fq "$dns_name" "$SOURCE" || fail "Nginx source does not contain $dns_name"
  done

  require_command sudo
  require_command nginx
  require_command certbot
  require_command openssl
  require_command curl
  require_command dig
  require_command docker
  require_command systemctl
  sudo_run true
  sudo_run test -f "$TARGET" || fail "Missing active Nginx target: $TARGET"
  sudo_run test -r "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" \
    || fail "Missing certificate lineage: $CERT_NAME"
  sudo_run nginx -t
  test_pending_nginx_config
  check_certbot_scheduler
}

show_config_diff() {
  local diff_status=0
  log "== Pending Nginx diff =="
  sudo_run diff -u -- "$TARGET" "$SOURCE" || diff_status=$?
  if [[ "$diff_status" -gt 1 ]]; then
    fail "Could not compare $TARGET and $SOURCE"
  fi
  if [[ "$diff_status" == "0" ]]; then
    log "Nginx target already matches the versioned source."
  fi
}

show_certificate_plan() {
  local dns_name
  log "== Certificate plan =="
  printf 'sudo -n certbot certonly --nginx --non-interactive --cert-name %q --expand' "$CERT_NAME"
  for dns_name in "${DOMAINS[@]}"; do
    printf ' -d %q' "$dns_name"
  done
  printf '\n'
  log "The existing lineage is expanded in place, so the apex certificate path does not change."
}

verify_certificate_and_https() {
  local dns_name
  local header_block
  local header_name
  local location_header
  local status_code

  sudo_run openssl x509 -in "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" -noout -checkend 604800 \
    || fail "Expanded certificate expires in less than seven days"
  for dns_name in "${DOMAINS[@]}"; do
    sudo_run openssl x509 -in "/etc/letsencrypt/live/$CERT_NAME/fullchain.pem" -noout -checkhost "$dns_name" \
      >/dev/null || fail "Expanded certificate does not cover $dns_name"
    status_code="$(
      curl --noproxy '*' --resolve "$dns_name:443:127.0.0.1" -sS -o /dev/null -w '%{http_code}' \
        "https://$dns_name/api/health"
    )"
    if [[ "$dns_name" == "zdwa.zockdiewandan.online" ]]; then
      [[ "$status_code" == "308" ]] || fail "ZDWA alias must return 308, got $status_code"
      location_header="$(
        curl --noproxy '*' --resolve "$dns_name:443:127.0.0.1" -sS -D - -o /dev/null \
          "https://$dns_name/api/health?alias-check=1" \
          | awk 'BEGIN {IGNORECASE=1} /^location:/ {sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}'
      )"
      [[ "$location_header" == "https://zockdiewandan.online/api/health?alias-check=1" ]] \
        || fail "ZDWA alias returned an unexpected location: ${location_header:-<none>}"
    else
      [[ "$status_code" == "200" ]] \
        || fail "HTTPS health check failed for $dns_name (status $status_code)"
    fi
    header_block="$(
      curl --noproxy '*' --resolve "$dns_name:443:127.0.0.1" -sS -D - -o /dev/null \
        "https://$dns_name/api/health"
    )"
    for header_name in "${REQUIRED_HEADERS[@]}"; do
      grep -qi "^${header_name}:" <<<"$header_block" \
        || fail "Missing $header_name response header on $dns_name"
    done
    log "TLS, health and headers for $dns_name: ready"
  done
}

verify_certificate_renewal() {
  log "== Certificate renewal gate =="
  sudo_run certbot renew --dry-run --cert-name "$CERT_NAME"
  log "Certbot renewal dry run: ready"
}

restore_on_failed_exit() {
  local exit_code=$?
  trap - EXIT
  if [[ "$exit_code" != "0" && -n "${activation_backup:-}" ]] && sudo_run test -f "$activation_backup"; then
    printf 'Operation failed; restoring %s\n' "$activation_backup" >&2
    sudo_run cp -a -- "$activation_backup" "$TARGET"
    if sudo_run nginx -t; then
      sudo_run systemctl reload nginx
    else
      printf 'Restored file did not pass nginx -t; Nginx was not reloaded.\n' >&2
    fi
  fi
  exit "$exit_code"
}

activate() {
  local activation_timestamp
  local dns_name
  local -a certbot_command

  check_source_and_host
  check_dns
  check_runtime
  check_turnstile
  check_cookie_trust_zone
  show_config_diff
  show_certificate_plan

  if [[ "$APPLY" != "1" ]]; then
    log "DRY RUN ONLY: no file, certificate, service, container or database was changed."
    log "After all gates are green, repeat with APPLY=1, COOKIE_TRUST_ZONE_CONFIRMED=1 and, when Turnstile is enabled, TURNSTILE_HOSTNAMES_CONFIRMED=1."
    return
  fi

  activation_timestamp="$(date -u +%Y%m%d-%H%M%S)"
  activation_backup="${TARGET}.backup-subdomains-${activation_timestamp}"
  sudo_run cp -a -- "$TARGET" "$activation_backup"
  trap restore_on_failed_exit EXIT

  sudo_run install -m 0644 -- "$SOURCE" "$TARGET"
  sudo_run nginx -t
  sudo_run systemctl reload nginx

  certbot_command=(
    certbot certonly
    --nginx
    --non-interactive
    --cert-name "$CERT_NAME"
    --expand
  )
  for dns_name in "${DOMAINS[@]}"; do
    certbot_command+=( -d "$dns_name" )
  done
  sudo_run "${certbot_command[@]}"

  sudo_run nginx -t
  sudo_run systemctl reload nginx
  verify_certificate_and_https
  verify_certificate_renewal

  trap - EXIT
  log "Subdomains activated successfully."
  printf 'Rollback file: %s\n' "$activation_backup"
  printf 'Rollback command: ACTION=rollback BACKUP=%q APPLY=1 %q\n' "$activation_backup" "$0"
  log "The expanded certificate may safely remain in place after an Nginx rollback."
}

rollback() {
  local rollback_timestamp
  local rollback_safety_copy

  [[ -n "$BACKUP" ]] || fail "BACKUP must name the exact backup printed by a successful activation"
  case "$BACKUP" in
    "$TARGET".backup-subdomains-?*) ;;
    *) fail "Refusing backup outside the activation backup pattern: $BACKUP" ;;
  esac

  check_source_and_host
  sudo_run test -f "$BACKUP" || fail "Rollback backup does not exist: $BACKUP"
  log "Rollback source: $BACKUP"
  log "Rollback target: $TARGET"
  log "The certificate lineage and application database will not be changed."

  if [[ "$APPLY" != "1" ]]; then
    log "DRY RUN ONLY: no Nginx file or service was changed."
    log "Repeat with ACTION=rollback BACKUP=<exact-file-above> APPLY=1 to restore it."
    return
  fi

  rollback_timestamp="$(date -u +%Y%m%d-%H%M%S)"
  rollback_safety_copy="${TARGET}.backup-before-rollback-${rollback_timestamp}"
  sudo_run cp -a -- "$TARGET" "$rollback_safety_copy"
  activation_backup="$rollback_safety_copy"
  trap restore_on_failed_exit EXIT

  sudo_run cp -a -- "$BACKUP" "$TARGET"
  sudo_run nginx -t
  sudo_run systemctl reload nginx
  [[ "$(curl --noproxy '*' --resolve 'zockdiewandan.online:443:127.0.0.1' -sS -o /dev/null -w '%{http_code}' 'https://zockdiewandan.online/api/health')" == "200" ]] \
    || fail "Apex health check failed after rollback"

  trap - EXIT
  log "Nginx rollback completed; apex health is ready."
  log "Safety copy of the replaced configuration: $rollback_safety_copy"
  log "No Docker container, certificate lineage or database file was changed."
}

main() {
  require_safe_target
  [[ "$APPLY" == "0" || "$APPLY" == "1" ]] || fail "APPLY must be exactly 0 or 1"
  case "$ACTION" in
    activate) activate ;;
    rollback) rollback ;;
    *) fail "ACTION must be activate or rollback" ;;
  esac
}

main "$@"
