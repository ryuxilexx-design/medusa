#!/bin/bash
# Backup scheduler (container entrypoint): one backup at start if none exists yet, then every day at BACKUP_HOUR:00
# (Tashkent time, TZ is set by compose). After the Sunday backup the restore test runs.
set -uo pipefail
hour="${BACKUP_HOUR:-02}"
echo "$(date -Iseconds) backup scheduler started: daily at ${hour}:00 $TZ, keep ${KEEP_DAILY:-14} daily / ${KEEP_WEEKLY:-8} weekly"
# On a fresh install this container starts together with the app, before the app has applied the migrations:
# the first backup would be an empty database and its restore test would compare it with a half-migrated one.
# Wait (up to 15 min) until the app has created the schema and finished migrating (it holds advisory lock 74001
# while migrating, database/src/index.ts; this psql session releases the lock again when it ends).
for _ in $(seq 1 180); do
  [ "$(psql -tAc "SELECT to_regclass('public.schema_migrations') IS NOT NULL AND pg_try_advisory_lock(74001)" 2>/dev/null)" = "t" ] && break
  sleep 5
done
if ! ls /backups/daily/*.dump.gpg >/dev/null 2>&1; then
  bash /scripts/backup.sh && bash /scripts/restore-test.sh || echo "$(date -Iseconds) first backup/restore test FAILED — check the log above"
fi
while true; do
  now=$(date +%s)
  next=$(date -d "today ${hour}:00" +%s)
  [ "$now" -ge "$next" ] && next=$(date -d "tomorrow ${hour}:00" +%s)
  sleep $((next - now))
  if bash /scripts/backup.sh; then
    [ "$(date +%u)" = "7" ] && bash /scripts/restore-test.sh
  else
    echo "$(date -Iseconds) FAIL backup" | tee -a /backups/backup.log
  fi
done
