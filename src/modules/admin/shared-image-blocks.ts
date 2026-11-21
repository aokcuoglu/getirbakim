import "server-only";
import type { Pool, PoolClient } from "pg";
import { placeholderImageSha256 } from "@/modules/enrichment/placeholder-images";

/**
 * Blocking a shared automatic image (#1136): the image's sha256 goes into product_image_blocks and the donors of the
 * image are queued, so the next product_enrichment_shared_sync() drops it from their storefront links
 * (db/enrichment-shared-links.sql). The enrichments keep the image; unblocking queues them again and it comes back.
 */
export type ImageBlockResult = { ok: true } | { ok: false; reason: "not-found" | "listed" };
export type ImageBlock = {
  sha256: string; note: string; created_by: string | null; created_at: Date; image_id: string | null; source_url: string | null; donors: number;
};
type Database = Pick<Pool, "connect" | "query">;

/**
 * Runs a block change in one transaction on the media object's sha256 (never taken from the client); `check` may
 * refuse it. The image's donors are queued for the link sync either way.
 */
async function change(database: Database, imageId: string,
  check: (media: { sha256: string; donors: boolean }) => ImageBlockResult,
  run: (client: PoolClient, sha256: string) => Promise<unknown>): Promise<ImageBlockResult> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const media = (await client.query<{ sha256: string; donors: boolean }>(
      `SELECT m.sha256, EXISTS (SELECT 1 FROM product_enrichments e WHERE e.image_id=m.id) AS donors
       FROM product_media_objects m WHERE m.id=$1`, [imageId])).rows[0];
    const checked: ImageBlockResult = media ? check(media) : { ok: false, reason: "not-found" };
    if (!checked.ok) { await client.query("ROLLBACK"); return checked; }
    await run(client, media.sha256);
    // The donors' links are recomputed by the next sync; their products' offers follow (product_enrichment_shared_refresh).
    await client.query(`INSERT INTO product_enrichment_shared_queue(kind,id)
      SELECT DISTINCT 'i'::char(1), supplier_item_id FROM product_enrichments WHERE image_id=$1 ON CONFLICT DO NOTHING`, [imageId]);
    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/**
 * Blocks an enrichment image; `listed` refuses code-denylist placeholders, which are hidden already. Blocking a
 * blocked image keeps the first note and author.
 */
export function blockSharedImage(database: Database, imageId: string, note: string, adminId: string,
  denylist: ReadonlySet<string> = placeholderImageSha256) {
  return change(database, imageId,
    media => !media.donors ? { ok: false, reason: "not-found" } : denylist.has(media.sha256) ? { ok: false, reason: "listed" } : { ok: true },
    (client, sha256) => client.query(
      "INSERT INTO product_image_blocks(sha256,note,created_by) VALUES($1,$2,$3) ON CONFLICT (sha256) DO NOTHING", [sha256, note, adminId]));
}

/** Lifts a block whenever the media object exists, even when no enrichment uses it any more (a stale block). */
export function unblockSharedImage(database: Database, imageId: string) {
  return change(database, imageId, () => ({ ok: true }),
    (client, sha256) => client.query("DELETE FROM product_image_blocks WHERE sha256=$1", [sha256]));
}

/** Every block, newest first, with the blocking admin's name, the media in this database and its enrichment count. */
export async function listImageBlocks(database: Pick<Pool, "query">) {
  return (await database.query<ImageBlock>(
    `SELECT b.sha256, b.note, a.name AS created_by, b.created_at, m.id::text AS image_id, m.source_url,
       (SELECT count(*)::int FROM product_enrichments e WHERE e.image_id=m.id) AS donors
     FROM product_image_blocks b LEFT JOIN accounts a ON a.id=b.created_by LEFT JOIN product_media_objects m ON m.sha256=b.sha256
     ORDER BY b.created_at DESC, b.sha256`)).rows;
}

/**
 * Whether the link queue is small enough to drain inside a request: not when it holds the full-rebuild marker or more
 * than `limit` entries (a 10-20 s rebuild plus the make-fits refresh), which the server's sync tick runs instead.
 */
export async function linkQueueDrainable(database: Pick<Pool, "query">, limit = 1000) {
  const row = (await database.query<{ queued: number; rebuild: boolean }>(
    `SELECT count(*)::int AS queued, COALESCE(bool_or(kind='p' AND id='00000000-0000-0000-0000-000000000000'), false) AS rebuild
     FROM (SELECT kind,id FROM product_enrichment_shared_queue LIMIT $1) q`, [limit + 1])).rows[0];
  return !row.rebuild && row.queued <= limit;
}

/**
 * The stored object of a currently blocked media for the admin preview (#1176): only while its sha256 is in
 * product_image_blocks, so it is no general bypass of servableProductMedia and stops answering once unblocked.
 */
export async function blockedProductMedia(database: Pick<Pool, "query">, id: string) {
  return (await database.query<{ bucket: string; object_key: string; content_type: string; size_bytes: number }>(
    `SELECT m.bucket,m.object_key,m.content_type,m.size_bytes FROM product_media_objects m
     WHERE m.id=$1 AND EXISTS (SELECT 1 FROM product_image_blocks b WHERE b.sha256=m.sha256)`, [id])).rows[0];
}
