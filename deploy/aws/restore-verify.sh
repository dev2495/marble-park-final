#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /srv/marble-park/backups/<timestamp>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backup_dir="$(cd "$1" && pwd)"
cd "$SCRIPT_DIR"

set -a
# shellcheck disable=SC1091
source .env
set +a

(cd "$backup_dir" && sha256sum --check SHA256SUMS)

verify_name="${POSTGRES_DB}_restore_verify"
docker compose --env-file .env exec -T postgres \
  dropdb --if-exists --username "$POSTGRES_USER" "$verify_name"
docker compose --env-file .env exec -T postgres \
  createdb --username "$POSTGRES_USER" "$verify_name"
docker compose --env-file .env exec -T postgres \
  pg_restore --exit-on-error --no-owner --no-privileges \
  --username "$POSTGRES_USER" --dbname "$verify_name" \
  < "${backup_dir}/database.dump"

table_count="$(docker compose --env-file .env exec -T postgres \
  psql --tuples-only --no-align --username "$POSTGRES_USER" --dbname "$verify_name" \
  --command "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")"

docker compose --env-file .env exec -T postgres \
  dropdb --username "$POSTGRES_USER" "$verify_name"

echo "Restore verification passed with ${table_count} public tables."
