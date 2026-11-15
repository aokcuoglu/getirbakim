import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { pickKey, sortOrder } from "@/lib/table-sort";
import { productCategoriesSql } from "./product-categories-sql";
import { loadProductOverride } from "./product-override-store";
import { loadProductPricing } from "./product-pricing-store";
import type { ProductPricing } from "./product-pricing-schema";
import { compareOffers } from "@/modules/store/best-offer";
import { belowCost } from "./product-override-fields";

/** Master catalog (db/product-matching.sql): one product, the supplier rows it is sold from, and its equivalents. */
export const productFilters = {
  all: { label: "Tümü", where: "true" },
  multi: { label: "Birden çok tedarikçi", where: "cardinality(p.suppliers)>1" },
  basbug: { label: "Yalnız Başbuğ", where: "p.suppliers='{basbug}'" },
  dinamik: { label: "Yalnız Dinamik", where: "p.suppliers='{dinamik}'" },
  seta: { label: "SETA", where: "p.suppliers @> '{seta}'" },
  upload: { label: "Manuel liste", where: "p.suppliers @> '{manual}'" },
  manual: { label: "Elle karar verilen", where: "EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id=p.id AND s.method='manual')" },
  inactive: { label: "Satışta değil", where: "p.suppliers='{}'" },
  edited: { label: "Elle düzenlenen", where: "EXISTS (SELECT 1 FROM product_overrides o WHERE o.product_id=p.id)" },
  hidden: { label: "Mağazada gizli", where: "EXISTS (SELECT 1 FROM product_overrides o WHERE o.product_id=p.id AND o.hidden)" },
} as const;
export type ProductFilter = keyof typeof productFilters;
export const supplierNames: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA", manual: "Manuel liste" };
const pageSize = 50;
// Header sorting on the products list (TableHead sortKey → column).
const productSorts = { brand: "p.brand_label", code: "p.part_number", name: "p.name" };

type ProductRow = {
  id: string; brand: string; brand_label: string; part_number: string; variant: number; code: string; name: string | null;
  suppliers: string[]; merged_into: string | null; sources: number; best_price: number | null; best_supplier: string | null; available: boolean;
  categories: string[];
};
type ProductSource = {
  id: string; supplier: string; code: string; name: string | null; brand_label: string | null; method: "auto" | "manual"; linked_at: Date;
  saleable: boolean; price_kurus: number | null; available: boolean; stock_label: string | null; best: boolean;
  /** commerce_catalog's pricing inputs (cost_kurus, vat_percent, price_kind…); null when the row is not saleable. */
  pricing_snapshot: Record<string, unknown> | null;
  /** The row's rates and supplier cost (nf) for the "Kâr ve KDV oranları" dialog; saleable rows only. */
  pricing: ProductPricing | null; cost: number | null;
  /** Read from pricing_snapshot (#580): the formula's price, the VAT-excluded cost in kuruş, the VAT rate, an admin price. */
  auto_price: number | null; cost_kurus: number | null; vat_percent: number | null; price_kind: "fixed" | "sale" | null; below_cost: boolean;
};
type SourceRow = Omit<ProductSource, "pricing" | "auto_price" | "cost_kurus" | "vat_percent" | "price_kind" | "below_cost">;
type ProductEquivalent = {
  id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; kind: "oem" | "cross" | "brand" | "manual";
  via_brand: string; via_part: string;
};

const compact = (value: string | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);

/**
 * Best offer per product: the cheapest available saleable source, the lower cost and then the product's own row winning
 * ties (the storefront rule, compareOffers). Priced through commerce_catalog only for the ids asked for.
 */
const offersSql = `WITH sources AS (
   SELECT s.product_id, s.supplier_item_id FROM product_sources s WHERE s.product_id=ANY($1::uuid[])
 ), priced AS (
   SELECT s.product_id, c.id, c.supplier, c.price_kurus, c.available, c.stock_label, c.pricing_snapshot FROM sources s
   JOIN commerce_catalog c ON c.id=s.supplier_item_id AND c.id=ANY(ARRAY(SELECT supplier_item_id FROM sources))
 )`;

type ListedProduct = Omit<ProductRow, "best_price" | "best_supplier" | "available" | "sources" | "categories">;

/**
 * Whether product `p` has a supplier row whose code contains the compact query `n` (punctuation ignored). From three
 * characters on, the trigram index on supplier_item_search_codes (db/search.sql: the same compact code, lowercased, plus
 * the OEM number) narrows supplier_items first and the original condition still decides; scanning every supplier row
 * took ~1 s per query. The index folds Turkish letters (Ç → c) where this condition drops them, so only a query running
 * across such a letter could differ. Shorter queries have no trigram to look up and keep the plain scan.
 */
const codeMatch = (q: string, n: string) => q.length >= 3
  ? `p.id IN (SELECT s.product_id FROM supplier_items i JOIN product_sources s ON s.supplier_item_id=i.id
      WHERE supplier_item_search_codes(i.code,i.product_data) LIKE '%'||lower(${n})||'%' AND regexp_replace(upper(i.code),'[^A-Z0-9]','','g') LIKE '%'||${n}||'%')`
  : `EXISTS (SELECT 1 FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id
      WHERE s.product_id=p.id AND regexp_replace(upper(i.code),'[^A-Z0-9]','','g') LIKE '%'||${n}||'%')`;

export async function listProducts(params: { q?: string; filter?: string; brands?: string[]; categories?: string[]; page?: string; sort?: string; dir?: string }) {
  await requireAdmin();
  const filter: ProductFilter = pickKey(productFilters, params.filter, "all");
  const q = compact(params.q);
  const brands = [...new Set((params.brands ?? []).map(brand => brand.trim().slice(0, 80)).filter(Boolean))].slice(0, 100);
  const categories = [...new Set((params.categories ?? []).filter(id => /^\d{1,9}$/.test(id)))].slice(0, 100);
  // Each condition appends its value to the query's list and returns the SQL that reads it.
  const byBrand = (values: unknown[]) => (values.push(brands), `p.brand_label=ANY($${values.length}::text[])`);
  const byCategory = (values: unknown[]) =>
    (values.push(categories), `p.id IN (SELECT c.product_id FROM (${productCategoriesSql}) c WHERE c.category_id=ANY($${values.length}::int[]))`);
  // Merged products have no rows of their own; they only matter as redirects.
  const listed = [productFilters[filter].where, ...filter !== "inactive" ? ["p.merged_into IS NULL"] : []];
  const values: unknown[] = [];
  // The brand and category filters hold across the tabs, so their counts follow them too.
  const scope = [...brands.length ? [byBrand(values)] : [], ...categories.length ? [byCategory(values)] : []];
  const scoped = [...values];
  const where: string[] = [...listed, ...scope];
  if (q) {
    values.push(q);
    const n = `$${values.length}`;
    // Part number or any supplier code of the product, ignoring punctuation and the supplier's brand prefix.
    where.push(`(p.part_number LIKE '%'||${n}||'%' OR p.brand=${n} OR ${codeMatch(q, n)})`);
  }
  const sql = where.join(" AND ");
  const order = sortOrder(params, productSorts, "p.brand_label,p.part_number,p.variant");
  const columns = "p.id,p.brand,p.brand_label,p.part_number,p.variant,p.code,p.name,p.suppliers,p.merged_into";
  // The count and the page run together; only a request past the last page re-reads the clamped one. A search finds
  // its products once and counts and pages them from there.
  const pageAt = async (page: number): Promise<{ total: number; rows: ListedProduct[] }> => {
    const window = `ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    if (q) {
      const found = (await db.query<{ total: number; rows: ListedProduct[] | null }>(`WITH matched AS MATERIALIZED (SELECT ${columns} FROM products p WHERE ${sql})
        SELECT (SELECT count(*)::int FROM matched) AS total,
         (SELECT json_agg(p ORDER BY ${order}) FROM (SELECT * FROM matched p ${window}) p) AS rows`, values)).rows[0];
      return { total: found.total, rows: found.rows ?? [] };
    }
    const [total, rows] = await Promise.all([
      db.query<{ count: number }>(`SELECT count(*)::int FROM products p WHERE ${sql}`, values),
      db.query<ListedProduct>(`SELECT ${columns} FROM products p WHERE ${sql} ${window}`, values),
    ]);
    return { total: total.rows[0].count, rows: rows.rows };
  };
  const requested = Number(params.page), wanted = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  // Each column filter offers the choices left by the tab and the other column filter; selected ones stay listed.
  const brandValues: unknown[] = [brands], categoryValues: unknown[] = [categories];
  const brandWhere = [...listed, ...categories.length ? [byCategory(brandValues)] : []].join(" AND ");
  const categoryWhere = [...listed, ...brands.length ? [byBrand(categoryValues)] : []].join(" AND ");
  // Edited products among the listed ones (merged products only redirect), in the brand/category scope.
  const edited = `product_overrides o JOIN products p ON p.id=o.product_id AND p.merged_into IS NULL${scope.length ? ` AND ${scope.join(" AND ")}` : ""}`;
  const [first, counts, brandOptions, categoryOptions] = await Promise.all([
    pageAt(wanted),
    q ? Promise.resolve(null) : db.query<Record<ProductFilter, number>>(`SELECT count(*) FILTER (WHERE merged_into IS NULL)::int AS all,
      count(*) FILTER (WHERE cardinality(suppliers)>1)::int AS multi, count(*) FILTER (WHERE suppliers='{basbug}')::int AS basbug,
      count(*) FILTER (WHERE suppliers='{dinamik}')::int AS dinamik, count(*) FILTER (WHERE suppliers @> '{seta}')::int AS seta,
      (SELECT count(DISTINCT s.product_id) FROM product_sources s ${scope.length ? `JOIN products p ON p.id=s.product_id AND ${scope.join(" AND ")} ` : ""}WHERE s.method='manual')::int AS manual,
      count(*) FILTER (WHERE suppliers='{}' AND merged_into IS NULL)::int AS inactive,
      (SELECT count(*) FROM ${edited})::int AS edited, (SELECT count(*) FROM ${edited} WHERE o.hidden)::int AS hidden FROM products p${scope.length ? ` WHERE ${scope.join(" AND ")}` : ""}`, scoped),
    db.query<{ label: string; count: number }>(`SELECT p.brand_label AS label, count(*) FILTER (WHERE ${brandWhere})::int AS count FROM products p
      GROUP BY p.brand_label HAVING count(*) FILTER (WHERE ${brandWhere})>0 OR p.brand_label=ANY($1::text[]) ORDER BY p.brand_label`, brandValues),
    db.query<{ id: string; label: string; count: number }>(`SELECT c.category_id::text AS id, c.name AS label,
      count(DISTINCT p.id) FILTER (WHERE ${categoryWhere})::int AS count FROM (${productCategoriesSql}) c JOIN products p ON p.id=c.product_id
      GROUP BY c.category_id, c.name HAVING count(*) FILTER (WHERE ${categoryWhere})>0 OR c.category_id=ANY($1::int[]) ORDER BY c.name`, categoryValues),
  ]);
  const total = first.total, pages = Math.max(1, Math.ceil(total / pageSize)), page = Math.min(wanted, pages);
  const rows = page === wanted ? first.rows : (await pageAt(page)).rows;
  const ids = [rows.map(row => row.id)];
  const [offers, labels] = rows.length ? await Promise.all([
    db.query<{ product_id: string; sources: number; best_price: number | null; best_supplier: string | null; available: boolean }>(
      `${offersSql}, counted AS (SELECT product_id, count(*)::int AS sources FROM sources GROUP BY product_id)
      SELECT c.product_id, c.sources, b.price_kurus AS best_price, b.supplier AS best_supplier, COALESCE(b.available,false) AS available FROM counted c
      LEFT JOIN LATERAL (SELECT * FROM priced x WHERE x.product_id=c.product_id AND x.price_kurus IS NOT NULL
        ORDER BY x.available DESC, x.price_kurus, (x.pricing_snapshot->>'cost_kurus')::numeric NULLS LAST, x.id=c.product_id DESC, x.id
        LIMIT 1) b ON true`, ids).then(result => result.rows),
    db.query<{ product_id: string; categories: string[] }>(
      `SELECT c.product_id, array_agg(DISTINCT c.name ORDER BY c.name) AS categories FROM (${productCategoriesSql} AND s.product_id=ANY($1::uuid[])) c GROUP BY c.product_id`,
      ids).then(result => result.rows),
  ]) : [[], []];
  const byId = new Map(offers.map(offer => [offer.product_id, offer]));
  const categoriesById = new Map(labels.map(row => [row.product_id, row.categories]));
  const products: ProductRow[] = rows.map(row => ({ ...row, sources: 0, best_price: null, best_supplier: null, available: false, ...byId.get(row.id),
    categories: categoriesById.get(row.id) ?? [] }));
  return { products, filter, q, brands, categories, brandOptions: brandOptions.rows, categoryOptions: categoryOptions.rows, total, counts: counts?.rows[0] ?? null, page, pages };
}

export async function getMasterProduct(id: string) {
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const product = (await db.query<Omit<ProductRow, "sources" | "best_price" | "best_supplier" | "available" | "categories"> & { created_at: Date; updated_at: Date }>(
    `SELECT id,brand,brand_label,part_number,variant,code,name,suppliers,merged_into,created_at,updated_at FROM products WHERE id=$1`, [id])).rows[0];
  if (!product) return null;
  const [sources, equivalents] = await Promise.all([
    db.query<SourceRow>(`${offersSql}
      SELECT i.id, i.supplier, i.code, supplier_item_name(i.supplier,i.product_data) AS name, supplier_item_brand(i.supplier,i.product_data) AS brand_label,
       s.method, s.linked_at, p.id IS NOT NULL AS saleable, p.price_kurus, COALESCE(p.available,false) AS available, p.stock_label, false AS best,
       p.pricing_snapshot, (i.price_data->>'nf')::float8 AS cost
      FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id LEFT JOIN priced p ON p.id=s.supplier_item_id
      WHERE s.product_id=($1::uuid[])[1]
      ORDER BY p.id IS NULL, i.id=s.product_id DESC, CASE i.supplier WHEN 'basbug' THEN 0 WHEN 'dinamik' THEN 1 ELSE 2 END, i.code`, [[id]]),
    db.query<ProductEquivalent>(`SELECT p.id, p.brand_label, p.code, p.name, p.suppliers, e.kind, e.brand AS via_brand, e.part_number AS via_part
      FROM product_equivalents e JOIN products p ON p.id=e.equivalent_id WHERE e.product_id=$1
      ORDER BY p.suppliers='{}', e.kind, p.brand_label, p.code LIMIT 100`, [id]),
  ]);
  // The rates dialog of each saleable row (a few rows per product).
  const rows: ProductSource[] = await Promise.all(sources.rows.map(async row => {
    const snapshot = row.pricing_snapshot ?? {}, number = (key: string) => snapshot[key] == null || !Number.isFinite(Number(snapshot[key])) ? null : Number(snapshot[key]);
    const cost_kurus = number("cost_kurus"), vat_percent = number("vat_percent");
    return { ...row, pricing: row.saleable ? await loadProductPricing(db, row.id) : null, cost_kurus, vat_percent,
      price_kind: snapshot.price_kind === "fixed" || snapshot.price_kind === "sale" ? snapshot.price_kind : null,
      // The formula's price: recorded beside an admin price, else the row's price itself.
      auto_price: snapshot.source === "override" ? number("auto_price_kurus") : row.price_kurus,
      below_cost: belowCost(row.price_kurus, cost_kurus, vat_percent) };
  }));
  // The storefront sells the cheapest available row; the lower cost, then the product's own row win ties.
  const best = rows.filter(row => row.available && row.price_kurus !== null).sort(compareOffers(id))[0];
  if (best) best.best = true;
  const merged = product.merged_into ? (await db.query<{ id: string; brand_label: string; code: string }>(
    "SELECT id,brand_label,code FROM products WHERE id=$1", [product.merged_into])).rows[0] ?? null : null;
  // The store still lists supplier rows in this phase: the row it shows for this product.
  const listed = rows.find(row => row.saleable && row.supplier !== "seta" && row.id === id)
    ?? rows.find(row => row.saleable) ?? null;
  const [override, references] = await Promise.all([loadProductOverride(db, id),
    db.query<{ exists: boolean }>("SELECT EXISTS (SELECT 1 FROM product_override_references WHERE product_id=$1) AS exists", [id])]);
  // Hand-entered reference numbers (#582) count as an edit for the "Elle düzenlendi" badge.
  return { product, sources: rows, equivalents: equivalents.rows, merged, storeId: listed?.id ?? null, override, hasReferences: references.rows[0].exists };
}

type MergeTarget = {
  id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; same_brand: boolean; equivalent: boolean;
};

/** Products to merge with (or link as equivalent to) `id`: part number or supplier code match, same brand first. */
export async function findMergeTargets(id: string, query: string | undefined) {
  await requireAdmin();
  const q = compact(query);
  // The product page asks alongside getMasterProduct, before the id is known to exist.
  if (q.length < 3 || !/^[0-9a-f-]{36}$/i.test(id)) return { q, targets: [] as MergeTarget[] };
  const targets = (await db.query<MergeTarget>(`SELECT p.id,p.brand_label,p.code,p.name,p.suppliers,p.brand=self.brand AS same_brand,
    EXISTS (SELECT 1 FROM product_equivalents e WHERE e.product_id=$1 AND e.equivalent_id=p.id) AS equivalent
    FROM products p, (SELECT brand FROM products WHERE id=$1) self
    WHERE p.id<>$1 AND p.merged_into IS NULL AND (p.part_number LIKE '%'||$2||'%' OR ${codeMatch(q, "$2")})
    ORDER BY p.brand=self.brand DESC, p.part_number=$2 DESC, p.suppliers='{}', length(p.part_number), p.code LIMIT 20`, [id, q])).rows;
  return { q, targets };
}
