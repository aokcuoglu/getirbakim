import "server-only";
import { boundedQuery, db } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { batches, diffChunk, indexNowConfig, indexNowDisabledReason, removalAnomaly, submitUrls, type IndexNowRow } from "./indexnow";
import { contentSignals } from "./indexing";
import { productPath, type ProductAddress } from "./product-path";
import { productChunkRange, productChunks } from "./sitemap";
import { indexableProductsSql, productAddressColumns } from "./sitemap.server";

// The content a search engine sees on the page: shown name, brand, part number, description, shown OEM and the
// enrichment import (images, specifications, vehicles; only while the page shows that enrichment, the same condition as
// the minimum-content signal, so a stale link's import does not count). Price and stock are left out on purpose: they change with every
// sync and the sitemap's lastmod carries them.
const supplierFingerprint = `md5(concat_ws(chr(31),
  COALESCE(h.name,NULLIF(i.product_data->>'ac',''),i.code),
  COALESCE(h.brand,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş'),
  COALESCE(h.part_number,i.code),
  COALESCE(h.description,i.product_data->>'ac2',''),
  CASE WHEN h.hide_oem THEN '' ELSE COALESCE(i.product_data->>'oe','') END,
  CASE WHEN ${contentSignals.enrichment.sql} THEN l.imported_at::text ELSE '' END))::uuid::text`;
const storeFingerprint = "md5(concat_ws(chr(31),p.name,p.brand,p.code,p.description))::uuid::text";

/** The indexable product pages of sitemap chunk `index` with their content fingerprint, ordered by id. */
export async function loadIndexNowChunk(index: number): Promise<IndexNowRow[]> {
  const { from, to } = productChunkRange(index);
  const sql = indexableProductsSql({
    supplier: `${productAddressColumns.supplier},${supplierFingerprint} AS fingerprint`,
    store: `${productAddressColumns.store},${storeFingerprint} AS fingerprint`,
  });
  const { rows } = await boundedQuery<ProductAddress & { fingerprint: string }>(`SELECT id,name,name_overridden,display_brand,display_code,fingerprint FROM (${sql}) u ORDER BY id`,
    [storefrontCompanies(), from, to]);
  return rows.map(row => ({ id: row.id, path: productPath(row), fingerprint: row.fingerprint }));
}

export type IndexNowRunOptions = {
  mode: "send" | "seed";
  /** URL budget of a send run; 0 is unlimited. The run's first chunk is always processed. */
  limit: number;
  /** Neither requests nor writes: only the counters. */
  dryRun?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Pause between two requests. */
  pauseMs?: number;
  env?: Record<string, string | undefined>;
};

export type IndexNowRunResult = {
  status: "completed" | "partial" | "failed" | "skipped" | "disabled";
  mode: "send" | "seed";
  dryRun: boolean;
  reason?: string;
  runId?: number;
  startChunk?: number;
  nextChunk?: number;
  chunks: number;
  checked: number;
  added: number;
  changed: number;
  removed: number;
  /** URLs of the difference; a dry run reports what a send would submit. */
  urls: number;
  submitted: number;
  requests: number;
  lastHttpStatus: number | null;
  error?: string;
  ms: number;
};

const lockKey = [20261115, 1];
const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * One run over the 64 sitemap chunks, starting where the previous run stopped. `send` reports each chunk's difference
 * and then records it; `seed` records the current state without reporting. A failed request leaves the chunk's state
 * as it was, so the next run sends it again.
 */
export async function runIndexNow(options: IndexNowRunOptions): Promise<IndexNowRunResult> {
  const started = Date.now();
  const { mode, limit, dryRun = false, fetch: fetchImpl = fetch, sleep = defaultSleep, pauseMs = 1000, env = process.env } = options;
  const result: IndexNowRunResult = { status: "completed", mode, dryRun, chunks: 0, checked: 0, added: 0, changed: 0, removed: 0, urls: 0,
    submitted: 0, requests: 0, lastHttpStatus: null, ms: 0 };
  const finish = () => ({ ...result, ms: Date.now() - started });
  const disabled = dryRun ? null : indexNowDisabledReason(env);
  if (disabled) return { ...finish(), status: "disabled", reason: disabled };
  const config = mode === "send" && !dryRun ? indexNowConfig(env) : null;

  const lock = await db.connect();
  // A failed unlock must not hide the run's result: the connection is then destroyed, which releases the lock too.
  let lockBroken = false;
  try {
    if (!(await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1,$2) AS ok", lockKey)).rows[0].ok) {
      return { ...finish(), status: "skipped", reason: "another IndexNow run holds the lock" };
    }
    try {
      // Before db/indexnow.sql ran (a local database), a dry run reads an empty state; any other run stops.
      const stateReady = (await db.query<{ ok: boolean }>(
        "SELECT to_regclass('indexnow_urls') IS NOT NULL AND to_regclass('indexnow_runs') IS NOT NULL AS ok")).rows[0].ok;
      if (!stateReady && !dryRun) throw new Error("indexnow_urls / indexnow_runs are missing: run npm run db:setup");
      const last = stateReady ? await db.query<{ next_chunk: number }>("SELECT next_chunk FROM indexnow_runs ORDER BY id DESC LIMIT 1") : null;
      const start = (last?.rows[0]?.next_chunk ?? 0) % productChunks;
      result.startChunk = start;
      result.nextChunk = start;
      if (!dryRun) {
        result.runId = Number((await db.query<{ id: string }>("INSERT INTO indexnow_runs(mode,next_chunk) VALUES($1,$2) RETURNING id::text",
          [mode, start])).rows[0].id);
      }
      const record = async (status: IndexNowRunResult["status"] | "running", final: boolean) => {
        if (result.runId === undefined) return;
        await db.query(`UPDATE indexnow_runs SET status=$2,next_chunk=$3,checked=$4,added=$5,changed=$6,removed=$7,submitted=$8,requests=$9,
          last_http_status=$10,error=$11,finished_at=CASE WHEN $12 THEN now() END WHERE id=$1`,
        [result.runId, status, result.nextChunk, result.checked, result.added, result.changed, result.removed, result.submitted, result.requests,
          result.lastHttpStatus, result.error ?? null, final]);
      };
      try {
        for (let step = 0; step < productChunks; step++) {
          const chunk = (start + step) % productChunks;
          const { from, to } = productChunkRange(chunk);
          const current = await loadIndexNowChunk(chunk);
          const known = !stateReady ? [] : (await db.query<IndexNowRow>(`SELECT product_id::text AS id,path,fingerprint::text AS fingerprint FROM indexnow_urls
            WHERE product_id BETWEEN $1::uuid AND $2::uuid`, [from, to])).rows;
          const diff = diffChunk(current, known);
          if (mode === "send" && removalAnomaly(known.length, diff.removed.length)) {
            throw new Error(`Chunk ${chunk}: ${diff.removed.length} of ${known.length} reported pages would leave the index; check the catalog, or accept with --seed`);
          }
          if (mode === "send" && limit > 0 && step > 0 && result.urls + diff.urls.length > limit) {
            result.status = "partial";
            break;
          }
          if (mode === "send" && !dryRun && config) {
            for (const batch of batches(diff.urls)) {
              if (result.requests > 0 && pauseMs > 0) await sleep(pauseMs);
              const sent = await submitUrls(config, batch, { fetch: fetchImpl, sleep });
              result.requests += sent.requests;
              result.lastHttpStatus = sent.status;
              if (!sent.ok) throw new Error(`IndexNow rejected chunk ${chunk}: ${sent.error ?? "unknown error"}`);
              result.submitted += batch.length;
            }
          }
          if (!dryRun) await saveChunk(diff.added.concat(diff.changed), diff.removed.map(row => row.id));
          result.chunks++;
          result.checked += current.length;
          result.added += diff.added.length;
          result.changed += diff.changed.length;
          result.removed += diff.removed.length;
          result.urls += diff.urls.length;
          result.nextChunk = (chunk + 1) % productChunks;
          if (step + 1 < productChunks) await record("running", false);
        }
      } catch (error) {
        result.status = "failed";
        result.error = error instanceof Error ? error.message : String(error);
      }
      await record(result.status, true);
      return finish();
    } finally {
      await lock.query("SELECT pg_advisory_unlock($1,$2)", lockKey).catch(() => { lockBroken = true; });
    }
  } finally { lock.release(lockBroken); }
}

/** The reported state of one chunk, in one transaction: new and changed pages upserted, removed pages deleted. */
async function saveChunk(upserts: IndexNowRow[], removedIds: string[]) {
  if (upserts.length === 0 && removedIds.length === 0) return;
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (upserts.length > 0) {
      await client.query(`INSERT INTO indexnow_urls(product_id,path,fingerprint)
        SELECT * FROM unnest($1::uuid[],$2::text[],$3::uuid[])
        ON CONFLICT (product_id) DO UPDATE SET path=EXCLUDED.path,fingerprint=EXCLUDED.fingerprint,submitted_at=now()`,
      [upserts.map(row => row.id), upserts.map(row => row.path), upserts.map(row => row.fingerprint)]);
    }
    if (removedIds.length > 0) await client.query("DELETE FROM indexnow_urls WHERE product_id=ANY($1::uuid[])", [removedIds]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
