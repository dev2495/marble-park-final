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

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  aws s3 cp "$backup_dir" "${BACKUP_S3_URI%/}/${timestamp}/" \
    --recursive --only-show-errors
fi

python3 "$SCRIPT_DIR/backup-retention.py" --root "$backup_root" --apply --lock-fd 9
echo "Backup complete: $backup_dir"
