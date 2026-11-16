#!/usr/bin/env bash
# Nightly backup: database dump + published media, kept 14 days locally,
# then copied off the VPS if BACKUP_REMOTE is set in infra/.env.
#
# Cron (as root):  15 3 * * *  /opt/framework/infra/scripts/backup.sh >> /var/log/framework-backup.log 2>&1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; source "$ROOT/infra/.env"; set +a

DEST="${BACKUP_DIR:-/srv/backups}"
STAMP="$(date +%Y-%m-%d_%H%M)"
mkdir -p "$DEST/db"

echo "[$(date)] dumping database"
docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ROOT/infra/.env" \
  exec -T db pg_dump -U postgres -d "$POSTGRES_DB" -Fc > "$DEST/db/app_$STAMP.dump"

# keep two weeks of dumps on the VPS
find "$DEST/db" -name 'app_*.dump' -mtime +14 -delete

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  echo "[$(date)] copying off-site to $BACKUP_REMOTE"
  rsync -a "$DEST/db/" "$BACKUP_REMOTE/db/"
  rsync -a --delete "$MEDIA_ROOT/published/" "$BACKUP_REMOTE/media/"
else
  echo "WARNING: BACKUP_REMOTE is empty; backups stay on this VPS only."
fi
echo "[$(date)] done"
