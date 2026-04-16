#!/bin/bash
# ─────────────────────────────────────────────
# DLQ Purge Cron Job
# Deletes Dead Letter jobs older than 14 days
# ─────────────────────────────────────────────

DB_PATH="${1:-tenants.db}"

echo "Starting DLQ Purge on $DB_PATH..."

sqlite3 "$DB_PATH" <<EOF
  DELETE FROM stitch_jobs_dead_letter
  WHERE failed_at < datetime('now', '-14 days');
EOF

echo "DLQ Purge Completed."
