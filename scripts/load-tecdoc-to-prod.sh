#!/usr/bin/env bash
set -euo pipefail

# ── Load the TecDoc archive into production ─────────────────────────────────
#
# Why: production's `public.part_*` tables are empty, so `getPartEnrichment()`
# returns nothing there and the storefront's technical-info accordions render
# blank. Matching parts to catalog products also cannot run on production, which
# is where the team works.
#
# What moves and what does not:
#   - Everything except `part_vehicle_types` is copied in full (~54M rows,
#     ~4 GB heap). Cheap, and it leaves room for the link step to improve later
#     without another data migration.
#   - `part_vehicle_types` is 931,276,096 rows / 119 GB — 119 of the archive's
#     129 GB sit in this one table. Only the slice belonging to parts that are
#     linked to a catalog product ships (~4.98M rows, ~250 MB). Coverage of the
#     fitment data therefore tracks link coverage; see the `topup` phase.
#
# Phases run independently so a failure can be retried without redoing the rest:
#   bash scripts/load-tecdoc-to-prod.sh dump     # local  -> ./tecdoc-load/
#   bash scripts/load-tecdoc-to-prod.sh push     # -> VPS /root/tecdoc-load/
#   bash scripts/load-tecdoc-to-prod.sh load     # prod: drop idx, restore, rebuild
#   bash scripts/load-tecdoc-to-prod.sh verify   # compare row counts
#   bash scripts/load-tecdoc-to-prod.sh topup    # ship fitment for newly linked parts
#
# Take a backup first (scripts/pg-backup.sh) — `load` drops 51 indexes before
# restoring and rebuilds them afterwards.

PHASE="${1:-}"

SSH_HOST="${SSH_HOST:-root@173.249.36.2}"
PROD_CONTAINER="${PROD_CONTAINER:-getirbakim-postgres}"
LOCAL_CONTAINER="${LOCAL_CONTAINER:-getirbakim-postgres-local}"
PG_DB="${PG_DB:-getirbakim}"
PG_USER="${PG_USER:-postgres}"
WORK_DIR="${WORK_DIR:-./tecdoc-load}"
REMOTE_DIR="${REMOTE_DIR:-/root/tecdoc-load}"

# Restore order does not matter — `--disable-triggers` switches off FK checks —
# but keep the list in dependency order so a manual retry stays sane.
CORE_TABLES=(
  public.part_brands
  public.part_categories
  public.parts
  public.part_oens
  public.part_eans
  public.part_images
  public.part_infos
  public.part_properties
  public.part_documents
  public.part_cross_references
  public.oil_capacities
)

# Tables whose id comes from a sequence. After a --data-only load the sequence
# is still at 1, so the next INSERT collides with a restored row (23505).
SEQ_TABLES=(
  part_oens part_eans part_images part_infos part_properties
  part_documents part_cross_references part_vehicle_types oil_capacities
)

local_psql() { docker exec -i "${LOCAL_CONTAINER}" psql -U "${PG_USER}" -d "${PG_DB}" "$@"; }

case "${PHASE}" in

# ─────────────────────────────────────────────────────────────────────────────
dump)
  mkdir -p "${WORK_DIR}"
  echo "=== DUMP (local) ==="

  echo ">>> Core tables -> ${WORK_DIR}/core.dump"
  # -Fc so `load` can use pg_restore's --disable-triggers and parallel jobs.
  docker exec "${LOCAL_CONTAINER}" pg_dump -U "${PG_USER}" -d "${PG_DB}" \
    -Fc --data-only --no-owner --no-privileges \
    $(printf -- '-t %s ' "${CORE_TABLES[@]}") \
    > "${WORK_DIR}/core.dump"
  echo "    $(du -h "${WORK_DIR}/core.dump" | cut -f1)"

  echo ">>> part_vehicle_types slice (linked parts only) -> ${WORK_DIR}/fitment.csv.gz"
  # Every link status, not just CONFIRMED: CANDIDATE rows get promoted as the
  # matching improves, and shipping them now costs ~1.1M extra rows instead of a
  # second pass later.
  local_psql -q -c "\copy (
      SELECT v.id, v.part_id, v.vehicle_type_id
      FROM public.part_vehicle_types v
      WHERE v.part_id IN (SELECT part_id FROM catalog.product_part_links)
    ) TO STDOUT WITH (FORMAT csv)" | gzip > "${WORK_DIR}/fitment.csv.gz"
  echo "    $(du -h "${WORK_DIR}/fitment.csv.gz" | cut -f1)"

  echo ">>> Expected row counts -> ${WORK_DIR}/expected.txt"
  : > "${WORK_DIR}/expected.txt"
  for t in "${CORE_TABLES[@]}"; do
    printf '%s=%s\n' "$t" "$(local_psql -tAc "SELECT count(*) FROM ${t}")" >> "${WORK_DIR}/expected.txt"
  done
  printf 'public.part_vehicle_types=%s\n' \
    "$(local_psql -tAc "SELECT count(*) FROM public.part_vehicle_types v WHERE v.part_id IN (SELECT part_id FROM catalog.product_part_links)")" \
    >> "${WORK_DIR}/expected.txt"
  cat "${WORK_DIR}/expected.txt"
  echo "=== DUMP done ==="
  ;;

# ─────────────────────────────────────────────────────────────────────────────
push)
  echo "=== PUSH -> ${SSH_HOST}:${REMOTE_DIR} ==="
  ssh "${SSH_HOST}" "mkdir -p ${REMOTE_DIR}"
  # -C compresses in flight; the dump is already compact but the CSV is not.
  scp -C "${WORK_DIR}/core.dump" "${WORK_DIR}/fitment.csv.gz" "${WORK_DIR}/expected.txt" \
    "${SSH_HOST}:${REMOTE_DIR}/"
  ssh "${SSH_HOST}" "ls -lh ${REMOTE_DIR}"
  echo "=== PUSH done ==="
  ;;

# ─────────────────────────────────────────────────────────────────────────────
load)
  echo "=== LOAD (production) ==="
  echo "!!! Take a backup first: ssh ${SSH_HOST} /opt/getirbakim/scripts/pg-backup.sh"
  echo ""
  # Launch detached: the load runs for the better part of an hour and an SSH
  # drop mid-restore would leave the tables loaded but the indexes missing.
  scp -q "$(dirname "$0")/load-tecdoc-remote.sh" "${SSH_HOST}:${REMOTE_DIR}/"
  ssh "${SSH_HOST}" "chmod +x ${REMOTE_DIR}/load-tecdoc-remote.sh && \
    setsid nohup bash ${REMOTE_DIR}/load-tecdoc-remote.sh > ${REMOTE_DIR}/load.log 2>&1 < /dev/null & \
    sleep 2; echo 'started, log: ${REMOTE_DIR}/load.log'"
  echo ""
  echo "Follow with:  ssh ${SSH_HOST} 'tail -f ${REMOTE_DIR}/load.log'"
  ;;
# ─────────────────────────────────────────────────────────────────────────────
verify)
  echo "=== VERIFY: expected (local) vs actual (production) ==="
  FAIL=0
  while IFS='=' read -r table expected; do
    [[ -z "${table}" ]] && continue
    # ssh -n: without it ssh reads the loop's stdin and swallows the rest of
    # expected.txt, so only the first table ever gets checked.
    actual=$(ssh -n "${SSH_HOST}" "docker exec -i ${PROD_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -tAc 'SELECT count(*) FROM ${table}'" | tr -d '[:space:]')
    if [[ "${expected}" == "${actual}" ]]; then
      printf '  %-38s %-12s OK\n' "${table}" "${actual}"
    else
      printf '  %-38s expected=%-12s actual=%-12s MISMATCH\n' "${table}" "${expected}" "${actual}"
      FAIL=1
    fi
  done < "${WORK_DIR}/expected.txt"

  echo ""
  echo ">>> Sequence check — an un-advanced sequence fails the next INSERT with 23505"
  for t in "${SEQ_TABLES[@]}"; do
    nextval=$(ssh "${SSH_HOST}" "docker exec -i ${PROD_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -tAc \"SELECT last_value FROM public.${t}_id_seq\"" | tr -d '[:space:]')
    maxid=$(ssh "${SSH_HOST}" "docker exec -i ${PROD_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -tAc \"SELECT COALESCE(MAX(id),0) FROM public.${t}\"" | tr -d '[:space:]')
    if [[ "${nextval}" -gt "${maxid}" ]]; then
      printf '  %-28s seq=%-12s max_id=%-12s OK\n' "${t}" "${nextval}" "${maxid}"
    else
      printf '  %-28s seq=%-12s max_id=%-12s BEHIND\n' "${t}" "${nextval}" "${maxid}"
      FAIL=1
    fi
  done

  [[ "${FAIL}" -eq 0 ]] && echo "" && echo "=== VERIFY passed ===" || { echo ""; echo "=== VERIFY FAILED ==="; exit 1; }
  ;;

# ─────────────────────────────────────────────────────────────────────────────
topup)
  # Fitment coverage tracks link coverage. When the matching step links parts it
  # had not linked before, their part_vehicle_types rows are still missing from
  # production. This ships only the difference, so the 119 GB table never has to
  # move in full.
  echo "=== TOPUP: fitment rows for parts linked on production but missing there ==="
  ssh "${SSH_HOST}" "docker exec -i ${PROD_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -tAc \"
    SELECT DISTINCT l.part_id FROM catalog.product_part_links l
    WHERE NOT EXISTS (SELECT 1 FROM public.part_vehicle_types v WHERE v.part_id = l.part_id)\"" \
    | tr -d '[:space:]' | grep -v '^$' > "${WORK_DIR}/topup-part-ids.txt" || true

  COUNT=$(wc -l < "${WORK_DIR}/topup-part-ids.txt" | tr -d '[:space:]')
  echo "    ${COUNT} parts need fitment"
  if [[ "${COUNT}" -eq 0 ]]; then echo "=== nothing to do ==="; exit 0; fi

  local_psql -q -c "CREATE TEMP TABLE _topup(part_id BIGINT); \copy _topup FROM '${WORK_DIR}/topup-part-ids.txt';
    \copy (SELECT v.id, v.part_id, v.vehicle_type_id FROM public.part_vehicle_types v JOIN _topup t ON t.part_id = v.part_id) TO STDOUT WITH (FORMAT csv)" \
    | gzip > "${WORK_DIR}/fitment-topup.csv.gz"

  scp -C "${WORK_DIR}/fitment-topup.csv.gz" "${SSH_HOST}:${REMOTE_DIR}/"
  ssh "${SSH_HOST}" "gunzip -c ${REMOTE_DIR}/fitment-topup.csv.gz | docker exec -i ${PROD_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -v ON_ERROR_STOP=1 -c \"COPY public.part_vehicle_types (id, part_id, vehicle_type_id) FROM STDIN WITH (FORMAT csv)\"
    docker exec -i ${PROD_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -tAc \"SELECT setval(pg_get_serial_sequence('public.part_vehicle_types','id'), COALESCE((SELECT MAX(id) FROM public.part_vehicle_types),0)+1, false)\" >/dev/null
    docker exec -i ${PROD_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -c 'ANALYZE public.part_vehicle_types;'"
  echo "=== TOPUP done ==="
  ;;

*)
  echo "usage: load-tecdoc-to-prod.sh [dump|push|load|verify|topup]" >&2
  exit 2
  ;;
esac
