#!/usr/bin/env bash
# Applies db/migrations/*.sql in order, each once, inside a transaction.
#
#   On the VPS (uses the db container):   ./infra/scripts/migrate.sh
#   Against any database:                 DB_URL=postgres://... ./infra/scripts/migrate.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIGRATIONS="$ROOT/db/migrations"

if [[ -n "${DB_URL:-}" ]]; then
  psql_cmd=(psql "$DB_URL" -v ON_ERROR_STOP=1 -q -X)
else
  psql_cmd=(docker compose -f "$ROOT/infra/docker-compose.yml" --env-file "$ROOT/infra/.env"
            exec -T db psql -U postgres -d "${POSTGRES_DB:-app}" -v ON_ERROR_STOP=1 -q -X)
fi

"${psql_cmd[@]}" -c "create table if not exists public.schema_migrations (
  name text primary key, applied_at timestamptz not null default now())" >/dev/null

for file in "$MIGRATIONS"/*.sql; do
  name="$(basename "$file")"
  done_already="$("${psql_cmd[@]}" -tA -c "select 1 from public.schema_migrations where name = '$name'")"
  if [[ "$done_already" == "1" ]]; then
    continue
  fi
  echo "Applying $name"
  { echo "begin;"; cat "$file"; echo; echo "insert into public.schema_migrations (name) values ('$name');"; echo "commit;"; } \
    | "${psql_cmd[@]}"
done

# Tell PostgREST to pick up new tables and functions.
"${psql_cmd[@]}" -c "notify pgrst, 'reload schema'" >/dev/null
echo "Database is up to date."
