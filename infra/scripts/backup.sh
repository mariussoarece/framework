#!/usr/bin/env bash
# Nightly backup: database dump (kept 14 days on this VPS) and, when configured, a copy off the VPS:
#   BACKUP_REMOTE=user@host:/path     -> rsync over SSH (another server)
#   BACKUP_RCLONE=r2:myritmio-backups -> rclone (Cloudflare R2, Backblaze B2, …; see infra/BACKUPS.md)
# Both copy the database dumps and the published pictures/videos.
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
  exec -T db pg_dump -U postgres -d "$POSTGRES_DB" -Fc > "$DEST/db/app_$STAMP.dump.part"
mv "$DEST/db/app_$STAMP.dump.part" "$DEST/db/app_$STAMP.dump"
echo "[$(date)] $(du -h "$DEST/db/app_$STAMP.dump" | cut -f1) written"

# keep two weeks of dumps on the VPS
find "$DEST/db" -name 'app_*.dump' -mtime +14 -delete

copied=no
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  echo "[$(date)] rsync to $BACKUP_REMOTE"
  rsync -a "$DEST/db/" "$BACKUP_REMOTE/db/"
  rsync -a --delete "$MEDIA_ROOT/published/" "$BACKUP_REMOTE/media/"
  copied=yes
fi
if [[ -n "${BACKUP_RCLONE:-}" ]]; then
  echo "[$(date)] rclone to $BACKUP_RCLONE"
  # dumps: keep 60 days off-site; media: mirror of what is published
  rclone copy "$DEST/db/" "$BACKUP_RCLONE/db/" --transfers 4
  rclone delete "$BACKUP_RCLONE/db/" --min-age 60d || true
  rclone sync "$MEDIA_ROOT/published/" "$BACKUP_RCLONE/media/" --transfers 8 --fast-list
  copied=yes
fi
[[ $copied == yes ]] || echo "WARNING: no BACKUP_REMOTE / BACKUP_RCLONE set; backups stay on this VPS only."
echo "[$(date)] done"
