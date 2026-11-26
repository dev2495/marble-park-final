#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $SCRIPT_DIR/.env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

umask 077
if [[ "$(realpath -e "$DATA_ROOT")" != "$DATA_ROOT" || "$DATA_ROOT" == / || "$DATA_ROOT" == /srv ]]; then
  echo "DATA_ROOT must be a canonical application data directory" >&2
  exit 1
fi
backup_root="${DATA_ROOT}/backups"
[[ -d "$backup_root" && ! -L "$backup_root" && ! -L "$backup_root/.backup.lock" ]] || exit 1
# Root and operator invocations share one lock; retention inherits descriptor 9.
if [[ "$EUID" -ne 0 ]]; then
  exec sudo "$SCRIPT_DIR/backup.sh" "$@"
fi
exec 9>"$backup_root/.backup.lock"
flock -n 9 || { echo "Another backup/retention operation is running" >&2; exit 1; }

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${backup_root}/${timestamp}"
staging_dir="${backup_root}/.partial-${timestamp}-$$"
[[ ! -e "$backup_dir" ]] || exit 1
mkdir "$staging_dir"
cleanup_failed_backup() {
  if [[ -d "$staging_dir" && ! -L "$staging_dir" ]]; then
    rm -f -- "$staging_dir/database.dump" "$staging_dir/assets.tar.gz" "$staging_dir/SHA256SUMS"
    rmdir -- "$staging_dir"
  fi
}
trap cleanup_failed_backup EXIT

docker compose --env-file .env exec -T postgres \
  pg_dump --format=custom --no-owner --no-privileges \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  > "${staging_dir}/database.dump"
docker compose --env-file .env exec -T postgres pg_restore --list \
  < "${staging_dir}/database.dump" > /dev/null

sudo tar -C "$DATA_ROOT" \
  --exclude='assets/document-vault/.incoming' \
  --exclude='assets/document-vault/.trash' \
  -czf "${staging_dir}/assets.tar.gz" assets
(cd "$staging_dir" && sha256sum database.dump assets.tar.gz > SHA256SUMS)
mv -T -- "$staging_dir" "$backup_dir"
trap - EXIT

# Tells the owner in the app (work inbox) that backups are not safe. Best effort:
# a failure to write the row must never hide the real problem.
notify_owner() {
  local title="$1" message="$2" day
  day="$(date -u +%Y%m%d)"
  docker compose --env-file .env exec -T postgres \
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    -v title="$title" -v message="$message" -v taskkey="backup-offsite-${day}" > /dev/null <<'SQL' || echo "WARNING: could not write the owner notification" >&2
INSERT INTO "Notification" (id, title, message, type, "targetRole", priority, category, status, "taskKey", "createdAt")
VALUES ('backup-' || md5(random()::text), :'title', :'message', 'system', 'owner', 'high', 'updates', 'open', :'taskkey', now())
ON CONFLICT ("taskKey") DO NOTHING;
SQL
}

offsite_ok=1
if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  if ! aws s3 cp "$backup_dir" "${BACKUP_S3_URI%/}/${timestamp}/" \
      --recursive --only-show-errors; then
    offsite_ok=0
    echo "BACKUP FAILED TO LEAVE THE SERVER: copy to ${BACKUP_S3_URI} failed. Today's backup exists only on this disk: $backup_dir" >&2
    notify_owner "Backup copy to the off-server store failed" "Last night's backup was made but could not be copied off the server. If the server disk is lost, it is lost too. Ask your IT person to check the backup copy setting."
  fi
elif [[ "${BACKUP_ALLOW_LOCAL_ONLY:-0}" == "1" ]]; then
  echo "WARNING: BACKUP_S3_URI is empty; backups stay on this server only (BACKUP_ALLOW_LOCAL_ONLY=1 accepts this)." >&2
else
  offsite_ok=0
  echo "BACKUP NOT SAFE: BACKUP_S3_URI is not set, so backups are kept only on this server's disk. Set BACKUP_S3_URI in $SCRIPT_DIR/.env (see deploy/aws/README.md). Local backup kept at: $backup_dir" >&2
  notify_owner "Backups are not leaving the server" "Backups are only stored on the server's own disk. If the disk is lost, every backup is lost with it. Ask your IT person to set the off-server backup address."
fi

python3 "$SCRIPT_DIR/backup-retention.py" --root "$backup_root" --apply --lock-fd 9
if [[ "$offsite_ok" -ne 1 ]]; then
  echo "Local backup complete but NOT copied off the server: $backup_dir" >&2
  exit 1
fi
echo "Backup complete: $backup_dir"
