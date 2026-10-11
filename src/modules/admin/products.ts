import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";

/** Master catalog (db/product-matching.sql): one product, the supplier rows it is sold from, and its equivalents. */
export const productFilters = {
  all: { label: "Tümü", where: "true" },
  multi: { label: "Birden çok tedarikçi", where: "cardinality(p.suppliers)>1" },
  basbug: { label: "Yalnız Başbuğ", where: "p.suppliers='{basbug}'" },
  dinamik: { label: "Yalnız Dinamik", where: "p.suppliers='{dinamik}'" },
  seta: { label: "SETA", where: "p.suppliers @> '{seta}'" },
  manual: { label: "Elle ayrılan", where: "EXISTS (SELECT 1 FROM product_sources s WHERE s.product_id=p.id AND s.method='manual')" },
  inactive: { label: "Satışta değil", where: "p.suppliers='{}'" },
} as const;
export type ProductFilter = keyof typeof productFilters;
export const supplierNames: Record<string, string> = { basbug: "Başbuğ", dinamik: "Dinamik", seta: "SETA" };
const pageSize = 50;

export type ProductRow = {
  id: string; brand: string; brand_label: string; part_number: string; variant: number; code: string; name: string | null;
  suppliers: string[]; merged_into: string | null; sources: number; best_price: number | null; best_supplier: string | null; available: boolean;
};
export type ProductSource = {
  id: string; supplier: string; code: string; name: string | null; brand_label: string | null; method: "auto" | "manual"; linked_at: Date;
  saleable: boolean; price_kurus: number | null; available: boolean; stock_label: string | null; best: boolean;
};
export type ProductEquivalent = {
  id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; kind: "oem" | "cross" | "brand" | "manual";
  via_brand: string; via_part: string;
};

const compact = (value: string | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40);

/**
 * Best offer per product: the cheapest available saleable source, the product's own row winning ties (the
 * storefront rule). Priced through commerce_catalog only for the ids asked for.
 */
const offersSql = `WITH sources AS (
   SELECT s.product_id, s.supplier_item_id FROM product_sources s WHERE s.product_id=ANY($1::uuid[])
 ), priced AS (
   SELECT s.product_id, c.id, c.supplier, c.price_kurus, c.available, c.stock_label FROM sources s
   JOIN commerce_catalog c ON c.id=s.supplier_item_id AND c.id=ANY(ARRAY(SELECT supplier_item_id FROM sources))
 )`;

export async function listProducts(params: { q?: string; filter?: string; page?: string }) {
  await requireAdmin();
  const filter: ProductFilter = params.filter && params.filter in productFilters ? params.filter as ProductFilter : "all";
  const q = compact(params.q);
  const values: unknown[] = [];
  const where: string[] = [productFilters[filter].where];
  if (q) {
    values.push(q);
    // Part number or any supplier code of the product, ignoring punctuation and the supplier's brand prefix.
    where.push(`(p.part_number LIKE '%'||$1||'%' OR p.brand=$1 OR EXISTS (SELECT 1 FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id
      WHERE s.product_id=p.id AND regexp_replace(upper(i.code),'[^A-Z0-9]','','g') LIKE '%'||$1||'%'))`);
  }
  // Merged products have no rows of their own; they only matter as redirects.
  if (filter !== "inactive") where.push("p.merged_into IS NULL");
  const sql = where.join(" AND ");
  const [total, counts] = await Promise.all([
    db.query<{ count: number }>(`SELECT count(*)::int FROM products p WHERE ${sql}`, values),
    q ? Promise.resolve(null) : db.query<Record<ProductFilter, number>>(`SELECT count(*) FILTER (WHERE merged_into IS NULL)::int AS all,
      count(*) FILTER (WHERE cardinality(suppliers)>1)::int AS multi, count(*) FILTER (WHERE suppliers='{basbug}')::int AS basbug,
      count(*) FILTER (WHERE suppliers='{dinamik}')::int AS dinamik, count(*) FILTER (WHERE suppliers @> '{seta}')::int AS seta,
      (SELECT count(DISTINCT product_id) FROM product_sources WHERE method='manual')::int AS manual,
      count(*) FILTER (WHERE suppliers='{}' AND merged_into IS NULL)::int AS inactive FROM products`),
  ]);
  const pages = Math.max(1, Math.ceil(total.rows[0].count / pageSize));
  const requested = Number(params.page), page = Math.min(Number.isSafeInteger(requested) && requested > 0 ? requested : 1, pages);
  const rows = (await db.query<Omit<ProductRow, "best_price" | "best_supplier" | "available" | "sources">>(`SELECT p.id,p.brand,p.brand_label,p.part_number,
    p.variant,p.code,p.name,p.suppliers,p.merged_into FROM products p WHERE ${sql}
    ORDER BY p.brand_label,p.part_number,p.variant LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  const offers = rows.length ? (await db.query<{ product_id: string; sources: number; best_price: number | null; best_supplier: string | null; available: boolean }>(
    `${offersSql}, counted AS (SELECT product_id, count(*)::int AS sources FROM sources GROUP BY product_id)
    SELECT c.product_id, c.sources, b.price_kurus AS best_price, b.supplier AS best_supplier, COALESCE(b.available,false) AS available FROM counted c
    LEFT JOIN LATERAL (SELECT * FROM priced x WHERE x.product_id=c.product_id AND x.price_kurus IS NOT NULL
      ORDER BY x.available DESC, x.price_kurus, x.id=c.product_id DESC LIMIT 1) b ON true`, [rows.map(row => row.id)])).rows : [];
  const byId = new Map(offers.map(offer => [offer.product_id, offer]));
  const products: ProductRow[] = rows.map(row => ({ ...row, sources: 0, best_price: null, best_supplier: null, available: false, ...byId.get(row.id) }));
  return { products, filter, q, total: total.rows[0].count, counts: counts?.rows[0] ?? null, page, pages };
}

export async function getMasterProduct(id: string) {
  await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const product = (await db.query<Omit<ProductRow, "sources" | "best_price" | "best_supplier" | "available"> & { created_at: Date; updated_at: Date }>(
    `SELECT id,brand,brand_label,part_number,variant,code,name,suppliers,merged_into,created_at,updated_at FROM products WHERE id=$1`, [id])).rows[0];
  if (!product) return null;
  const [sources, equivalents] = await Promise.all([
    db.query<ProductSource>(`${offersSql}
      SELECT i.id, i.supplier, i.code, supplier_item_name(i.supplier,i.product_data) AS name, supplier_item_brand(i.supplier,i.product_data) AS brand_label,
       s.method, s.linked_at, p.id IS NOT NULL AS saleable, p.price_kurus, COALESCE(p.available,false) AS available, p.stock_label, false AS best
      FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id LEFT JOIN priced p ON p.id=s.supplier_item_id
      WHERE s.product_id=($1::uuid[])[1]
      ORDER BY p.id IS NULL, i.id=s.product_id DESC, CASE i.supplier WHEN 'basbug' THEN 0 WHEN 'dinamik' THEN 1 ELSE 2 END, i.code`, [[id]]),
    db.query<ProductEquivalent>(`SELECT p.id, p.brand_label, p.code, p.name, p.suppliers, e.kind, e.brand AS via_brand, e.part_number AS via_part
      FROM product_equivalents e JOIN products p ON p.id=e.equivalent_id WHERE e.product_id=$1
      ORDER BY p.suppliers='{}', e.kind, p.brand_label, p.code LIMIT 100`, [id]),
  ]);
  // The storefront sells the cheapest available row; the product's own row wins ties.
  const best = sources.rows.filter(row => row.available && row.price_kurus !== null)
    .sort((a, b) => a.price_kurus! - b.price_kurus! || Number(b.id === id) - Number(a.id === id))[0];
  if (best) best.best = true;
  const merged = product.merged_into ? (await db.query<{ id: string; brand_label: string; code: string }>(
    "SELECT id,brand_label,code FROM products WHERE id=$1", [product.merged_into])).rows[0] ?? null : null;
  // The store still lists supplier rows in this phase: the row it shows for this product.
  const listed = sources.rows.find(row => row.saleable && row.supplier !== "seta" && row.id === id)
    ?? sources.rows.find(row => row.saleable) ?? null;
  return { product, sources: sources.rows, equivalents: equivalents.rows, merged, storeId: listed?.id ?? null };
}

export type MergeTarget = {
  id: string; brand_label: string; code: string; name: string | null; suppliers: string[]; same_brand: boolean; equivalent: boolean;
};

/** Products to merge with (or link as equivalent to) `id`: part number or supplier code match, same brand first. */
export async function findMergeTargets(id: string, query: string | undefined) {
  await requireAdmin();
  const q = compact(query);
  if (q.length < 3) return { q, targets: [] as MergeTarget[] };
  const targets = (await db.query<MergeTarget>(`SELECT p.id,p.brand_label,p.code,p.name,p.suppliers,p.brand=self.brand AS same_brand,
    EXISTS (SELECT 1 FROM product_equivalents e WHERE e.product_id=$1 AND e.equivalent_id=p.id) AS equivalent
    FROM products p, (SELECT brand FROM products WHERE id=$1) self
    WHERE p.id<>$1 AND p.merged_into IS NULL AND (p.part_number LIKE '%'||$2||'%' OR EXISTS (SELECT 1 FROM product_sources s JOIN supplier_items i ON i.id=s.supplier_item_id
      WHERE s.product_id=p.id AND regexp_replace(upper(i.code),'[^A-Z0-9]','','g') LIKE '%'||$2||'%'))
    ORDER BY p.brand=self.brand DESC, p.part_number=$2 DESC, p.suppliers='{}', length(p.part_number), p.code LIMIT 20`, [id, q])).rows;
  return { q, targets };
}
