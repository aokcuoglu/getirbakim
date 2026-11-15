import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { ReferenceOverride } from "./product-reference-display";

/**
 * The admin's reference numbers of the product a store row belongs to (db/product-override-references.sql, #582):
 * added OEM / cross-reference numbers and barcodes, and hidden automatic numbers. Read once per request.
 */
export const getItemReferences = cache(async (itemId: string): Promise<ReferenceOverride[]> => (await db.query<ReferenceOverride>(
  `SELECT r.kind,r.action,r.brand,r.number,r.brand_key,r.number_key FROM product_sources s
   JOIN product_override_references r ON r.product_id=s.product_id WHERE s.supplier_item_id=$1 ORDER BY r.created_at,r.id`, [itemId])).rows);
