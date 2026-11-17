import "server-only";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { productFitmentAutomaticLimit, productFitmentLimit } from "./product-fitment-fields";

/** A vehicle engine type as the admin list shows it (vehicle_types with its model and make). */
export type FitmentVehicle = {
  typeId: number; brand: string; model: string; engine: string; fuel: string;
  ps: number; kw: number; cc: number | null; from: string; to: string | null;
};
/** `automatic`: an automatic source links the type too (also beyond the list's limit). */
type DecisionRow = FitmentVehicle & { id: string; mode: "add" | "remove"; carried: boolean; automatic: boolean };
/** A product's vehicle fitments as the admin manages them (db/product-override-fitments.sql, #583). */
export type ProductFitments = {
  /** The admin's added and removed types (or a merge's), oldest first. */
  rows: DecisionRow[];
  /** The engine types the automatic sources (enrichment fitments) link, by make, model and engine; at most productFitmentAutomaticLimit. */
  automatic: FitmentVehicle[];
  /** How many automatic types there are in all (the list stops at productFitmentAutomaticLimit). */
  automaticTotal: number;
};
/**
 * `added`: how many types an add or a copy from another product wrote (#662); `batchId`: the id the rows of a bulk add
 * or a copy share (#817), which "Geri al" takes back; `undone`: how many types that undo removed.
 */
export type ProductFitmentResult = { ok: true; added?: number; batchId?: string; undone?: number } | { ok: false; reason: "not-found" | "merged" | "limit"
  | "unknown-vehicle" | "duplicate" | "removed" | "not-automatic" | "unchanged" | "stale" | "not-in-source" | "hide-limit" | "bad-source" | "nothing-to-copy"
  | "nothing-to-undo" };

type Queryable = Pick<Pool, "query"> | PoolClient;

export const vehicleColumns = `v.id AS "typeId",b.display_name AS brand,m.name AS model,v.name AS engine,v.fuel_name AS fuel,v.hp AS ps,v.kwt AS kw,v.cc,
  to_char(v.year_of_constr_from,'MM/YYYY') AS "from",to_char(v.year_of_constr_to,'MM/YYYY') AS "to"`;
export const vehicleJoins = "JOIN vehicle_models m ON m.id=v.model_id JOIN vehicle_brands b ON b.id=m.brand_id";

// The enrichment donors the store reads for the product's rows (src/modules/store/catalog.ts fittedProductIds): the donor
// of a row whose payload still describes it (RAW code and brand, trusted basis), with its vehicles and model list. A
// product has one donor; its payload is read once. `sources` of a WITH list taking the product id as $1.
export const fitmentSourcesSql = `sources AS MATERIALIZED (
   SELECT DISTINCT ON (e.donor_item_id) e.donor_item_id,e.payload->'vehicles' AS vehicles,e.payload->'vehicleModels' AS models
   FROM product_sources s JOIN storefront_enrichments e ON e.supplier_item_id=s.supplier_item_id
   JOIN supplier_items i ON i.id=e.supplier_item_id AND i.code=e.supplier_code AND i.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   WHERE s.product_id=$1 ORDER BY e.donor_item_id)`;
// Only the fitments that agree with the vehicle at the same index of the donor's payload, by their primary key prefix.
// `automatic` of a WITH list taking the product id as $1.
export const automaticTypesSql = `${fitmentSourcesSql},
  automatic AS (SELECT DISTINCT f.vehicle_type_id AS id FROM sources x
   JOIN product_vehicle_fitments f ON f.supplier_item_id=x.donor_item_id
   WHERE f.vehicle_type_id IS NOT NULL AND f.source_vehicle=x.vehicles->f.source_index)`;

async function loadAutomatic(database: Queryable, productId: string) {
  const rows = (await database.query<FitmentVehicle & { total: number }>(`WITH ${automaticTypesSql}
    SELECT ${vehicleColumns},count(*) OVER ()::int AS total FROM automatic a JOIN vehicle_types v ON v.id=a.id ${vehicleJoins}
    ORDER BY b.display_name,m.name,v.name,v.year_of_constr_from,v.id LIMIT ${productFitmentAutomaticLimit}`, [productId])).rows;
  // The vehicle fields only: the window count is not sent to the page once per row.
  const automatic = rows.map(({ typeId, brand, model, engine, fuel, ps, kw, cc, from, to }): FitmentVehicle => ({ typeId, brand, model, engine, fuel, ps, kw, cc, from, to }));
  return { automatic, automaticTotal: rows[0]?.total ?? 0 };
}

const isAutomatic = async (client: PoolClient, productId: string, typeId: number) =>
  Boolean((await client.query(`WITH ${automaticTypesSql} SELECT 1 FROM automatic WHERE id=$2`, [productId, typeId])).rowCount);

export async function loadProductFitments(database: Pick<Pool, "query">, productId: string): Promise<ProductFitments> {
  const [rows, automatic] = await Promise.all([
    database.query<DecisionRow>(`WITH ${automaticTypesSql}
      SELECT o.id::text,o.mode,o.carried_from IS NOT NULL AS carried,EXISTS (SELECT 1 FROM automatic a WHERE a.id=o.vehicle_type_id) AS automatic,${vehicleColumns}
      FROM product_override_fitments o JOIN vehicle_types v ON v.id=o.vehicle_type_id ${vehicleJoins}
      WHERE o.product_id=$1 ORDER BY o.created_at,o.id`, [productId]),
    loadAutomatic(database, productId),
  ]);
  return { rows: rows.rows, ...automatic };
}

/** "MERCEDES-BENZ 190 (W201) 2.0" by type id, for the history of the given type ids (unknown ids are left out). */
export async function fitmentVehicleNames(database: Pick<Pool, "query">, typeIds: string[]) {
  const ids = [...new Set(typeIds.filter(id => /^\d{1,9}$/.test(id)))];
  if (!ids.length) return new Map<string, string>();
  const rows = (await database.query<{ id: string; name: string }>(`SELECT v.id::text,concat_ws(' ',b.display_name,m.name,v.name) AS name
    FROM vehicle_types v ${vehicleJoins} WHERE v.id=ANY($1::int[])`, [ids])).rows;
  return new Map(rows.map(row => [row.id, row.name]));
}

/** Runs a change in one transaction on the locked product (a merge carrying decisions locks the same row). */
export async function changeProductFitments(database: Pick<Pool, "connect">, productId: string,
  run: (client: PoolClient) => Promise<ProductFitmentResult>): Promise<ProductFitmentResult> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    const product = (await client.query<{ merged_into: string | null }>("SELECT merged_into FROM products WHERE id=$1 FOR UPDATE", [productId])).rows[0];
    if (!product) { await client.query("ROLLBACK"); return { ok: false, reason: "not-found" }; }
    if (product.merged_into) { await client.query("ROLLBACK"); return { ok: false, reason: "merged" }; }
    const result = await run(client);
    await client.query(result.ok ? "COMMIT" : "ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** One history row of a fitment change, written by the admin; `batchId` joins it to a bulk change's rows (#816). */
export const recordFitmentChange = (client: PoolClient, productId: string, field: string, oldValue: string | null, newValue: string | null, adminId: string,
  batchId: string | null = null) =>
  client.query(`INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,batch_id) VALUES($1,$2,$3,$4,$5,$6)`,
    [productId, field, oldValue, newValue, adminId, batchId]);
export const decisionCount = async (client: PoolClient, productId: string) =>
  (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM product_override_fitments WHERE product_id=$1", [productId])).rows[0].n;

/**
 * Writes added types of a locked product in the given order, with one fitment_added history row each, in one
 * statement: the queue triggers of product_override_fitments run once per statement, not once per type. A bulk change
 * gives every row and history row its `batchId` (#816, #817); a single type is written with NULL.
 */
export async function insertAddedFitments(client: PoolClient, productId: string, ids: number[], adminId: string, batchId: string | null) {
  // Every row gets the same now(): a microsecond per position keeps the order the admin chose.
  await client.query(`WITH t AS (SELECT * FROM unnest($2::int[]) WITH ORDINALITY t(id,position)),
    added AS (INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode,created_by,created_at,batch_id)
      SELECT $1,t.id,'add',$3,now()+(t.position*interval '1 microsecond'),$4 FROM t)
    INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,batch_id)
    SELECT $1,'fitment_added',NULL,t.id::text,$3,$4 FROM t ORDER BY t.position`, [productId, ids, adminId, batchId]);
}

/**
 * Adds engine types the product fits: every row of the product lists them in the store (vehicle filter, search, make
 * page, product page), with or without enrichment. A type the automatic sources link already may be added too: the
 * decision keeps it if the source drops it. The whole batch is refused when one type is unknown, added already or
 * removed by an admin (that one is shown again with "Yeniden göster"). Several types share a batch id (#817).
 */
export async function addProductFitments(database: Pick<Pool, "connect">, productId: string, typeIds: number[], adminId: string) {
  const ids = [...new Set(typeIds)];
  return changeProductFitments(database, productId, async client => {
    // One client runs one query at a time: awaited in turn, not in parallel.
    const known = (await client.query<{ id: number }>("SELECT id FROM vehicle_types WHERE id=ANY($1::int[])", [ids])).rows;
    if (known.length !== ids.length) return { ok: false, reason: "unknown-vehicle" };
    const existing = (await client.query<{ vehicle_type_id: number; mode: string }>(
      "SELECT vehicle_type_id,mode FROM product_override_fitments WHERE product_id=$1 AND vehicle_type_id=ANY($2::int[])", [productId, ids])).rows;
    if (existing.some(row => row.mode === "remove")) return { ok: false, reason: "removed" };
    if (existing.length) return { ok: false, reason: "duplicate" };
    if (await decisionCount(client, productId) + ids.length > productFitmentLimit) return { ok: false, reason: "limit" };
    const batchId = ids.length > 1 ? randomUUID() : null;
    await insertAddedFitments(client, productId, ids, adminId, batchId);
    return batchId ? { ok: true, added: ids.length, batchId } : { ok: true, added: ids.length };
  });
}

/** Leaves an automatic fitment out of the store for every row of the product (an added type becomes removed). */
export async function removeProductFitment(database: Pick<Pool, "connect">, productId: string, typeId: number, adminId: string) {
  return changeProductFitments(database, productId, async client => {
    if (!(await isAutomatic(client, productId, typeId))) return { ok: false, reason: "not-automatic" };
    const previous = (await client.query<{ mode: string }>(
      "SELECT mode FROM product_override_fitments WHERE product_id=$1 AND vehicle_type_id=$2", [productId, typeId])).rows[0];
    if (previous?.mode === "remove") return { ok: false, reason: "unchanged" };
    if (!previous && await decisionCount(client, productId) >= productFitmentLimit) return { ok: false, reason: "limit" };
    await client.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode,created_by) VALUES($1,$2,'remove',$3)
      ON CONFLICT (product_id,vehicle_type_id) DO UPDATE SET mode='remove',carried_from=NULL,batch_id=NULL,created_by=excluded.created_by,created_at=now()`,
    [productId, typeId, adminId]);
    await recordFitmentChange(client, productId, "fitment_removed", previous ? String(typeId) : null, String(typeId), adminId);
    return { ok: true };
  });
}

/**
 * Takes a decision back: an added type leaves the store again (unless an automatic source links it), a removed
 * automatic type returns. "stale" when the row is gone already.
 */
export async function deleteProductFitment(database: Pick<Pool, "connect">, productId: string, rowId: string, adminId: string) {
  return changeProductFitments(database, productId, async client => {
    const removed = (await client.query<{ mode: string; vehicle_type_id: number }>(
      "DELETE FROM product_override_fitments WHERE id=$1 AND product_id=$2 RETURNING mode,vehicle_type_id", [rowId, productId])).rows[0];
    if (!removed) return { ok: false, reason: "stale" };
    await recordFitmentChange(client, productId, removed.mode === "add" ? "fitment_unadded" : "fitment_restored", String(removed.vehicle_type_id), null, adminId);
    return { ok: true };
  });
}

/**
 * Takes a bulk add or copy back in one step (#817): the batch's types still added to the product leave it, with one
 * fitment_unadded history row each under a new batch id. Types removed one by one since, or turned into "remove"
 * decisions, are no longer in the batch and stay as they are; an automatic source still linking a type keeps it as an
 * automatic fitment. "nothing-to-undo" when none of the batch is left.
 */
export async function undoFitmentBatch(database: Pick<Pool, "connect">, productId: string, batchId: string, adminId: string) {
  return changeProductFitments(database, productId, async (client): Promise<ProductFitmentResult> => {
    const { rowCount } = await client.query(`WITH removed AS (DELETE FROM product_override_fitments WHERE product_id=$1 AND batch_id=$2 AND mode='add'
        RETURNING vehicle_type_id,created_at)
      INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by,batch_id)
      SELECT $1,'fitment_unadded',vehicle_type_id::text,NULL,$3,$4 FROM removed ORDER BY created_at`, [productId, batchId, adminId, randomUUID()]);
    return rowCount ? { ok: true, undone: rowCount } : { ok: false, reason: "nothing-to-undo" };
  });
}
