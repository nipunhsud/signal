#!/bin/bash
set -euo pipefail

# Nightly Postgres backup for the self-hosted container DB (signal-forge-db).
# Dumps to ~/backups and keeps the last 14 days. Wire to cron:
#   0 4 * * * /root/signal-forge/scripts/backup.sh >> /root/backups/backup.log 2>&1

DIR="${BACKUP_DIR:-$HOME/backups}"
mkdir -p "$DIR"

docker exec -t signal-forge-db pg_dump -U "${DB_USER:-nipunsud}" -Fc signal_forge \
  > "$DIR/sf-$(date +%F).dump"

# ponytail: retain 14 days, keeps ~/backups from filling the 35GB disk.
find "$DIR" -name 'sf-*.dump' -mtime +14 -delete

echo "backup ok: $DIR/sf-$(date +%F).dump"
