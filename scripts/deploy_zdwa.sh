#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-zdwa}"
REMOTE_DIR="${REMOTE_DIR:-}"
REPO_MATCH="${REPO_MATCH:-Maetran/RollTheDice}"
BRANCH="${BRANCH:-master}"

if [[ -z "$REMOTE_DIR" ]]; then
  REMOTE_DIR="$(
    ssh "$REMOTE" "find /root /home /opt /srv /var/www -maxdepth 6 -type d -name .git 2>/dev/null | while read -r gitdir; do repo=\${gitdir%/.git}; if git -C \"\$repo\" remote -v 2>/dev/null | grep -q '$REPO_MATCH'; then printf '%s\n' \"\$repo\"; exit 0; fi; done" || true
  )"
fi

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
  backup_dir="data.backup-$(date +%Y%m%d-%H%M%S)"
  cp -a data "$backup_dir"
  echo "Created $backup_dir"
else
  mkdir -p data
  echo "Created missing data directory for first deploy"
fi

echo "== Update code =="
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "== Docker deploy =="
docker compose up -d --build
docker compose ps

echo "== Local health =="
if command -v curl >/dev/null 2>&1; then
  curl -fsS http://127.0.0.1:8000/ >/dev/null && echo "local app OK"
else
  echo "curl not installed; skipped local HTTP check"
fi
REMOTE_SCRIPT
