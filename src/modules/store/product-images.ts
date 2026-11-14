import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { CatalogProductImage } from "./product-enrichment";

export type ItemOverrideImages = { images: CatalogProductImage[]; hideAutomatic: boolean };

/**
 * The admin's uploads and the "hide the automatic image" choice of the products the given store rows belong to
 * (db/product-override-images.sql, #581), in one query. Rows of products without either are left out.
 */
export async function getOverrideImages(itemIds: string[]) {
  const result = new Map<string, ItemOverrideImages>();
  if (!itemIds.length) return result;
  const rows = (await db.query<{ supplier_item_id: string; media_id: string | null; width: number | null; height: number | null; hide_automatic: boolean | null }>(
    `SELECT s.supplier_item_id::text,i.media_id::text,i.width,i.height,st.hide_automatic
     FROM product_sources s
     LEFT JOIN product_override_image_settings st ON st.product_id=s.product_id
     LEFT JOIN product_override_images i ON i.product_id=s.product_id
     WHERE s.supplier_item_id=ANY($1::uuid[]) AND (i.id IS NOT NULL OR st.hide_automatic)
     ORDER BY s.supplier_item_id,i.position,i.id`, [itemIds])).rows;
  for (const row of rows) {
    const entry = result.get(row.supplier_item_id) ?? { images: [], hideAutomatic: Boolean(row.hide_automatic) };
    if (row.media_id && row.width && row.height) entry.images.push({ src: `/api/product-media/${row.media_id}`, width: row.width, height: row.height });
    result.set(row.supplier_item_id, entry);
  }
  return result;
}

/** One store row's uploads, read once per request (the product page and its metadata). */
export const getItemImages = cache(async (itemId: string): Promise<ItemOverrideImages> =>
  (await getOverrideImages([itemId])).get(itemId) ?? { images: [], hideAutomatic: false });

/**
 * A media object the store may serve: an enrichment image shown on a present storefront row, or an admin upload.
 * Anything else (vehicle and category images have their own routes, objects nothing shows) is not served here.
 */
export async function servableProductMedia(id: string, companies: string[]) {
  return (await db.query<{ bucket: string; object_key: string; content_type: string; sha256: string; size_bytes: number }>(
    `SELECT m.bucket,m.object_key,m.content_type,m.sha256,m.size_bytes FROM product_media_objects m WHERE m.id=$1 AND (EXISTS
     (SELECT 1 FROM storefront_enrichments e JOIN supplier_items i ON i.id=e.supplier_item_id
      WHERE e.image_id=m.id AND i.presence='present' AND i.company=ANY($2::text[]))
     OR EXISTS (SELECT 1 FROM product_override_images o WHERE o.media_id=m.id))`, [id, companies])).rows[0];
}
