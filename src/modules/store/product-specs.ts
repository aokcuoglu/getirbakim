import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import type { SpecOverride } from "./product-spec-display";

/**
 * The admin's technical specification decisions of the products the given store rows belong to
 * (db/product-override-specs.sql, #603), in one query, oldest first. Rows of products without any are left out.
 */
export async function getOverrideSpecs(itemIds: string[]) {
  const result = new Map<string, SpecOverride[]>();
  if (!itemIds.length) return result;
  const rows = (await db.query<SpecOverride & { supplier_item_id: string }>(
    `SELECT s.supplier_item_id::text,o.action,o.key,o.value FROM product_sources s
     JOIN product_override_specs o ON o.product_id=s.product_id
     WHERE s.supplier_item_id=ANY($1::uuid[]) ORDER BY o.created_at,o.id`, [itemIds])).rows;
  for (const { supplier_item_id: id, ...override } of rows) result.set(id, [...result.get(id) ?? [], override]);
  return result;
}

/** One store row's specification decisions, read once per request. */
export const getItemSpecs = cache(async (itemId: string): Promise<SpecOverride[]> => (await getOverrideSpecs([itemId])).get(itemId) ?? []);
