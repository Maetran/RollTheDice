"""Exercise closed-domain activation and rollback without contacting production."""

from __future__ import annotations

import os
import subprocess
import unittest
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
TARGET = "/etc/nginx/conf.d/watten-reserved.conf"
STAGING = "/etc/nginx/conf.d/watten-acme-staging.conf"


class WattenReservationActivationTestCase(unittest.TestCase):
    def execute(self, **flags):
        doubles = r'''
sudo() {
    shift
    case "$*" in
        "test -e /etc/nginx/conf.d/watten-reserved.conf") return "$TARGET_MISSING" ;;
        "test -e /etc/nginx/conf.d/watten-acme-staging.conf") return "$STAGING_MISSING" ;;
        "test -e /etc/letsencrypt/renewal-hooks/deploy/rollthedice-watten-nginx-reload.sh") return "$HOOK_MISSING" ;;
        "cmp -s -- deploy/nginx/"*) return "$TARGET_DIFFERS" ;;
        "cmp -s -- "*) return "$HOOK_DIFFERS" ;;
        "tee "*) cat >/dev/null; echo "WRITE:$*" >&2 ;;
        "cp "*) echo "COPY:$*" >&2 ;;
        "rm "*) echo "REMOVE:$*" >&2 ;;
        "install -m 0644 "*) echo INSTALL_TARGET >&2; return "$INSTALL_FAIL" ;;
        "install -m 0755 "*) echo INSTALL_HOOK >&2 ;;
        "certbot certonly "*) echo ISSUE >&2; return "$CERT_FAIL" ;;
        "certbot renew "*) echo RENEW >&2; return "$RENEW_FAIL" ;;
        "openssl x509"*) return "$CERT_INVALID" ;;
        "nginx -t")
            nginx_tests=$((nginx_tests + 1))
            if [[ "$nginx_tests" == "$NGINX_FAIL_AT" ]]; then return 1; fi
            ;;
        "nginx -T")
            if [[ "$DEFAULT_IPV4_MISSING" == 0 ]]; then echo '    listen 80 default_server;'; fi
            if [[ "$DEFAULT_IPV6_MISSING" == 0 ]]; then echo '    listen [::]:80 default_server;'; fi
            ;;
        "systemctl reload "*)
            echo RELOAD >&2
            reloads=$((reloads + 1))
            if [[ "$reloads" == "$RELOAD_FAIL_AT" ]]; then return 1; fi
            ;;
    esac
    return 0
}
nginx() { return 0; }
certbot() { return 0; }
systemctl() { return 0; }
dig() { if [[ "$DNS_MISSING" == 0 ]]; then echo 104.21.75.229; fi; }
openssl() { echo 0123456789abcdef0123456789abcdef; }
sleep() { echo WAIT >&2; }
proof_attempts=0
closed_attempts=0
nginx_tests=0
reloads=0
curl() {
    local output="" headers="" previous="" url="" mode=public argument body
    for argument in "$@"; do
        if [[ "$previous" == --output ]]; then output="$argument"; fi
        if [[ "$previous" == --dump-header ]]; then headers="$argument"; fi
        if [[ "$argument" == --resolve ]]; then mode=origin; fi
        if [[ "$argument" == http://* || "$argument" == https://* ]]; then url="$argument"; fi
        previous="$argument"
    done
    case "$url" in
        http://watten.*)
            proof_attempts=$((proof_attempts + 1))
            echo "PROOF:$url" >&2
            if [[ "$HTTP_FAIL_FROM" -gt 0 && "$proof_attempts" -ge "$HTTP_FAIL_FROM" ]]; then return 22; fi
            body="${url##*/}"
            if [[ "$proof_attempts" -le "$HTTP_WRONG_BODIES" ]]; then body=wrong; fi
            if [[ "$PROOF_SUFFIX" == newline ]]; then body+=$'\n'; fi
            printf '%s' "$body" >"$output"
            printf '%s' "$HTTP_STATUS"
            ;;
        https://watten.*)
            echo "CLOSED:$mode:$url" >&2
            closed_attempts=$((closed_attempts + 1))
            if [[ "$mode" == origin && "$closed_attempts" -le "$TLS_FAILURES" ]]; then return 60; fi
            if [[ "$mode" == public && "$PUBLIC_FAIL" == 1 ]]; then return 60; fi
            printf 'HTTP/2 503\r\nCache-Control: %s\r\nX-Robots-Tag: noindex, nofollow\r\n' "$CACHE_POLICY" >"$headers"
            if [[ "$COOKIE_PRESENT" == 1 ]]; then printf 'Set-Cookie: secret=present\r\n' >>"$headers"; fi
            if [[ "$url" == */robots.txt ]]; then
                printf 'User-agent: *\nDisallow: /\n' >"$output"
                printf 200
            else
                printf '<body data-watten-reserved="true">Watten ist noch nicht verfügbar. Watten is not available yet.</body>' >"$output"
                printf '%s' "$CLOSED_STATUS"
            fi
            ;;
        *)
            echo "EXISTING:$url" >&2
            if [[ "$EXISTING_FAIL" == 1 ]]; then printf 500
            elif [[ "$url" == https://zdwa.* ]]; then printf 308
            else printf 200; fi
            ;;
    esac
}
'''
        defaults = {
            "APPLY": "1", "TARGET_MISSING": "1", "STAGING_MISSING": "1",
            "HOOK_MISSING": "1", "TARGET_DIFFERS": "0", "HOOK_DIFFERS": "0",
            "INSTALL_FAIL": "0", "CERT_FAIL": "0", "RENEW_FAIL": "0", "CERT_INVALID": "0",
            "DNS_MISSING": "0", "HTTP_WRONG_BODIES": "0", "HTTP_STATUS": "200", "PROOF_SUFFIX": "",
            "HTTP_FAIL_FROM": "0", "NGINX_FAIL_AT": "0", "RELOAD_FAIL_AT": "0",
            "DEFAULT_IPV4_MISSING": "0", "DEFAULT_IPV6_MISSING": "0",
            "TLS_FAILURES": "0", "PUBLIC_FAIL": "0", "CLOSED_STATUS": "503",
            "CACHE_POLICY": "no-store", "COOKIE_PRESENT": "0", "EXISTING_FAIL": "0",
        }
        return subprocess.run(
            ["bash", "-s"], input=doubles + (BASE / "scripts/activate_watten.sh").read_text(),
            cwd=BASE, text=True, capture_output=True, timeout=10,
            env={**os.environ, **defaults, **flags},
        )

    def test_dry_run_has_no_writes_certificate_requests_or_reloads(self):
        result = self.execute(APPLY="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DRY RUN ONLY", result.stdout)
        for forbidden in ("WRITE:", "REMOVE:", "COPY:", "ISSUE", "INSTALL", "RELOAD", "RENEW"):
            self.assertNotIn(forbidden, result.stderr)

    def test_unknown_files_missing_dns_and_unhealthy_existing_host_abort_without_writes(self):
        for flags in ({"STAGING_MISSING": "0"}, {"TARGET_MISSING": "0", "TARGET_DIFFERS": "1"},
                      {"DNS_MISSING": "1"}, {"EXISTING_FAIL": "1"},
                      {"DEFAULT_IPV4_MISSING": "1"}, {"DEFAULT_IPV6_MISSING": "1"}):
            with self.subTest(flags=flags):
                result = self.execute(**flags)
                self.assertNotEqual(result.returncode, 0)
                for forbidden in ("WRITE:", "REMOVE:", "COPY:", "ISSUE", "INSTALL", "RELOAD", "RENEW"):
                    self.assertNotIn(forbidden, result.stderr)

    def test_public_proof_precedes_issuance_and_final_closed_checks_precede_success(self):
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        trace = result.stderr
        self.assertLess(trace.index("PROOF:"), trace.index("ISSUE"))
        self.assertLess(trace.index("ISSUE"), trace.index("INSTALL_TARGET"))
        self.assertLess(trace.index(f"REMOVE:rm -f -- {STAGING}"), trace.index("INSTALL_TARGET"))
        self.assertLess(trace.index("CLOSED:origin:"), trace.index("RENEW"))
        self.assertLess(trace.index("RENEW"), trace.index("CLOSED:public:"))
        self.assertEqual(trace.count("EXISTING:"), 10)  # five preserved hosts, before and after
        for mode in ("origin", "public"):
            for path in ("/api/auth/me", "/watten-sw.js", "/sitemap.xml", "/ws/watten", "/robots.txt"):
                self.assertIn(f"CLOSED:{mode}:https://watten.zockdiewandan.online{path}", trace)

    def test_retries_use_fresh_tokens_and_require_exact_bytes(self):
        result = self.execute(HTTP_WRONG_BODIES="2")
        self.assertEqual(result.returncode, 0, result.stderr)
        paths = [line.removeprefix("PROOF:") for line in result.stderr.splitlines() if line.startswith("PROOF:")]
        self.assertEqual(len(paths), 4)
        self.assertEqual(len(set(paths)), 4)
        self.assertEqual(result.stderr.count("WAIT"), 2)
        for path in paths:
            token = path.rsplit("/", 1)[1]
            self.assertIn(f"REMOVE:rm -f -- /var/lib/letsencrypt/.well-known/acme-challenge/{token}", result.stderr)
        for flags in ({"HTTP_WRONG_BODIES": "99"}, {"PROOF_SUFFIX": "newline"}, {"HTTP_STATUS": "302"}):
            with self.subTest(flags=flags):
                result = self.execute(**flags)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stderr.count("PROOF:"), 10)
                self.assertEqual(result.stderr.count("WAIT"), 9)
                self.assertNotIn("ISSUE", result.stderr)

    def test_tls_readiness_waits_without_disabling_hostname_or_chain_verification(self):
        result = self.execute(TLS_FAILURES="2")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr.count("WAIT"), 2)
        source = (BASE / "scripts/activate_watten.sh").read_text()
        for forbidden in ("--insecure", "-k ", "--location", "--retry", "docker ", "ufw "):
            self.assertNotIn(forbidden, source)

    def test_failed_install_closed_policy_tls_renewal_or_hook_rolls_back_only_owned_files(self):
        for flags in ({"INSTALL_FAIL": "1"}, {"CERT_FAIL": "1"},
                      {"NGINX_FAIL_AT": "3"}, {"RELOAD_FAIL_AT": "2"},
                      {"CLOSED_STATUS": "200"}, {"CACHE_POLICY": "public"},
                      {"COOKIE_PRESENT": "1"}, {"TLS_FAILURES": "99"}, {"PUBLIC_FAIL": "1"},
                      {"RENEW_FAIL": "1"}, {"CERT_INVALID": "1"},
                      {"HOOK_MISSING": "0", "HOOK_DIFFERS": "1"}):
            with self.subTest(flags=flags):
                result = self.execute(**flags)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Watten activation failed", result.stderr)
                self.assertNotIn("rollthedice.conf", result.stderr)
                if "INSTALL_TARGET" in result.stderr:
                    self.assertIn(f"REMOVE:rm -f -- {TARGET}", result.stderr)

    def test_failed_permanent_challenge_prevents_renewal_and_rolls_back(self):
        result = self.execute(HTTP_FAIL_FROM="2")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("INSTALL_TARGET", result.stderr)
        self.assertIn("Permanent HTTP-01 exact-token proof did not become ready", result.stderr)
        self.assertNotIn("RENEW", result.stderr)
        self.assertIn(f"REMOVE:rm -f -- {TARGET}", result.stderr)

    def test_repeat_activation_never_stages_a_duplicate_host_and_preserves_previous_target(self):
        result = self.execute(TARGET_MISSING="0", RENEW_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(f"WRITE:tee {STAGING}", result.stderr)
        self.assertEqual(result.stderr.count("COPY:"), 2)
        self.assertNotIn(f"REMOVE:rm -f -- {TARGET}", result.stderr)


class WattenReservedNginxTestCase(unittest.TestCase):
    def test_both_host_blocks_are_closed_and_only_http_challenge_serves_files(self):
        source = (BASE / "deploy/nginx/watten-reserved.conf").read_text()
        blocks = source.split("server {\n")[1:]
        self.assertEqual(len(blocks), 2)
        for block in blocks:
            self.assertIn("server_name watten.zockdiewandan.online;", block)
        self.assertNotIn("proxy_pass", source)
        self.assertNotIn("rollthedice_backend", source)
        self.assertIn("/live/watten.zockdiewandan.online/fullchain.pem", source)
        https = blocks[1]
        self.assertIn("return 503", https)
        self.assertIn('add_header X-Robots-Tag "noindex, nofollow" always;', https)
        self.assertIn('add_header Cache-Control "no-store" always;', https)
        self.assertIn('return 200 "User-agent: *\\nDisallow: /\\n";', https)
        self.assertNotIn("Sitemap:", https)
        self.assertNotIn('rel="manifest"', https)
