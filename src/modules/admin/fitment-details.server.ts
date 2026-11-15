import "server-only";
import { db } from "@/lib/db";
import { fitmentDonorLateral } from "./fitment-donor";
import { fitmentPageSize, type AdminFitmentDetails, type FitmentPaging } from "./fitment-details";

// Each whitespace-separated term must appear somewhere in the vehicle text; LIKE wildcards are escaped.
const searchPatterns = (query: string) => query.split(/\s+/).filter(Boolean).slice(0, 8).map(term => `%${term.replace(/[\\%_]/g, "\\$&")}%`);

// `job` reads the donor enrichment with per-offer index lookups (fitment-donor.ts) instead of the whole
// product_enrichment_shared view. `base` carries only light columns for every source vehicle (needed for the
// totals); the catalog joins and the JSON build run for the requested page alone.
export async function adminFitmentDetails(id: string, paging: FitmentPaging = { offset: 0, limit: fitmentPageSize, filter: "all", query: "" }): Promise<AdminFitmentDetails | null> {
  const result = await db.query<AdminFitmentDetails>(`WITH job AS MATERIALIZED (
      SELECT COALESCE(jsonb_array_length(e.payload->'vehicleModels'),0) AS model_count,
        COALESCE(e.payload->'vehicles','[]'::jsonb) AS vehicles, e.donor_item_id
      FROM product_enrichment_jobs j
      LEFT JOIN LATERAL (${fitmentDonorLateral}) e ON true
      WHERE j.supplier_item_id=$1
    ), base AS MATERIALIZED (
      SELECT source.ordinality, source.vehicle, f.vehicle_type_id,
        CASE WHEN f.source_index IS NULL THEN 'unprocessed'
          WHEN f.source_vehicle IS DISTINCT FROM source.vehicle THEN 'stale' ELSE f.match_status END AS status,
        (f.source_vehicle=source.vehicle AND f.match_status='matched' AND f.vehicle_type_id IS NOT NULL) AS linked
      FROM job
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(job.vehicles)='array' THEN job.vehicles ELSE '[]'::jsonb END) WITH ORDINALITY source(vehicle,ordinality)
      LEFT JOIN product_vehicle_fitments f ON f.supplier_item_id=job.donor_item_id AND f.source_index=source.ordinality-1
    ), selected AS (
      SELECT * FROM base
      WHERE ($2::text='all' OR ($2::text='matched')=COALESCE(linked,false))
        AND concat_ws(' ',vehicle->>'model',vehicle->>'engineAndCodes',vehicle->>'ps',vehicle->>'kw',vehicle->>'cc',vehicle_type_id::text) ILIKE ALL($5::text[])
    ), page AS (
      SELECT * FROM selected ORDER BY ordinality OFFSET $3 LIMIT $4
    )
    SELECT job.model_count AS "modelCount",
      (SELECT count(*)::int FROM base) AS total,
      (SELECT count(*)::int FROM base WHERE COALESCE(linked,false)) AS matched,
      (SELECT count(*)::int FROM selected) AS filtered,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('index',p.ordinality-1,'source',p.vehicle,'status',p.status,
        'catalog',CASE WHEN p.linked AND v.id IS NOT NULL
          THEN jsonb_build_object('typeId',v.id,'brand',b.display_name,'model',m.name,'engine',v.name,
            'ps',v.hp,'kw',v.kwt,'cc',v.cc,'from',to_char(v.year_of_constr_from,'MM/YYYY'),
            'to',to_char(v.year_of_constr_to,'MM/YYYY')) ELSE NULL END
      ) ORDER BY p.ordinality)
      FROM page p
      LEFT JOIN vehicle_types v ON v.id=p.vehicle_type_id
      LEFT JOIN vehicle_models m ON m.id=v.model_id
      LEFT JOIN vehicle_brands b ON b.id=m.brand_id),'[]'::jsonb) AS rows
    FROM job`, [id, paging.filter, paging.offset, paging.limit, searchPatterns(paging.query)]);
  return result.rows[0] || null;
}
