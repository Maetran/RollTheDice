#!/usr/bin/env bash
set -Eeuo pipefail

# Origin-only, closed-domain reservation. Default: inspect without mutation.
# Never changes Cloudflare, DNS, firewall, Docker, application data or old hosts.
APPLY="${APPLY:-0}"
SOURCE="${SOURCE:-deploy/nginx/watten-reserved.conf}"
DOMAIN="watten.zockdiewandan.online"
TARGET="/etc/nginx/conf.d/watten-reserved.conf"
STAGING="/etc/nginx/conf.d/watten-acme-staging.conf"
WEBROOT="/var/lib/letsencrypt"
CERTIFICATE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
RENEW_HOOK="/etc/letsencrypt/renewal-hooks/deploy/rollthedice-watten-nginx-reload.sh"
backup=""
target_existed=0
target_changed=0
staging_created=0
hook_created=0
probe_path=""
probe_sequence=0
temporary=""
completed=0

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
sudo_run() { sudo -n "$@"; }

wait_for_readiness() {
    local label="$1" check="$2" attempt
    for attempt in {1..10}; do
        if "$check"; then return 0; fi
        if [[ "$attempt" -lt 10 ]]; then sleep 1; fi
    done
    fail "$label did not become ready after ten bounded attempts"
}

probe_public_http01() {
    local random token
    if [[ -n "$probe_path" ]]; then sudo_run rm -f -- "$probe_path" || return 1; fi
    probe_sequence=$((probe_sequence + 1))
    random="$(openssl rand -hex 16)" || return 1
    [[ "$random" =~ ^[0-9a-f]{32}$ ]] || return 1
    token="watten-$random-$probe_sequence"
    probe_path="$WEBROOT/.well-known/acme-challenge/$token"
    printf '%s' "$token" | sudo_run tee "$probe_path" >/dev/null || return 1
    if ! curl --noproxy '*' --connect-timeout 2 --max-time 3 --fail --silent --show-error \
        --header 'Cache-Control: no-cache' --output "$temporary/body" --write-out '%{http_code}' \
        "http://$DOMAIN/.well-known/acme-challenge/$token" >"$temporary/status"; then return 1; fi
    [[ "$(< "$temporary/status")" == "200" ]] || return 1
    printf '%s' "$token" | cmp -s - "$temporary/body"
}

probe_closed_https() {
    local mode="$1" path expected
    local -a curl_arguments=(--noproxy '*' --connect-timeout 2 --max-time 3 --silent --show-error)
    if [[ "$mode" == "origin" ]]; then curl_arguments+=(--resolve "$DOMAIN:443:127.0.0.1"); fi
    for path in / /api/auth/me /watten-sw.js /sitemap.xml /ws/watten /robots.txt; do
        if ! curl "${curl_arguments[@]}" --dump-header "$temporary/headers" --output "$temporary/body" \
            --write-out '%{http_code}' "https://$DOMAIN$path" >"$temporary/status"; then return 1; fi
        expected=503
        if [[ "$path" == "/robots.txt" ]]; then expected=200; fi
        [[ "$(< "$temporary/status")" == "$expected" ]] || return 1
        grep -Eiq '^cache-control: *no-store[[:space:]]*$' "$temporary/headers" || return 1
        grep -Eiq '^x-robots-tag: *noindex, nofollow[[:space:]]*$' "$temporary/headers" || return 1
        if grep -Eiq '^set-cookie:' "$temporary/headers"; then return 1; fi
        if [[ "$path" == "/robots.txt" ]]; then
            printf 'User-agent: *\nDisallow: /\n' | cmp -s - "$temporary/body" || return 1
        else
            grep -Fq 'data-watten-reserved="true"' "$temporary/body" || return 1
            grep -Fq 'Watten ist noch nicht verfügbar.' "$temporary/body" || return 1
            grep -Fq 'Watten is not available yet.' "$temporary/body" || return 1
        fi
    done
}
probe_origin_https() { probe_closed_https origin; }
probe_public_https() { probe_closed_https public; }

check_existing_hosts() {
    local host expected status
    for host in zockdiewandan.online www.zockdiewandan.online zdwa.zockdiewandan.online \
        zilch.zockdiewandan.online hausdepp.zockdiewandan.online; do
        expected=200
        if [[ "$host" == zdwa.zockdiewandan.online ]]; then expected=308; fi
        status="$(curl --noproxy '*' --connect-timeout 2 --max-time 5 --silent --show-error \
            --output /dev/null --write-out '%{http_code}' "https://$host/api/health")" || return 1
        [[ "$status" == "$expected" ]] || return 1
    done
}

[[ "$APPLY" == "0" || "$APPLY" == "1" ]] || fail "APPLY must be exactly 0 or 1"
[[ -f "$SOURCE" ]] || fail "Missing reviewed reservation configuration: $SOURCE"
grep -Fq '# Managed Watten reservation.' "$SOURCE" || fail "Unrecognised reservation source"
grep -Fq "ssl_certificate $CERTIFICATE;" "$SOURCE" || fail "Separate Watten certificate is required"
if grep -Eq '\b(proxy_pass|fastcgi_pass|uwsgi_pass|grpc_pass)\b' "$SOURCE"; then
    fail "A closed reservation must never proxy to the application"
fi
for command_name in sudo nginx certbot openssl curl dig systemctl cmp mktemp grep sleep; do
    command -v "$command_name" >/dev/null || fail "Missing command: $command_name"
done
sudo_run true
sudo_run nginx -t
sudo_run systemctl is-enabled --quiet certbot.timer || fail "certbot.timer must be enabled"
sudo_run systemctl is-active --quiet certbot.timer || fail "certbot.timer must be active"
[[ -n "$(dig +time=2 +tries=1 +short A "$DOMAIN")" ]] || fail "Watten has no public IPv4 DNS answer"
if sudo_run test -e "$TARGET"; then
    sudo_run cmp -s -- "$SOURCE" "$TARGET" || fail "Existing Watten target differs; inspect it before changing anything"
    target_existed=1
fi
if sudo_run test -e "$STAGING"; then fail "Unrecognised existing staging file: $STAGING"; fi
check_existing_hosts || fail "Existing product-host baseline is not healthy"
printf 'Separate Watten TLS; closed 503/no-store/noindex host. Cloudflare proxy and firewall stay enabled.\n'
if [[ "$APPLY" == "0" ]]; then
    printf 'DRY RUN ONLY. APPLY=1 stages exact-token HTTP-01, obtains TLS and reserves this closed host.\n'
    exit 0
fi

temporary="$(mktemp -d)"
cleanup() {
    local status=$? rollback_failed=0
    trap - EXIT
    set +e
    # Some Bash versions report zero for an expansion error in a conditional
    # function. Only reaching every final gate counts as successful activation.
    if [[ "$status" == "0" && "$completed" != "1" ]]; then status=1; fi
    if [[ -n "$probe_path" ]]; then sudo_run rm -f -- "$probe_path"; fi
    if [[ "$staging_created" == "1" ]]; then sudo_run rm -f -- "$STAGING" || rollback_failed=1; fi
    if [[ "$status" != "0" ]]; then
        if [[ "$target_changed" == "1" ]]; then
            if [[ "$target_existed" == "1" ]]; then
                sudo_run cp -a -- "$backup" "$TARGET" || rollback_failed=1
            else
                sudo_run rm -f -- "$TARGET" || rollback_failed=1
            fi
        fi
        if [[ "$hook_created" == "1" ]]; then sudo_run rm -f -- "$RENEW_HOOK" || rollback_failed=1; fi
        if sudo_run nginx -t; then sudo_run systemctl reload nginx || rollback_failed=1; else rollback_failed=1; fi
        printf 'Watten activation failed; only owned Nginx files were rolled back. Issued TLS may remain.\n' >&2
        if [[ "$rollback_failed" == "1" ]]; then
            printf 'Rollback needs operator attention: %s (backup: %s).\n' "$TARGET" "${backup:-none; target was absent}" >&2
        fi
    fi
    rm -rf -- "$temporary"
    exit "$status"
}
trap cleanup EXIT

if [[ "$target_existed" == "1" ]]; then
    backup="${TARGET}.backup-$(date -u +%Y%m%d-%H%M%S)"
    sudo_run cp -a -- "$TARGET" "$backup"
else
    staging_created=1
    sudo_run tee "$STAGING" >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name watten.zockdiewandan.online;
    location ^~ /.well-known/acme-challenge/ {
        root /var/lib/letsencrypt;
        default_type text/plain;
        add_header Cache-Control "no-store" always;
        try_files $uri =404;
    }
    location / { return 404; }
}
NGINX
fi
sudo_run install -d -m 0755 "$WEBROOT/.well-known/acme-challenge"
sudo_run nginx -t
sudo_run systemctl reload nginx
wait_for_readiness 'Public HTTP-01 exact-token proof' probe_public_http01
sudo_run certbot certonly --webroot --webroot-path "$WEBROOT" --non-interactive \
    --cert-name "$DOMAIN" --keep-until-expiring -d "$DOMAIN"
sudo_run openssl x509 -in "$CERTIFICATE" -noout -checkhost "$DOMAIN" >/dev/null \
    || fail "Watten certificate does not cover its hostname"
sudo_run openssl x509 -in "$CERTIFICATE" -noout -checkend 604800 >/dev/null \
    || fail "Watten certificate expires within seven days"

cat >"$temporary/renew-hook" <<'HOOK'
#!/bin/sh
set -eu
/usr/sbin/nginx -t
/bin/systemctl reload nginx
HOOK
if sudo_run test -e "$RENEW_HOOK"; then
    sudo_run cmp -s -- "$temporary/renew-hook" "$RENEW_HOOK" || fail "Unrecognised existing Watten renewal hook"
else
    sudo_run install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
    hook_created=1
    sudo_run install -m 0755 -- "$temporary/renew-hook" "$RENEW_HOOK"
fi
if [[ "$staging_created" == "1" ]]; then sudo_run rm -f -- "$STAGING"; staging_created=0; fi
target_changed=1
sudo_run install -m 0644 -- "$SOURCE" "$TARGET"
sudo_run nginx -t
sudo_run systemctl reload nginx
wait_for_readiness 'Verified closed origin HTTPS' probe_origin_https
wait_for_readiness 'Permanent HTTP-01 exact-token proof' probe_public_http01
sudo_run certbot renew --dry-run --cert-name "$DOMAIN"
wait_for_readiness 'Verified closed public HTTPS' probe_public_https
check_existing_hosts || fail "An existing product host failed after activation"
printf 'Watten reserved with verified HTTPS and renewal; public gameplay remains closed.\n'
printf 'Target: %s; previous target backup: %s\n' "$TARGET" "${backup:-none; target was absent}"
completed=1
