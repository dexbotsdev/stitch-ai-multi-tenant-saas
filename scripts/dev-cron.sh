#!/bin/bash
# ─────────────────────────────────────────────
# Dev Cron: Triggers the worker every 5 seconds
# Usage: ./scripts/dev-cron.sh
# ─────────────────────────────────────────────

# Load CRON_SECRET from .env.local if not already exported
if [ -f .env.local ]; then
  # Extract CRON_SECRET using grep and cut
  FILE_SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d '=' -f 2-)
  if [ -n "$FILE_SECRET" ]; then
    CRON_SECRET="$FILE_SECRET"
  fi
fi

CRON_SECRET="${CRON_SECRET:-change_this_to_a_random_secret}"
APP_URL="${APP_URL:-http://localhost:3000}"
INTERVAL="${INTERVAL:-5}"

echo "🔄 Dev Cron started — hitting $APP_URL/api/cron/process-jobs every ${INTERVAL}s"
echo "   Press Ctrl+C to stop"
echo ""

while true; do
  RESPONSE=$(curl -s -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/cron/process-jobs" 2>&1)
  TIMESTAMP=$(date +"%H:%M:%S")
  echo "[$TIMESTAMP] $RESPONSE"
  sleep "$INTERVAL"
done
