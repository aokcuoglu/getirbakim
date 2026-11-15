import "server-only";
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
export type ProductFitmentResult = { ok: true } | { ok: false; reason: "not-found" | "merged" | "limit" | "unknown-vehicle" | "duplicate" | "removed" | "not-automatic" | "unchanged" | "stale" };

type Queryable = Pick<Pool, "query"> | PoolClient;

const vehicleColumns = `v.id AS "typeId",b.display_name AS brand,m.name AS model,v.name AS engine,v.fuel_name AS fuel,v.hp AS ps,v.kwt AS kw,v.cc,
  to_char(v.year_of_constr_from,'MM/YYYY') AS "from",to_char(v.year_of_constr_to,'MM/YYYY') AS "to"`;
const vehicleJoins = "JOIN vehicle_models m ON m.id=v.model_id JOIN vehicle_brands b ON b.id=m.brand_id";

// The fitments the store counts for the product's rows (src/modules/store/catalog.ts fittedProductIds): the donor of a
// row whose payload still describes it (RAW code and brand, trusted basis), and only the fitments that agree with the
// vehicle at the same index of that payload. A product has one donor; its vehicles are read once, then the fitments by
// their primary key prefix.
const automaticTypesSql = `sources AS MATERIALIZED (
   SELECT DISTINCT ON (e.donor_item_id) e.donor_item_id,e.payload->'vehicles' AS vehicles
   FROM product_sources s JOIN storefront_enrichments e ON e.supplier_item_id=s.supplier_item_id
   JOIN supplier_items i ON i.id=e.supplier_item_id AND i.code=e.supplier_code AND i.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   WHERE s.product_id=$1 ORDER BY e.donor_item_id),
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
async function change(database: Pick<Pool, "connect">, productId: string,
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

const record = (client: PoolClient, productId: string, field: string, oldValue: string | null, newValue: string | null, adminId: string) =>
  client.query(`INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by) VALUES($1,$2,$3,$4,$5)`,
    [productId, field, oldValue, newValue, adminId]);
const decisionCount = async (client: PoolClient, productId: string) =>
  (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM product_override_fitments WHERE product_id=$1", [productId])).rows[0].n;

/**
 * Adds engine types the product fits: every row of the product lists them in the store (vehicle filter, search, make
 * page, product page), with or without enrichment. A type the automatic sources link already may be added too: the
 * decision keeps it if the source drops it. The whole batch is refused when one type is unknown, added already or
 * removed by an admin (that one is shown again with "Yeniden göster").
 */
export async function addProductFitments(database: Pick<Pool, "connect">, productId: string, typeIds: number[], adminId: string) {
  const ids = [...new Set(typeIds)];
  return change(database, productId, async client => {
    // One client runs one query at a time: awaited in turn, not in parallel.
    const known = (await client.query<{ id: number }>("SELECT id FROM vehicle_types WHERE id=ANY($1::int[])", [ids])).rows;
    if (known.length !== ids.length) return { ok: false, reason: "unknown-vehicle" };
    const existing = (await client.query<{ vehicle_type_id: number; mode: string }>(
      "SELECT vehicle_type_id,mode FROM product_override_fitments WHERE product_id=$1 AND vehicle_type_id=ANY($2::int[])", [productId, ids])).rows;
    if (existing.some(row => row.mode === "remove")) return { ok: false, reason: "removed" };
    if (existing.length) return { ok: false, reason: "duplicate" };
    if (await decisionCount(client, productId) + ids.length > productFitmentLimit) return { ok: false, reason: "limit" };
    // One statement gives every row the same now(): a microsecond per position keeps the order the admin chose.
    await client.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode,created_by,created_at)
      SELECT $1,t.id,'add',$3,now()+(t.position*interval '1 microsecond') FROM unnest($2::int[]) WITH ORDINALITY t(id,position)`,
    [productId, ids, adminId]);
    for (const id of ids) await record(client, productId, "fitment_added", null, String(id), adminId);
    return { ok: true };
  });
}

/** Leaves an automatic fitment out of the store for every row of the product (an added type becomes removed). */
export async function removeProductFitment(database: Pick<Pool, "connect">, productId: string, typeId: number, adminId: string) {
  return change(database, productId, async client => {
    if (!(await isAutomatic(client, productId, typeId))) return { ok: false, reason: "not-automatic" };
    const previous = (await client.query<{ mode: string }>(
      "SELECT mode FROM product_override_fitments WHERE product_id=$1 AND vehicle_type_id=$2", [productId, typeId])).rows[0];
    if (previous?.mode === "remove") return { ok: false, reason: "unchanged" };
    if (!previous && await decisionCount(client, productId) >= productFitmentLimit) return { ok: false, reason: "limit" };
    await client.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode,created_by) VALUES($1,$2,'remove',$3)
      ON CONFLICT (product_id,vehicle_type_id) DO UPDATE SET mode='remove',carried_from=NULL,created_by=excluded.created_by,created_at=now()`,
    [productId, typeId, adminId]);
    await record(client, productId, "fitment_removed", previous ? String(typeId) : null, String(typeId), adminId);
    return { ok: true };
  });
}

/**
 * Takes a decision back: an added type leaves the store again (unless an automatic source links it), a removed
 * automatic type returns. "stale" when the row is gone already.
 */
export async function deleteProductFitment(database: Pick<Pool, "connect">, productId: string, rowId: string, adminId: string) {
  return change(database, productId, async client => {
    const removed = (await client.query<{ mode: string; vehicle_type_id: number }>(
      "DELETE FROM product_override_fitments WHERE id=$1 AND product_id=$2 RETURNING mode,vehicle_type_id", [rowId, productId])).rows[0];
    if (!removed) return { ok: false, reason: "stale" };
    await record(client, productId, removed.mode === "add" ? "fitment_unadded" : "fitment_restored", String(removed.vehicle_type_id), null, adminId);
    return { ok: true };
  });
}
