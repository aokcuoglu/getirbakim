import "server-only";
import type { Pool } from "pg";
import type { ProductPricing, ProductPricingRates } from "./product-pricing-schema";

/** Uses the same latest successful import and currency rate as commerce_catalog. */
export async function loadProductPricing(database: Pick<Pool, "query">, id: string): Promise<ProductPricing> {
  const { rows } = await database.query<ProductPricing>(`SELECT p.markup_percent::float8 AS markup,p.vat_percent::float8 AS vat,
    s.markup_percent::float8 AS "generalMarkup",s.vat_percent::float8 AS "generalVat",i.product_data->>'dc' AS currency,
    CASE WHEN i.product_data->>'dc' IN ('TL','TRY') THEN 1::float8 ELSE (rate.value->>'satis')::float8 END AS "exchangeRate"
    FROM commerce_settings s LEFT JOIN supplier_items i ON i.id=$1
    LEFT JOIN commerce_product_pricing p ON p.supplier_item_id=i.id
    LEFT JOIN LATERAL (SELECT currencies_data FROM supplier_imports
      WHERE supplier=i.supplier AND company=i.company AND status='succeeded' ORDER BY completed_at DESC,id DESC LIMIT 1) latest ON true
    LEFT JOIN LATERAL jsonb_array_elements(latest.currencies_data->'dovizListesi') rate(value)
      ON rate.value->>'dovizCinsi'=i.product_data->>'dc' WHERE s.id=true`, [id]);
  if (!rows[0]) throw new Error("Satış ayarları bulunamadı.");
  return rows[0];
}

/** The action authorizes the administrator; this statement restricts writes to supported supplier items. */
export async function persistProductPricing(database: Pick<Pool, "query">, id: string, rates: ProductPricingRates, adminId: string): Promise<boolean> {
  if (rates.markup === null && rates.vat === null) {
    const result = await database.query(`WITH item AS (SELECT id FROM supplier_items WHERE id=$1 AND supplier IN ('dinamik','basbug','seta','manual')),
      removed AS (DELETE FROM commerce_product_pricing p USING item WHERE p.supplier_item_id=item.id RETURNING p.supplier_item_id)
      SELECT id FROM item`, [id]);
    return result.rows.length > 0;
  }
  const result = await database.query(`INSERT INTO commerce_product_pricing(supplier_item_id,markup_percent,vat_percent,updated_by)
    SELECT id,$2,$3,$4 FROM supplier_items WHERE id=$1 AND supplier IN ('dinamik','basbug','seta','manual')
    ON CONFLICT(supplier_item_id) DO UPDATE SET markup_percent=EXCLUDED.markup_percent,vat_percent=EXCLUDED.vat_percent,
      updated_at=now(),updated_by=EXCLUDED.updated_by RETURNING supplier_item_id`, [id, rates.markup, rates.vat, adminId]);
  return result.rows.length > 0;
}
