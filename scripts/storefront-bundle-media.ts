import type { PoolClient } from "pg";
import { type ObjectStore, objectIsStored, putVerifiedObject } from "../src/lib/stored-object";

// The bundle media objects of import-storefront-bundle.ts (#1406). An object whose size and sha256 metadata already match
// costs one HEAD; a missing, different or metadata-less one is written with its sha256 metadata and a ChecksumSHA256 the
// store validates, so an acknowledged PUT is not read back (#1417; src/lib/stored-object.ts, shared with storeProductImage).
// The importer stores them before its transaction (S3 round trips no longer hold row locks) and rechecks inside it only
// what that read could not vouch for (mediaToRecheck). An object with the right size and intact metadata but other bytes
// is not noticed.

export type MediaTarget = { sha256: string; bucket: string; object_key: string; content_type: string };
/** A bundle media row's target, as read before the transaction; `known` when the target already had a row with its sha256. */
export type PlannedMedia = MediaTarget & { known: boolean };

export const DEFAULT_MEDIA_CONCURRENCY = 8;
const MAX_MEDIA_CONCURRENCY = 32;

/** STOREFRONT_MEDIA_CONCURRENCY (1–32, default 8): how many objects are checked or written at once. */
export function mediaConcurrency(env: Record<string, string | undefined> = process.env) {
  const value = env.STOREFRONT_MEDIA_CONCURRENCY;
  if (value === undefined || value === "") return DEFAULT_MEDIA_CONCURRENCY;
  const number = Number(value);
  if (!/^[1-9]\d*$/.test(value) || number > MAX_MEDIA_CONCURRENCY) {
    throw new Error(`STOREFRONT_MEDIA_CONCURRENCY must be an integer from 1 to ${MAX_MEDIA_CONCURRENCY}: ${value}`);
  }
  return number;
}

/**
 * Where each bundle media row's object lives on this side, as the importer's media INSERT … ON CONFLICT DO NOTHING
 * resolves it: the existing row's bucket, key and type for a known sha256, else `bucket` and the bundle's key and type.
 * Throws, before any object is touched, when a new sha256's key already belongs to a row with other content: the INSERT
 * would skip it (UNIQUE(bucket,object_key)) and fail the import, but storing first would overwrite that row's object.
 */
export async function resolveMediaTargets(db: Pick<PoolClient, "query">, mediaJson: string, bucket: string): Promise<PlannedMedia[]> {
  const { rows } = await db.query<PlannedMedia & { owner: string | null }>(`SELECT b.sha256,COALESCE(m.bucket,$2) AS bucket,
    COALESCE(m.object_key,b.object_key) AS object_key,COALESCE(m.content_type,b.content_type) AS content_type,m.id IS NOT NULL AS known,o.sha256 AS owner
    FROM jsonb_populate_recordset(null::product_media_objects,$1::jsonb) b LEFT JOIN product_media_objects m ON m.sha256=b.sha256
    LEFT JOIN product_media_objects o ON m.id IS NULL AND o.bucket=$2 AND o.object_key=b.object_key AND o.sha256<>b.sha256`, [mediaJson, bucket]);
  const taken = rows.filter(row => row.owner);
  if (taken.length) {
    throw new Error(`Bundle media key(s) already hold other media here, nothing was stored: ${taken.slice(0, 5)
      .map(row => `${row.bucket}/${row.object_key} (bundle ${row.sha256}, stored ${row.owner})`).join(", ")}`);
  }
  return rows.map(row => ({ sha256: row.sha256, bucket: row.bucket, object_key: row.object_key, content_type: row.content_type, known: row.known }));
}

/**
 * Makes the object at `target` hold `bytes`: "verified" when it already did (HEAD only), "uploaded" when it was written
 * and the store validated its checksum (or, on a store that does not echo it, read back).
 */
export async function ensureStoredObject(storage: ObjectStore, target: MediaTarget, bytes: Uint8Array): Promise<"verified" | "uploaded"> {
  const object = { bucket: target.bucket, key: target.object_key, sha256: target.sha256, contentType: target.content_type };
  if (await objectIsStored(storage, object, bytes.length)) return "verified";
  await putVerifiedObject(storage, object, bytes);
  return "uploaded";
}

/**
 * ensureStoredObject for every distinct bucket/key, `concurrency` at a time. After the first failure no further object
 * starts; the ones already running finish and the call rejects with that failure. Two sha256 values on one key throw.
 */
export async function ensureStoredObjects(storage: ObjectStore, targets: readonly MediaTarget[], bytesOf: (sha256: string) => Uint8Array,
  concurrency = mediaConcurrency()) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error(`Invalid media concurrency: ${concurrency}`);
  const byKey = new Map<string, MediaTarget>();
  for (const target of targets) {
    const key = `${target.bucket}/${target.object_key}`;
    const seen = byKey.get(key);
    if (seen && seen.sha256 !== target.sha256) throw new Error(`Media ${seen.sha256} and ${target.sha256} share one object key: ${key}`);
    byKey.set(key, target);
  }
  const queue = [...byKey.values()];
  const counts = { verified: 0, uploaded: 0 };
  const failures: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (failures.length === 0 && next < queue.length) {
      const target = queue[next++];
      try { counts[await ensureStoredObject(storage, target, bytesOf(target.sha256))]++; }
      catch (error) { failures.push(error); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  if (failures.length) throw failures[0];
  return counts;
}

/**
 * The media rows, as the transaction resolved them (`current`), whose objects the pre-transaction pass did not store:
 * a row it had no plan for or planned at another bucket/key, a sha256 it saw known that this transaction inserted again
 * (npm run media:gc removed the row and its object in between; the id and key can be the same, so only `inserted`, the
 * media INSERT's RETURNING sha256, tells), and one it saw new that this transaction did not insert (a concurrent writer).
 */
export function mediaToRecheck(planned: readonly PlannedMedia[], current: readonly MediaTarget[], inserted: ReadonlySet<string>) {
  const bySha = new Map(planned.map(entry => [entry.sha256, entry]));
  return current.filter(row => {
    const plan = bySha.get(row.sha256);
    return !plan || plan.bucket !== row.bucket || plan.object_key !== row.object_key || plan.known === inserted.has(row.sha256);
  });
}
