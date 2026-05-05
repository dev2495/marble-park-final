#!/bin/bash
cd "$(dirname "$0")"

echo "Starting Database..."
pg_ctl -D /opt/homebrew/var/postgresql@15 start 2>/dev/null || true

echo "Starting API..."
cd apps/api && npm run dev &
API_PID=$!

echo "Starting Web..."
cd ../web && npm run dev &
WEB_PID=$!

echo "Started!"
echo "API: http://localhost:4000"
echo "Web: http://localhost:3000"

trap "kill $API_PID $WEB_PID 2>/dev/null" EXIT