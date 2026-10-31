#!/bin/bash
# One encrypted backup now: pg_dump (custom format) → gpg AES-256 → /backups/daily/meduza-YYYYMMDD-HHMM.dump.gpg
# Sunday copies also go to /backups/weekly. Keeps KEEP_DAILY daily and KEEP_WEEKLY weekly files.
# Manual run: docker compose -f docker-compose.prod.yml exec backup bash /scripts/backup.sh
# BACKUP_KIND=pre-restore (restore.sh): the safety copy goes to /backups/pre-restore/ instead — never into daily/,
# where it could replace or prune the very file that is about to be restored.
set -euo pipefail
kind="${BACKUP_KIND:-daily}"
dir="/backups/$kind"
mkdir -p /backups/daily /backups/weekly "$dir"
out="$dir/meduza-$(date +%Y%m%d-%H%M).dump.gpg"
# a second backup in the same minute never overwrites the first
[ -e "$out" ] && out="$dir/meduza-$(date +%Y%m%d-%H%M%S).dump.gpg"
part="$out.part"
# pipefail: a failed pg_dump fails the whole backup and leaves no half file behind
trap 'rm -f "$part"' ERR
pg_dump -Fc --no-owner --no-privileges \
  | gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-fd 3 -o "$part" 3<<<"$BACKUP_PASSPHRASE"
mv -n "$part" "$out"
# keep the newest N files; find (unlike ls with a glob) is quiet and successful on an empty folder
prune() { find "$1" -maxdepth 1 -name '*.dump.gpg' -printf '%T@ %p\n' | sort -rn | tail -n +$(($2 + 1)) | cut -d' ' -f2- | xargs -r rm --; }
if [ "$kind" = daily ]; then
  if [ "$(date +%u)" = "7" ]; then cp "$out" /backups/weekly/; fi
  prune /backups/daily "${KEEP_DAILY:-14}"
  prune /backups/weekly "${KEEP_WEEKLY:-8}"
else
  prune "$dir" "${KEEP_DAILY:-14}"
fi
size=$(stat -c %s "$out")
echo "$(date -Iseconds) OK backup $out $size bytes" | tee -a /backups/backup.log
