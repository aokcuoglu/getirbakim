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

export type FitmentRebuildResult = {
  mode: "full" | "scoped"; requested: number; outdated: number; products: number; counts: Partial<Record<FitmentMatch["status"], number>>;
};
/**
 * Re-derives product_vehicle_fitments from the stored payloads, in the caller's transaction. Without `items` every
 * enrichment is rebuilt; with `items` only those supplier items (ids without an enrichment are ignored) plus every
 * product whose rows came from an older matcher version. Fitments depend only on the payload's vehicles, the vehicle
 * catalogue (whose importer rebuilds all of them) and FITMENT_MATCHER_VERSION, so this covers what a full rebuild would change.
 */
export async function rebuildProductFitments(client: PoolClient, options: { items?: string[] } = {}): Promise<FitmentRebuildResult> {
  await lockFitmentSync(client);
  const match = await loadFitmentMatcher(client);
  const columns = "SELECT supplier_item_id,payload FROM product_enrichments";
  let products: { supplier_item_id: string; payload: unknown }[];
  let outdated = 0;
  if (options.items === undefined) {
    products = (await client.query<{ supplier_item_id: string; payload: unknown }>(`${columns} ORDER BY supplier_item_id FOR UPDATE`)).rows;
  } else {
    const stale = (await client.query<{ supplier_item_id: string }>(
      "SELECT DISTINCT supplier_item_id FROM product_vehicle_fitments WHERE matcher_version<>$1", [FITMENT_MATCHER_VERSION])).rows.map(row => row.supplier_item_id);
    outdated = stale.length;
    const target = [...new Set([...options.items, ...stale])];
    products = (await client.query<{ supplier_item_id: string; payload: unknown }>(
      `${columns} WHERE supplier_item_id=ANY($1::uuid[]) ORDER BY supplier_item_id FOR UPDATE`, [target])).rows;
  }
  const counts: FitmentRebuildResult["counts"] = {};
  for (const product of products) {
    const result = await syncProductFitments(client, product.supplier_item_id, product.payload, match);
    for (const [status, n] of Object.entries(result) as [FitmentMatch["status"], number][]) counts[status] = (counts[status] || 0) + n;
  }
  return { mode: options.items === undefined ? "full" : "scoped", requested: options.items?.length ?? 0, outdated, products: products.length, counts };
}
