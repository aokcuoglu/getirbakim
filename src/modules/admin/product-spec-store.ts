import "server-only";
import type { Pool, PoolClient } from "pg";
import { reservedSpecificationKeys, sameSpecificationText, specificationKey, specificationRawValue } from "@/modules/store/catalog-filters";
import { productSpecLimit } from "./product-spec-fields";

type SpecRow = { id: string; action: "set" | "hide"; key: string; value: string | null; carried: boolean };
/** A product's technical specifications as the admin manages them (db/product-override-specs.sql, #603). */
export type ProductSpecs = {
  /** The admin's set and hidden keys (or a merge's), oldest first. */
  rows: SpecRow[];
  /** The key/value pairs the automatic sources (enrichment) give, in the payload's order. */
  automatic: { key: string; value: string }[];
};
export type ProductSpecInput = { key: string; value: string };
export type ProductSpecResult = { ok: true } | { ok: false; reason: "not-found" | "merged" | "limit" | "reserved" | "not-automatic" | "unchanged" | "stale" };

type Queryable = Pick<Pool, "query"> | PoolClient;

// The specifications the store page shows from enrichment: only payloads that still describe the row (the
// storefront's guard, src/modules/store/catalog.ts), as [key, value] string pairs.
const automaticSql = `SELECT x.key,x.value FROM (
  SELECT spec->>0 AS key,spec->>1 AS value,min(spec_index) AS position
  FROM product_sources s JOIN storefront_enrichments e ON e.supplier_item_id=s.supplier_item_id
  JOIN supplier_items i ON i.id=e.supplier_item_id AND i.code=e.supplier_code AND i.product_data->>'uk'=e.supplier_brand
   AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
  CROSS JOIN LATERAL jsonb_array_elements(CASE jsonb_typeof(e.payload->'specifications') WHEN 'array' THEN e.payload->'specifications' ELSE '[]' END)
   WITH ORDINALITY spec_rows(spec,spec_index)
  WHERE s.product_id=$1 AND jsonb_typeof(spec)='array' AND jsonb_typeof(spec->0)='string' AND jsonb_typeof(spec->1)='string' AND btrim(spec->>0)<>''
  GROUP BY spec->>0,spec->>1) x ORDER BY x.position,x.key,x.value`;

const loadAutomatic = async (database: Queryable, productId: string) =>
  (await database.query<{ key: string; value: string }>(automaticSql, [productId])).rows;

export async function loadProductSpecs(database: Pick<Pool, "query">, productId: string): Promise<ProductSpecs> {
  const [rows, automatic] = await Promise.all([
    database.query<SpecRow>(`SELECT id::text,action,key,value,carried_from IS NOT NULL AS carried
      FROM product_override_specs WHERE product_id=$1 ORDER BY created_at,id`, [productId]),
    loadAutomatic(database, productId),
  ]);
  return { rows: rows.rows, automatic };
}

/** Runs a change in one transaction on the locked product (a merge carrying specifications locks the same row). */
async function change(database: Pick<Pool, "connect">, productId: string,
  run: (client: PoolClient) => Promise<ProductSpecResult>): Promise<ProductSpecResult> {
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
/** History text: "key|value", or the key alone for a hidden key (specHistoryValue reads it back). */
const historyText = (key: string, value: string | null) => value === null ? key : `${key}|${value}`;

const isReserved = (key: string) => reservedSpecificationKeys.some(name => sameSpecificationText(name, key));

/**
 * Sets the value the store shows for a key: an automatic key's value is replaced, a new key is added. The key is
 * stored as the enrichment spells it (a Turkish label or another casing of a known or existing key becomes the raw
 * key), so the catalog filters see one key; a known key's Turkish value becomes the raw value ("Ön aks" → "Front Axle").
 * Identity keys (manufacturer, part number, OEM, barcode) have their own fields and are refused.
 */
export async function setProductSpec(database: Pick<Pool, "connect">, productId: string, input: ProductSpecInput, adminId: string) {
  return change(database, productId, async client => {
    // One client runs one query at a time: awaited in turn, not in parallel.
    const automatic = await loadAutomatic(client, productId);
    const existing = await client.query<{ key: string; action: string; value: string | null }>("SELECT key,action,value FROM product_override_specs WHERE product_id=$1", [productId]);
    const typed = specificationKey(input.key);
    if (isReserved(input.key) || isReserved(typed)) return { ok: false, reason: "reserved" };
    const key = [...existing.rows.map(row => row.key), ...automatic.map(row => row.key)].find(known => sameSpecificationText(known, typed)) ?? typed;
    if (isReserved(key)) return { ok: false, reason: "reserved" };
    const value = specificationRawValue(key, input.value);
    const previous = existing.rows.find(row => row.key === key);
    if (previous?.action === "set" && previous.value === value) return { ok: false, reason: "unchanged" };
    if (!previous && existing.rows.length >= productSpecLimit) return { ok: false, reason: "limit" };
    await client.query(`INSERT INTO product_override_specs(product_id,action,key,value,created_by) VALUES($1,'set',$2,$3,$4)
      ON CONFLICT (product_id,key) DO UPDATE SET action='set',value=excluded.value,carried_from=NULL,created_by=excluded.created_by,updated_at=now()`,
    [productId, key, value, adminId]);
    await record(client, productId, "spec_set", previous?.action === "set" ? historyText(key, previous.value) : null, historyText(key, value), adminId);
    return { ok: true };
  });
}

/** Leaves an automatic key (all its values) out of the store, its cards and its filters. */
export async function hideProductSpec(database: Pick<Pool, "connect">, productId: string, key: string, adminId: string) {
  return change(database, productId, async client => {
    if (!(await loadAutomatic(client, productId)).some(row => row.key === key)) return { ok: false, reason: "not-automatic" };
    const previous = (await client.query<{ action: string; value: string | null }>(
      "SELECT action,value FROM product_override_specs WHERE product_id=$1 AND key=$2", [productId, key])).rows[0];
    if (previous?.action === "hide") return { ok: false, reason: "unchanged" };
    if (!previous && (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM product_override_specs WHERE product_id=$1",
      [productId])).rows[0].n >= productSpecLimit) return { ok: false, reason: "limit" };
    await client.query(`INSERT INTO product_override_specs(product_id,action,key,value,created_by) VALUES($1,'hide',$2,NULL,$3)
      ON CONFLICT (product_id,key) DO UPDATE SET action='hide',value=NULL,carried_from=NULL,created_by=excluded.created_by,updated_at=now()`,
    [productId, key, adminId]);
    await record(client, productId, "spec_hidden", previous ? historyText(key, previous.value) : null, historyText(key, null), adminId);
    return { ok: true };
  });
}

/** Removes a set value or shows a hidden key again: the automatic value returns. "stale" when the row is gone already. */
export async function removeProductSpec(database: Pick<Pool, "connect">, productId: string, specId: string, adminId: string) {
  return change(database, productId, async client => {
    const removed = (await client.query<{ action: string; key: string; value: string | null }>(
      "DELETE FROM product_override_specs WHERE id=$1 AND product_id=$2 RETURNING action,key,value", [specId, productId])).rows[0];
    if (!removed) return { ok: false, reason: "stale" };
    await record(client, productId, removed.action === "set" ? "spec_removed" : "spec_shown", historyText(removed.key, removed.value), null, adminId);
    return { ok: true };
  });
}
