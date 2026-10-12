import "server-only";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { sharedCandidateSql } from "@/modules/admin/product-matching-sql";
import { requireAdmin } from "@/modules/auth/session";
import { dinamikCompany } from "@/modules/suppliers/storefront-sources";

export type MatchingParams = { tab?: string; scope?: string; names?: string; q?: string; page?: string; decided?: string; refreshed?: string; split?: string; matched?: string; count?: string; brand?: string; error?: string; sort?: string; dir?: string };
// Header sorting per tab (TableHead sortKey → column); keys are only looked up here, never interpolated from the URL.
const sorts = {
  brands: { name: "name", items: "items" },
  same: { primary: "primary_price", selling: "selling_price" },
  candidates: { reason: "c.reason", similarity: "c.name_similarity" },
  dinamik: { code: "i.code", brand: "i.product_data->>'marka'", name: "supplier_item_name('dinamik',i.product_data)" },
  seta: { code: "s.code", linked: "linked", price: "c.price_kurus" },
};
// Keys arrived over time; runs recorded before a key lack it.
export type MatchStats = { items: number; basbug_dinamik_groups?: number; dinamik_only?: number; offer_exclusions?: number;
  seta_linked_items?: number; seta_linked_products?: number; match_candidates?: number };
export type Offer = { id: string; supplier: string; code: string; name: string; price: number | null; available: boolean; stock_label: string };
/** A Başbuğ product with the Dinamik offers grouped under it; `selling` is the supplier whose offer the store sells now. */
export type SameProduct = { primary_id: string; offers: Offer[]; selling: string | null; selling_price: number | null; primary_price: number | null };
export type SplitItem = { id: string; supplier: string; code: string; name: string | null; decided_at: Date };
export type DinamikItem = { id: string; product_id: string | null; code: string; brand: string | null; name: string | null; price_kurus: number | null; available: boolean | null; enriched: boolean };
export type SetaProduct = { id: string; supplier: string; code: string; name: string | null; via: string };
export type SetaItem = { id: string; code: string; name: string | null; price_kurus: number | null; available: boolean | null; linked: number; products: SetaProduct[] };
export type MatchingTab = "brands" | "candidates" | "same" | "dinamik" | "seta";
export type BrandLabel = { supplier: string; label: string; items: number; method: "auto" | "manual" };
/** A master brand and the supplier labels deduplicated into it; `pending` while any label was placed automatically. */
export type MasterBrand = { id: string; key: string; name: string; items: number; pending: boolean; labels: BrandLabel[] };
export type BrandScope = "pending" | "single" | "all";
export const brandScopes: BrandScope[] = ["pending", "single", "all"];
export type CandidateReason = "prefix" | "leading_zero" | "suffix";
export const candidateReasons: Record<CandidateReason, string> = { prefix: "Kod ön eki farkı", leading_zero: "Baştaki sıfır farkı", suffix: "Son ek farkı" };
type CandidateSide = { id: string; brand_label: string; code: string; name: string | null; price_kurus: number | null; available: boolean | null };
/** A Başbuğ-only product (a) and a Dinamik-only product (b) that look the same; "Aynı ürün" merges b into a. */
export type Candidate = { reason: CandidateReason; name_similarity: number | null; name_conflict: boolean; shared_b: boolean; brand: string; a: CandidateSide; b: CandidateSide };
/** Candidates split by whether the two part names name the same kind of part (db product_names_conflict). */
export type CandidateNames = "consistent" | "conflict";
export const candidateNames: Record<CandidateNames, string> = { consistent: "Tanımı uyumlu", conflict: "Tanımı farklı" };

const pageSize = 25;
const pageOf = (value: string | undefined, total: number) => {
  const pages = Math.max(1, Math.ceil(total / pageSize)), parsed = Number(value);
  return { pages, page: Number.isSafeInteger(parsed) ? Math.min(pages, Math.max(1, parsed)) : 1 };
};
const compact = (value: string | undefined) => value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 80) ?? "";
const tabs: MatchingTab[] = ["brands", "candidates", "same", "dinamik", "seta"];
// Per master brand: its labels, whether any is unconfirmed, and how many of Başbuğ/Dinamik sell it. A brand only one
// of them sells may be the other's under another spelling; SETA is a brand of its own.
const brandRows = `SELECT b.id::text,b.key,b.name,COALESCE(sum(sb.items),0)::int AS items,bool_or(sb.method='auto') AS pending,
   count(DISTINCT sb.supplier) FILTER (WHERE sb.supplier IN ('basbug','dinamik') AND sb.items>0) AS sellers,bool_or(sb.supplier='seta') AS seta,
   jsonb_agg(jsonb_build_object('supplier',sb.supplier,'label',sb.label,'items',sb.items,'method',sb.method) ORDER BY sb.supplier,sb.items DESC,sb.label) AS labels
  FROM brands b JOIN supplier_brands sb ON sb.brand_id=b.id GROUP BY b.id`;
const brandFilters: Record<BrandScope, string> = { pending: "pending", single: "sellers=1 AND NOT seta", all: "true" };

export async function productMatchingData(params: MatchingParams) {
  await requireAdmin();
  const [run, candidates, brandCounts] = await Promise.all([
    db.query<{ completed_at: Date; stats: MatchStats }>("SELECT completed_at,stats FROM product_match_runs ORDER BY id DESC LIMIT 1"),
    db.query<{ count: number }>("SELECT count(*)::int FROM product_match_candidates"),
    db.query<{ pending: number; single: number; all: number }>(`SELECT count(*) FILTER (WHERE ${brandFilters.pending})::int AS pending,
      count(*) FILTER (WHERE ${brandFilters.single})::int AS single,count(*)::int AS all FROM (${brandRows}) b`),
  ]);
  // "pairs" was the brand tab before master brands.
  const tab = params.tab === "pairs" ? "brands" : tabs.includes(params.tab as MatchingTab) ? params.tab as MatchingTab : "brands";
  // Decisions remove candidates at once, so the pending count is live rather than the last run's.
  const brandCount = brandCounts.rows[0];
  const base = { run: run.rows[0] ?? null, pendingCandidates: candidates.rows[0].count, brandCount, tab };
  if (tab === "candidates") return { ...base, ...await matchCandidates(params) };
  if (tab === "same") return { ...base, ...await sameProducts(params) };
  if (tab === "dinamik") return { ...base, ...await dinamikOnly(params) };
  if (tab === "seta") return { ...base, ...await setaReferences(params) };
  const scope = brandScopes.includes(params.scope as BrandScope) ? params.scope as BrandScope : "pending";
  return { ...base, ...await masterBrands(scope, params) };
}

/** Master brands with their Başbuğ / Dinamik / SETA labels, largest first; `q` matches the name or any label. */
async function masterBrands(scope: BrandScope, params: MatchingParams) {
  const q = compact(params.q);
  const where = `${brandFilters[scope]} AND ($1='' OR regexp_replace(upper(name),'[^A-Z0-9]','','g') LIKE '%'||$1||'%'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(labels) l WHERE regexp_replace(upper(l->>'label'),'[^A-Z0-9]','','g') LIKE '%'||$1||'%'))`;
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM (${brandRows}) b WHERE ${where}`, [q])).rows[0].count;
  const { page, pages } = pageOf(params.page, total);
  const brands = (await db.query<MasterBrand>(`SELECT id,key,name,items,pending,labels FROM (${brandRows}) b WHERE ${where}
    ORDER BY ${sortOrder(params, sorts.brands, "items DESC,name")} LIMIT ${pageSize} OFFSET $2`, [q, (page - 1) * pageSize])).rows;
  // Names for the move/merge inputs' suggestions.
  const names = (await db.query<{ name: string }>("SELECT DISTINCT name FROM brands ORDER BY name")).rows.map(row => row.name);
  return { scope, brands, names, total, page, pages };
}

/**
 * Başbuğ products that Dinamik also sells, priced live through commerce_catalog (~2 s for every group). The
 * offer sold is the cheapest available one, the Başbuğ row winning ties: the rule of withBestOffers (store catalog).
 */
async function sameProducts(params: MatchingParams) {
  const exclusions = (await db.query<{ count: number }>("SELECT count(*)::int FROM product_sources WHERE method='manual'")).rows[0].count;
  if (params.scope === "split") {
    const split = (await db.query<SplitItem>(`SELECT i.id,i.supplier,i.code,supplier_item_name(i.supplier,i.product_data) AS name,x.linked_at AS decided_at
      FROM product_sources x JOIN supplier_items i ON i.id=x.supplier_item_id WHERE x.method='manual' ORDER BY x.linked_at DESC LIMIT 200`)).rows;
    return { split, same: [] as SameProduct[], summary: undefined, scope: "split", total: split.length, page: 1, pages: 1, exclusions };
  }
  const scope = ["dinamik", "basbug", "none"].includes(params.scope ?? "") ? params.scope! : "all";
  const q = compact(params.q);
  const requested = Number(params.page), page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const row = (await db.query<{ summary: Record<string, number>; total: number; groups: SameProduct[] | null }>(`WITH offers AS MATERIALIZED (
      SELECT o.primary_id,c.id,c.supplier,c.code,c.name,c.price_kurus,c.available,c.stock_label FROM product_offers o JOIN commerce_catalog c ON c.id=o.item_id
    ), grouped AS MATERIALIZED (
      SELECT primary_id::text,
       (array_agg(supplier ORDER BY price_kurus,(id=primary_id) DESC) FILTER (WHERE available AND price_kurus IS NOT NULL))[1] AS selling,
       min(price_kurus) FILTER (WHERE available) AS selling_price, min(price_kurus) FILTER (WHERE id=primary_id) AS primary_price,
       jsonb_agg(jsonb_build_object('id',id,'supplier',supplier,'code',code,'name',name,'price',price_kurus,'available',available,'stock_label',stock_label)
        ORDER BY (id=primary_id) DESC,supplier,code) AS offers
      FROM offers GROUP BY primary_id HAVING bool_or(supplier='basbug' AND id=primary_id) AND bool_or(supplier='dinamik')
    ), filtered AS (
      SELECT * FROM grouped WHERE ($1='all' OR ($1='none' AND selling IS NULL) OR selling=$1)
       AND ($2='' OR EXISTS (SELECT 1 FROM jsonb_array_elements(offers) e WHERE regexp_replace(upper(e->>'code'),'[^A-Z0-9]','','g') LIKE '%'||$2||'%'))
    )
    SELECT (SELECT jsonb_build_object('all',count(*),'dinamik',count(*) FILTER (WHERE selling='dinamik'),'basbug',count(*) FILTER (WHERE selling='basbug'),
       'none',count(*) FILTER (WHERE selling IS NULL)) FROM grouped) AS summary,
     (SELECT count(*)::int FROM filtered) AS total,
     (SELECT jsonb_agg(f) FROM (SELECT * FROM filtered ORDER BY ${sortOrder(params, sorts.same, "(primary_price-selling_price) DESC NULLS LAST,primary_id")} LIMIT ${pageSize} OFFSET $3) f) AS groups`,
    [scope, q, (page - 1) * pageSize])).rows[0];
  const { pages } = pageOf(String(page), row.total);
  return { same: row.groups ?? [], summary: row.summary, scope, total: row.total, page: Math.min(page, pages), pages, exclusions };
}

/** Reviewable candidates the automatic key missed; most similar names first. `q` narrows to a brand or code. */
async function matchCandidates(params: MatchingParams) {
  const reason = params.scope && params.scope in candidateReasons ? params.scope as CandidateReason : null;
  const names = params.names && params.names in candidateNames ? params.names as CandidateNames : null;
  const q = compact(params.q);
  const values: unknown[] = [reason, q, names === null ? null : names === "conflict"];
  const where = `($1::text IS NULL OR c.reason=$1) AND ($2='' OR a.brand=$2 OR a.part_number LIKE '%'||$2||'%' OR b.part_number LIKE '%'||$2||'%')
    AND ($3::boolean IS NULL OR COALESCE(c.name_conflict,false)=$3)`;
  const from = "product_match_candidates c JOIN products a ON a.id=c.product_a JOIN products b ON b.id=c.product_b";
  const [counts, nameCounts, total] = await Promise.all([
    db.query<{ reason: CandidateReason; count: number }>(`SELECT reason,count(*)::int FROM product_match_candidates GROUP BY reason`),
    db.query<{ conflict: number; consistent: number }>(`SELECT count(*) FILTER (WHERE name_conflict)::int AS conflict,
      count(*) FILTER (WHERE name_conflict IS NOT TRUE)::int AS consistent FROM product_match_candidates WHERE $1::text IS NULL OR reason=$1`, [reason]),
    db.query<{ count: number; acceptable: number }>(`SELECT count(*)::int,
      count(*) FILTER (WHERE c.name_conflict IS NOT TRUE AND NOT ${sharedCandidateSql})::int AS acceptable FROM ${from} WHERE ${where}`, values),
  ]);
  const { page, pages } = pageOf(params.page, total.rows[0].count);
  type Row = { reason: CandidateReason; name_similarity: number | null; name_conflict: boolean; shared_b: boolean; brand: string; a: Omit<CandidateSide, "price_kurus" | "available">; b: Omit<CandidateSide, "price_kurus" | "available"> };
  const side = (alias: string) => `jsonb_build_object('id',${alias}.id,'brand_label',${alias}.brand_label,'code',${alias}.code,'name',${alias}.name)`;
  const rows = (await db.query<Row>(`SELECT c.reason,c.name_similarity,COALESCE(c.name_conflict,false) AS name_conflict,${sharedCandidateSql} AS shared_b,a.brand,${side("a")} AS a,${side("b")} AS b FROM ${from} WHERE ${where}
    ORDER BY ${sortOrder(params, sorts.candidates, "c.name_similarity DESC NULLS LAST,a.brand,a.part_number")} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  // Priced in one pass for the page (commerce_catalog per id is fast; per row in a subquery it is not). Each side is
  // a single-supplier product; its cheapest available row stands for it.
  const ids = rows.flatMap(row => [row.a.id, row.b.id]);
  const prices = ids.length ? (await db.query<{ product_id: string; price_kurus: number | null; available: boolean }>(`WITH s AS (
      SELECT product_id,supplier_item_id FROM product_sources WHERE product_id=ANY($1::uuid[]))
    SELECT DISTINCT ON (s.product_id) s.product_id,k.price_kurus,k.available FROM s
    JOIN commerce_catalog k ON k.id=s.supplier_item_id AND k.id=ANY(ARRAY(SELECT supplier_item_id FROM s))
    ORDER BY s.product_id,k.available DESC,k.price_kurus NULLS LAST`, [ids])).rows : [];
  const priceOf = new Map(prices.map(row => [row.product_id, { price_kurus: row.price_kurus, available: row.available }]));
  const priced = (item: Row["a"]): CandidateSide => ({ ...item, ...(priceOf.get(item.id) ?? { price_kurus: null, available: null }) });
  const candidates: Candidate[] = rows.map(row => ({ ...row, a: priced(row.a), b: priced(row.b) }));
  const byReason = Object.fromEntries(counts.rows.map(row => [row.reason, row.count])) as Partial<Record<CandidateReason, number>>;
  return { candidates, reason, names, byReason, byNames: nameCounts.rows[0], total: total.rows[0].count, acceptableTotal: total.rows[0].acceptable,
    page, pages, brandFilter: q };
}

/** Dinamik items the store lists on their own: not grouped under a Başbuğ product. */
async function dinamikOnly(params: MatchingParams) {
  const q = compact(params.q).toLowerCase();
  const values: unknown[] = q ? [dinamikCompany, q] : [dinamikCompany];
  const where = `i.supplier='dinamik' AND i.company=$1 AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=i.id AND o.primary_id<>o.item_id)
    ${q ? "AND supplier_item_search_codes(i.code,i.product_data) LIKE '%'||$2||'%'" : ""}`;
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM commerce_supplier_items i WHERE ${where}`, values)).rows[0].count;
  const { page, pages } = pageOf(params.page, total);
  const order = sortOrder(params, sorts.dinamik, "i.changed_at DESC,i.id");
  const items = (await db.query<DinamikItem>(`SELECT i.id,(SELECT s.product_id FROM product_sources s WHERE s.supplier_item_id=i.id) AS product_id,i.code,i.product_data->>'marka' AS brand,supplier_item_name('dinamik',i.product_data) AS name,
      c.price_kurus,c.available,EXISTS (SELECT 1 FROM product_enrichment_shared e WHERE e.supplier_item_id=i.id) AS enriched
    FROM (SELECT i.* FROM commerce_supplier_items i WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}) i
    LEFT JOIN LATERAL (SELECT price_kurus,available FROM commerce_catalog c WHERE c.id=i.id OFFSET 0) c ON true ORDER BY ${order}`, values)).rows;
  return { dinamik: items, total, page, pages };
}

/** SETA products and the Başbuğ/Dinamik listings they are shown on as equivalents. */
async function setaReferences(params: MatchingParams) {
  const q = compact(params.q);
  const scope = params.scope === "unlinked" ? "unlinked" : "linked";
  const values: unknown[] = q ? [q] : [];
  const where = `s.supplier='seta' AND s.presence='present' AND ${scope === "unlinked" ? "NOT " : ""}EXISTS (SELECT 1 FROM product_seta_references r WHERE r.seta_item_id=s.id)
    ${q ? `AND (regexp_replace(upper(s.code),'[^A-Z0-9]','','g') LIKE '%'||$1||'%' OR EXISTS (SELECT 1 FROM product_seta_references r WHERE r.seta_item_id=s.id AND r.part_number LIKE $1||'%'))` : ""}`;
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM supplier_items s WHERE ${where}`, values)).rows[0].count;
  const { page, pages } = pageOf(params.page, total);
  const items = (await db.query<Omit<SetaItem, "products">>(`SELECT s.id::text,s.code,supplier_item_name('seta',s.product_data) AS name,c.price_kurus,c.available,
      (SELECT count(DISTINCT COALESCE(o.primary_id,r.item_id))::int FROM product_seta_references r LEFT JOIN product_offers o ON o.item_id=r.item_id WHERE r.seta_item_id=s.id) AS linked
    FROM supplier_items s LEFT JOIN LATERAL (SELECT price_kurus,available FROM commerce_catalog c WHERE c.id=s.id OFFSET 0) c ON true
    WHERE ${where} ORDER BY ${sortOrder(params, sorts.seta, "linked DESC,s.code")} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  // Listings, not raw rows: a Dinamik offer grouped under a Başbuğ product shows as that product.
  const products = items.length ? (await db.query<SetaProduct & { seta_item_id: string }>(`SELECT * FROM (
      SELECT DISTINCT ON (r.seta_item_id,p.id) r.seta_item_id::text,p.id::text,p.supplier,p.code,supplier_item_name(p.supplier,p.product_data) AS name,
       CASE r.brand WHEN 'ORIJINAL' THEN 'OEM '||r.part_number ELSE r.brand||' '||r.part_number END AS via
      FROM product_seta_references r LEFT JOIN product_offers o ON o.item_id=r.item_id JOIN supplier_items p ON p.id=COALESCE(o.primary_id,r.item_id)
      WHERE r.seta_item_id=ANY($1::uuid[]) ORDER BY r.seta_item_id,p.id) x ORDER BY supplier,code`, [items.map(item => item.id)])).rows : [];
  return { seta: items.map(item => ({ ...item, products: products.filter(product => product.seta_item_id === item.id) })), scope, total, page, pages };
}
