import "server-only";
import type { Pool, PoolClient } from "pg";
import { productReferenceLimit, type ReferenceKind } from "./product-reference-fields";

type Reference = { id: string; kind: ReferenceKind; brand: string; number: string; carried: boolean };
/** A product's reference numbers as the admin manages them (db/product-override-references.sql, #582). */
export type ProductReferences = {
  /** Numbers the admin added (or a merge carried here), oldest first. */
  added: Reference[];
  /** Automatic OEM / cross-reference numbers left out of the store. */
  hidden: (Omit<Reference, "kind"> & { kind: "oem" | "cross" })[];
  /**
   * Numbers the automatic sources give: the enrichment's OEM and cross-reference lists (hideable, `hiddenId` set
   * while hidden) and the supplier rows' own OEM field (`supplierOem`, read-only in this slice).
   */
  automatic: { kind: "oem" | "cross"; brand: string; number: string; hiddenId: string | null; supplierOem: boolean }[];
};
export type ProductReferenceInput = { kind: ReferenceKind; brand: string; number: string };
export type ProductReferenceResult = { ok: true } | { ok: false; reason: "not-found" | "merged" | "limit" | "duplicate" | "hidden" | "ean" | "stale" };

const key = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function loadProductReferences(database: Pick<Pool, "query">, productId: string): Promise<ProductReferences> {
  const [rows, automatic] = await Promise.all([
    database.query<Reference & { action: "add" | "hide"; brand_key: string; number_key: string }>(
      `SELECT id::text,kind,action,brand,number,brand_key,number_key,carried_from IS NOT NULL AS carried
       FROM product_override_references WHERE product_id=$1 ORDER BY created_at,id`, [productId]),
    // The numbers the store page shows from enrichment: only payloads that still describe the row (the storefront's
    // guard, src/modules/store/catalog.ts), then the supplier rows' own OEM field.
    database.query<{ kind: "oem" | "cross"; brand: string; number: string; supplier_oem: boolean }>(
      `SELECT x.kind,x.brand,x.number,x.supplier_oem FROM (
        SELECT l.kind,refs.key AS brand,reference.number,false AS supplier_oem
        FROM product_sources s JOIN storefront_enrichments e ON e.supplier_item_id=s.supplier_item_id
        JOIN supplier_items i ON i.id=e.supplier_item_id AND i.code=e.supplier_code AND i.product_data->>'uk'=e.supplier_brand
         AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
        CROSS JOIN LATERAL (VALUES ('oem',e.payload->'oemNumbers'),('cross',e.payload->'crossReferences')) l(kind,refs)
        CROSS JOIN LATERAL jsonb_each(CASE jsonb_typeof(l.refs) WHEN 'object' THEN l.refs ELSE '{}' END) refs
        CROSS JOIN LATERAL jsonb_array_elements_text(CASE jsonb_typeof(refs.value) WHEN 'array' THEN refs.value ELSE '[]' END) reference(number)
        WHERE s.product_id=$1
        UNION ALL
        SELECT 'oem','',i.product_data->>'oe',true FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id
        WHERE s.product_id=$1 AND i.product_data->>'oe'<>''
       ) x ORDER BY x.supplier_oem,x.kind DESC,x.brand,x.number`, [productId]),
  ]);
  const hidden = new Map(rows.rows.filter(row => row.action === "hide").map(row => [`${row.kind}|${row.brand_key}|${row.number_key}`, row.id]));
  const seen = new Set<string>();
  const listed: ProductReferences["automatic"] = [];
  for (const row of automatic.rows) {
    const id = `${row.kind}|${key(row.brand)}|${key(row.number)}`;
    if (key(row.number).length < 1 || seen.has(id)) continue;
    seen.add(id);
    listed.push({ kind: row.kind, brand: row.brand, number: row.number, hiddenId: row.supplier_oem ? null : hidden.get(id) ?? null, supplierOem: row.supplier_oem });
  }
  const plain = ({ id, kind, brand, number, carried }: Reference) => ({ id, kind, brand, number, carried });
  return {
    added: rows.rows.filter(row => row.action === "add").map(plain),
    hidden: rows.rows.filter(row => row.action === "hide").map(row => ({ ...plain(row), kind: row.kind === "cross" ? "cross" as const : "oem" as const })),
    automatic: listed,
  };
}

/** Runs a change in one transaction on the locked product (a merge carrying numbers locks the same row). */
async function change(database: Pick<Pool, "connect">, productId: string,
  run: (client: PoolClient) => Promise<ProductReferenceResult>): Promise<ProductReferenceResult> {
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
/** History text: "kind|brand|number" (referenceHistoryValue reads it back). */
const historyText = (kind: string, brand: string, number: string) => `${kind}|${brand}|${number}`;

async function insert(client: PoolClient, productId: string, action: "add" | "hide", input: ProductReferenceInput, adminId: string): Promise<ProductReferenceResult> {
  const brand = input.kind === "ean" ? "" : input.brand.trim(), number = input.number.trim();
  const count = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM product_override_references WHERE product_id=$1", [productId])).rows[0].n;
  if (count >= productReferenceLimit) return { ok: false, reason: "limit" };
  const inserted = await client.query(`INSERT INTO product_override_references(product_id,kind,action,brand,number,created_by) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT (product_id,kind,brand_key,number_key) DO NOTHING RETURNING id`, [productId, input.kind, action, brand, number, adminId]);
  if (!inserted.rowCount) {
    const existing = (await client.query<{ action: string }>(`SELECT action FROM product_override_references
      WHERE product_id=$1 AND kind=$2 AND brand_key=part_number_key($3) AND number_key=part_number_key($4)`, [productId, input.kind, brand, number])).rows[0];
    return { ok: false, reason: existing?.action === "hide" && action === "add" ? "hidden" : "duplicate" };
  }
  await record(client, productId, action === "add" ? "reference_added" : "reference_hidden", null, historyText(input.kind, brand, number), adminId);
  return { ok: true };
}

/** Adds an OEM number, cross-reference code or barcode the store shows and search finds; a barcode must be a valid GTIN. */
export async function addProductReference(database: Pick<Pool, "connect">, productId: string, input: ProductReferenceInput, adminId: string) {
  return change(database, productId, async client => {
    if (input.kind === "ean" && !(await client.query<{ valid: boolean }>("SELECT COALESCE(gtin_valid(part_number_key($1)),false) AS valid",
      [input.number])).rows[0].valid) return { ok: false, reason: "ean" };
    return insert(client, productId, "add", input, adminId);
  });
}

/** Leaves an automatic (enrichment) OEM / cross-reference number out of the store and its search. */
export async function hideProductReference(database: Pick<Pool, "connect">, productId: string, input: ProductReferenceInput & { kind: "oem" | "cross" }, adminId: string) {
  return change(database, productId, client => insert(client, productId, "hide", input, adminId));
}

/** Removes an added number, or shows a hidden automatic number again; "stale" when the row is gone already. */
export async function removeProductReference(database: Pick<Pool, "connect">, productId: string, referenceId: string, adminId: string) {
  return change(database, productId, async client => {
    const removed = (await client.query<{ kind: string; action: string; brand: string; number: string }>(
      "DELETE FROM product_override_references WHERE id=$1 AND product_id=$2 RETURNING kind,action,brand,number", [referenceId, productId])).rows[0];
    if (!removed) return { ok: false, reason: "stale" };
    await record(client, productId, removed.action === "add" ? "reference_removed" : "reference_shown", historyText(removed.kind, removed.brand, removed.number), null, adminId);
    return { ok: true };
  });
}
