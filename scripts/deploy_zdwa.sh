#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-zdwa}"
REMOTE_DIR="${REMOTE_DIR:-/root/RollTheDice}"
REPO_MATCH="${REPO_MATCH:-Maetran/RollTheDice}"
BRANCH="${BRANCH:-master}"

if [[ "$REMOTE_DIR" == "auto" ]]; then
  REMOTE_DIR="$(
    ssh "$REMOTE" "find /root /home /opt /srv /var/www -maxdepth 6 -type d -name .git 2>/dev/null | while read -r gitdir; do repo=\${gitdir%/.git}; if git -C \"\$repo\" remote -v 2>/dev/null | grep -q '$REPO_MATCH'; then printf '%s\n' \"\$repo\"; exit 0; fi; done" || true
  )"

  if [[ -z "$REMOTE_DIR" ]]; then
    cat >&2 <<'EOF'
Could not auto-discover the remote RollTheDice checkout.
Run again with:

  REMOTE_DIR=/path/to/RollTheDice scripts/deploy_zdwa.sh
EOF
    exit 1
  fi

  if [[ "$REMOTE_DIR" == *$'\n'* ]]; then
    cat >&2 <<EOF
Multiple remote checkouts found. Pick one explicitly:

$REMOTE_DIR

Run:
  REMOTE_DIR=/path/to/RollTheDice scripts/deploy_zdwa.sh
EOF
    exit 1
  fi
fi

printf 'Deploy target: %s:%s\n' "$REMOTE" "$REMOTE_DIR"

ssh "$REMOTE" "REMOTE_DIR=$(printf '%q' "$REMOTE_DIR") BRANCH=$(printf '%q' "$BRANCH") bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$REMOTE_DIR"

echo "== Remote =="
hostname
pwd

echo "== Git status =="
git status --short --branch
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy: remote worktree has uncommitted changes." >&2
  exit 1
fi

echo "== Data backup =="
if [[ -d data ]]; then
  service_was_running=0
  resume_service() {
    if [[ "$service_was_running" == "1" ]]; then
      docker compose start rollthedice >/dev/null
      service_was_running=0
    fi
  }
  trap resume_service EXIT
  if docker compose ps --status running --services 2>/dev/null | grep -qx 'rollthedice'; then
    service_was_running=1
    docker compose stop rollthedice >/dev/null
  fi
  backup_dir="data.backup-$(date +%Y%m%d-%H%M%S)"
  cp -a data "$backup_dir"
  resume_service
  trap - EXIT
  echo "Created $backup_dir"
else
  mkdir -p data
  echo "Created missing data directory for first deploy"
fi

echo "== Update code =="
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "== Static asset versions =="
python3 scripts/sync_static_versions.py --check

echo "== Docker deploy =="
docker compose up -d --build
docker compose ps

echo "== Local health =="
if command -v curl >/dev/null 2>&1; then
  curl --retry 15 --retry-delay 2 --retry-connrefused --retry-all-errors \
    -fsS http://127.0.0.1:8000/api/health >/dev/null
  echo "local app and database ready"
else
  echo "curl not installed; skipped local HTTP check"
fi
REMOTE_SCRIPT
