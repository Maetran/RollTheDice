#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-.}"
KEEP="${KEEP:-5}"
APPLY="${APPLY:-0}"

if ! [[ "$KEEP" =~ ^[0-9]+$ ]] || (( KEEP < 1 )); then
  echo "KEEP must be a positive integer." >&2
  exit 1
fi

backups=()
while IFS= read -r backup; do
  backup_name="${backup##*/}"
  if [[ "$backup_name" =~ ^data\.backup-[0-9]{8}-[0-9]{6}$ ]]; then
    backups+=("$backup")
  fi
done < <(find "$BACKUP_ROOT" -maxdepth 1 -type d -name 'data.backup-[0-9]*' -print | LC_ALL=C sort)

remove_count=$(( ${#backups[@]} - KEEP ))
if (( remove_count <= 0 )); then
  echo "Nothing to prune (${#backups[@]} backups, keeping $KEEP)."
  exit 0
fi

printf 'Backups selected for removal (%d of %d):\n' "$remove_count" "${#backups[@]}"
for (( index=0; index<remove_count; index++ )); do
  printf '  %s\n' "${backups[$index]}"
done

if [[ "$APPLY" != "1" ]]; then
  echo "Dry run only. Re-run with APPLY=1 after reviewing the exact list."
  exit 0
fi

for (( index=0; index<remove_count; index++ )); do
  target="${backups[$index]}"
  target_name="${target##*/}"
  if [[ "$target" != "$BACKUP_ROOT"/data.backup-* ]] \
    || ! [[ "$target_name" =~ ^data\.backup-[0-9]{8}-[0-9]{6}$ ]] \
    || [[ ! -d "$target" ]]; then
    echo "Refusing unexpected target: $target" >&2
    exit 1
  fi
  rm -rf -- "$target"
done

echo "Removed $remove_count old backups; kept the newest $KEEP."
