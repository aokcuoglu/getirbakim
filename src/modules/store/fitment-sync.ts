import type { PoolClient } from "pg";
import { enrichmentDataSchema } from "./enrichment-contract";
import { createFitmentMatcher, FITMENT_MATCHER_VERSION, type FitmentCatalogModel, type FitmentCatalogType, type FitmentMatch } from "./fitment-matcher";

// Call before locking/updating enrichment rows. Both imports and rebuilds use
// these locks, and the vehicle catalog importer already uses (20261003, 1).
export async function lockFitmentSync(client: PoolClient) {
  await client.query("SELECT pg_advisory_xact_lock(20261003,3)");
  await client.query("SELECT pg_advisory_xact_lock(20261003,1)");
}
export async function loadFitmentMatcher(client: PoolClient) {
  const models = (await client.query<FitmentCatalogModel>(`SELECT m.id,m.brand_id,m.name,b.name AS brand,b.display_name AS display_brand
    FROM vehicle_models m JOIN vehicle_brands b ON b.id=m.brand_id`)).rows;
  const types = (await client.query<FitmentCatalogType>(`SELECT id,model_id,name,cc,fuel_type,hp,kwt,
    to_char(year_of_constr_from,'YYYY-MM') AS date_from,to_char(year_of_constr_to,'YYYY-MM') AS date_to FROM vehicle_types`)).rows;
  return createFitmentMatcher(models, types);
}
export async function syncProductFitments(client: PoolClient, productId: string, payload: unknown, match: ReturnType<typeof createFitmentMatcher>) {
  const data = enrichmentDataSchema.parse(payload);
  const matches = data.vehicles.map(match);
  // Replace only this product's derived observations, in the caller's transaction.
  await client.query("DELETE FROM product_vehicle_fitments WHERE supplier_item_id=$1", [productId]);
  if (matches.length) await client.query(`INSERT INTO product_vehicle_fitments
    (supplier_item_id,source_index,source_vehicle,vehicle_type_id,match_status,candidate_type_ids,matcher_version)
    SELECT $1,source_index,source_vehicle,vehicle_type_id,match_status,candidate_type_ids,$3
    FROM jsonb_to_recordset($2::jsonb) AS r(source_index integer,source_vehicle jsonb,vehicle_type_id integer,match_status text,candidate_type_ids integer[])`,
    [productId, JSON.stringify(matches.map(row => ({ source_index: row.sourceIndex, source_vehicle: row.source, vehicle_type_id: row.typeId, match_status: row.status, candidate_type_ids: row.candidateTypeIds }))), FITMENT_MATCHER_VERSION]);
  return matches.reduce<Partial<Record<FitmentMatch["status"], number>>>((counts, row) => { counts[row.status] = (counts[row.status] || 0) + 1; return counts; }, {});
}
