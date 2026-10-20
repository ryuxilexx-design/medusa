#!/bin/bash
# One encrypted backup now: pg_dump (custom format) → gpg AES-256 → /backups/daily/meduza-YYYYMMDD-HHMM.dump.gpg
# Sunday copies also go to /backups/weekly. Keeps KEEP_DAILY daily and KEEP_WEEKLY weekly files.
# Manual run: docker compose -f docker-compose.prod.yml exec backup bash /scripts/backup.sh
set -euo pipefail
ts=$(date +%Y%m%d-%H%M)
mkdir -p /backups/daily /backups/weekly
out="/backups/daily/meduza-$ts.dump.gpg"
part="$out.part"
# pipefail: a failed pg_dump fails the whole backup and leaves no half file behind
trap 'rm -f "$part"' ERR
pg_dump -Fc --no-owner --no-privileges \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o "$part" 3<<<"$BACKUP_PASSPHRASE"
mv "$part" "$out"
if [ "$(date +%u)" = "7" ]; then cp "$out" /backups/weekly/; fi
# keep the newest N files; find (unlike ls with a glob) is quiet and successful on an empty folder
prune() { find "$1" -maxdepth 1 -name '*.dump.gpg' -printf '%T@ %p\n' | sort -rn | tail -n +$(($2 + 1)) | cut -d' ' -f2- | xargs -r rm --; }
prune /backups/daily "${KEEP_DAILY:-14}"
prune /backups/weekly "${KEEP_WEEKLY:-8}"
size=$(stat -c %s "$out")
echo "$(date -Iseconds) OK backup $out $size bytes" | tee -a /backups/backup.log
