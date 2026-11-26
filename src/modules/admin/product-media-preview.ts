import "server-only";
import type { Pool } from "pg";

/**
 * The automatic image of a storefront row that is not in the supplier's current list (#1442), for the admin product
 * page preview. Mirror of servableProductMedia's enrichment branch for non-present rows; it reads storefront_enrichments,
 * so a blocked image (link image_id NULL) is not matched by this branch.
 */
export async function unlistedAutomaticMedia(database: Pick<Pool, "query">, id: string, companies: string[]) {
  return (await database.query<{ bucket: string; object_key: string; content_type: string; size_bytes: number }>(
    `SELECT m.bucket,m.object_key,m.content_type,m.size_bytes FROM product_media_objects m
     WHERE m.id=$1 AND EXISTS (SELECT 1 FROM storefront_enrichments e JOIN supplier_items i ON i.id=e.supplier_item_id
       WHERE e.image_id=m.id AND i.presence<>'present' AND i.company=ANY($2::text[]))`, [id, companies])).rows[0];
}
