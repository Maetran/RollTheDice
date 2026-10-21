#!/usr/bin/env bash
set -euo pipefail

REMOTE="${REMOTE:-zdwa}"
REMOTE_DIR="${REMOTE_DIR:-/home/manuel/RollTheDice}"
REPO_MATCH="${REPO_MATCH:-Maetran/RollTheDice}"
BRANCH="${BRANCH:-master}"
SILENT_RELEASE="${SILENT_RELEASE:-0}"
FOUNDER_USER_ID="${FOUNDER_USER_ID:-}"
ACTIVATE_HAUSDEPP="${ACTIVATE_HAUSDEPP:-0}"
ACTIVATE_WATTEN="${ACTIVATE_WATTEN:-0}"
ALLOW_NOTICE_BOOTSTRAP="${ALLOW_NOTICE_BOOTSTRAP:-0}"

if [[ "$SILENT_RELEASE" != "0" && "$SILENT_RELEASE" != "1" ]]; then
  echo "SILENT_RELEASE must be 0 or 1" >&2
  exit 2
fi
if [[ "$ACTIVATE_HAUSDEPP" != "0" && "$ACTIVATE_HAUSDEPP" != "1" ]]; then
  echo "ACTIVATE_HAUSDEPP must be 0 or 1" >&2
  exit 2
fi

if [[ "$ACTIVATE_WATTEN" != "0" && "$ACTIVATE_WATTEN" != "1" ]]; then
  echo "ACTIVATE_WATTEN must be 0 or 1" >&2
  exit 2
fi
if [[ "$ALLOW_NOTICE_BOOTSTRAP" != "0" && "$ALLOW_NOTICE_BOOTSTRAP" != "1" ]]; then
  echo "ALLOW_NOTICE_BOOTSTRAP must be 0 or 1" >&2
  exit 2
fi

if [[ -n "$FOUNDER_USER_ID" && ! "$FOUNDER_USER_ID" =~ ^[1-9][0-9]*$ ]]; then
  echo "FOUNDER_USER_ID must be a positive account ID" >&2
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

remote_env="REMOTE_DIR=$(printf '%q' "$REMOTE_DIR") BRANCH=$(printf '%q' "$BRANCH") SILENT_RELEASE=$(printf '%q' "$SILENT_RELEASE") FOUNDER_USER_ID=$(printf '%q' "$FOUNDER_USER_ID") ACTIVATE_HAUSDEPP=$(printf '%q' "$ACTIVATE_HAUSDEPP") ACTIVATE_WATTEN=$(printf '%q' "$ACTIVATE_WATTEN") ALLOW_NOTICE_BOOTSTRAP=$(printf '%q' "$ALLOW_NOTICE_BOOTSTRAP")"
ssh "$REMOTE" "$remote_env bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

cd "$REMOTE_DIR"
SILENT_RELEASE="${SILENT_RELEASE:-0}"
FOUNDER_USER_ID="${FOUNDER_USER_ID:-}"
ACTIVATE_HAUSDEPP="${ACTIVATE_HAUSDEPP:-0}"
ACTIVATE_WATTEN="${ACTIVATE_WATTEN:-0}"
ALLOW_NOTICE_BOOTSTRAP="${ALLOW_NOTICE_BOOTSTRAP:-0}"

compose() {
  if [[ -n "$FOUNDER_USER_ID" ]]; then
    # Pass through sudo explicitly. Startup binds this ID before becoming
    # healthy; an invalid or conflicting account prevents the announcement.
    sudo -n env ROLLTHEDICE_FOUNDER_USER_ID="$FOUNDER_USER_ID" docker compose "$@"
  else
    sudo -n docker compose "$@"
  fi
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

echo "== Update code =="
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "== Static asset versions =="
python3 scripts/sync_static_versions.py --check

echo "== Product version =="
python3 scripts/product_versions.py check --previous "$previous_revision"

echo "== Release note validation =="
if [[ "$SILENT_RELEASE" == "1" ]]; then
  # An operator explicitly requested a silent hotfix. It neither creates a
  # push notification nor a new in-app release history entry.
  release_notice='{"skip":true}'
  echo "Silent release: player notification skipped"
else
  release_notice="$(python3 scripts/prepare_release_notice.py --previous "$previous_revision")"
fi

echo "== Docker build while the current service remains live =="
compose build rollthedice

if [[ "$ACTIVATE_HAUSDEPP" == "1" ]]; then
  echo "== Explicit first Hausdepp TLS activation =="
  APPLY=1 bash scripts/activate_hausdepp.sh
fi

notice_id="$(git rev-parse HEAD)-$(date +%s)"
notice_active=0
service_was_running=0
service_stopped=0
deployment_cleanup() {
  exit_status=$1
  trap - EXIT
  if [[ "$service_stopped" == "1" ]]; then
    # If backup or recreation failed, restore the existing service first.
    compose start rollthedice >/dev/null || true
  fi
  if [[ "$notice_active" == "1" ]]; then
    compose exec -T rollthedice python -m app.deployment_notice clear --id "$notice_id" || true
  fi
  exit "$exit_status"
}
trap 'deployment_cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if compose ps --status running --services | grep -qx 'rollthedice'; then
  service_was_running=1
  echo "== Upcoming rollout: 30 seconds before the first service stop =="
  # Detect only the expected first-installation limitation. All other CLI
  # errors fail before stopping the live server; no public write API exists.
  if compose exec -T rollthedice python -c 'import importlib.util, sys; sys.exit(0 if importlib.util.find_spec("app.deployment_notice") else 42)'; then
    notice_active=1
    compose exec -T rollthedice python -m app.deployment_notice announce --id "$notice_id" --delay 30
  else
    notice_status=$?
    if [[ "$notice_status" != "42" || "$ALLOW_NOTICE_BOOTSTRAP" != "1" ]]; then
      echo "Rollout notice unavailable; refusing to stop the live server (status $notice_status)." >&2
      echo "Only when installing this feature for the first time: ALLOW_NOTICE_BOOTSTRAP=1." >&2
      exit 1
    fi
    echo "First installation: the old version cannot deliver rollout notices to open clients. Waiting 30 seconds; notices work after loading the new version."
  fi
  sleep 30
fi

echo "== Data backup =="
if [[ -d data ]]; then
  if [[ "$service_was_running" == "1" ]]; then
    service_stopped=1
    compose stop rollthedice >/dev/null
  fi
  backup_dir="data.backup-$(date +%Y%m%d-%H%M%S)"
  # Docker owns SQLite and its WAL files. No writer runs during this copy.
  sudo -n cp -a data "$backup_dir"
  echo "Created $backup_dir"
else
  sudo -n mkdir -p data
  sudo -n chown root:root data
  echo "Created missing data directory for first deploy"
fi

echo "== Docker deploy from the prebuilt image =="
compose up -d --no-build rollthedice
service_stopped=0
compose ps

echo "== Local health =="
if command -v curl >/dev/null 2>&1; then
  curl --retry 15 --retry-delay 2 --retry-connrefused --retry-all-errors \
    -fsS http://127.0.0.1:8000/api/health >/dev/null
  echo "local app and database ready"
fi

if [[ "$notice_active" == "1" ]]; then
  compose exec -T rollthedice python -m app.deployment_notice clear --id "$notice_id"
  notice_active=0
fi

if [[ "$ACTIVATE_WATTEN" == "1" ]]; then
  echo "== Explicit Watten public beta activation =="
  APPLY=1 bash scripts/activate_watten_public.sh
fi

echo "== Public product readiness =="
# Real DNS, Cloudflare and certificate validation must succeed for every
# product before a new release reaches the outbox. Local health alone cannot
# detect an unknown SNI host, stale frontend, private lobby or broken sitemap.
python3 scripts/verify_public_release.py

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
