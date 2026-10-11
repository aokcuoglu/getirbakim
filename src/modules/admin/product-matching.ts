import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { dinamikCompany } from "@/modules/suppliers/storefront-sources";

export type MatchingParams = { tab?: string; strength?: string; scope?: string; q?: string; page?: string; decided?: string; refreshed?: string; split?: string; error?: string };
// Keys arrived over time; runs recorded before a key lack it.
export type MatchStats = { items: number; pair_suggestions: number; basbug_dinamik_groups?: number; dinamik_only?: number; offer_exclusions?: number;
  seta_linked_items?: number; seta_linked_products?: number };
export type EanSample = { ean: string; part_a: string; a: string | null; part_b: string; b: string | null };
export type PairSuggestion = { brand_a: string; brand_b: string; shared_parts: number; shared_eans: number; avg_name_similarity: number | null;
  samples: { part: string; a: string | null; b: string | null }[]; ean_samples: EanSample[] };
export type Offer = { id: string; supplier: string; code: string; name: string; price: number | null; available: boolean; stock_label: string };
/** A Başbuğ product with the Dinamik offers grouped under it; `selling` is the supplier whose offer the store sells now. */
export type SameProduct = { primary_id: string; offers: Offer[]; selling: string | null; selling_price: number | null; primary_price: number | null };
export type SplitItem = { id: string; supplier: string; code: string; name: string | null; decided_at: Date };
export type DinamikItem = { id: string; code: string; brand: string | null; name: string | null; price_kurus: number | null; available: boolean | null; enriched: boolean };
export type SetaProduct = { id: string; supplier: string; code: string; name: string | null; via: string };
export type SetaItem = { id: string; code: string; name: string | null; price_kurus: number | null; available: boolean | null; linked: number; products: SetaProduct[] };
export type MatchingTab = "pairs" | "same" | "dinamik" | "seta";

// Name similarity of real alias/rebrand pairs measured 0.15–0.37, coincidental number collisions ~0.02–0.05.
export const strongSimilarity = 0.1;
const pageSize = 25;
const pageOf = (value: string | undefined, total: number) => {
  const pages = Math.max(1, Math.ceil(total / pageSize)), parsed = Number(value);
  return { pages, page: Number.isSafeInteger(parsed) ? Math.min(pages, Math.max(1, parsed)) : 1 };
};
const compact = (value: string | undefined) => value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 80) ?? "";
const tabs: MatchingTab[] = ["pairs", "same", "dinamik", "seta"];

export async function productMatchingData(params: MatchingParams) {
  await requireAdmin();
  const [run, strength] = await Promise.all([
    db.query<{ completed_at: Date; stats: MatchStats }>("SELECT completed_at,stats FROM product_match_runs ORDER BY id DESC LIMIT 1"),
    db.query<{ strong: number; weak: number }>(`SELECT count(*) FILTER (WHERE avg_name_similarity>=$1)::int AS strong,
      count(*) FILTER (WHERE avg_name_similarity IS NULL OR avg_name_similarity<$1)::int AS weak FROM product_brand_pair_suggestions`, [strongSimilarity]),
  ]);
  const tab = tabs.includes(params.tab as MatchingTab) ? params.tab as MatchingTab : "pairs";
  const base = { run: run.rows[0] ?? null, strength: strength.rows[0], tab };
  if (tab === "same") return { ...base, ...await sameProducts(params) };
  if (tab === "dinamik") return { ...base, ...await dinamikOnly(params) };
  if (tab === "seta") return { ...base, ...await setaReferences(params) };
  const weak = params.strength === "weak";
  const filter = weak ? "avg_name_similarity IS NULL OR avg_name_similarity<$1" : "avg_name_similarity>=$1";
  const total = weak ? base.strength.weak : base.strength.strong;
  const { page, pages } = pageOf(params.page, total);
  const pairs = (await db.query<PairSuggestion>(`SELECT * FROM product_brand_pair_suggestions WHERE ${filter}
    ORDER BY greatest(shared_parts,shared_eans) DESC,brand_a,brand_b LIMIT ${pageSize} OFFSET $2`, [strongSimilarity, (page - 1) * pageSize])).rows;
  return { ...base, pairs, weak, total, page, pages };
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
     (SELECT jsonb_agg(f) FROM (SELECT * FROM filtered ORDER BY (primary_price-selling_price) DESC NULLS LAST,primary_id LIMIT ${pageSize} OFFSET $3) f) AS groups`,
    [scope, q, (page - 1) * pageSize])).rows[0];
  const { pages } = pageOf(String(page), row.total);
  return { same: row.groups ?? [], summary: row.summary, scope, total: row.total, page: Math.min(page, pages), pages, exclusions };
}

/** Dinamik items the store lists on their own: not grouped under a Başbuğ product. */
async function dinamikOnly(params: MatchingParams) {
  const q = compact(params.q).toLowerCase();
  const values: unknown[] = q ? [dinamikCompany, q] : [dinamikCompany];
  const where = `i.supplier='dinamik' AND i.company=$1 AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=i.id AND o.primary_id<>o.item_id)
    ${q ? "AND supplier_item_search_codes(i.code,i.product_data) LIKE '%'||$2||'%'" : ""}`;
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM commerce_supplier_items i WHERE ${where}`, values)).rows[0].count;
  const { page, pages } = pageOf(params.page, total);
  const items = (await db.query<DinamikItem>(`SELECT i.id,i.code,i.product_data->>'marka' AS brand,supplier_item_name('dinamik',i.product_data) AS name,
      c.price_kurus,c.available,EXISTS (SELECT 1 FROM product_enrichments e WHERE e.supplier_item_id=i.id) AS enriched
    FROM (SELECT i.* FROM commerce_supplier_items i WHERE ${where} ORDER BY i.changed_at DESC,i.id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}) i
    LEFT JOIN LATERAL (SELECT price_kurus,available FROM commerce_catalog c WHERE c.id=i.id OFFSET 0) c ON true ORDER BY i.changed_at DESC,i.id`, values)).rows;
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
    WHERE ${where} ORDER BY linked DESC,s.code LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  // Listings, not raw rows: a Dinamik offer grouped under a Başbuğ product shows as that product.
  const products = items.length ? (await db.query<SetaProduct & { seta_item_id: string }>(`SELECT * FROM (
      SELECT DISTINCT ON (r.seta_item_id,p.id) r.seta_item_id::text,p.id::text,p.supplier,p.code,supplier_item_name(p.supplier,p.product_data) AS name,
       CASE r.brand WHEN 'ORIJINAL' THEN 'OEM '||r.part_number ELSE r.brand||' '||r.part_number END AS via
      FROM product_seta_references r LEFT JOIN product_offers o ON o.item_id=r.item_id JOIN supplier_items p ON p.id=COALESCE(o.primary_id,r.item_id)
      WHERE r.seta_item_id=ANY($1::uuid[]) ORDER BY r.seta_item_id,p.id) x ORDER BY supplier,code`, [items.map(item => item.id)])).rows : [];
  return { seta: items.map(item => ({ ...item, products: products.filter(product => product.seta_item_id === item.id) })), scope, total, page, pages };
}
