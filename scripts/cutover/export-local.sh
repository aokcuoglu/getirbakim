#!/bin/bash
# Cutover: export the local catalog database and media for the AWS restore. AWS is built from the local catalog;
# transactional tables and commerce_settings come from the VPS (export-vps-transactional.sh).
#
#   bash scripts/cutover/export-local.sh media              # day before: all media (+ media-keys.txt)
#   bash scripts/cutover/export-local.sh final <media-keys> # cutover: database + media added since that list
#   bash scripts/cutover/export-local.sh full               # database + all media in one go
#
# Output: .local/aws-export-local-<mode>-<UTC time>/, 1 GB parts + SHA256SUMS. Send `ls -lh` to Lokum Ops for upload links.
# The Mac uploads at ~8 Mbit/s (measured 2026-11-12): all media (~4.4 GB) takes ~75 min, the database (~0.75 GB) ~12 min,
# so media goes up the day before and the cutover only carries the database and the media delta.
set -euo pipefail
MODE=${1:-}
case "$MODE" in
  media|full) ;;
  final) PREV=${2:?usage: export-local.sh final <media-keys.txt from the media export>}; [ -s "$PREV" ] || { echo "missing $PREV" >&2; exit 2; } ;;
  *) echo "usage: export-local.sh media | final <media-keys.txt> | full" >&2; exit 2 ;;
esac
ts(){ date -u +%FT%TZ; }
step(){ echo "[$(ts)] $*"; }
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT=$REPO/.local/aws-export-local-$MODE-$(date -u +%Y%m%dT%H%M%SZ)
[ "$MODE" = final ] && PREV=$(cd "$(dirname "$PREV")" && pwd)/$(basename "$PREV")
# macOS tar stores extended attributes as ._<name> entries beside every file and folder (#451); the
# restore had to strip ~61k of them. COPYFILE_DISABLE=1 leaves them out; it does nothing on Linux.
cd "$REPO"
umask 077
mkdir -p "$OUT"
envval(){ grep -E "^$1=" .env.local | head -1 | cut -d= -f2-; }
DB=$(envval DATABASE_URL)
files=()

if [ "$MODE" != media ]; then
  # Data left out (tables still created): enrichment worker scratch, supplier change log, and the transactional
  # tables that come from the VPS (commerce_settings too: the VPS checkout mode is live, local is snapshot).
  EXCL=(enrichment_run_items enrichment_source_cache enrichment_source_requests enrichment_search_products
    enrichment_request_events parts2world_article_oems parts2world_job_articles parts2world_articles
    supplier_item_changes account_vehicles sessions login_attempts commerce_orders commerce_order_items
    commerce_payments commerce_returns commerce_cart_items guest_carts guest_cart_items cart_items
    newsletter_subscriptions newsletter_subscription_attempts service_application_attempts commerce_settings)
  args=(); for t in "${EXCL[@]}"; do args+=("--exclude-table-data=public.$t"); done
  printf '%s\n' "${EXCL[@]}" > "$OUT/excluded-table-data.txt"
  S=$SECONDS; step "dump"
  pg_dump "$DB" -Fc --no-owner --no-acl "${args[@]}" -f "$OUT/database.dump"
  pg_restore --list "$OUT/database.dump" > /dev/null && echo "dump OK"
  step "dump bitti ($((SECONDS-S)) sn) $(du -h "$OUT/database.dump" | cut -f1)"
  psql "$DB" -At -F ' ' -c "
    SELECT table_name,
      (xpath('/row/c/text()', query_to_xml(
        format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name),
        false, true, '')))[1]::text
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY 1" > "$OUT/table-counts.txt"
  step "sayımlar: $(wc -l < "$OUT/table-counts.txt" | tr -d ' ') tablo"
  files+=(database.dump table-counts.txt excluded-table-data.txt)
fi

export AWS_ACCESS_KEY_ID=$(envval S3_ACCESS_KEY_ID) AWS_SECRET_ACCESS_KEY=$(envval S3_SECRET_ACCESS_KEY) AWS_DEFAULT_REGION=us-east-1
unset AWS_PROFILE AWS_SESSION_TOKEN
EP=(--endpoint-url "$(envval S3_ENDPOINT)")
BUCKET=$(envval S3_BUCKET)
S=$SECONDS
aws s3 ls "s3://$BUCKET" --recursive "${EP[@]}" | awk '{ $1=$2=$3=""; sub(/^ +/, ""); print }' | sort > "$OUT/media-keys.txt"
expected=$(wc -l < "$OUT/media-keys.txt" | tr -d ' ')
mkdir -p "$OUT/media"
aws s3 sync "s3://$BUCKET" "$OUT/media" "${EP[@]}" --only-show-errors
actual=$(cd "$OUT/media" && find . -type f | wc -l | tr -d ' ')
step "medya: bucket $expected nesne, kopyalanan $actual dosya ($((SECONDS-S)) sn)"
[ "$expected" -gt 0 ] && [ "$actual" -ge "$expected" ] || { step "HATA: medya sayısı tutmuyor"; exit 1; }
S=$SECONDS
if [ "$MODE" = final ]; then
  comm -13 <(sort "$PREV") "$OUT/media-keys.txt" > "$OUT/media-delta-keys.txt"
  delta=$(wc -l < "$OUT/media-delta-keys.txt" | tr -d ' ')
  if [ "$delta" -gt 0 ]; then
    COPYFILE_DISABLE=1 tar -czf "$OUT/media.tar.gz" -C "$OUT/media" -T "$OUT/media-delta-keys.txt"
    files+=(media.tar.gz)
  fi
  files+=(media-delta-keys.txt)
  step "yeni medya: $delta nesne ($((SECONDS-S)) sn)"
else
  COPYFILE_DISABLE=1 tar -czf "$OUT/media.tar.gz" -C "$OUT/media" .
  files+=(media.tar.gz)
  step "medya arşivi $(du -h "$OUT/media.tar.gz" | cut -f1) ($((SECONDS-S)) sn)"
fi
rm -rf "$OUT/media"
files+=(media-keys.txt)

cd "$OUT"
shasum -a 256 "${files[@]}" > SHA256SUMS
for f in database.dump media.tar.gz; do
  [ -f "$f" ] || continue
  split -b 1G -d -a 3 "$f" "$f.part-"
  shasum -a 256 "$f".part-* >> SHA256SUMS
  want=$(awk -v f="$f" '$2==f{print $1}' SHA256SUMS); got=$(cat "$f".part-* | shasum -a 256 | cut -d' ' -f1)
  [ "$want" = "$got" ] && echo "$f birleştirme OK" || { echo "$f UYUŞMUYOR"; exit 1; }
  rm "$f"
done
echo "$OUT"; ls -lh
step "TAMAM"
