#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing $SCRIPT_DIR/.env; create it from .env.example." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

required=(
  APP_HOST DATA_ROOT POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD JWT_SECRET
  BOOTSTRAP_OWNER_NAME BOOTSTRAP_OWNER_EMAIL BOOTSTRAP_OWNER_PASSWORD
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Required variable $name is empty." >&2
    exit 1
  fi
done

if [[ "${#POSTGRES_PASSWORD}" -lt 24 || "${#JWT_SECRET}" -lt 48 || "${#BOOTSTRAP_OWNER_PASSWORD}" -lt 16 ]]; then
  echo "Production secrets do not meet the minimum length policy." >&2
  exit 1
fi

if [[ "$APP_HOST" == http://* || "$APP_HOST" == https://* || "$APP_HOST" == */* ]]; then
  echo "APP_HOST must be a hostname without scheme or path." >&2
  exit 1
fi

export COMPOSE_PARALLEL_LIMIT=1
docker compose --env-file .env config --quiet
docker compose --env-file .env build --pull
docker compose --env-file .env up -d
docker compose --env-file .env exec -T api npm run db:seed --workspace=apps/api
docker compose --env-file .env ps

echo "Deployment started. Verify https://${APP_HOST}/readyz before handover."
