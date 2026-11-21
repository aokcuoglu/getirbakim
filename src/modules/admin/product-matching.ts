import "server-only";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { compactCode as compact, manualKind, manualSearchTerms, pickSameProducts, sameLinked, sameScope, type SameEntry } from "@/modules/admin/product-matching-same";
import { bulkAcceptableSql, isBulkReason, manualDeciderSql, manualKindFilterSql, manualKindSql, manualGroupsSql, offerManualSql, isPatternBulkReason, multiNumberCandidateSql, productCostTrySql, sharedCandidateSql } from "@/modules/admin/product-matching-sql";
import { suffixHints, type SuffixHints } from "@/modules/admin/product-suffix-signals";
import { requireAdmin } from "@/modules/auth/session";
import { catalogRowsByIdsSql } from "@/modules/store/catalog";
import { resolveBrandLogos, type BrandLogoSource, type ManufacturerLogo } from "@/modules/store/manufacturer-logos";
import { dinamikCompany } from "@/modules/suppliers/storefront-sources";

type MatchingParams = { tab?: string; scope?: string; names?: string; q?: string; page?: string; decided?: string; refreshed?: string; split?: string; matched?: string; count?: string; brand?: string; error?: string; sort?: string; dir?: string; kind?: string; linked?: string; logo?: string };
// Header sorting per tab (TableHead sortKey → column); keys are only looked up here, never interpolated from the URL.
const sorts = {
  brands: { name: "name", items: "items" },
  candidates: { reason: "c.reason", similarity: "c.name_similarity" },
  dinamik: { code: "i.code", brand: "i.product_data->>'marka'", name: "supplier_item_name('dinamik',i.product_data)" },
  seta: { code: "s.code", linked: "linked", price: "c.price_kurus" },
  // "Karar" A→Z: Ayırma (a split-off variant) before Birleştirme.
  manual: { kind: "(p.variant=0)", supplier: "i.supplier", code: "i.code", decided: "x.linked_at", decider: manualDeciderSql },
};
// Keys arrived over time; runs recorded before a key lack it.
type MatchStats = { items: number; basbug_dinamik_groups?: number; dinamik_only?: number; offer_exclusions?: number;
  seta_linked_items?: number; seta_linked_products?: number; match_candidates?: number };
export type Offer = { id: string; supplier: string; code: string; name: string; price: number | null; available: boolean; stock_label: string;
  /** Linked by an admin (product_sources.method='manual'), not by brand key + part number. */
  manual: boolean };
/** A Başbuğ product with the Dinamik offers grouped under it; `selling` is the supplier whose offer the store sells now. */
type SameProduct = { primary_id: string; offers: Offer[]; selling: string | null; selling_price: number | null; primary_price: number | null };
/**
 * A supplier row an admin placed by hand: merged into another product (`merge`) or split off into a product of its
 * own (`split`, a variant above 0); "Geri al" returns it to its own key's product.
 */
export type ManualDecision = { id: string; supplier: string; code: string; name: string | null; decided_at: Date; decided_by_name: string | null; kind: "merge" | "split";
  product_id: string; product_label: string; product_code: string; product_name: string | null };
export type DinamikItem = { id: string; product_id: string | null; code: string; brand: string | null; name: string | null; price_kurus: number | null; available: boolean | null; enriched: boolean };
type SetaProduct = { id: string; supplier: string; code: string; name: string | null; via: string };
export type SetaItem = { id: string; code: string; name: string | null; price_kurus: number | null; available: boolean | null; linked: number; products: SetaProduct[] };
type MatchingTab = "brands" | "candidates" | "same" | "dinamik" | "seta";
export type BrandLabel = { supplier: string; label: string; items: number; method: "auto" | "manual" };
/** The reviewed brand a new master brand most likely is under another spelling (db brand_merge_suggestions). */
export type BrandSuggestion = { id: string; name: string; shared_parts: number; parts: number; name_similarity: number };
/**
 * A master brand and the supplier labels deduplicated into it; `pending` while any label was placed automatically,
 * `fresh` while every label was (a brand created by a new label), with the existing brand it may belong to.
 */
type MasterBrand = { id: string; key: string; name: string; items: number; pending: boolean; fresh: boolean; suggestion: BrandSuggestion | null; labels: BrandLabel[];
  /** The logo the store shows for the brand (#819): the admin's, a static or an enrichment one; null when none or hidden. */
  logo: ManufacturerLogo | null; logoSource: BrandLogoSource | null;
  /** An automatic logo exists (shown again by "Otomatik logoya dön"). */
  automatic: boolean };
type BrandScope = "pending" | "single" | "all";
const brandScopes: BrandScope[] = ["pending", "single", "all"];
/** Markalar tab's logo filter (#819): brands the store shows no logo for, or those it does. */
export type BrandLogoFilter = "missing" | "present";
const logoFilters: BrandLogoFilter[] = ["missing", "present"];
export type CandidateReason = "prefix" | "leading_zero" | "suffix";
export const candidateReasons: Record<CandidateReason, string> = { prefix: "Kod ön eki farkı", leading_zero: "Baştaki sıfır farkı", suffix: "Son ek farkı" };
type CandidateSide = { id: string; brand_label: string; code: string; part_number: string; name: string | null; suppliers: string[]; price_kurus: number | null; available: boolean | null };
/** A Başbuğ-only (a) and a Dinamik-only product (b), or a Başbuğ/Dinamik product (a) and a manual-list-only one (b), that
 *  look the same; "Aynı ürün" merges b into a. */
export type Candidate = { reason: CandidateReason; name_similarity: number | null; name_conflict: boolean; shared_b: boolean; multi_a: boolean; suffix_bulk: boolean; brand: string; a: CandidateSide; b: CandidateSide;
  /** Review hints of a suffix candidate (#899); null for other reasons. Informational: no decision or bulk rule reads them. */
  hints: SuffixHints | null };
/** Candidates split by whether the two part names name the same kind of part (db product_names_conflict). */
export type CandidateNames = "consistent" | "conflict";
export const candidateNames: Record<CandidateNames, string> = { consistent: "Tanımı uyumlu", conflict: "Tanımı farklı" };

const pageSize = 25;
const pageOf = (value: string | undefined, total: number) => {
  const pages = Math.max(1, Math.ceil(total / pageSize)), parsed = Number(value);
  return { pages, page: Number.isSafeInteger(parsed) ? Math.min(pages, Math.max(1, parsed)) : 1 };
};
const tabs: MatchingTab[] = ["brands", "candidates", "same", "dinamik", "seta"];
// Per master brand: its labels, whether any is unconfirmed, and how many of Başbuğ/Dinamik sell it. A brand only one
// of them sells may be the other's under another spelling; SETA is a brand of its own.
const brandRows = `SELECT b.id::text,b.key,b.name,COALESCE(sum(sb.items),0)::int AS items,bool_or(sb.method='auto') AS pending,
   bool_and(sb.method='auto') AS fresh,
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
  const logo = logoFilters.includes(params.logo as BrandLogoFilter) ? params.logo as BrandLogoFilter : null;
  // A logo filter alone lists every brand, not only the pending ones.
  const scope = brandScopes.includes(params.scope as BrandScope) ? params.scope as BrandScope : logo || !brandCount.pending ? "all" : "pending";
  return { ...base, ...await masterBrands(scope, logo, params) };
}

/** What one brand's dialog needs, loaded when it opens: its labels and every master brand name (the move/merge inputs' suggestions). */
export async function brandDialogData(id: string) {
  const [labels, names] = await Promise.all([
    db.query<{ supplier: string; label: string; items: number; method: "auto" | "manual" }>(
      "SELECT supplier,label,items,method FROM supplier_brands WHERE brand_id=$1 ORDER BY supplier,items DESC,label", [id]),
    db.query<{ name: string }>("SELECT DISTINCT name FROM brands ORDER BY name"),
  ]);
  return { labels: labels.rows, names: names.rows.map(row => row.name) };
}

/**
 * Master brands the store shows a logo for (#819), by the store's own rule (resolveBrandLogos): the admin's logo, else a
 * static or enrichment logo of the brand's name or any of its labels. Only keys and sizes are read, never image bytes.
 */
export async function brandLogoIds(): Promise<string[]> {
  const brands = (await db.query<{ id: string; name: string; labels: string[] }>(`SELECT b.id::text,b.name,
    COALESCE(array_agg(sb.label ORDER BY sb.items DESC,sb.label) FILTER (WHERE sb.label IS NOT NULL),'{}') AS labels
    FROM brands b LEFT JOIN supplier_brands sb ON sb.brand_id=b.id GROUP BY b.id`)).rows;
  const logos = await resolveBrandLogos(brands);
  return brands.filter(brand => logos.get(brand.id)?.logo).map(brand => brand.id);
}

/** Master brands with their Başbuğ / Dinamik / SETA labels, largest first; `q` matches the name or any label. */
async function masterBrands(scope: BrandScope, logo: BrandLogoFilter | null, params: MatchingParams) {
  const q = compact(params.q);
  const withLogo = await brandLogoIds();
  const where = `${brandFilters[scope]} AND ($1='' OR regexp_replace(upper(name),'[^A-Z0-9]','','g') LIKE '%'||$1||'%'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(labels) l WHERE regexp_replace(upper(l->>'label'),'[^A-Z0-9]','','g') LIKE '%'||$1||'%'))
    AND CASE $2::text WHEN 'missing' THEN NOT (id=ANY($3::text[])) WHEN 'present' THEN id=ANY($3::text[]) ELSE true END`;
  const [count, missing] = await Promise.all([
    db.query<{ count: number }>(`SELECT count(*)::int FROM (${brandRows}) b WHERE ${where}`, [q, logo ?? "", withLogo]),
    // The filter option's count: the same scope and search, without a logo.
    db.query<{ count: number }>(`SELECT count(*)::int FROM (${brandRows}) b WHERE ${where}`, [q, "missing", withLogo]),
  ]);
  const total = count.rows[0].count;
  const { page, pages } = pageOf(params.page, total);
  // A suggestion only stands while the brand is still new; confirming it keeps the brand separate.
  const order = sortOrder(params, sorts.brands, "items DESC,name");
  const rows = (await db.query<Omit<MasterBrand, "logo" | "logoSource" | "automatic">>(`SELECT b.id,b.key,b.name,b.items,b.pending,b.fresh,b.labels,
    CASE WHEN b.fresh AND t.id IS NOT NULL THEN jsonb_build_object('id',t.id::text,'name',t.name,'shared_parts',s.shared_parts,
     'parts',s.parts,'name_similarity',s.name_similarity) END AS suggestion
    FROM (SELECT *,row_number() OVER (ORDER BY ${order}) AS position FROM (${brandRows}) b WHERE ${where}
     ORDER BY ${order} LIMIT ${pageSize} OFFSET $4) b
    LEFT JOIN brand_merge_suggestions s ON s.brand_id=b.id::bigint LEFT JOIN brands t ON t.id=s.target_id ORDER BY b.position`,
  [q, logo ?? "", withLogo, (page - 1) * pageSize])).rows;
  const logos = await resolveBrandLogos(rows.map(brand => ({ id: brand.id, name: brand.name,
    labels: [...brand.labels].sort((a, b) => b.items - a.items).map(label => label.label) })));
  const brands: MasterBrand[] = rows.map(brand => {
    const resolved = logos.get(brand.id);
    return { ...brand, logo: resolved?.logo ?? null, logoSource: resolved?.source ?? null, automatic: resolved?.automatic ?? false };
  });
  return { scope, logo, logoMissing: missing.rows[0].count, brands, total, page, pages };
}

// A group is a Başbuğ product that Dinamik also sells. The offer sold is the cheapest available one, the lower cost and
// then the Başbuğ row winning ties: the rule of withBestOffers (compareOffers). `filter` narrows the offers before grouping.
const sameGroups = (filter: string, columns: string) => `WITH offers AS MATERIALIZED (
    SELECT o.primary_id,c.id,c.supplier,c.code,c.name,c.price_kurus,c.available,c.stock_label,(c.pricing_snapshot->>'cost_kurus')::numeric AS cost_kurus
    FROM product_offers o JOIN commerce_catalog c ON c.id=o.item_id ${filter}
  )
  SELECT primary_id::text,
   (array_agg(supplier ORDER BY price_kurus,cost_kurus NULLS LAST,(id=primary_id) DESC,id) FILTER (WHERE available AND price_kurus IS NOT NULL))[1] AS selling,
   min(price_kurus) FILTER (WHERE available) AS selling_price, min(price_kurus) FILTER (WHERE id=primary_id) AS primary_price,${columns}
  FROM offers GROUP BY primary_id HAVING bool_or(supplier='basbug' AND id=primary_id) AND bool_or(supplier='dinamik')`;
type SameIndex = { entries: SameEntry[]; summary: Record<string, number> };
// Pricing every grouped offer takes ~2 s, so the groups (without their offers) are kept in this process for up to a
// minute. The key changes with the grouping (product_grouping_version, bumped by a trigger on every product_offers
// write from any process: db/product-matching.sql) and with each successful supplier import; actions in this process
// also clear it at once (forgetSameProducts). Past a minute the next request waits for a fresh read, so other price
// changes (markup/VAT settings, rows ageing out of freshness) show within 60 s. Admin-wide data, nothing per user.
const sameTtlMs = 60_000;
let sameCache: { key: string; at: number; index: Promise<SameIndex>; ready: SameIndex | null } | null = null;
export function forgetSameProducts() { sameCache = null; }
async function sameKey() {
  const imported = "(SELECT max(completed_at) FROM supplier_imports WHERE status='succeeded')";
  try {
    return (await db.query<{ key: string }>(`SELECT concat_ws('/',(SELECT version FROM product_grouping_version WHERE id=1),${imported}) AS key`)).rows[0].key;
  } catch (error) {
    // Before db:setup adds the counter (42P01), the latest matching run stands in for it.
    if ((error as { code?: string }).code !== "42P01") throw error;
    return (await db.query<{ key: string }>(`SELECT concat_ws('/','run',(SELECT max(id) FROM product_match_runs),${imported}) AS key`)).rows[0].key;
  }
}
async function sameIndex(key?: string) {
  key ??= await sameKey();
  if (sameCache && sameCache.key === key && Date.now() - sameCache.at <= sameTtlMs) return sameCache.index;
  const entry: NonNullable<typeof sameCache> = { key, at: Date.now(), index: loadSameIndex(), ready: null };
  sameCache = entry;
  // A failed read is not reused: the next request tries again.
  entry.index.then(index => { entry.ready = index; }, () => { if (sameCache === entry) sameCache = null; });
  return entry.index;
}
/**
 * The group counts when the index is already loaded and current; otherwise undefined at once, and the index starts
 * loading in the background for the next request (a cold read takes ~2 s, and every decision clears it).
 */
async function sameSummaryIfReady() {
  const key = await sameKey();
  if (sameCache?.ready && sameCache.key === key && Date.now() - sameCache.at <= sameTtlMs) return sameCache.ready.summary;
  sameIndex(key).catch(error => console.error("Background load of the matched groups failed", error));
  return undefined;
}
async function loadSameIndex(): Promise<SameIndex> {
  // `codes`: the offers' codes as the search compares them; `position`: the database's primary_id order, the last tie-break.
  // `manual` comes from its own query: ~8-30 ms (depending on buffer cache) next to the ~2.8 s index, which adding it to the grouping CTE would
  // change (a join per offer in the big query) without a shown-cheap plan.
  const [groups, manualGroups] = await Promise.all([db.query<Omit<SameEntry, "manual">>(sameGroups("", `
   string_agg(regexp_replace(upper(code),'[^A-Z0-9]','','g'),' ') AS codes,row_number() OVER (ORDER BY primary_id::text)::int AS position`)),
    db.query<{ primary_id: string }>(manualGroupsSql)]);
  const manualIds = new Set(manualGroups.rows.map(row => row.primary_id));
  const entries = groups.rows.map(row => ({ ...row, manual: manualIds.has(row.primary_id) }));
  const summary = { all: entries.length, dinamik: 0, basbug: 0, none: 0, manual: 0 };
  for (const entry of entries) {
    if (entry.manual) summary.manual++;
    if (entry.selling === "dinamik") summary.dinamik++;
    else if (entry.selling === "basbug") summary.basbug++;
    else if (entry.selling === null) summary.none++;
  }
  return { entries, summary };
}
/** Başbuğ products that Dinamik also sells, priced live through commerce_catalog; the page's offers are read fresh. */
async function sameProducts(params: MatchingParams) {
  const exclusions = (await db.query<{ count: number }>("SELECT count(*)::int FROM product_sources WHERE method='manual'")).rows[0].count;
  const scope = sameScope(params.scope);
  // The other views' counts stay on the scope selector while the cached groups are loaded; the list never waits for them.
  if (scope === "manual") {
    const [decided, summary] = await Promise.all([manualDecisions(params, exclusions), sameSummaryIfReady()]);
    return { ...decided, same: [] as SameProduct[], summary, scope, exclusions, linked: false };
  }
  const requested = Number(params.page), page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const linked = sameLinked(params.linked);
  const { entries, summary } = await sameIndex();
  const { total, listed } = pickSameProducts(entries, { scope, q: compact(params.q), linked, sort: params.sort, dir: params.dir, page, pageSize });
  const ids = listed.map(entry => entry.primary_id);
  const rows = ids.length ? (await db.query<SameProduct>(sameGroups("AND o.primary_id=ANY($1::uuid[]) AND c.id=ANY(ARRAY(SELECT item_id FROM product_offers WHERE primary_id=ANY($1::uuid[])))", `
   jsonb_agg(jsonb_build_object('id',id,'supplier',supplier,'code',code,'name',name,'price',price_kurus,'available',available,'stock_label',stock_label,'manual',${offerManualSql})
    ORDER BY (id=primary_id) DESC,supplier,code) AS offers`), [ids])).rows : [];
  const byId = new Map(rows.map(row => [row.primary_id, row]));
  const same = ids.flatMap(id => byId.get(id) ?? []);
  const { pages } = pageOf(String(page), total);
  return { same, summary, scope, total, page: Math.min(page, pages), pages, exclusions, linked };
}

/**
 * Every manual decision, newest first, paged. Each word of `q` must match the supplier code or the product's part
 * number (compacted), or the row's name, the product's brand or name (search_normalize): "FEBI 100261" finds FEBI's
 * 100261. `kind` (merge/split) narrows to one kind. `manualTotal` is the unfiltered count the caller already read.
 */
async function manualDecisions(params: MatchingParams, manualTotal: number) {
  const terms = manualSearchTerms(params.q);
  const kind = manualKind(params.kind);
  const values = [terms.map(term => term.code), terms.map(term => term.text), kind === null ? null : kind === "split"];
  const from = "product_sources x JOIN supplier_items i ON i.id=x.supplier_item_id JOIN products p ON p.id=x.product_id LEFT JOIN accounts a ON a.id=x.decided_by";
  const where = `x.method='manual' AND ${manualKindFilterSql("$3")} AND NOT EXISTS (SELECT 1 FROM unnest($1::text[],$2::text[]) t(code,text) WHERE NOT (
    t.code<>'' AND (regexp_replace(upper(i.code),'[^A-Z0-9]','','g') LIKE '%'||t.code||'%' OR p.part_number LIKE '%'||t.code||'%')
    OR t.text<>'' AND (search_normalize(concat_ws(' ',supplier_item_name(i.supplier,i.product_data),p.brand_label,p.name)) LIKE '%'||t.text||'%')))`;
  const total = terms.length || kind ? (await db.query<{ count: number }>(`SELECT count(*)::int FROM ${from} WHERE ${where}`, values)).rows[0].count : manualTotal;
  const { page, pages } = pageOf(params.page, total);
  const decisions = (await db.query<ManualDecision>(`SELECT i.id,i.supplier,i.code,supplier_item_name(i.supplier,i.product_data) AS name,x.linked_at AS decided_at,
      ${manualDeciderSql} AS decided_by_name,${manualKindSql} AS kind,p.id AS product_id,p.brand_label AS product_label,p.code AS product_code,p.name AS product_name
    FROM ${from} WHERE ${where}
    ORDER BY ${sortOrder(params, sorts.manual, "x.linked_at DESC,x.supplier_item_id")} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  return { decisions, total, page, pages };
}

/** Reviewable candidates the automatic key missed; most similar names first. `q` narrows to a brand or code. */
async function matchCandidates(params: MatchingParams) {
  const reason = params.scope && Object.hasOwn(candidateReasons, params.scope) ? params.scope as CandidateReason : null;
  const names = params.names && Object.hasOwn(candidateNames, params.names) ? params.names as CandidateNames : null;
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
      count(*) FILTER (WHERE ${bulkAcceptableSql})::int AS acceptable FROM ${from} WHERE ${where}`, values),
  ]);
  const { page, pages } = pageOf(params.page, total.rows[0].count);
  type Row = { reason: CandidateReason; name_similarity: number | null; name_conflict: boolean; shared_b: boolean; multi_a: boolean; suffix_bulk: boolean; brand: string; a: Omit<CandidateSide, "price_kurus" | "available">; b: Omit<CandidateSide, "price_kurus" | "available"> };
  const side = (alias: string) => `jsonb_build_object('id',${alias}.id,'brand_label',${alias}.brand_label,'code',${alias}.code,'part_number',${alias}.part_number,'name',${alias}.name,'suppliers',${alias}.suppliers)`;
  const rows = (await db.query<Row>(`SELECT c.reason,c.name_similarity,COALESCE(c.name_conflict,false) AS name_conflict,${sharedCandidateSql} AS shared_b,${multiNumberCandidateSql} AS multi_a,(c.reason='suffix' AND ${bulkAcceptableSql}) AS suffix_bulk,a.brand,${side("a")} AS a,${side("b")} AS b FROM ${from} WHERE ${where}
    ORDER BY ${sortOrder(params, sorts.candidates, "c.name_similarity DESC NULLS LAST,a.brand,a.part_number")} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, values)).rows;
  // Priced in one pass for the page (commerce_catalog per id is fast; per row in a subquery it is not). Each side is
  // a single-supplier product; its cheapest available row stands for it.
  const ids = rows.flatMap(row => [row.a.id, row.b.id]);
  const pricesQuery = () => db.query<{ product_id: string; price_kurus: number | null; available: boolean }>(`WITH s AS (
      SELECT product_id,supplier_item_id FROM product_sources WHERE product_id=ANY($1::uuid[]))
    SELECT DISTINCT ON (s.product_id) s.product_id,k.price_kurus,k.available FROM s
    JOIN commerce_catalog k ON k.id=s.supplier_item_id AND k.id=ANY(ARRAY(SELECT supplier_item_id FROM s))
    ORDER BY s.product_id,k.available DESC,k.price_kurus NULLS LAST`, [ids]);
  // Hints only for suffix rows: the buying cost in TRY of each side (like the #587 measurement), not the sale price.
  const suffixIds = rows.filter(row => row.reason === "suffix").flatMap(row => [row.a.id, row.b.id]);
  const [prices, costs] = await Promise.all([
    ids.length ? pricesQuery().then(result => result.rows) : [],
    suffixIds.length ? db.query<{ product_id: string; cost_try: string }>(productCostTrySql, [suffixIds]).then(result => result.rows) : [],
  ]);
  const costOf = new Map(costs.map(row => [row.product_id, Number(row.cost_try)]));
  const hinted = (row: Row): SuffixHints | null => row.reason !== "suffix" ? null : suffixHints(
    { partNumber: row.a.part_number, name: row.a.name, costTry: costOf.get(row.a.id) ?? null },
    { partNumber: row.b.part_number, name: row.b.name, costTry: costOf.get(row.b.id) ?? null });
  const priceOf = new Map(prices.map(row => [row.product_id, { price_kurus: row.price_kurus, available: row.available }]));
  const priced = (item: Row["a"]): CandidateSide => ({ ...item, ...(priceOf.get(item.id) ?? { price_kurus: null, available: null }) });
  const candidates: Candidate[] = rows.map(row => ({ ...row, a: priced(row.a), b: priced(row.b), hints: hinted(row) }));
  const byReason = Object.fromEntries(counts.rows.map(row => [row.reason, row.count])) as Partial<Record<CandidateReason, number>>;
  return { candidates, reason, names, byReason, byNames: nameCounts.rows[0], total: total.rows[0].count, acceptableTotal: total.rows[0].acceptable,
    bulkAllowed: reason !== null && isBulkReason(reason), bulkPartial: reason !== null && isPatternBulkReason(reason),
    page, pages, brandFilter: q };
}

/** Dinamik items the store lists on their own: not grouped under a Başbuğ product. */
// Admin prices every company's row, and `$1` is not the companies array here: the raw view, read by id array (#1168).
const allCatalogSql = "SELECT * FROM commerce_catalog";

async function dinamikOnly(params: MatchingParams) {
  const q = compact(params.q).toLowerCase();
  const values: unknown[] = q ? [dinamikCompany, q] : [dinamikCompany];
  const where = `i.supplier='dinamik' AND i.company=$1 AND NOT EXISTS (SELECT 1 FROM product_offers o WHERE o.item_id=i.id AND o.primary_id<>o.item_id)
    ${q ? "AND supplier_item_search_codes(i.code,i.product_data) LIKE '%'||$2||'%'" : ""}`;
  const total = (await db.query<{ count: number }>(`SELECT count(*)::int FROM commerce_supplier_items i WHERE ${where}`, values)).rows[0].count;
  const { page, pages } = pageOf(params.page, total);
  const order = sortOrder(params, sorts.dinamik, "i.changed_at DESC,i.id");
  // "Enriched" reads the materialized per-product states (db/enrichment-states.sql) instead of evaluating
  // product_enrichment_shared for the whole catalog (~1.5 s). Like /yonetim/urun-verileri, drain the state queue first so
  // the flag is current; an empty queue costs a few milliseconds. The flag is informational: if the sync fails, the
  // page reads the last synced states.
  try { await db.query("SELECT enrichment_product_states_sync()"); }
  catch (error) { console.error("enrichment_product_states_sync failed; Dinamik enriched flags may be stale", error); }
  // product_sources is keyed by the supplier row and the states by product: at most one row each.
  const items = (await db.query<DinamikItem>(`WITH i AS MATERIALIZED (SELECT i.* FROM commerce_supplier_items i WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}),
      c AS MATERIALIZED (${catalogRowsByIdsSql("ARRAY(SELECT id FROM i)", allCatalogSql)})
    SELECT i.id,ps.product_id,i.code,i.product_data->>'marka' AS brand,supplier_item_name('dinamik',i.product_data) AS name,
      c.price_kurus,c.available,COALESCE(st.enriched,false) AS enriched
    FROM i LEFT JOIN product_sources ps ON ps.supplier_item_id=i.id LEFT JOIN enrichment_product_states st ON st.product_id=ps.product_id
    LEFT JOIN c ON c.id=i.id ORDER BY ${order}`, values)).rows;
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
  // Priced after the page is cut: commerce_catalog per row before LIMIT walks every listed row (~3 s). Both branches read
  // the page's (or, sorted by price, every listed) ids in one id-array batch, not a per-row LATERAL (#1168).
  const order = sortOrder(params, sorts.seta, "linked DESC,s.code");
  const linked = "(SELECT count(DISTINCT COALESCE(o.primary_id,r.item_id))::int FROM product_seta_references r LEFT JOIN product_offers o ON o.item_id=r.item_id WHERE r.seta_item_id=s.id) AS linked";
  const columns = "s.id::text,s.code,supplier_item_name('seta',s.product_data) AS name,c.price_kurus,c.available,s.linked";
  const slice = `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const items = (await db.query<Omit<SetaItem, "products">>(params.sort === "price" ? `WITH listed AS MATERIALIZED (
      SELECT s.id,s.code,s.product_data,${linked} FROM supplier_items s WHERE ${where}
    ), c AS MATERIALIZED (SELECT id,price_kurus,available FROM commerce_catalog WHERE id=ANY(ARRAY(SELECT id FROM listed)))
    SELECT ${columns} FROM listed s LEFT JOIN c ON c.id=s.id ORDER BY ${order} ${slice}`
    : `WITH s AS MATERIALIZED (SELECT s.id,s.code,s.product_data,${linked} FROM supplier_items s WHERE ${where} ORDER BY ${order} ${slice}),
      c AS MATERIALIZED (${catalogRowsByIdsSql("ARRAY(SELECT id FROM s)", allCatalogSql)})
    SELECT ${columns} FROM s LEFT JOIN c ON c.id=s.id ORDER BY ${order}`, values)).rows;
  // Listings, not raw rows: a Dinamik offer grouped under a Başbuğ product shows as that product.
  const products = items.length ? (await db.query<SetaProduct & { seta_item_id: string }>(`SELECT * FROM (
      SELECT DISTINCT ON (r.seta_item_id,p.id) r.seta_item_id::text,p.id::text,p.supplier,p.code,supplier_item_name(p.supplier,p.product_data) AS name,
       CASE r.brand WHEN 'ORIJINAL' THEN 'OEM '||r.part_number ELSE r.brand||' '||r.part_number END AS via
      FROM product_seta_references r LEFT JOIN product_offers o ON o.item_id=r.item_id JOIN supplier_items p ON p.id=COALESCE(o.primary_id,r.item_id)
      WHERE r.seta_item_id=ANY($1::uuid[]) ORDER BY r.seta_item_id,p.id) x ORDER BY supplier,code`, [items.map(item => item.id)])).rows : [];
  return { seta: items.map(item => ({ ...item, products: products.filter(product => product.seta_item_id === item.id) })), scope, total, page, pages };
}
