import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { StoreOverride } from "./product-override-display";

/**
 * The admin's edits of the product a store row belongs to (db/product-overrides.sql, #575), or null. Name and
 * description reach the catalog views already; the short description, SEO fields and the category are read here for the
 * product page.
 */
export const getItemOverride = cache(async (itemId: string): Promise<StoreOverride | null> => (await db.query<StoreOverride>(
  `SELECT o.name,o.description,o.short_description,o.seo_title,o.seo_description,o.category_id FROM product_sources s
   JOIN product_overrides o ON o.product_id=s.product_id WHERE s.supplier_item_id=$1`, [itemId])).rows[0] ?? null);
