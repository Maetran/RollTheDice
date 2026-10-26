"""Execute deployment guards with command doubles; never contact production."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("verify_public_release", BASE / "scripts/verify_public_release.py")
assert spec and spec.loader
public_smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public_smoke)


class HausdeppActivationTestCase(unittest.TestCase):
    def execute(self, **flags):
        doubles = r'''
sudo() {
  shift
  case "$*" in
    "test -e "*) return "$EXISTING_STAGING" ;;
    "grep -Fq "*) return "$FINAL_HOST_PRESENT" ;;
    "tee "*) cat >/dev/null; echo TEE >&2 ;;
    "cp "*) echo BACKUP_OR_RESTORE >&2 ;;
    "rm "*) echo "REMOVE:$*" >&2 ;;
    "certbot certonly "*) echo ISSUE >&2; return "$CERT_FAIL" ;;
    "certbot renew "*) echo RENEW >&2; return "$RENEW_FAIL" ;;
    "systemctl reload "*) echo RELOAD >&2 ;;
  esac
  return 0
}
nginx() { return 0; }
certbot() { return 0; }
systemctl() { return 0; }
dig() { echo 104.21.75.229; }
openssl() { echo 0123456789abcdef0123456789abcdef; }
tls_attempts=0
proof_attempts=0
sleep() { echo WAIT >&2; }
curl() {
  case "$*" in
    *"http://hausdepp."*)
      echo PROOF >&2
      proof_attempts=$((proof_attempts + 1))
      if [[ "$proof_attempts" -le "$HTTP_FAILURES" ]]; then return 22; fi
      if [[ "$HTTP_FAIL_FROM" -gt 0 && "$proof_attempts" -ge "$HTTP_FAIL_FROM" ]]; then return 22; fi
      output=""
      previous=""
      url=""
      for argument in "$@"; do
        if [[ "$previous" == "--output" ]]; then output="$argument"; fi
        if [[ "$argument" == http://* ]]; then url="$argument"; fi
        previous="$argument"
      done
      echo "PROBE_PATH:$url" >&2
      body="$PROOF_RESPONSE"
      if [[ "$body" == "__exact__" || "$body" == "__exact_newline__" || "$body" == "__exact_extra__" ]]; then
        body="${url##*/}"
        if [[ "$PROOF_RESPONSE" == "__exact_newline__" ]]; then body+=$'\n'; fi
        if [[ "$PROOF_RESPONSE" == "__exact_extra__" ]]; then body+="extra"; fi
      fi
      if [[ "$proof_attempts" -le "$HTTP_WRONG_BODIES" ]]; then body="wrong-token"; fi
      printf '%s' "$body" > "$output"
      printf '%s' "$HTTP_STATUS"
      ;;
    *)
      echo ORIGIN_TLS >&2
      tls_attempts=$((tls_attempts + 1))
      if [[ "$tls_attempts" -le "$TLS_FAILURES" ]]; then return "$TLS_EXIT_CODE"; fi
      ;;
  esac
}
bash() { echo INSTALL >&2; return "$INSTALL_FAIL"; }
'''
        defaults = {
            "APPLY": "1", "EXISTING_STAGING": "1", "FINAL_HOST_PRESENT": "1",
            "CERT_FAIL": "0", "RENEW_FAIL": "0", "INSTALL_FAIL": "0",
            "TLS_FAILURES": "0", "TLS_EXIT_CODE": "35",
            "HTTP_FAILURES": "0", "HTTP_WRONG_BODIES": "0",
            "HTTP_FAIL_FROM": "0", "HTTP_STATUS": "200", "PROOF_RESPONSE": "__exact__",
        }
        # A regular-file stdin avoids a Darwin pipe deadlock while Bash emits
        # output before subprocess.communicate() finishes sending the script.
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as script:
            script.write(doubles + (BASE / "scripts/activate_hausdepp.sh").read_text())
            script.seek(0)
            return subprocess.run(
                ["bash", "-s"], stdin=script, text=True, capture_output=True, cwd=BASE, timeout=10,
                env={**os.environ, **defaults, **flags},
            )

    def test_dry_run_does_not_write_stage_issue_reload_or_install(self):
        result = self.execute(APPLY="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("DRY RUN ONLY", result.stdout)
        for operation in ("TEE", "ISSUE", "RELOAD", "INSTALL", "BACKUP_OR_RESTORE"):
            self.assertNotIn(operation, result.stderr)

    def test_public_challenge_precedes_issue_and_staging_is_removed_before_install(self):
        result = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        trace = result.stderr
        self.assertLess(trace.index("PROOF"), trace.index("ISSUE"))
        staging_cleanup = "REMOVE:rm -f -- /etc/nginx/conf.d/hausdepp-acme-staging.conf"
        self.assertLess(trace.index("ISSUE"), trace.index(staging_cleanup))
        self.assertLess(trace.index(staging_cleanup), trace.index("INSTALL"))
        self.assertLess(trace.index("INSTALL"), trace.index("ORIGIN_TLS"))
        self.assertLess(trace.index("ORIGIN_TLS"), trace.index("RENEW"))

    def test_proof_certificate_install_and_renewal_failures_restore_configuration(self):
        for flags in ({"PROOF_RESPONSE": "wrong"}, {"CERT_FAIL": "1"},
                      {"INSTALL_FAIL": "1"}, {"RENEW_FAIL": "1"}):
            with self.subTest(flags=flags):
                result = self.execute(**flags)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stderr.count("BACKUP_OR_RESTORE"), 2)
                self.assertIn("Activation failed; restored", result.stderr)
                self.assertIn("REMOVE:rm -f -- /etc/nginx/conf.d/hausdepp-acme-staging.conf", result.stderr)
                if "PROOF_RESPONSE" in flags:
                    self.assertNotIn("ISSUE", result.stderr)

    def test_existing_unknown_staging_file_is_not_removed_or_overwritten(self):
        result = self.execute(EXISTING_STAGING="0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unrecognised existing staging", result.stderr)
        self.assertNotIn("TEE", result.stderr)
        self.assertNotIn("REMOVE:rm -f -- /etc/nginx/conf.d/hausdepp-acme-staging.conf", result.stderr)

    def test_repeat_activation_uses_permanent_challenge_without_duplicate_vhost(self):
        result = self.execute(FINAL_HOST_PRESENT="0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr.count("TEE"), 3)  # both HTTP gates + renewal hook only
        self.assertNotIn("/etc/nginx/conf.d/hausdepp-acme-staging.conf", result.stderr)

    def test_transient_old_worker_sni_rejection_waits_then_accepts_verified_https(self):
        result = self.execute(TLS_FAILURES="2")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr.count("ORIGIN_TLS"), 3)
        self.assertEqual(result.stderr.count("WAIT"), 2)
        self.assertEqual(result.stderr.count("BACKUP_OR_RESTORE"), 1)
        self.assertIn("RENEW", result.stderr)
        self.assertNotIn("Activation failed", result.stderr)

    def test_staging_http_404_or_wrong_body_retries_until_exact_token_before_certbot(self):
        for flags in ({"HTTP_FAILURES": "2"}, {"HTTP_WRONG_BODIES": "2"}):
            with self.subTest(flags=flags):
                result = self.execute(**flags)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stderr.count("PROOF"), 4)  # three staging attempts + permanent proof
                self.assertEqual(result.stderr.count("WAIT"), 2)
                issue = result.stderr.index("ISSUE")
                self.assertEqual(result.stderr[:issue].count("PROOF"), 3)
                self.assertLess(result.stderr.rindex("PROOF"), result.stderr.index("RENEW"))
                self.assertEqual(result.stderr.count("BACKUP_OR_RESTORE"), 1)

    def test_persistent_http_404_wrong_token_or_trailing_bytes_never_issues_certificate(self):
        for flags in ({"HTTP_FAILURES": "99"}, {"PROOF_RESPONSE": "wrong-token"},
                      {"PROOF_RESPONSE": "__exact_newline__"}, {"PROOF_RESPONSE": "__exact_extra__"},
                      {"HTTP_STATUS": "302"}):
            with self.subTest(flags=flags):
                result = self.execute(**flags)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stderr.count("PROOF"), 10)
                self.assertEqual(result.stderr.count("WAIT"), 9)
                self.assertEqual(result.stderr.count("BACKUP_OR_RESTORE"), 2)
                self.assertIn("Public HTTP-01 exact-token proof did not become ready", result.stderr)
                for forbidden in ("ISSUE", "INSTALL", "ORIGIN_TLS", "RENEW"):
                    self.assertNotIn(forbidden, result.stderr)

    def test_permanent_http_proof_is_required_after_final_reload_before_renewal(self):
        result = self.execute(HTTP_FAIL_FROM="2")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ISSUE", result.stderr)  # initial public proof passed
        self.assertIn("INSTALL", result.stderr)
        self.assertIn("ORIGIN_TLS", result.stderr)
        self.assertNotIn("RENEW", result.stderr)
        self.assertEqual(result.stderr.count("PROOF"), 11)
        self.assertEqual(result.stderr.count("WAIT"), 9)
        self.assertEqual(result.stderr.count("BACKUP_OR_RESTORE"), 2)
        self.assertIn("Permanent HTTP-01 exact-token proof did not become ready", result.stderr)

    def test_each_public_retry_uses_a_fresh_path_and_previous_token_is_removed(self):
        result = self.execute(HTTP_WRONG_BODIES="2")
        self.assertEqual(result.returncode, 0, result.stderr)
        paths = [line.removeprefix("PROBE_PATH:") for line in result.stderr.splitlines()
                 if line.startswith("PROBE_PATH:")]
        self.assertEqual(len(paths), 4)
        self.assertEqual(len(set(paths)), 4)
        for path in paths:
            token = path.rsplit("/", 1)[1]
            self.assertIn(f"REMOVE:rm -f -- /var/lib/letsencrypt/.well-known/acme-challenge/{token}", result.stderr)

    def test_persistent_tls_or_certificate_failure_remains_bounded_and_rolls_back(self):
        for error in ("35", "60"):
            with self.subTest(curl_error=error):
                result = self.execute(TLS_FAILURES="99", TLS_EXIT_CODE=error)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(result.stderr.count("ORIGIN_TLS"), 10)
                self.assertEqual(result.stderr.count("WAIT"), 9)
                self.assertEqual(result.stderr.count("BACKUP_OR_RESTORE"), 2)
                self.assertNotIn("RENEW", result.stderr)
                self.assertIn("Verified Hausdepp HTTPS did not become ready", result.stderr)

    def test_reload_wait_preserves_tls_hostname_chain_and_http_health_verification(self):
        source = (BASE / "scripts/activate_hausdepp.sh").read_text()
        wait = source.split("probe_origin_https() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("--resolve", wait)
        self.assertIn("--fail", wait)
        self.assertIn("--max-time 3", wait)
        self.assertNotIn("--insecure", wait)
        self.assertNotIn(" -k", wait)

    def test_staging_probe_uses_public_cloudflare_path_and_exact_body_with_common_bounded_wait(self):
        source = (BASE / "scripts/activate_hausdepp.sh").read_text()
        probe = source.split("probe_public_http01() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('"http://$DOMAIN/.well-known/acme-challenge/$probe"', probe)
        self.assertIn('cmp -s - "$probe_response_file"', probe)
        self.assertIn("--fail", probe)
        self.assertIn("--max-time 3", probe)
        self.assertNotIn("--resolve", probe.split("if curl", 1)[1])
        self.assertNotIn("--location", probe)
        wait = source.split("wait_for_readiness() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("{1..10}", wait)
        self.assertIn("sleep 1", wait)

    def test_house_proxy_and_security_directives_match_existing_products(self):
        source = (BASE / "deploy/nginx/rollthedice.conf").read_text()
        blocks = source.split("server {\n")
        regular = next(block for block in blocks if "www.zockdiewandan.online\n" in block)
        house = next(block for block in blocks if "server_name hausdepp.zockdiewandan.online;" in block
                     and "listen 443 ssl" in block)
        # Both the dedicated Hausdepp PWA and existing suite PWAs may request
        # their own microphone. Camera/location and cross-origin access stay closed.
        self.assertIn('Permissions-Policy "camera=(), microphone=(self), geolocation=()"', house)
        self.assertIn('Permissions-Policy "camera=(), microphone=(self), geolocation=()"', regular)
        for prefix in ("add_header", "proxy_", "client_max_body_size", "limit_req ", "limit_conn "):
            old = [line.strip() for line in regular.splitlines() if line.strip().startswith(prefix)]
            new = [line.strip() for line in house.splitlines() if line.strip().startswith(prefix)]
            self.assertTrue(old, prefix)
            self.assertEqual(new, old, prefix)
        self.assertIn("/live/hausdepp.zockdiewandan.online/fullchain.pem", house)
        self.assertIn("location ^~ /.well-known/acme-challenge/", source)

    def test_microphone_policy_covers_all_trusted_tls_entry_hosts_without_delegation(self):
        source = (BASE / "deploy/nginx/rollthedice.conf").read_text()
        entry_blocks = [block for block in source.split("server {\n")
                        if "listen 443 ssl" in block and "server_name" in block]
        covered_hosts = set()
        for block in entry_blocks:
            with self.subTest(server=block.split("server_name", 1)[1].split(";", 1)[0].strip()):
                hosts = block.split("server_name", 1)[1].split(";", 1)[0].split()
                covered_hosts.update(hosts)
                policies = [line.strip() for line in block.splitlines()
                            if line.strip().startswith("add_header Permissions-Policy ")]
                self.assertEqual(policies, [
                    'add_header Permissions-Policy "camera=(), microphone=(self), geolocation=()" always;'
                ])
        self.assertEqual(covered_hosts, {
            "zockdiewandan.online", "www.zockdiewandan.online", "zdwa.zockdiewandan.online",
            "zilch.zockdiewandan.online", "hausdepp.zockdiewandan.online",
        })
        legacy = next(block for block in entry_blocks
                      if "server_name zdwa.zockdiewandan.online;" in block)
        self.assertIn("return 308 https://zockdiewandan.online$request_uri;", legacy)


class HausdeppInstallGuardTestCase(unittest.TestCase):
    def test_missing_house_san_prevents_copy_and_nginx_reload(self):
        doubles = r'''
sudo() {
  case "$*" in
    *"openssl x509"*"-checkhost hausdepp.zockdiewandan.online") return 1 ;;
    *"cp "*|*"install "*|*"reload nginx"*) echo MUTATION ;;
  esac
  return 0
}
'''
        result = subprocess.run(
            ["bash", "-s"], input=doubles + (BASE / "scripts/install_nginx_config.sh").read_text(),
            text=True, capture_output=True, cwd=BASE, env=os.environ,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Certificate does not cover hausdepp.zockdiewandan.online", result.stderr)
        self.assertIn("scripts/activate_hausdepp.sh", result.stderr)
        self.assertNotIn("MUTATION", result.stdout)


class PublicReleaseSmokeTestCase(unittest.TestCase):
    def response(self, url, *, final_url=None):
        headers = {name: "present" for name in public_smoke.SECURITY_HEADERS}
        if url.endswith("/api/auth/me"):
            return json.dumps({"authenticated": False, "user": None, "passkeys": {"enabled": True},
                               "game_access": {"hausdepp_public": True}}), {"cache-control": "no-store"}
        if "/hausdepp/anmelden?" in url or url.endswith("/hausdepp/konto"):
            return ('<html data-hausdepp-login="true"><head>'
                    '<link rel="manifest" href="/hausdepp-manifest.webmanifest?v=current"></head></html>'), {
                        "cache-control": "no-store", "x-robots-tag": "noindex, nofollow",
                    }
        if "/api/releases?" in url:
            version = json.loads((BASE / "app/version.json").read_text())["version"]
            return json.dumps({"current_version": version}), {}
        if url.endswith("/api/health"):
            return json.dumps({"status": "ok"}), headers
        if url.endswith("/sitemap.xml"):
            return ('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
                    f'<url><loc>{public_smoke.HAUSDEPP}/hausdepp</loc></url>'
                    f'<url><loc>{public_smoke.HAUSDEPP}/hausdepp/regeln</loc></url></urlset>'), {}
        if url.endswith("/robots.txt"):
            return f"Sitemap: {public_smoke.HAUSDEPP}/sitemap.xml", {}
        if url.endswith(".webmanifest"):
            return json.dumps({"start_url": "/hausdepp?installed=hausdepp"}), {}
        if url.endswith("/hausdepp-sw.js"):
            return "/* worker */", {"service-worker-allowed": "/hausdepp"}
        if url == public_smoke.HAUSDEPP + "/hausdepp":
            return (BASE / "app/static/hausdepp-lobby.html").read_text(), headers
        return f'<link rel="canonical" href="{final_url or url}">', headers

    def watten_response(self, url, *, beta, final_url=None):
        body, headers = self.response(url, final_url=final_url)
        if url.endswith("/api/auth/me"):
            auth = json.loads(body)
            auth["game_access"]["watten_public"] = True
            auth["game_presentation"] = {"watten": {"beta": beta}}
            return json.dumps(auth), headers
        if not url.startswith(public_smoke.WATTEN + "/"):
            return body, headers
        if url.endswith("/sitemap.xml"):
            locations = (f"{public_smoke.WATTEN}{path}{suffix}"
                         for path in ("/watten", "/watten/regeln") for suffix in ("", "?lang=en"))
            return "<urlset>" + "".join(f"<url><loc>{value}</loc></url>" for value in locations) + "</urlset>", headers
        if url.endswith("/robots.txt"):
            return f"Sitemap: {public_smoke.WATTEN}/sitemap.xml", headers
        if url.endswith(".webmanifest"):
            manifest = json.loads((BASE / "app/static" / url.rsplit("/", 1)[1]).read_text())
            manifest["name"] = "Watten [BETA]" if beta else "Watten"
            return json.dumps(manifest), headers
        if url.endswith("/watten-sw.js"):
            return "/* worker */", {"service-worker-allowed": "/"}
        for path, filename in (("/watten", "watten-game.html"), ("/watten/regeln", "watten-rules.html")):
            if url in (public_smoke.WATTEN + path, public_smoke.WATTEN + path + "?lang=en"):
                page = (BASE / "app/static" / filename).read_text().replace(
                    '<meta name="robots" content="noindex, nofollow">', '<meta name="robots" content="index, follow">')
                return f'<link rel="canonical" href="{url}">' + page, headers
        return body, headers

    def test_all_public_products_and_house_search_and_pwa_surface_pass(self):
        with patch.object(public_smoke, "fetch", side_effect=self.response) as fetch:
            with patch("sys.stdout", new=io.StringIO()):
                public_smoke.verify_release()
        urls = [call.args[0] for call in fetch.call_args_list]
        self.assertIn(f"{public_smoke.HAUSDEPP}/hausdepp/regeln", urls)
        self.assertIn(f"{public_smoke.ZILCH}/api/health", urls)
        self.assertIn(f"{public_smoke.WWW}/api/health", urls)
        self.assertIn(f"{public_smoke.HAUSDEPP}/api/auth/me", urls)
        self.assertIn(f"{public_smoke.HAUSDEPP}/hausdepp/konto", urls)

    def test_public_watten_accepts_both_live_beta_labels_in_both_languages(self):
        for beta in (True, False):
            def response(url, *, final_url=None):
                return self.watten_response(url, beta=beta, final_url=final_url)
            with self.subTest(beta=beta), patch.object(public_smoke, "fetch", side_effect=response) as fetch:
                with patch("sys.stdout", new=io.StringIO()):
                    public_smoke.verify_release()
                urls = [call.args[0] for call in fetch.call_args_list]
                for suffix in (".webmanifest", "-en.webmanifest"):
                    self.assertIn(f"{public_smoke.WATTEN}/watten-manifest{suffix}", urls)

    def test_watten_rejects_stale_beta_labels_in_either_language(self):
        for beta in (True, False):
            for suffix in (".webmanifest", "-en.webmanifest"):
                def response(url, *, final_url=None):
                    body, headers = self.watten_response(url, beta=beta, final_url=final_url)
                    if url == f"{public_smoke.WATTEN}/watten-manifest{suffix}":
                        manifest = json.loads(body)
                        manifest["name"] = "Watten" if beta else "Watten [BETA]"
                        body = json.dumps(manifest)
                    return body, headers
                with self.subTest(beta=beta, language=suffix), patch.object(public_smoke, "fetch", side_effect=response):
                    with patch("sys.stdout", new=io.StringIO()), self.assertRaisesRegex(ValueError, "install metadata"):
                        public_smoke.verify_release()

    def test_watten_requires_a_present_strict_boolean_beta_presentation(self):
        invalid = ({}, {"game_presentation": None}, {"game_presentation": []},
                   {"game_presentation": {"watten": None}}, {"game_presentation": {"watten": {}}},
                   *({"game_presentation": {"watten": {"beta": value}}}
                     for value in (None, 0, 1, "true", "false", [], {})))
        for presentation in invalid:
            def response(url, *, final_url=None):
                body, headers = self.watten_response(url, beta=False, final_url=final_url)
                if url == public_smoke.WATTEN + "/api/auth/me":
                    auth = json.loads(body)
                    auth.pop("game_presentation")
                    auth.update(presentation)
                    body = json.dumps(auth)
                return body, headers
            with self.subTest(presentation=presentation), patch.object(public_smoke, "fetch", side_effect=response):
                with patch("sys.stdout", new=io.StringIO()), self.assertRaisesRegex(ValueError, "beta presentation"):
                    public_smoke.verify_release()

    def test_watten_public_access_guard_is_required_for_either_beta_label(self):
        for beta in (True, False):
            def response(url, *, final_url=None):
                body, headers = self.watten_response(url, beta=beta, final_url=final_url)
                if url == public_smoke.WATTEN + "/api/auth/me":
                    auth = json.loads(body)
                    auth["game_access"]["watten_public"] = False
                    body = json.dumps(auth)
                return body, headers
            with self.subTest(beta=beta), patch.object(public_smoke, "fetch", side_effect=response):
                with patch("sys.stdout", new=io.StringIO()), self.assertRaisesRegex(ValueError, "not publicly discoverable"):
                    public_smoke.verify_release()

    def test_watten_manifest_url_scope_and_icon_guards_remain_required_without_beta(self):
        for failure in ("start_url", "scope", "icon"):
            def response(url, *, final_url=None):
                body, headers = self.watten_response(url, beta=False, final_url=final_url)
                if url == public_smoke.WATTEN + "/watten-manifest-en.webmanifest":
                    manifest = json.loads(body)
                    if failure == "icon":
                        manifest["icons"][0]["src"] = "/static/foreign-icon.png"
                    else:
                        manifest[failure] = "/foreign-product"
                    body = json.dumps(manifest)
                return body, headers
            with self.subTest(failure=failure), patch.object(public_smoke, "fetch", side_effect=response):
                with patch("sys.stdout", new=io.StringIO()), self.assertRaisesRegex(
                        ValueError, "icon" if failure == "icon" else "install metadata"):
                    public_smoke.verify_release()

    def test_globally_disabled_passkeys_are_allowed_when_apex_and_house_agree(self):
        def disabled(url, *, final_url=None):
            body, headers = self.response(url, final_url=final_url)
            if url.endswith("/api/auth/me"):
                body = body.replace('"enabled": true', '"enabled": false')
            return body, headers
        with patch.object(public_smoke, "fetch", side_effect=disabled), patch("sys.stdout", new=io.StringIO()):
            public_smoke.verify_release()

    def test_nonpublic_house_mismatched_passkeys_or_anonymous_account_data_block_release(self):
        for failure in ("public", "passkeys", "user", "credential_hint"):
            def broken(url, *, final_url=None):
                body, headers = self.response(url, final_url=final_url)
                if url == public_smoke.HAUSDEPP + "/api/auth/me":
                    auth = json.loads(body)
                    if failure == "public":
                        auth["game_access"]["hausdepp_public"] = False
                    elif failure == "passkeys":
                        auth["passkeys"]["enabled"] = False
                    elif failure == "user":
                        auth["user"] = {"username": "private", "csrf_token": "private"}
                    else:
                        auth["passkeys"]["has_credentials"] = True
                    body = json.dumps(auth)
                return body, headers
            with self.subTest(failure=failure), patch.object(public_smoke, "fetch", side_effect=broken):
                with patch("sys.stdout", new=io.StringIO()), self.assertRaises(ValueError):
                    public_smoke.verify_release()

    def test_foreign_manifest_indexable_or_cacheable_sign_in_blocks_release(self):
        for failure in ("manifest", "indexing", "cache"):
            def broken(url, *, final_url=None):
                body, headers = self.response(url, final_url=final_url)
                if "/hausdepp/anmelden?" in url:
                    if failure == "manifest":
                        body = body.replace("hausdepp-manifest", "zilch-manifest")
                    elif failure == "indexing":
                        headers.pop("x-robots-tag")
                    else:
                        headers["cache-control"] = "public, max-age=3600"
                return body, headers
            with self.subTest(failure=failure), patch.object(public_smoke, "fetch", side_effect=broken):
                with patch("sys.stdout", new=io.StringIO()), self.assertRaises(ValueError):
                    public_smoke.verify_release()

    def test_private_page_redirect_must_stay_on_house_origin_before_any_followup_request(self):
        house = public_smoke.HAUSDEPP
        request = public_smoke.urllib.request.Request(house + "/hausdepp/konto")
        handler = public_smoke.KnownProductRedirect(house + "/hausdepp/anmelden?return_to=%2Fhausdepp%2Fkonto")
        for external in (public_smoke.APEX + "/zilch/anmelden", "https://untrusted.invalid/", "http://hausdepp.zockdiewandan.online/"):
            with self.subTest(external=external), self.assertRaises(ValueError):
                handler.redirect_request(request, None, 303, "See other", {}, external)
        safe = handler.redirect_request(request, None, 303, "See other", {}, house + "/zilch/anmelden")
        self.assertEqual(safe.full_url, house + "/zilch/anmelden")
        alias = public_smoke.KnownProductRedirect(public_smoke.APEX + "/api/health")
        redirected = alias.redirect_request(request, None, 308, "Permanent", {}, public_smoke.APEX + "/api/health")
        self.assertEqual(redirected.full_url, public_smoke.APEX + "/api/health")

    def test_private_lobby_foreign_sitemap_and_wide_worker_scope_block_release(self):
        for broken_path in ("/hausdepp", "/sitemap.xml", "/hausdepp-sw.js", "/api/health", "/api/releases?game_type=hausdepp", "stale-assets"):
            def broken(url, *, final_url=None):
                body, headers = self.response(url, final_url=final_url)
                if broken_path == "stale-assets" and url == public_smoke.HAUSDEPP + "/hausdepp":
                    return body.replace("?v=", "?v=stale"), headers
                if url == public_smoke.HAUSDEPP + broken_path:
                    if broken_path == "/hausdepp":
                        headers["x-robots-tag"] = "noindex"
                    elif broken_path == "/sitemap.xml":
                        body = body.replace("/hausdepp/regeln", "/hausdepp/konto")
                    elif broken_path == "/hausdepp-sw.js":
                        headers["service-worker-allowed"] = "/"
                    elif broken_path.startswith("/api/releases"):
                        body = '{"current_version":"0.0.0"}'
                    else:
                        body = '{"status":"unavailable"}'
                return body, headers
            with self.subTest(path=broken_path), patch.object(public_smoke, "fetch", side_effect=broken):
                with patch("sys.stdout", new=io.StringIO()), self.assertRaises(ValueError):
                    public_smoke.verify_release()
