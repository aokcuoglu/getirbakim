import type { PoolClient } from "pg";

// Deleted and invalidated enrichments in the storefront sync (#564). db/enrichment-tombstones.sql logs, with the
// supplier item's natural key, every product_enrichments row deleted here and every job that leaves complete/partial.
// The export carries the log of the last TOMBSTONE_RETENTION_DAYS (every run, not by watermark: the import is
// idempotent, and a target still running code older than #564 receives them again once it is updated); the import
// resolves each entry by natural key (storefront-bundle-items.ts) and:
// - enrichment_deleted: deletes the target's enrichment unless it is a manual upload (the target's own data) or was
//   imported after the deletion here (newer data there). Fitments and shared links cascade; the enrichment's category
//   mappings of the bundle's sources go too, and its complete/partial job becomes pending. Images are left to media:gc.
// - job_invalidated: only counted (invalidatedJobsReported); the bundle carries their number (manifest.invalidatedJobs),
//   not the rows (bundleTombstones). A local job also falls back to pending when the supplier item's OEM or code changes
//   (enqueueProductSources), and those identities can differ on the target, where the enrichment may still be right.
//   Setting INVALIDATE_JOBS_ON_TARGET to true ships the rows and resets those jobs to pending as well.
// More than maxDeletions removed enrichments stop the import (manifest.maxDeletions, sync --max-deletions).

export const TOMBSTONE_RETENTION_DAYS = 90;
export const DEFAULT_MAX_DELETIONS = 1000;
// Same value as manualSourceMethod in src/modules/suppliers/manual-import.ts (a test checks it); that module pulls in
// sharp and the app's import graph, which the bundle scripts do not need.
export const MANUAL_SOURCE_METHOD = "manual-upload";
export const INVALIDATE_JOBS_ON_TARGET = false;
export const REMOVED_JOB_ERROR = "Enrichment removed locally (storefront sync #564)";

export type TombstoneKind = "enrichment_deleted" | "job_invalidated";
export type Tombstone = {
  supplier_item_id: string; supplier: string; company: string; list_group: string; warehouse: string; code: string;
  kind: TombstoneKind; source_method: string | null; recorded_at: string | Date;
};

/**
 * The tombstones an export carries: the latest entry per supplier item, $1 true for the whole log, otherwise the last
 * $2 days; $3 is MANUAL_SOURCE_METHOD. The kind follows the item's current state when the item still exists here
 * (found by natural key, as on the target): no enrichment → enrichment_deleted, an enrichment whose job is not
 * complete/partial → job_invalidated. An item gone here keeps the logged kind: its enrichment went with it by cascade,
 * which is not a deletion to repeat on the target. Items enriched and valid again, and manual uploads, are left out.
 */
export const EXPORTED_TOMBSTONES = `WITH latest AS (
  SELECT DISTINCT ON (supplier_item_id) supplier_item_id,supplier,company,list_group,warehouse,code,kind,source_method,recorded_at
  FROM product_enrichment_tombstones WHERE $1::boolean OR recorded_at > now() - make_interval(days => $2::int)
  ORDER BY supplier_item_id,recorded_at DESC,id DESC)
SELECT t.supplier_item_id,t.supplier,t.company,t.list_group,t.warehouse,t.code,
  CASE WHEN s.id IS NULL THEN t.kind WHEN e.supplier_item_id IS NULL THEN 'enrichment_deleted' ELSE 'job_invalidated' END AS kind,
  coalesce(e.source_method,t.source_method) AS source_method,t.recorded_at
FROM latest t
LEFT JOIN supplier_items s ON (s.supplier,s.company,s.list_group,s.warehouse,s.code)=(t.supplier,t.company,t.list_group,t.warehouse,t.code)
LEFT JOIN product_enrichments e ON e.supplier_item_id=s.id
LEFT JOIN product_enrichment_jobs j ON j.supplier_item_id=s.id
WHERE NOT (e.supplier_item_id IS NOT NULL AND j.status IS NOT NULL AND j.status IN ('complete','partial'))
  AND t.source_method IS DISTINCT FROM $3 AND e.source_method IS DISTINCT FROM $3
ORDER BY t.supplier_item_id`;

/** Reads the tombstones to export; `all` drops the retention window (a --full run). */
export async function exportTombstones(client: PoolClient, all: boolean) {
  return (await client.query<Tombstone>(EXPORTED_TOMBSTONES, [all, TOMBSTONE_RETENTION_DAYS, MANUAL_SOURCE_METHOD])).rows;
}

/**
 * What a bundle ships: job_invalidated entries only while the target applies them (INVALIDATE_JOBS_ON_TARGET);
 * otherwise just their count (manifest.invalidatedJobs), so part-00 does not carry rows the target ignores.
 */
export function bundleTombstones(rows: Tombstone[], invalidateJobs = INVALIDATE_JOBS_ON_TARGET) {
  const tombstones = invalidateJobs ? rows : rows.filter(row => row.kind === "enrichment_deleted");
  return { tombstones, invalidatedJobs: rows.length - tombstones.length };
}

const TOMBSTONES = "jsonb_to_recordset($1::jsonb) AS r(supplier_item_id uuid, kind text, recorded_at timestamptz)";

/**
 * Applies the bundle's tombstones; call after resolveBundleItems in the same transaction (its bundle_items must hold the
 * tombstones' natural keys). `sources` are the category sources the bundle carries (bundleSources). Throws when more
 * than maxDeletions enrichments would go; the caller rolls back.
 */
export async function applyBundleTombstones(client: PoolClient, tombstones: Tombstone[], sources: string[],
  { maxDeletions = DEFAULT_MAX_DELETIONS, invalidateJobs = INVALIDATE_JOBS_ON_TARGET } = {}) {
  const json = JSON.stringify(tombstones);
  const removed = (await client.query<{ id: string }>(`WITH t AS (
    SELECT DISTINCT ON (bi.id) bi.id,r.recorded_at FROM ${TOMBSTONES} JOIN bundle_items bi ON bi.bundle_id=r.supplier_item_id AND bi.id IS NOT NULL
    WHERE r.kind='enrichment_deleted' ORDER BY bi.id,r.recorded_at DESC)
    DELETE FROM product_enrichments e USING t WHERE e.supplier_item_id=t.id AND e.source_method<>$2 AND e.imported_at<=t.recorded_at
    RETURNING e.supplier_item_id::text AS id`, [json, MANUAL_SOURCE_METHOD])).rows.map(row => row.id);
  if (removed.length > maxDeletions) {
    throw new Error(`The bundle would delete ${removed.length} enrichments, more than --max-deletions=${maxDeletions}; nothing was applied. `
      + "Check the local deletions, then re-run the sync with a higher --max-deletions.");
  }
  const mappings = await client.query("DELETE FROM product_source_categories WHERE supplier_item_id=ANY($1::uuid[]) AND source=ANY($2::text[])", [removed, sources]);
  const jobs = await client.query(`UPDATE product_enrichment_jobs j SET status='pending',last_error=$3,updated_at=now()
    WHERE j.status IN ('complete','partial') AND (j.supplier_item_id=ANY($2::uuid[]) OR ($4::boolean AND EXISTS (
      SELECT 1 FROM ${TOMBSTONES} JOIN bundle_items bi ON bi.bundle_id=r.supplier_item_id
      WHERE bi.id=j.supplier_item_id AND r.kind='job_invalidated' AND j.updated_at<=r.recorded_at
      AND NOT EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=j.supplier_item_id AND e.source_method=$5))))`,
  [json, removed, REMOVED_JOB_ERROR, invalidateJobs, MANUAL_SOURCE_METHOD]);
  const kept = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM ${TOMBSTONES}
    LEFT JOIN bundle_items bi ON bi.bundle_id=r.supplier_item_id
    WHERE r.kind='enrichment_deleted' AND (bi.id IS NULL OR NOT bi.id=ANY($2::uuid[]))`, [json, removed]);
  return {
    tombstones: tombstones.length,
    removedEnrichments: removed.length,
    removedMappings: mappings.rowCount ?? 0,
    resetJobs: jobs.rowCount ?? 0,
    invalidatedJobsReported: invalidateJobs ? 0 : tombstones.filter(row => row.kind === "job_invalidated").length,
    // Deletions the target did not follow: product not there, no enrichment, a manual upload or newer data.
    tombstonesKept: kept.rows[0].count,
  };
}

/** Removes log entries past the retention; a database without the log (setup not run yet) is left alone. */
export async function pruneTombstones(client: PoolClient) {
  if (!(await client.query<{ table: string | null }>("SELECT to_regclass('product_enrichment_tombstones')::text AS table")).rows[0].table) return 0;
  const result = await client.query("DELETE FROM product_enrichment_tombstones WHERE recorded_at < now() - make_interval(days => $1::int)", [TOMBSTONE_RETENTION_DAYS]);
  return result.rowCount ?? 0;
}
