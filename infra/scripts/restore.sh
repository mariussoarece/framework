#!/usr/bin/env bash
# Put a backup back: the database from a dump and, optionally, the published media.
#   sudo infra/scripts/restore.sh /srv/backups/db/app_2026-12-01_0315.dump [/path/to/media-copy]
# The app containers must be running (docker compose up -d). Everything in the database is replaced.
set -euo pipefail

DUMP="${1:?usage: restore.sh <dump file> [media folder]}"
MEDIA_FROM="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
set -a; source "$ROOT/infra/.env"; set +a
DC=(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ROOT/infra/.env")

read -r -p "This replaces the database '$POSTGRES_DB' with $DUMP. Type YES to continue: " ok
[[ "$ok" == "YES" ]] || { echo "stopped"; exit 1; }

echo "[$(date)] stopping the services that use the database"
"${DC[@]}" stop api auth rest

echo "[$(date)] restoring"
"${DC[@]}" exec -T db pg_restore -U postgres -d "$POSTGRES_DB" --clean --if-exists --no-owner \
  --role=postgres < "$DUMP" || echo "(warnings above are usually harmless: objects that did not exist yet)"

if [[ -n "$MEDIA_FROM" ]]; then
  echo "[$(date)] copying media from $MEDIA_FROM"
  mkdir -p "$MEDIA_ROOT/published"
  rsync -a "$MEDIA_FROM/" "$MEDIA_ROOT/published/"
fi

echo "[$(date)] starting again"
"${DC[@]}" up -d
echo "[$(date)] done. Check: curl -s https://\$DOMAIN/api/health"
