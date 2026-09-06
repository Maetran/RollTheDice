#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-zdwa}"
REMOTE_DIR="${REMOTE_DIR:-/home/manuel/RollTheDice}"
REPO_MATCH="${REPO_MATCH:-Maetran/RollTheDice}"
BRANCH="${BRANCH:-master}"
SILENT_RELEASE="${SILENT_RELEASE:-0}"

if [[ "$SILENT_RELEASE" != "0" && "$SILENT_RELEASE" != "1" ]]; then
  echo "SILENT_RELEASE must be 0 or 1" >&2
  exit 2
fi

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

remote_env="REMOTE_DIR=$(printf '%q' "$REMOTE_DIR") BRANCH=$(printf '%q' "$BRANCH") SILENT_RELEASE=$(printf '%q' "$SILENT_RELEASE")"
ssh "$REMOTE" "$remote_env bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$REMOTE_DIR"
SILENT_RELEASE="${SILENT_RELEASE:-0}"

compose() {
  sudo -n docker compose "$@"
}

echo "== Remote =="
hostname
pwd

echo "== Git status =="
git status --short --branch
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Refusing to deploy: remote worktree has uncommitted changes." >&2
  exit 1
fi

# Keep the last successful deployment separate from checkout HEAD: a failed
# build may already have pulled the new commit, and its retry still needs
# the original comparison base. This private Git marker is not app data.
deployment_marker="$(git rev-parse --git-path rollthedice-last-deployed)"
if [[ ! -s "$deployment_marker" ]]; then
  git rev-parse HEAD > "$deployment_marker"
fi
previous_revision="$(< "$deployment_marker")"
command -v curl >/dev/null || { echo "curl is required to verify a release before announcing it." >&2; exit 1; }

echo "== Data backup =="
if [[ -d data ]]; then
  service_was_running=0
  resume_service() {
    if [[ "$service_was_running" == "1" ]]; then
      compose start rollthedice >/dev/null
      service_was_running=0
    fi
  }
  trap resume_service EXIT
  if compose ps --status running --services 2>/dev/null | grep -qx 'rollthedice'; then
    service_was_running=1
    compose stop rollthedice >/dev/null
  fi
  backup_dir="data.backup-$(date +%Y%m%d-%H%M%S)"
  # Docker's root-mapped process owns SQLite and its WAL files. Preserve their
  # ownership and copy them via sudo so a later deployment stays writable.
  sudo -n cp -a data "$backup_dir"
  resume_service
  trap - EXIT
  echo "Created $backup_dir"
else
  sudo -n mkdir -p data
  sudo -n chown root:root data
  echo "Created missing data directory for first deploy"
fi

echo "== Update code =="
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "== Static asset versions =="
python3 scripts/sync_static_versions.py --check

echo "== Release note validation =="
if [[ "$SILENT_RELEASE" == "1" ]]; then
  # An operator explicitly requested a silent hotfix. It neither creates a
  # push notification nor a new in-app release history entry.
  release_notice='{"skip":true}'
  echo "Silent release: player notification skipped"
else
  release_notice="$(python3 scripts/prepare_release_notice.py --previous "$previous_revision")"
fi

echo "== Docker deploy =="
compose up -d --build
compose ps

echo "== Local health =="
if command -v curl >/dev/null 2>&1; then
  curl --retry 15 --retry-delay 2 --retry-connrefused --retry-all-errors \
    -fsS http://127.0.0.1:8000/api/health >/dev/null
  echo "local app and database ready"
fi

echo "== Release notification =="
# No public trigger and no startup broadcast: only a healthy deployment
# enters the durable outbox. Repeating a revision cannot re-notify accounts.
printf '%s\n' "$release_notice" | compose exec -T rollthedice python -m app.release_push
git rev-parse HEAD > "$deployment_marker"

echo "== Backup retention =="
# Erst nach dem erfolgreichen Rollout aufräumen. Das soeben erstellte Backup
# gehört zu den fünf neuesten und bleibt damit für einen Rollback erhalten.
sudo -n env BACKUP_ROOT="$REMOTE_DIR" KEEP=5 APPLY=1 scripts/prune_data_backups.sh
REMOTE_SCRIPT
