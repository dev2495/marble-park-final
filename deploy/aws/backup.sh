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

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="${DATA_ROOT}/backups/${timestamp}"
mkdir -p "$backup_dir"

docker compose --env-file .env exec -T postgres \
  pg_dump --format=custom --no-owner --no-privileges \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  > "${backup_dir}/database.dump"

sudo tar -C "$DATA_ROOT" \
  --exclude='assets/document-vault/.incoming' \
  --exclude='assets/document-vault/.trash' \
  -czf "${backup_dir}/assets.tar.gz" assets
sudo chown "$(id -u):$(id -g)" "${backup_dir}/assets.tar.gz"
sha256sum "${backup_dir}/database.dump" "${backup_dir}/assets.tar.gz" \
  > "${backup_dir}/SHA256SUMS"

find "${DATA_ROOT}/backups" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +

if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  aws s3 cp "$backup_dir" "${BACKUP_S3_URI%/}/${timestamp}/" \
    --recursive --only-show-errors
fi

echo "Backup complete: $backup_dir"
