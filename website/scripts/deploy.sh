#!/usr/bin/env bash
# Builds the website and publishes it to the production server, where Caddy
# serves it at https://www.marblepark.in (see deploy/aws/Caddyfile).
#
#   website/scripts/deploy.sh            build, upload, switch over
#
# Needs: the `marble-park-prod` SSH alias, and the Caddy site block and
# volume from deploy/aws already live on the server (one-time; see README).
set -euo pipefail

HOST="${MP_DEPLOY_HOST:-marble-park-prod}"
TARGET="/srv/marble-park/website"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

npm run build
test -f dist/index.html

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="/tmp/marble-park-website-$STAMP"
echo "Uploading to $HOST:$STAGE"
rsync -az --delete dist/ "$HOST:$STAGE/"

# Swap in the new build in one step, keeping the previous one for rollback.
ssh "$HOST" "set -e
  sudo mkdir -p '$TARGET'
  sudo rm -rf '$TARGET.previous'
  sudo cp -a '$TARGET' '$TARGET.previous'
  sudo rsync -a --delete '$STAGE/' '$TARGET/'
  sudo chown -R root:root '$TARGET'
  sudo find '$TARGET' -type d -exec chmod 755 {} +
  sudo find '$TARGET' -type f -exec chmod 644 {} +
  rm -rf '$STAGE'"

echo "Published. Previous build kept at $TARGET.previous"
echo "Check: curl -sI https://www.marblepark.in | head -3"
