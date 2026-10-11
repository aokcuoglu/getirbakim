import "server-only";
import type { Pool } from "pg";
import type { ProductPricingRates } from "./product-pricing-schema";

/** The action authorizes the administrator; this single statement also restricts writes to Dinamik items. */
export async function persistProductPricing(database: Pick<Pool, "query">, id: string, rates: ProductPricingRates, adminId: string): Promise<boolean> {
  if (rates.markup === null && rates.vat === null) {
    const result = await database.query(`WITH item AS (SELECT id FROM supplier_items WHERE id=$1 AND supplier='dinamik'),
      removed AS (DELETE FROM commerce_product_pricing p USING item WHERE p.supplier_item_id=item.id RETURNING p.supplier_item_id)
      SELECT id FROM item`, [id]);
    return result.rows.length > 0;
  }
  const result = await database.query(`INSERT INTO commerce_product_pricing(supplier_item_id,markup_percent,vat_percent,updated_by)
    SELECT id,$2,$3,$4 FROM supplier_items WHERE id=$1 AND supplier='dinamik'
    ON CONFLICT(supplier_item_id) DO UPDATE SET markup_percent=EXCLUDED.markup_percent,vat_percent=EXCLUDED.vat_percent,
      updated_at=now(),updated_by=EXCLUDED.updated_by RETURNING supplier_item_id`, [id, rates.markup, rates.vat, adminId]);
  return result.rows.length > 0;
}
