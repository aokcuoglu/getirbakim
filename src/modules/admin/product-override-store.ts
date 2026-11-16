import "server-only";
import type { Pool } from "pg";
import { productCategoriesSql } from "./product-categories-sql";
import { masterBrandJoinSql } from "@/modules/store/display-brand-sql";
import { costWithVat, productOverrideFields, type ProductOverrideField, type ProductOverrideValues } from "./product-override-fields";

/** A product's hand-set store card values (db/product-overrides.sql); NULL follows the automatic sources. */
export type ProductOverride = ProductOverrideValues & { updated_at: Date; updated_by: string | null; version: string };
export type ProductOverrideChange = {
  id: string; field: string; old_value: string | null; new_value: string | null; changed_at: Date; changed_by: string | null;
  /** null: an admin's save; carry: copied by a merge; uncarry: taken back when that merge was undone. */
  reason: "carry" | "uncarry" | null;
};
export type ProductOverrideDetails = {
  override: ProductOverride | null;
  /**
   * What the store shows without an edit: the product's name, its listed source's description, brand and code,
   * enrichment categories.
   */
  automatic: { name: string | null; description: string; brand: string | null; code: string | null; categories: { id: number; name: string }[] };
  changes: ProductOverrideChange[];
};
export type PersistOverrideResult = { ok: false; reason: "not-found" | "merged" | "category" | "brand" | "stale" | "sale-expired" } | {
  ok: true; changed: ProductOverrideField[];
  /** The stored edits after the call and their version: the form shows these instead of waiting for the page refresh. */
  values: ProductOverrideValues; version: string;
};
/** Version of a product's edits as the form saw them: the row's updated_at in microseconds, "auto" without a row. */
export const automaticVersion = "auto";
const versionSql = "(extract(epoch FROM updated_at)*1000000)::bigint::text";
/**
 * The stored columns as ProductOverrideValues. Campaign times are timestamptz read and written as Istanbul wall clock
 * ("YYYY-MM-DDTHH:MM", what a datetime-local input holds), whatever the session time zone; the history stores the same text.
 */
const valuesSql = (alias = "") => `${alias}name,${alias}description,${alias}short_description,${alias}seo_title,${alias}seo_description,${alias}category_id,${alias}hidden,
  ${alias}price_kurus,${alias}sale_price_kurus,to_char(${alias}sale_from AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD"T"HH24:MI') AS sale_from,
  to_char(${alias}sale_until AT TIME ZONE 'Europe/Istanbul','YYYY-MM-DD"T"HH24:MI') AS sale_until,${alias}brand,${alias}part_number,
  ${alias}hide_supplier_oem`;

const empty: ProductOverrideValues = { name: null, description: null, short_description: null, seo_title: null, seo_description: null, category_id: null, hidden: false,
  price_kurus: null, sale_price_kurus: null, sale_from: null, sale_until: null, brand: null, part_number: null,
  hide_supplier_oem: false };

/**
 * History text of a value: hidden=false (published) and hide_supplier_oem=false (shown) are the automatic states, so
 * they are recorded as NULL like the rest.
 */
function historyValue(field: ProductOverrideField, value: ProductOverrideValues[ProductOverrideField]): string | null {
  if (field === "hidden" || field === "hide_supplier_oem") return value === true ? "true" : null;
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
    const row = (await client.query<ProductOverrideValues & { version: string }>(`SELECT ${valuesSql()},
      ${versionSql} AS version FROM product_overrides WHERE product_id=$1`, [productId])).rows[0];
    if (expectedVersion !== undefined && expectedVersion !== (row?.version ?? automaticVersion)) {
      await client.query("ROLLBACK"); return { ok: false, reason: "stale" };
    }
    const current: ProductOverrideValues = row ? Object.fromEntries(productOverrideFields.map(field => [field, row[field]])) as ProductOverrideValues : empty;
    // A new store brand must be a master brand's name, as picked from the list. No FK: a brand merge deletes the merged
    // brand and the saved edit keeps its text, so an unchanged brand is not checked again (the other fields still save).
    if (patch.brand !== undefined && patch.brand !== null && patch.brand !== current.brand
      && !(await client.query("SELECT 1 FROM brands WHERE name=$1", [patch.brand])).rowCount) {
      await client.query("ROLLBACK"); return { ok: false, reason: "brand" };
    }
    // A new end in the past would never sell; refused instead of stored silently. An ended campaign left as it is does
    // not block other changes (it no longer applies).
    if (patch.sale_until && patch.sale_until !== current.sale_until && (await client.query<{ ended: boolean }>(
      "SELECT $1::timestamp AT TIME ZONE 'Europe/Istanbul'<=now() AS ended", [patch.sale_until])).rows[0].ended) {
      await client.query("ROLLBACK"); return { ok: false, reason: "sale-expired" };
    }
    const next: ProductOverrideValues = { ...current };
    for (const field of productOverrideFields) if (patch[field] !== undefined) Object.assign(next, { [field]: patch[field] });
    const changed = productOverrideFields.filter(field => historyValue(field, current[field]) !== historyValue(field, next[field]));
    if (!changed.length) { await client.query("ROLLBACK"); return { ok: true, changed, values: current, version: row?.version ?? automaticVersion }; }
    for (const field of changed) await client.query(`INSERT INTO product_override_changes(product_id,field,old_value,new_value,changed_by)
      VALUES($1,$2,$3,$4,$5)`, [productId, field, historyValue(field, current[field]), historyValue(field, next[field]), adminId]);
    const anySet = productOverrideFields.some(field => historyValue(field, next[field]) !== null);
    if (anySet) await client.query(`INSERT INTO product_overrides(product_id,name,description,seo_title,seo_description,category_id,hidden,
      price_kurus,sale_price_kurus,sale_from,sale_until,brand,part_number,hide_supplier_oem,short_description,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$9,$10,$11::timestamp AT TIME ZONE 'Europe/Istanbul',$12::timestamp AT TIME ZONE 'Europe/Istanbul',$13,$14,$15,$16,$8)
      ON CONFLICT (product_id) DO UPDATE SET name=excluded.name,description=excluded.description,short_description=excluded.short_description,
      seo_title=excluded.seo_title,seo_description=excluded.seo_description,category_id=excluded.category_id,hidden=excluded.hidden,
      price_kurus=excluded.price_kurus,sale_price_kurus=excluded.sale_price_kurus,sale_from=excluded.sale_from,sale_until=excluded.sale_until,
      brand=excluded.brand,part_number=excluded.part_number,hide_supplier_oem=excluded.hide_supplier_oem,
      updated_by=excluded.updated_by,updated_at=now()`,
    [productId, next.name, next.description, next.seo_title, next.seo_description, next.category_id, next.hidden, adminId,
      next.price_kurus, next.sale_price_kurus, next.sale_from, next.sale_until, next.brand, next.part_number, next.hide_supplier_oem,
      next.short_description]);
    else await client.query("DELETE FROM product_overrides WHERE product_id=$1", [productId]);
    const version = anySet ? (await client.query<{ version: string }>(`SELECT ${versionSql} AS version FROM product_overrides WHERE product_id=$1`, [productId])).rows[0].version
      : automaticVersion;
    // Fields the admin set now are theirs: undoing a merge that carried them must not take them back. The campaign is
    // one unit (price and window): touching any part of a carried campaign makes all of it the admin's.
    const campaign = ["sale_price_kurus", "sale_from", "sale_until"];
    const owned = changed.some(field => campaign.includes(field)) ? [...new Set([...changed, ...campaign])] : changed;
    await client.query("UPDATE product_override_carries SET fields=fields-$2::text[] WHERE target=$1 AND fields ?| $2::text[]", [productId, owned]);
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
    database.query<ProductOverride>(`SELECT ${valuesSql("o.")},o.updated_at,a.name AS updated_by,
      ${versionSql} AS version
      FROM product_overrides o LEFT JOIN accounts a ON a.id=o.updated_by WHERE o.product_id=$1`, [productId]),
    // The listed source: the product's own row, then Başbuğ, Dinamik, SETA, manual (the storefront's order). Its brand
    // and code are what the store shows without an edit (commerce_catalog_entries' supplier branch): the brand is the
    // label's master brand name (#811).
    database.query<{ name: string | null; description: string | null; brand: string | null; code: string | null }>(`SELECT p.name,
      l.description,l.brand,l.code
      FROM products p LEFT JOIN LATERAL (SELECT i.product_data->>'ac2' AS description,
        COALESCE(mb.name,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş') AS brand,i.code
       FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id ${masterBrandJoinSql("i")} WHERE s.product_id=p.id
       ORDER BY i.id=p.id DESC, storefront_supplier_rank(i.supplier), i.code LIMIT 1) l ON true
      WHERE p.id=$1`, [productId]),
    database.query<{ id: number; name: string }>(`SELECT DISTINCT c.category_id AS id, c.name FROM (${productCategoriesSql} AND s.product_id=$1) c
      ORDER BY c.name`, [productId]),
    database.query<ProductOverrideChange>(`SELECT c.id::text,c.field,c.old_value,c.new_value,c.changed_at,a.name AS changed_by,c.reason
      FROM product_override_changes c LEFT JOIN accounts a ON a.id=c.changed_by WHERE c.product_id=$1
      ORDER BY c.changed_at DESC,c.id DESC LIMIT 50`, [productId]),
  ]);
  return {
    override: override.rows[0] ?? null,
    automatic: {
      name: automatic.rows[0]?.name ?? null, description: automatic.rows[0]?.description ?? "",
      brand: automatic.rows[0]?.brand ?? null, code: automatic.rows[0]?.code ?? null, categories: categories.rows,
    },
    changes: changes.rows,
  };
}

/** The master brands an admin can pick as a product's store brand (#602), by name. */
export async function loadBrandOptions(database: Pick<Pool, "query">): Promise<string[]> {
  return (await database.query<{ name: string }>("SELECT name FROM brands ORDER BY name")).rows.map(row => row.name);
}

/** A saleable source of the product whose price is below its VAT-included cost right now (commerce_catalog). */
export type BelowCostSource = { supplier: string; code: string; price_kurus: number; cost_with_vat_kurus: number };

/**
 * The product's sources priced below cost now: only a warning (#580), the price stands. The ids are resolved first so
 * the catalog view is priced for these rows only.
 */
export async function belowCostSources(database: Pick<Pool, "query">, productId: string): Promise<BelowCostSource[]> {
  const { rows } = await database.query<{ supplier: string; code: string; price_kurus: number; cost_kurus: string | number | null; vat_percent: string | number | null }>(
    `SELECT c.supplier,c.code,c.price_kurus,c.pricing_snapshot->>'cost_kurus' AS cost_kurus,c.pricing_snapshot->>'vat_percent' AS vat_percent
    FROM commerce_catalog c WHERE c.id=ANY(ARRAY(SELECT s.supplier_item_id FROM product_sources s WHERE s.product_id=$1)) AND c.price_kurus IS NOT NULL
    ORDER BY c.supplier,c.code`, [productId]);
  return rows.flatMap(row => {
    const cost = costWithVat(row.cost_kurus === null ? null : Number(row.cost_kurus), row.vat_percent === null ? null : Number(row.vat_percent));
    return cost !== null && row.price_kurus < cost ? [{ supplier: row.supplier, code: row.code, price_kurus: row.price_kurus, cost_with_vat_kurus: cost }] : [];
  });
}
