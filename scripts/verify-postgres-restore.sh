#!/usr/bin/env bash
set -euo pipefail

container=${1:?Usage: verify-postgres-restore.sh CONTAINER [SOURCE_DATABASE]}
source_db=${2:-shanrail}
restore_db="shanrail_restore_$$_${RANDOM}"
archive=$(mktemp)
restore_created=0

cleanup() {
  rm -f -- "$archive"
  if [[ "$restore_created" == 1 ]]; then
    docker exec "$container" dropdb -U shanrail -- "$restore_db"
  fi
}
trap cleanup EXIT

fingerprint() {
  docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U shanrail -d "$1" <<'SQL'
SELECT format(
  'SELECT %L, count(*), md5(COALESCE(string_agg(digest, %L ORDER BY digest), %L)) FROM (SELECT md5(to_jsonb(row_data)::text) AS digest FROM %I.%I AS row_data) AS rows',
  tablename, '', '', schemaname, tablename
)
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename
\gexec
SQL
}

started=$SECONDS
docker exec "$container" pg_dump -U shanrail -Fc -d "$source_db" > "$archive"
test -s "$archive"
docker exec "$container" createdb -U shanrail -- "$restore_db"
restore_created=1
docker exec -i "$container" pg_restore -U shanrail --exit-on-error --single-transaction -d "$restore_db" < "$archive"

before=$(fingerprint "$source_db")
after=$(fingerprint "$restore_db")
for table in schema_migrations trips trip_place_segments checkout_orders tickets ticket_inspections; do
  if ! printf '%s\n' "$after" | awk -F '|' -v table="$table" '$1 == table && $2 > 0 { found=1 } END { exit !found }'; then
    printf 'Missing restore fixture rows in %s\n' "$table" >&2
    exit 1
  fi
done
if [[ "$before" != "$after" ]]; then
  printf 'Source and restored application data differ\n' >&2
  exit 1
fi
printf 'Verified PostgreSQL restore in %ss\n' "$((SECONDS - started))"
printf '%s\n' "$after" | cut -d '|' -f1,2
