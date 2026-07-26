#!/usr/bin/env bash
set -euo pipefail

# ── Production side of the TecDoc load ──────────────────────────────────────
#
# Runs ON the VPS. Shipped and launched by `load-tecdoc-to-prod.sh load`, which
# starts it detached so an SSH drop cannot kill a load that takes an hour or more.
#
# Expects /root/tecdoc-load/{core.dump,fitment.csv.gz} to already be in place.
# Take a backup first — this drops every non-constraint index on the target
# tables before restoring, then rebuilds them.

C="${PROD_CONTAINER:-getirbakim-postgres}"
U="${PG_USER:-postgres}"
D="${PG_DB:-getirbakim}"
R="${REMOTE_DIR:-/root/tecdoc-load}"

TABLES="'parts','part_brands','part_categories','part_oens','part_eans','part_images','part_infos','part_properties','part_documents','part_cross_references','part_vehicle_types','oil_capacities'"
SEQ_TABLES="part_oens part_eans part_images part_infos part_properties part_documents part_cross_references part_vehicle_types oil_capacities"

q()  { docker exec -i "$C" psql -U "$U" -d "$D" -v ON_ERROR_STOP=1 "$@"; }
qt() { docker exec -i "$C" psql -U "$U" -d "$D" -tAc "$1"; }

step() { echo ""; echo "[$(date -u +%H:%M:%S)] $*"; }

step "Preflight"
docker exec "$C" pg_isready -U "$U" >/dev/null || { echo "FATAL: postgres not ready"; exit 1; }
[[ -f "$R/core.dump" ]] || { echo "FATAL: $R/core.dump missing"; exit 1; }
[[ -f "$R/fitment.csv.gz" ]] || { echo "FATAL: $R/fitment.csv.gz missing"; exit 1; }
df -h / | tail -1

step "Saving index definitions -> $R/indexes.sql"
qt "SELECT pg_get_indexdef(i.indexrelid) || ';'
    FROM pg_index i
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
    WHERE n.nspname='public' AND tc.relname IN ($TABLES)
      AND con.conname IS NULL" > "$R/indexes.sql"
echo "  $(grep -c ';' "$R/indexes.sql") indexes saved"
[[ -s "$R/indexes.sql" ]] || { echo "FATAL: no index definitions captured — refusing to drop"; exit 1; }

step "Dropping non-constraint indexes (rebuilding after the load is far faster)"
qt "SELECT 'DROP INDEX IF EXISTS ' || quote_ident(n.nspname) || '.' || quote_ident(ic.relname) || ';'
    FROM pg_index i
    JOIN pg_class ic ON ic.oid = i.indexrelid
    JOIN pg_class tc ON tc.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = tc.relnamespace
    LEFT JOIN pg_constraint con ON con.conindid = i.indexrelid
    WHERE n.nspname='public' AND tc.relname IN ($TABLES)
      AND con.conname IS NULL" | q -q

step "Restoring core tables (--disable-triggers turns FK checks off during load)"
docker exec -i "$C" pg_restore -U "$U" -d "$D" \
  --data-only --disable-triggers --no-owner --no-privileges < "$R/core.dump"

step "Loading part_vehicle_types slice"
gunzip -c "$R/fitment.csv.gz" \
  | q -c "COPY public.part_vehicle_types (id, part_id, vehicle_type_id) FROM STDIN WITH (FORMAT csv)"

step "Rebuilding indexes"
# -c then -f share one session, so the SET applies to the builds. Sorting 34M
# part_oens rows with the default 64MB would spill to disk over and over.
q -q -c "SET maintenance_work_mem='1GB';" -f - < "$R/indexes.sql"

step "Advancing sequences (a --data-only load leaves them at 1 -> 23505 on next insert)"
for t in $SEQ_TABLES; do
  qt "SELECT setval(pg_get_serial_sequence('public.$t','id'), COALESCE((SELECT MAX(id) FROM public.$t),0)+1, false);" >/dev/null
  echo "  $t"
done

step "ANALYZE (the planner has no statistics for freshly loaded tables)"
for t in parts part_brands part_categories part_oens part_eans part_images part_infos \
         part_properties part_documents part_cross_references part_vehicle_types oil_capacities; do
  q -q -c "ANALYZE public.$t;"
done

step "Done"
df -h / | tail -1
qt "SELECT 'db size = ' || pg_size_pretty(pg_database_size('$D'))"
echo "=== LOAD COMPLETE ==="
