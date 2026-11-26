#!/usr/bin/env bash
# Create fresh test databases for the integration tests.
#   scripts/test-db.sh mp_t1 [mp_t2 ...]
# Each name is cloned from $TEMPLATE_DB (default mp_quote_workspace_test, never modified), then every
# migration folder under apps/api/prisma/migrations that the clone has not applied yet is run with psql
# and recorded in _prisma_migrations. An existing database with the same name is dropped first.
# Env: PGHOST (default /tmp), PGPORT (5432), PGUSER (current user), TEMPLATE_DB, KEEP=1 to keep an existing db.
set -euo pipefail
export PGHOST="${PGHOST:-/tmp}" PGPORT="${PGPORT:-5432}"
[ -n "${PATH_PG:-}" ] && export PATH="$PATH_PG:$PATH"
export PATH="$PATH:/opt/homebrew/opt/postgresql@15/bin:/usr/local/bin"
TEMPLATE_DB="${TEMPLATE_DB:-mp_quote_workspace_test}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/apps/api/prisma/migrations"
[ $# -ge 1 ] || { echo "usage: $0 <db-name> [<db-name> ...]" >&2; exit 2; }

for NAME in "$@"; do
  case "$NAME" in mp_quote_workspace_test|marble_park|*prod*) echo "refusing to touch $NAME" >&2; exit 2;; esac
  if psql -d postgres -Atc "select 1 from pg_database where datname='$NAME'" | grep -q 1; then
    if [ "${KEEP:-0}" = 1 ]; then echo "$NAME exists, keeping"; else
      psql -d postgres -qc "select pg_terminate_backend(pid) from pg_stat_activity where datname='$NAME' and pid<>pg_backend_pid()" >/dev/null
      dropdb "$NAME"
    fi
  fi
  if ! psql -d postgres -Atc "select 1 from pg_database where datname='$NAME'" | grep -q 1; then
    if ! createdb -T "$TEMPLATE_DB" "$NAME" 2>/dev/null; then
      echo "template busy; cloning $TEMPLATE_DB with pg_dump"
      createdb "$NAME"
      pg_dump -d "$TEMPLATE_DB" --no-owner | psql -d "$NAME" -q -v ON_ERROR_STOP=1 >/dev/null
    fi
  fi
  applied=0
  for dir in "$MIGRATIONS"/*/; do
    m="$(basename "$dir")"; f="$dir/migration.sql"
    [ -f "$f" ] || continue
    if [ "$(psql -d "$NAME" -Atc "select count(*) from _prisma_migrations where migration_name='$m'")" = 0 ]; then
      psql -d "$NAME" -q -v ON_ERROR_STOP=1 -1 -f "$f" >/dev/null
      psql -d "$NAME" -qc "insert into _prisma_migrations (id, checksum, migration_name, finished_at, started_at, applied_steps_count) values (gen_random_uuid()::text, 'applied-by-test-db.sh', '$m', now(), now(), 1)"
      echo "  applied $m"; applied=$((applied+1))
    fi
  done
  echo "$NAME ready ($applied migration(s) applied on top of $TEMPLATE_DB)"
done
