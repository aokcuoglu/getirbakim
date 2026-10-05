import "server-only";
import { db } from "@/lib/db";
import type { AdminFitmentDetails } from "./fitment-details";

export async function adminFitmentDetails(id: string): Promise<AdminFitmentDetails | null> {
  const result = await db.query<AdminFitmentDetails>(`SELECT
    COALESCE(jsonb_array_length(e.payload->'vehicleModels'),0) AS "modelCount",
    COALESCE(jsonb_agg(jsonb_build_object(
      'index',source.ordinality-1,'source',source.vehicle,
      'status',CASE WHEN f.source_index IS NULL THEN 'unprocessed'
        WHEN f.source_vehicle IS DISTINCT FROM source.vehicle THEN 'stale' ELSE f.match_status END,
      'catalog',CASE WHEN f.source_vehicle=source.vehicle AND f.match_status='matched' AND v.id IS NOT NULL
        THEN jsonb_build_object('typeId',v.id,'brand',b.display_name,'model',m.name,'engine',v.name,
          'ps',v.hp,'kw',v.kwt,'cc',v.cc,'from',to_char(v.year_of_constr_from,'MM/YYYY'),
          'to',to_char(v.year_of_constr_to,'MM/YYYY')) ELSE NULL END
    ) ORDER BY source.ordinality) FILTER(WHERE source.ordinality IS NOT NULL),'[]'::jsonb) AS rows
    FROM product_enrichment_jobs j
    LEFT JOIN product_enrichments e ON e.supplier_item_id=j.supplier_item_id
    LEFT JOIN LATERAL jsonb_array_elements(COALESCE(e.payload->'vehicles','[]'::jsonb))
      WITH ORDINALITY source(vehicle,ordinality) ON true
    LEFT JOIN product_vehicle_fitments f ON f.supplier_item_id=j.supplier_item_id AND f.source_index=source.ordinality-1
    LEFT JOIN vehicle_types v ON v.id=f.vehicle_type_id
    LEFT JOIN vehicle_models m ON m.id=v.model_id
    LEFT JOIN vehicle_brands b ON b.id=m.brand_id
    WHERE j.supplier_item_id=$1 GROUP BY j.supplier_item_id,e.supplier_item_id`, [id]);
  return result.rows[0] || null;
}
