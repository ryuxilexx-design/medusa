#!/bin/bash
# DISASTER RECOVERY: replaces the LIVE database with a backup. Stop the app first:
#   docker compose -f docker-compose.prod.yml stop app
#   docker compose -f docker-compose.prod.yml exec -e CONFIRM=RESTORE backup bash /scripts/restore.sh /backups/daily/<file>.dump.gpg
#   docker compose -f docker-compose.prod.yml start app
# A safety backup of the current state is taken first, into /backups/pre-restore/ (never into daily/: a copy there
# in the same minute would have the chosen file's name, and pruning daily/ could delete the chosen file).
set -euo pipefail
file="${1:-}"
[ -n "$file" ] && [ -f "$file" ] || { echo "Usage: CONFIRM=RESTORE restore.sh /backups/daily/<file>.dump.gpg"; exit 1; }
[ "${CONFIRM:-}" = "RESTORE" ] || { echo "Refusing: set CONFIRM=RESTORE to replace the live database with $file"; exit 1; }
BACKUP_KIND=pre-restore bash /scripts/backup.sh   # current state, in case the wrong file was chosen
gpg --batch --quiet --decrypt --passphrase-fd 3 "$file" 3<<<"$BACKUP_PASSPHRASE" \
  | pg_restore --no-owner --no-privileges --clean --if-exists --single-transaction --exit-on-error -d "$PGDATABASE"
echo "$(date -Iseconds) RESTORED live database from $file" | tee -a /backups/backup.log
