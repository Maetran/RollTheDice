"""Execute deployment guards with command doubles; never contact production."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import subprocess
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
curl() {
  case "$*" in
    *"http://hausdepp."*) echo PROOF >&2; echo "$PROOF_RESPONSE" ;;
    *) echo ORIGIN_TLS >&2 ;;
  esac
}
bash() { echo INSTALL >&2; return "$INSTALL_FAIL"; }
'''
        defaults = {
            "APPLY": "1", "EXISTING_STAGING": "1", "FINAL_HOST_PRESENT": "1",
            "CERT_FAIL": "0", "RENEW_FAIL": "0", "INSTALL_FAIL": "0",
            "PROOF_RESPONSE": "hausdepp-0123456789abcdef0123456789abcdef",
        }
        return subprocess.run(
            ["bash", "-s"], input=doubles + (BASE / "scripts/activate_hausdepp.sh").read_text(),
            text=True, capture_output=True, cwd=BASE,
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
        self.assertEqual(result.stderr.count("TEE"), 2)  # token + renewal hook only
        self.assertNotIn("/etc/nginx/conf.d/hausdepp-acme-staging.conf", result.stderr)

    def test_house_proxy_and_security_directives_match_existing_products(self):
        source = (BASE / "deploy/nginx/rollthedice.conf").read_text()
        blocks = source.split("server {\n")
        regular = next(block for block in blocks if "www.zockdiewandan.online\n" in block)
        house = next(block for block in blocks if "server_name hausdepp.zockdiewandan.online;" in block
                     and "listen 443 ssl" in block)
        for prefix in ("add_header", "proxy_", "client_max_body_size", "limit_req ", "limit_conn "):
            old = [line.strip() for line in regular.splitlines() if line.strip().startswith(prefix)]
            new = [line.strip() for line in house.splitlines() if line.strip().startswith(prefix)]
            self.assertTrue(old, prefix)
            self.assertEqual(new, old, prefix)
        self.assertIn("/live/hausdepp.zockdiewandan.online/fullchain.pem", house)
        self.assertIn("location ^~ /.well-known/acme-challenge/", source)


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
        if "/zilch/anmelden?" in url or url.endswith("/hausdepp/konto"):
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
                if "/zilch/anmelden?" in url:
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
        handler = public_smoke.KnownProductRedirect(house + "/zilch/anmelden?return_to=%2Fhausdepp%2Fkonto")
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
