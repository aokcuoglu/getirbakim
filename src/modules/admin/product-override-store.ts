import "server-only";
import type { Pool } from "pg";
import { productCategoriesSql } from "./product-categories-sql";
import { productOverrideFields, type ProductOverrideField, type ProductOverrideValues } from "./product-override-fields";

/** A product's hand-set store card values (db/product-overrides.sql); NULL follows the automatic sources. */
export type ProductOverride = ProductOverrideValues & { updated_at: Date; updated_by: string | null; version: string };
export type ProductOverrideChange = {
  id: string; field: string; old_value: string | null; new_value: string | null; changed_at: Date; changed_by: string | null;
  /** null: an admin's save; carry: copied by a merge; uncarry: taken back when that merge was undone. */
  reason: "carry" | "uncarry" | null;
};
export type ProductOverrideDetails = {
  override: ProductOverride | null;
  /** What the store shows without an edit: the product's name, its listed source's description, enrichment categories. */
  automatic: { name: string | null; description: string; categories: { id: number; name: string }[] };
  changes: ProductOverrideChange[];
};
export type PersistOverrideResult = { ok: false; reason: "not-found" | "merged" | "category" | "stale" } | {
  ok: true; changed: ProductOverrideField[];
  /** The stored edits after the call and their version: the form shows these instead of waiting for the page refresh. */
  values: ProductOverrideValues; version: string;
};
/** Version of a product's edits as the form saw them: the row's updated_at in microseconds, "auto" without a row. */
export const automaticVersion = "auto";
const versionSql = "(extract(epoch FROM updated_at)*1000000)::bigint::text";

const empty: ProductOverrideValues = { name: null, description: null, seo_title: null, seo_description: null, category_id: null, hidden: false };

/** History text of a value: hidden=false is the automatic state (published), so it is recorded as NULL like the rest. */
function historyValue(field: ProductOverrideField, value: ProductOverrideValues[ProductOverrideField]): string | null {
  if (field === "hidden") return value === true ? "true" : null;
  return value === null ? null : String(value);
}

/**
 * Applies `patch` to the product's edits in one transaction: records each changed field, keeps a row only while some
 * field is set, and projects the result onto the product's supplier rows. The action authorizes the administrator.
 * `expectedVersion` (ProductOverride.version or automaticVersion) refuses a save from a form opened before another
 * save of the same product, which would silently overwrite it.
 */
export async function persistProductOverride(database: Pick<Pool, "connect">, productId: string, patch: Partial<ProductOverrideValues>,
  adminId: string, expectedVersion?: string): Promise<PersistOverrideResult> {
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // The admin regrouping lock (product_merge, refresh_product_matches): the projection reads product_sources and
    // writes the rows the matcher's source trigger rewrites, so both queue here instead of deadlocking.
    await client.query("SELECT pg_advisory_xact_lock(20261001,6)");
    const product = (await client.query<{ merged_into: string | null }>("SELECT merged_into FROM products WHERE id=$1 FOR UPDATE", [productId])).rows[0];
    if (!product) { await client.query("ROLLBACK"); return { ok: false, reason: "not-found" }; }
    if (product.merged_into) { await client.query("ROLLBACK"); return { ok: false, reason: "merged" }; }
    if (patch.category_id !== undefined && patch.category_id !== null
      && !(await client.query("SELECT 1 FROM source_categories WHERE source='trodo' AND category_id=$1", [patch.category_id])).rowCount) {
      await client.query("ROLLBACK"); return { ok: false, reason: "category" };
    }
    const row = (await client.query<ProductOverrideValues & { version: string }>(`SELECT name,description,seo_title,seo_description,category_id,hidden,
      ${versionSql} AS version FROM product_overrides WHERE product_id=$1`, [productId])).rows[0];
    if (expectedVersion !== undefined && expectedVersion !== (row?.version ?? automaticVersion)) {
      await client.query("ROLLBACK"); return { ok: false, reason: "stale" };
    }
    const current: ProductOverrideValues = row ? { name: row.name, description: row.description, seo_title: row.seo_title,
      seo_description: row.seo_description, category_id: row.category_id, hidden: row.hidden } : empty;
    const next: ProductOverrideValues = { ...current };
    for (const field of productOverrideFields) if (patch[field] !== undefined) Object.assign(next, { [field]: patch[field] });
    const changed = productOverrideFields.filter(field => historyValue(field, current[field]) !== historyValue(field, next[field]));
    if (!changed.length) { await client.query("ROLLBACK"); return { ok: true, changed, values: current, version: row?.version ?? automaticVersion }; }
    for (const field of changed) await client.query(`INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by)
      VALUES($1,$2,$3,$4,$5)`, [productId, field, historyValue(field, current[field]), historyValue(field, next[field]), adminId]);
    const anySet = productOverrideFields.some(field => historyValue(field, next[field]) !== null);
    if (anySet) await client.query(`INSERT INTO product_overrides(product_id,name,description,seo_title,seo_description,category_id,hidden,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (product_id) DO UPDATE SET name=excluded.name,description=excluded.description,
      seo_title=excluded.seo_title,seo_description=excluded.seo_description,category_id=excluded.category_id,hidden=excluded.hidden,
      updated_by=excluded.updated_by,updated_at=now()`,
    [productId, next.name, next.description, next.seo_title, next.seo_description, next.category_id, next.hidden, adminId]);
    else await client.query("DELETE FROM product_overrides WHERE product_id=$1", [productId]);
    const version = anySet ? (await client.query<{ version: string }>(`SELECT ${versionSql} AS version FROM product_overrides WHERE product_id=$1`, [productId])).rows[0].version
      : automaticVersion;
    // Fields the admin set now are theirs: undoing a merge that carried them must not take them back.
    await client.query("UPDATE product_override_carries SET fields=fields-$2::text[] WHERE target=$1 AND fields ?| $2::text[]", [productId, changed]);
    await client.query("DELETE FROM product_override_carries WHERE target=$1 AND fields='{}'::jsonb", [productId]);
    await client.query("SELECT product_overrides_project(ARRAY[$1::uuid])", [productId]);
    await client.query("COMMIT");
    return { ok: true, changed, values: anySet ? next : empty, version };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

/** The product's edits next to the automatic values they replace, and the latest 50 changes. */
export async function loadProductOverride(database: Pick<Pool, "query">, productId: string): Promise<ProductOverrideDetails> {
  const [override, automatic, categories, changes] = await Promise.all([
    database.query<ProductOverride>(`SELECT o.name,o.description,o.seo_title,o.seo_description,o.category_id,o.hidden,o.updated_at,a.name AS updated_by,
      ${versionSql} AS version
      FROM product_overrides o LEFT JOIN accounts a ON a.id=o.updated_by WHERE o.product_id=$1`, [productId]),
    // The listed source: the product's own row, then Başbuğ, Dinamik, SETA, manual (the storefront's order).
    database.query<{ name: string | null; description: string | null }>(`SELECT p.name,
      (SELECT i.product_data->>'ac2' FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id WHERE s.product_id=p.id
       ORDER BY i.id=p.id DESC, storefront_supplier_rank(i.supplier), i.code LIMIT 1) AS description
      FROM products p WHERE p.id=$1`, [productId]),
    database.query<{ id: number; name: string }>(`SELECT DISTINCT c.category_id AS id, c.name FROM (${productCategoriesSql} AND s.product_id=$1) c
      ORDER BY c.name`, [productId]),
    database.query<ProductOverrideChange>(`SELECT c.id::text,c.field,c.old_value,c.new_value,c.changed_at,a.name AS changed_by,c.reason
      FROM product_override_changes c LEFT JOIN accounts a ON a.id=c.changed_by WHERE c.product_id=$1
      ORDER BY c.changed_at DESC,c.id DESC LIMIT 50`, [productId]),
  ]);
  return {
    override: override.rows[0] ?? null,
    automatic: { name: automatic.rows[0]?.name ?? null, description: automatic.rows[0]?.description ?? "", categories: categories.rows },
    changes: changes.rows,
  };
}
