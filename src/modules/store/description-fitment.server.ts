import "server-only";
import { db } from "@/lib/db";

export type DescriptionModelFitment = { modelId: number; brand: string; model: string; yearFrom: number | null; yearTo: number | null };

/** Vehicle models read from the supplier's description of this product or its grouped offers (#392). */
export async function getDescriptionFitments(productId: string): Promise<DescriptionModelFitment[]> {
  return (await db.query<DescriptionModelFitment>(`SELECT DISTINCT ON (f.model_id) f.model_id AS "modelId",b.display_name AS brand,m.name AS model,
    f.year_from AS "yearFrom",f.year_to AS "yearTo"
    FROM storefront_description_fits f JOIN vehicle_models m ON m.id=f.model_id JOIN vehicle_brands b ON b.id=m.brand_id
    WHERE f.supplier_item_id IN (SELECT $1::uuid UNION SELECT item_id FROM product_offers WHERE primary_id=$1::uuid)
    ORDER BY f.model_id`, [productId])).rows.sort((a, b) => `${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`, "tr"));
}

/** The model ids getDescriptionFitments lists, for several store rows in one query (#708); rows without any are left out. */
export async function getDescriptionModelIds(productIds: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  if (!productIds.length) return result;
  const rows = (await db.query<{ id: string; model_id: number }>(`SELECT DISTINCT g.id::text,f.model_id FROM (
      SELECT id,id AS item_id FROM unnest($1::uuid[]) id
      UNION SELECT primary_id,item_id FROM product_offers WHERE primary_id=ANY($1::uuid[])) g
    JOIN storefront_description_fits f ON f.supplier_item_id=g.item_id
    JOIN vehicle_models m ON m.id=f.model_id JOIN vehicle_brands b ON b.id=m.brand_id`, [productIds])).rows;
  for (const row of rows) result.set(row.id, [...result.get(row.id) ?? [], row.model_id]);
  return result;
}

export const describeYears = (fitment: Pick<DescriptionModelFitment, "yearFrom" | "yearTo">) =>
  fitment.yearFrom ? `${fitment.yearFrom}–${fitment.yearTo ?? ""}` : "";
