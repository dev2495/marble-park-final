#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $SCRIPT_DIR/.env" >&2
  exit 1
fi
if [[ $# -ne 1 || ! -d "$1" ]]; then
  echo "Usage: $0 /absolute/path/to/backup-directory" >&2
  exit 1
fi

backup_dir="$(cd "$1" && pwd)"
for required in database.dump assets.tar.gz SHA256SUMS; do
  [[ -f "$backup_dir/$required" ]] || { echo "Missing $backup_dir/$required" >&2; exit 1; }
done

set -a
# shellcheck disable=SC1091
source .env
set +a

(cd "$backup_dir" && sha256sum --check SHA256SUMS)

compose=(docker compose --env-file .env -f compose.yaml)
"${compose[@]}" stop api web
trap '"${compose[@]}" up -d api web >/dev/null 2>&1 || true' EXIT

"${compose[@]}" exec -T postgres psql \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 \
  --command 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
"${compose[@]}" exec -T postgres pg_restore \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --no-owner --no-privileges --exit-on-error < "$backup_dir/database.dump"

asset_previous="${DATA_ROOT}/assets.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)"
if [[ -d "${DATA_ROOT}/assets" ]]; then
  mv "${DATA_ROOT}/assets" "$asset_previous"
fi
mkdir -p "$DATA_ROOT"
tar -C "$DATA_ROOT" -xzf "$backup_dir/assets.tar.gz"

"${compose[@]}" up -d
trap - EXIT
"${compose[@]}" ps
echo "Restore complete: $backup_dir"
echo "Previous assets retained at: $asset_previous"
