import type { Pool, PoolClient } from "pg";
import { DeleteObjectsCommand, type S3Client } from "@aws-sdk/client-s3";

// Collects product_media_objects rows nothing references any more, with their stored objects (npm run media:gc, #597).
// A row is a candidate when it is older than the threshold by GREATEST(created_at, stored_at) and no reference column
// points at it. Reference columns are every foreign key to product_media_objects found at run time (environments carry
// tables db/*.sql no longer creates) plus the FK-less copies below. A uuid column named *image_id / *media_id outside
// that set stops the run: it may hold media ids nobody declared. Only the deleted rows' keys are removed from the
// bucket; the bucket is never listed (it also holds non-media keys such as internal/storefront-sync/…).

type Queryable = Pick<PoolClient, "query">;
/** A reference column, as SQL: `table` is a regclass name, `column` an identifier, both quoted where needed. */
export type MediaReference = { table: string; column: string };

/** Columns holding media ids without a foreign key (copies refreshed from product_enrichments). */
const unlinkedReferences: [table: string, column: string][] = [
  ["product_enrichment_shared_links", "image_id"],
  ["enrichment_product_states", "image_id"],
];

export async function mediaReferenceColumns(db: Queryable): Promise<MediaReference[]> {
  const [tables, columns] = [unlinkedReferences.map(([table]) => table), unlinkedReferences.map(([, column]) => column)];
  const { rows } = await db.query<{ oid: number; table_sql: string; column_name: string; column_sql: string; source: string }>(`
    SELECT c.conrelid::oid AS oid, c.conrelid::regclass::text AS table_sql, a.attname::text AS column_name, format('%I', a.attname) AS column_sql, 'fk' AS source
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
    WHERE c.contype='f' AND c.confrelid='product_media_objects'::regclass
    UNION
    SELECT t.oid, t.oid::regclass::text, u.column_name, format('%I', u.column_name), 'unlinked'
    FROM unnest($1::text[], $2::text[]) u(table_name, column_name) JOIN pg_class t ON t.oid=to_regclass(quote_ident(u.table_name))
    ORDER BY 2, 3`, [tables, columns]);
  const known = new Set(rows.map(row => `${row.oid}:${row.column_name}`));
  // A listed FK-less table that exists must still have its column, or the copy moved somewhere unknown.
  const present = (await db.query<{ key: string }>(`SELECT a.attrelid::oid || ':' || a.attname AS key FROM pg_attribute a
    WHERE a.attrelid=ANY(SELECT to_regclass(quote_ident(t)) FROM unnest($1::text[]) t) AND a.attnum>0 AND NOT a.attisdropped`, [tables])).rows;
  const presentKeys = new Set(present.map(row => row.key));
  const missing = rows.filter(row => row.source === "unlinked" && !presentKeys.has(`${row.oid}:${row.column_name}`));
  if (missing.length) throw new Error(`Media reference column missing: ${missing.map(row => `${row.table_sql}.${row.column_name}`).join(", ")}`);
  const unknown = (await db.query<{ oid: number; table_name: string; column_name: string }>(`
    SELECT format('%I.%I', c.table_schema, c.table_name)::regclass::oid AS oid, c.table_name::text, c.column_name::text
    FROM information_schema.columns c JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema=current_schema() AND t.table_type='BASE TABLE' AND c.data_type='uuid' AND c.column_name ~ '(image|media)_id$'`)).rows
    .filter(row => !known.has(`${row.oid}:${row.column_name}`));
  if (unknown.length) {
    throw new Error(`Unrecognised media id column(s): ${unknown.map(row => `${row.table_name}.${row.column_name}`).join(", ")}. `
      + "Add a foreign key to product_media_objects or list the column in src/modules/enrichment/media-gc.ts; nothing was deleted.");
  }
  return rows.map(row => ({ table: row.table_sql, column: row.column_sql }));
}

/** Whether db/product-enrichment.sql's stored_at column exists (it does once npm run db:setup ran). */
async function hasStoredAt(db: Queryable) {
  return Boolean((await db.query(`SELECT 1 FROM pg_attribute WHERE attrelid='product_media_objects'::regclass
    AND attname='stored_at' AND NOT attisdropped`)).rowCount);
}

/** SQL conditions on `m` (product_media_objects); $1 is the minimum age in days. */
function conditions(references: MediaReference[], storedAt: boolean) {
  const age = `${storedAt ? "GREATEST(m.created_at, COALESCE(m.stored_at, m.created_at))" : "m.created_at"} < now() - make_interval(days => $1::int)`;
  const unreferenced = references.map(({ table, column }) => `NOT EXISTS (SELECT 1 FROM ${table} r WHERE r.${column}=m.id)`);
  return [age, ...unreferenced].join(" AND ");
}

export type MediaCandidate = { id: string; objectKey: string; sizeBytes: number };
export type UnreferencedMedia = {
  total: number; candidates: number; bytes: number; byFolder: Record<string, { count: number; bytes: number }>;
  foreignBucket: number; rows: MediaCandidate[]; storedAt: boolean;
};

/** Unreferenced, old-enough media in `bucket` (at most `limit` rows listed, oldest first); other buckets' rows are only counted. */
export async function findUnreferencedMedia(db: Queryable, { minAgeDays, bucket, limit = null }: { minAgeDays: number; bucket: string; limit?: number | null }):
  Promise<UnreferencedMedia & { references: MediaReference[] }> {
  const references = await mediaReferenceColumns(db);
  const storedAt = await hasStoredAt(db);
  const row = (await db.query<{ total: number; candidates: number; bytes: string; foreign_bucket: number;
    by_folder: Record<string, { count: number; bytes: number }>; rows: MediaCandidate[] }>(`
    WITH unreferenced AS MATERIALIZED (SELECT m.id, m.bucket, m.object_key, m.size_bytes, m.created_at FROM product_media_objects m WHERE ${conditions(references, storedAt)}),
    folders AS (SELECT split_part(object_key, '/', 1) AS folder, count(*)::int AS count, sum(size_bytes)::bigint AS bytes FROM unreferenced WHERE bucket=$2 GROUP BY 1)
    SELECT (SELECT count(*)::int FROM product_media_objects) AS total,
      (SELECT count(*)::int FROM unreferenced WHERE bucket=$2) AS candidates,
      (SELECT COALESCE(sum(size_bytes), 0)::bigint FROM unreferenced WHERE bucket=$2) AS bytes,
      (SELECT count(*)::int FROM unreferenced WHERE bucket<>$2) AS foreign_bucket,
      (SELECT COALESCE(jsonb_object_agg(folder, jsonb_build_object('count', count, 'bytes', bytes)), '{}') FROM folders) AS by_folder,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'objectKey', object_key, 'sizeBytes', size_bytes) ORDER BY created_at, id), '[]')
        FROM (SELECT * FROM unreferenced WHERE bucket=$2 ORDER BY created_at, id LIMIT $3) listed) AS rows`,
  [minAgeDays, bucket, limit])).rows[0];
  return { total: row.total, candidates: row.candidates, bytes: Number(row.bytes), byFolder: row.by_folder,
    foreignBucket: row.foreign_bucket, rows: row.rows, storedAt, references };
}

export type MediaGcOptions = {
  minAgeDays: number; bucket: string; apply?: boolean; batchSize?: number; limit?: number | null; maxShare?: number;
  /** How long a deletion waits for a row another transaction holds (an import about to reference it). */
  lockTimeoutMs?: number;
};
export type MediaGcResult = Omit<UnreferencedMedia, "rows"> & {
  apply: boolean; deleted: number; deletedBytes: number; becameReferenced: number; locked: number; sample: string[];
};

// One collection at a time; the (20261001, n) pairs are the project's advisory locks, 1-9 are taken.
const lockKey = [20261001, 10];
const errorCode = (error: unknown) => (error as { code?: string } | null)?.code;

/**
 * Reports (and with `apply` deletes) unreferenced media. Each batch deletes its rows first (foreign keys and the
 * conditions are checked again then), removes their objects, and commits only after the bucket confirmed; an object
 * store failure keeps the rows of the objects that stayed and stops the run. A row referenced after it was listed
 * (23503) or held by another transaction past `lockTimeoutMs` (55P03) is kept and the rest of its batch goes row by row.
 */
export async function collectMedia(pool: Pick<Pool, "connect">, storage: Pick<S3Client, "send">,
  { minAgeDays, bucket, apply = false, batchSize = 200, limit = null, maxShare = 0.2, lockTimeoutMs = 5000 }: MediaGcOptions): Promise<MediaGcResult> {
  if (!Number.isInteger(minAgeDays) || minAgeDays < 1) throw new Error("minAgeDays must be a whole number of days, at least 1");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) throw new Error("batchSize must be between 1 and 1000");
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) throw new Error("limit must be a positive whole number");
  if (!(maxShare >= 0 && maxShare <= 1)) throw new Error("maxShare must be between 0 and 1");
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 1) throw new Error("lockTimeoutMs must be a positive whole number");
  if (!bucket) throw new Error("bucket is required");
  const lock = apply ? await pool.connect() : null;
  const client = await pool.connect();
  let locked = false;
  try {
    if (lock) {
      locked = (await lock.query<{ ok: boolean }>("SELECT pg_try_advisory_lock($1, $2) AS ok", lockKey)).rows[0].ok;
      if (!locked) throw new Error("Another media collection is running");
    }
    const { rows, references, ...found } = await findUnreferencedMedia(client, { minAgeDays, bucket, limit });
    const result: MediaGcResult = { ...found, apply, deleted: 0, deletedBytes: 0, becameReferenced: 0, locked: 0, sample: rows.slice(0, 20).map(row => row.objectKey) };
    if (!apply) return result;
    if (!found.storedAt) throw new Error("product_media_objects.stored_at is missing; run npm run db:setup before --apply");
    if (found.total && found.candidates / found.total > maxShare) {
      throw new Error(`Refusing to delete ${found.candidates} of ${found.total} media objects: more than ${Math.round(maxShare * 100)}% (--max-share)`);
    }
    const deleteSql = `DELETE FROM product_media_objects m WHERE m.id=ANY($3::uuid[]) AND m.bucket=$2 AND ${conditions(references, true)}
      RETURNING m.id::text, m.object_key AS "objectKey", m.size_bytes AS "sizeBytes"`;
    const remove = (ids: string[]) => client.query<MediaCandidate>(deleteSql, [minAgeDays, bucket, ids]).then(res => res.rows);
    /** Keys the bucket did not delete; throws when the request itself failed. */
    const removeObjects = async (keys: string[]) => {
      const response = await storage.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true } }));
      return new Set((response.Errors ?? []).map(error => error.Key ?? ""));
    };
    const counted = (deleted: MediaCandidate[]) => {
      result.deleted += deleted.length;
      result.deletedBytes += deleted.reduce((sum, row) => sum + row.sizeBytes, 0);
    };
    const rollback = () => client.query("ROLLBACK");
    const begin = async () => {
      await client.query("BEGIN");
      await client.query("SELECT set_config('lock_timeout', $1, true)", [`${lockTimeoutMs}ms`]);
    };

    /**
     * Deletes rows and their objects in one transaction. "referenced": a reference appeared (23503); "locked":
     * another transaction held a row past the lock timeout (55P03); both rolled back, nothing deleted.
     */
    const deleteTogether = async (ids: string[]): Promise<"done" | "referenced" | "locked"> => {
      await begin();
      let deleted: MediaCandidate[];
      try { deleted = await remove(ids); } catch (error) {
        await rollback();
        if (errorCode(error) === "23503") return "referenced";
        if (errorCode(error) === "55P03") return "locked";
        throw error;
      }
      result.becameReferenced += ids.length - deleted.length;
      if (!deleted.length) { await client.query("COMMIT"); return "done"; }
      let failed: Set<string>;
      try { failed = await removeObjects(deleted.map(row => row.objectKey)); } catch (error) { await rollback(); throw error; }
      if (!failed.size) { await client.query("COMMIT"); counted(deleted); return "done"; }
      // The bucket kept some objects: their rows stay; the rows of objects already gone are deleted, then the run stops.
      await rollback();
      const gone = deleted.filter(row => !failed.has(row.objectKey));
      if (gone.length) {
        await begin();
        try { counted(await remove(gone.map(row => row.id))); await client.query("COMMIT"); } catch (error) { await rollback(); throw error; }
      }
      throw new Error(`Object storage did not delete ${failed.size} object(s), their rows were kept: ${[...failed].slice(0, 5).join(", ")}`);
    };

    for (let start = 0; start < rows.length; start += batchSize) {
      const ids = rows.slice(start, start + batchSize).map(row => row.id);
      if (await deleteTogether(ids) === "done") continue;
      for (const id of ids) {
        const outcome = await deleteTogether([id]);
        if (outcome === "referenced") result.becameReferenced++;
        else if (outcome === "locked") result.locked++;
      }
    }
    return result;
  } finally {
    client.release();
    if (lock) {
      // A connection whose unlock failed is closed instead of returned to the pool still holding the lock.
      const unlocked = !locked || await lock.query("SELECT pg_advisory_unlock($1, $2)", lockKey).then(() => true, () => false);
      lock.release(!unlocked);
    }
  }
}

export type MediaGcArgs = { apply: boolean; minAgeDays: number; limit: number | null; batchSize: number; maxShare: number };

/** npm run media:gc flags, strictly: a mistyped flag must never turn into a deleting run. */
export function parseMediaGcArgs(argv: string[]): MediaGcArgs {
  const usage = "Usage: media-gc.ts [--apply] [--min-age-days=N] [--limit=N] [--batch=N] [--max-share=0..1]";
  const parsed: MediaGcArgs = { apply: false, minAgeDays: 7, limit: null, batchSize: 200, maxShare: 0.2 };
  const seen = new Set<string>();
  const whole = (name: string, value: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw new Error(`${name} must be a whole number between ${min} and ${max}: ${value}`);
    return Number(value);
  };
  for (const arg of argv) {
    const [name, value] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    if (seen.has(name)) throw new Error(`Repeated argument: ${arg}. ${usage}`);
    seen.add(name);
    if (name === "--apply" && value === null) parsed.apply = true;
    else if (name === "--min-age-days" && value !== null) parsed.minAgeDays = whole(name, value, 1);
    else if (name === "--limit" && value !== null) parsed.limit = whole(name, value, 1);
    else if (name === "--batch" && value !== null) parsed.batchSize = whole(name, value, 1, 1000);
    else if (name === "--max-share" && value !== null) {
      if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(value)) throw new Error(`--max-share must be a number between 0 and 1: ${value}`);
      parsed.maxShare = Number(value);
    } else throw new Error(`Unknown argument: ${arg}. ${usage}`);
  }
  return parsed;
}
