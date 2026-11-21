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
  sha256: string; note: string; created_by: string | null; created_at: Date; image_id: string | null; donors: number;
};
type Database = Pick<Pool, "connect" | "query">;

/**
 * Runs a block change in one transaction. The sha256 is read from the media object (never taken from the client) and
 * the media must be an enrichment image; `listed` refuses code-denylist placeholders, which are hidden already.
 */
async function change(database: Database, imageId: string, denylist: ReadonlySet<string>,
  run: (client: PoolClient, sha256: string) => Promise<unknown>): Promise<ImageBlockResult> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const media = (await client.query<{ sha256: string; donors: boolean }>(
      `SELECT m.sha256, EXISTS (SELECT 1 FROM product_enrichments e WHERE e.image_id=m.id) AS donors
       FROM product_media_objects m WHERE m.id=$1`, [imageId])).rows[0];
    if (!media?.donors) { await client.query("ROLLBACK"); return { ok: false, reason: "not-found" }; }
    if (denylist.has(media.sha256)) { await client.query("ROLLBACK"); return { ok: false, reason: "listed" }; }
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

/** Blocks the image; blocking a blocked image keeps the first note and author. */
export function blockSharedImage(database: Database, imageId: string, note: string, adminId: string,
  denylist: ReadonlySet<string> = placeholderImageSha256) {
  return change(database, imageId, denylist, (client, sha256) => client.query(
    "INSERT INTO product_image_blocks(sha256,note,created_by) VALUES($1,$2,$3) ON CONFLICT (sha256) DO NOTHING", [sha256, note, adminId]));
}

export function unblockSharedImage(database: Database, imageId: string, denylist: ReadonlySet<string> = placeholderImageSha256) {
  return change(database, imageId, denylist, (client, sha256) => client.query("DELETE FROM product_image_blocks WHERE sha256=$1", [sha256]));
}

/** Every block, newest first, with the blocking admin's name, the media id in this database and its enrichment count. */
export async function listImageBlocks(database: Pick<Pool, "query">) {
  return (await database.query<ImageBlock>(
    `SELECT b.sha256, b.note, a.name AS created_by, b.created_at, m.id::text AS image_id,
       (SELECT count(*)::int FROM product_enrichments e WHERE e.image_id=m.id) AS donors
     FROM product_image_blocks b LEFT JOIN accounts a ON a.id=b.created_by LEFT JOIN product_media_objects m ON m.sha256=b.sha256
     ORDER BY b.created_at DESC, b.sha256`)).rows;
}
