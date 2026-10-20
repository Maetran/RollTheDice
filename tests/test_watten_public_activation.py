"""Public beta activation proves readiness and restores its own vhost on failure."""

import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def execute(**flags):
    doubles = r'''
sudo() {
  shift
  case "$*" in
    "cp "*) echo COPY >&2 ;;
    "install "*) echo INSTALL >&2 ;;
    "systemctl reload nginx") echo RELOAD >&2 ;;
    "nginx -t") nginx_checks=$((nginx_checks+1)); [[ "$nginx_checks" != "$FAIL_CHECK" ]] ;;
    *) return 0 ;;
  esac
}
nginx_checks=0
curl() {
  if [[ "$*" == *"https://"* ]]; then
    echo PUBLIC >&2
    [[ "$PUBLIC_FAIL" == 0 ]] || return 22
  else
    echo BACKEND >&2
  fi
  printf '{"game_access":{"watten_public":%s}}' "$BETA"
}
'''
    env = {**os.environ, "APPLY": "1", "FAIL_CHECK": "0", "PUBLIC_FAIL": "0", "BETA": "true", **flags}
    return subprocess.run(["bash", "-s"], input=doubles + (ROOT / "scripts/activate_watten_public.sh").read_text(),
                          cwd=ROOT, env=env, capture_output=True, text=True, timeout=10)


def test_dry_run_checks_backend_without_changing_nginx():
    result = execute(APPLY="0")
    assert result.returncode == 0, result.stderr
    assert "DRY RUN" in result.stdout
    assert "BACKEND" in result.stderr
    assert "COPY" not in result.stderr and "INSTALL" not in result.stderr and "RELOAD" not in result.stderr


def test_closed_backend_prevents_publication():
    result = execute(BETA="false")
    assert result.returncode != 0
    assert "INSTALL" not in result.stderr and "COPY" not in result.stderr


def test_publication_proves_real_edge_after_reload_and_preserves_backup():
    result = execute()
    assert result.returncode == 0, result.stderr
    trace = result.stderr
    assert trace.index("BACKEND") < trace.index("COPY") < trace.index("INSTALL") < trace.index("RELOAD") < trace.index("PUBLIC")
    assert "Previous vhost:" in result.stdout


def test_nginx_and_public_failures_restore_previous_vhost():
    for flags in ({"FAIL_CHECK": "2"}, {"PUBLIC_FAIL": "1"}):
        result = execute(**flags)
        assert result.returncode != 0
        assert result.stderr.count("COPY") == 2
        assert "restored the previous Watten vhost" in result.stderr


def test_public_vhost_keeps_origin_trust_microphone_and_acme():
    config = (ROOT / "deploy/nginx/watten-public.conf").read_text()
    assert "server_name watten.zockdiewandan.online;" in config
    assert "/etc/letsencrypt/live/watten.zockdiewandan.online/fullchain.pem" in config
    assert "proxy_pass http://rollthedice_backend;" in config
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in config
    assert "proxy_set_header X-RTD-Cloudflare-Peer $realip_remote_addr;" in config
    assert "microphone=(self)" in config
    assert "location ^~ /.well-known/acme-challenge/" in config
    assert "location /ws/" in config
    assert "noindex" not in config and "return 503" not in config
