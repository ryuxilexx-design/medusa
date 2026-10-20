#!/bin/bash
# Proves the newest backup can be restored: decrypts it into a scratch database (meduza_restore_test),
# checks that every table of the live database exists there and that key tables are not empty when the live ones
# are not, then drops the scratch database. The live database is only read.
# Manual run: docker compose -f docker-compose.prod.yml exec backup bash /scripts/restore-test.sh [file]
set -euo pipefail
file="${1:-$(ls -1t /backups/daily/*.dump.gpg 2>/dev/null | head -1)}"
[ -n "$file" ] && [ -f "$file" ] || { echo "$(date -Iseconds) FAIL restore-test: no backup file" | tee -a /backups/restore-test.log; exit 1; }
scratch=meduza_restore_test
log() { echo "$(date -Iseconds) $*" | tee -a /backups/restore-test.log; }
cleanup() { psql -d postgres -qc "DROP DATABASE IF EXISTS $scratch" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -d postgres -qc "DROP DATABASE IF EXISTS $scratch" -c "CREATE DATABASE $scratch"
if ! gpg --batch --quiet --decrypt --passphrase-fd 3 "$file" 3<<<"$BACKUP_PASSPHRASE" | pg_restore --no-owner --no-privileges --exit-on-error -d "$scratch"; then
  log "FAIL restore-test $file: pg_restore failed"; exit 1
fi

fail=0
live_tables=$(psql -tAc "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
restored_tables=$(psql -d "$scratch" -tAc "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")
missing=$(comm -23 <(echo "$live_tables") <(echo "$restored_tables"))
if [ -n "$missing" ]; then log "FAIL restore-test $file: tables missing: $(echo $missing)"; fail=1; fi

summary=""
for t in tenants users patients appointments clinical_notes invoices payments audit_logs; do
  live=$(psql -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo 0)
  rest=$(psql -d "$scratch" -tAc "SELECT count(*) FROM $t" 2>/dev/null || echo -1)
  summary="$summary $t=$rest/$live"
  # rows are only added between the backup and now, so restored <= live; empty restore of a non-empty table is a failure
  if [ "$rest" -lt 0 ] || { [ "$live" -gt 0 ] && [ "$rest" -eq 0 ]; } || [ "$rest" -gt "$live" ]; then fail=1; fi
done
mig_live=$(psql -tAc "SELECT max(name) FROM schema_migrations" 2>/dev/null || echo "?")
mig_rest=$(psql -d "$scratch" -tAc "SELECT max(name) FROM schema_migrations" 2>/dev/null || echo "?")

if [ "$fail" = 0 ]; then log "OK restore-test $file (restored/live:$summary; migration $mig_rest, live $mig_live)"
else log "FAIL restore-test $file (restored/live:$summary)"; exit 1; fi
