import "server-only";
import { boundedQuery } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { legacyCategoryIds } from "@/modules/store/category-tree";
import { vehicleBrandSlug } from "@/modules/store/vehicle-catalog";
import { minimumContentSql, productIndexPolicy } from "./indexing";
import { productPath, type ProductAddress } from "./product-path";
import { productChunkRange, sitemapUrlLimit, withAncestors } from "./sitemap";

const isoUtc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

// The supplier branch selects what productIndexable (./indexing) accepts: the rows the store lists (commerce_supplier_items
// as in commerce_catalog, without secondary offers like `listedOnly` in src/modules/store/catalog.ts), not hidden by an
// admin, with minimum content (#641). Unavailable cards (commerce_unavailable_items) and demo rows stay out. Plan: a
// bitmap scan of supplier_items_saleable_order_v3_idx per file; the content signals are index probes per row
// (product_model_fitments_pkey, product_offers_primary_idx), no sequential scan of supplier_items.
const supplierRows = `FROM commerce_supplier_items i
 LEFT JOIN product_enrichment_shared_links l ON l.supplier_item_id=i.id
 LEFT JOIN commerce_item_overrides h ON h.supplier_item_id=i.id
 WHERE i.company=ANY($1::text[]) AND i.id BETWEEN $2::uuid AND $3::uuid
  AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=i.id AND o.primary_id<>o.item_id)
  AND h.hidden IS NOT TRUE
  AND ${minimumContentSql()}`;
const storeRows = `FROM store_products p
 WHERE p.supplier<>'demo' AND p.id BETWEEN $2::uuid AND $3::uuid`;

/**
 * The indexable product pages of one id range: `columns.supplier` over the supplier row `i`, its enrichment link `l`
 * and override `h`; `columns.store` over the store row `p`, in the same order and names. Parameters: $1 the storefront
 * companies, $2/$3 the uuid range. The sitemap (loadProductChunk) and IndexNow (indexnow.server.ts) share it.
 */
export function indexableProductsSql(columns: { supplier: string; store: string }): string {
  const store = `SELECT ${columns.store} ${storeRows}`;
  return productIndexPolicy.supplierCatalog ? `SELECT ${columns.supplier} ${supplierRows}\n UNION ALL\n ${store}` : store;
}

/**
 * The columns a product address is built from (productPath): the shown name, brand and part number. The expressions are
 * those of commerce_catalog_entries (db/commerce.sql), so a page's canonical address and the one listed here are the same.
 */
export const productAddressColumns = {
  supplier: `i.id::text AS id,COALESCE(h.name,NULLIF(i.product_data->>'ac',''),i.code) AS name,
   COALESCE(h.brand,NULLIF(i.product_data->>'uk',''),'Belirtilmemiş') AS display_brand,COALESCE(h.part_number,i.code) AS display_code`,
  store: "p.id::text AS id,p.name AS name,p.brand AS display_brand,p.code AS display_code",
};

export type ProductSitemapRow = { id: string; path: string; lastmod: string };

// A secondary offer is left out even when its primary is hidden or not saleable (its page then shows itself): deliberate.
/** Product addresses of sitemap file `index` with their last change (ISO, UTC); one row past the limit shows an overflow. */
export async function loadProductChunk(index: number): Promise<ProductSitemapRow[]> {
  const { from, to } = productChunkRange(index);
  const branches = indexableProductsSql({
    supplier: `${productAddressColumns.supplier},${isoUtc("GREATEST(i.changed_at,l.imported_at)")} AS lastmod`,
    store: `${productAddressColumns.store},${isoUtc("p.updated_at")} AS lastmod`,
  });
  const { rows } = await boundedQuery<ProductAddress & { lastmod: string }>(`SELECT id,name,display_brand,display_code,lastmod FROM (${branches}) u ORDER BY id LIMIT ${sitemapUrlLimit + 1}`,
    [storefrontCompanies(), from, to]);
  return rows.map(row => ({ id: row.id, path: productPath(row), lastmod: row.lastmod }));
}

// Categories with a product of their own, as the catalog filter finds them (categoryProductIds in catalog.ts): Trodo
// categories of enriched supplier items and an admin's category (#575). One hashed pass over the enrichments for the
// whole tree (~0.2-0.5 s locally).
const categorySql = `SELECT c.category_id AS id,c.path_ids AS path,l.slug,
 (EXISTS (SELECT 1 FROM product_source_categories pc
   JOIN storefront_enrichments e ON e.donor_item_id=pc.supplier_item_id
   JOIN commerce_supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
    AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
   WHERE pc.source='trodo' AND pc.category_id=c.category_id)
  OR EXISTS (SELECT 1 FROM product_overrides o WHERE o.category_id=c.category_id AND NOT o.hidden)) AS direct
FROM source_categories c
JOIN source_category_labels l ON l.source=c.source AND l.category_id=c.category_id AND l.locale='tr'
WHERE c.source='trodo'
ORDER BY COALESCE((c.raw->>'l')::int,0),c.category_id`;
// Old storefront categories (supplier_items_legacy_category_idx) that still hold a product the store lists.
const legacySql = `SELECT slug FROM unnest($1::text[]) slug
WHERE EXISTS (SELECT 1 FROM commerce_supplier_items s WHERE s.company=ANY($2::text[])
 AND s.product_data->>'category'<>'' AND s.product_data->>'category'=slug)`;

/** Slugs of the categories holding products and of their ancestors. */
export async function loadCategorySlugs(): Promise<string[]> {
  const [nodes, legacy] = await Promise.all([
    boundedQuery<{ id: number; path: number[]; slug: string; direct: boolean }>(categorySql, []),
    boundedQuery<{ slug: string }>(legacySql, [Object.keys(legacyCategoryIds), storefrontCompanies()]),
  ]);
  const direct = [...nodes.rows.filter(node => node.direct).map(node => node.id), ...legacy.rows.map(row => legacyCategoryIds[row.slug])];
  return withAncestors(nodes.rows, direct).map(node => node.slug);
}

/** Slugs of the vehicle makes with a fitted product (/yedek-parca/<slug>). */
export async function loadMakeSlugs(): Promise<string[]> {
  const { rows } = await boundedQuery<{ name: string }>(`SELECT b.display_name AS name FROM vehicle_brands b
   WHERE EXISTS (SELECT 1 FROM storefront_make_fits f WHERE f.brand_id=b.id) ORDER BY b.id`, []);
  return [...new Set(rows.map(row => vehicleBrandSlug(row.name)))];
}
