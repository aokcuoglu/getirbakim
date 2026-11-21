import type { PoolClient } from "pg";
import { placeholderImageSha256 } from "./placeholder-images";

/**
 * Drops listed source placeholders (#1098) from stored enrichments: image_id and the payload's image dimensions go,
 * imported_at moves forward so the incremental storefront sync carries the row, and a complete job turns partial
 * (a complete Trodo/spareto/parts2world row has an image; image fill retries partial rows without one). Run inside the
 * caller's transaction; a second run changes nothing. The media objects stay for media:gc.
 */
export async function clearPlaceholderImages(client: Pick<PoolClient, "query">, sha256s: readonly string[] = [...placeholderImageSha256]) {
  const { rows } = await client.query<{ cleared: number; demoted: number }>(
    `WITH cleared AS (
       UPDATE product_enrichments e SET image_id=NULL, payload=e.payload - 'imageWidth' - 'imageHeight', imported_at=now()
       FROM product_media_objects m WHERE m.id=e.image_id AND m.sha256=ANY($1::text[])
       RETURNING e.supplier_item_id),
     demoted AS (
       UPDATE product_enrichment_jobs j SET status='partial', updated_at=now()
       FROM cleared c WHERE j.supplier_item_id=c.supplier_item_id AND j.status='complete'
       RETURNING j.supplier_item_id)
     SELECT (SELECT count(*)::int FROM cleared) AS cleared, (SELECT count(*)::int FROM demoted) AS demoted`, [sha256s]);
  return rows[0];
}

/** What clearPlaceholderImages would change, without writing. */
export async function placeholderImageUse(client: Pick<PoolClient, "query">, sha256s: readonly string[] = [...placeholderImageSha256]) {
  return (await client.query<{ enrichments: number; images: number; demoted: number }>(
    `SELECT count(*)::int AS enrichments, count(DISTINCT e.image_id)::int AS images, count(*) FILTER (WHERE j.status='complete')::int AS demoted
     FROM product_enrichments e JOIN product_media_objects m ON m.id=e.image_id
     LEFT JOIN product_enrichment_jobs j ON j.supplier_item_id=e.supplier_item_id
     WHERE m.sha256=ANY($1::text[])`, [sha256s])).rows[0];
}
