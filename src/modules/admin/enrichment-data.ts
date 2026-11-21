import "server-only";
import { db } from "@/lib/db";
import { requireAdmin } from "@/modules/auth/session";
import { sortOrder } from "@/lib/table-sort";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, enrichmentStateMatch } from "@/modules/search/sql";
import { sourceHosts, summarizeSources, type PassPace, type SourceActivity, type SourceKey, type SourceRun } from "./enrichment-pace";
import type { PartialGap } from "../enrichment/partial-gaps";
import { blockedMediaSql, shownImageSql, uploadedImageSql } from "../store/product-image-sql";
import { priceOnlyStatsSql, type PriceOnlyStats } from "../enrichment/price-only-queue";

import { dashboardTab, enrichmentStatuses } from "./enrichment-labels";
export { enrichmentStatuses };
export type EnrichmentRow = {
  id: string; product_id: string; code: string; brand: string; name: string; oem: string; status: string; attempts: number;
  last_error: string | null; updated_at: Date; imported_at: Date | null; source_url: string | null;
  manufacturer: string | null; manufacturer_part_number: string | null; image_id: string | null;
  /** The store shows an image: an admin upload, or the automatic one unless hidden (#596). */
  image_shown: boolean; image_uploaded: boolean;
  match_type: string | null; reference: string | null; oem_count: number; vehicle_count: number; specification_count: number;
  /** The adapter's import note, read only for partial rows to explain what is missing. */
  source_method: string | null;
  /** Sources that already searched the product, data source included. */
  searched: SourceKey[];
};
/** The record tabs: every product is in exactly one (#388). "error" groups the access and processing failures. */
const recordTabs = ["complete", "partial", "review", "not_found", "error", "pending"] as const;
export type RecordTab = typeof recordTabs[number];
const errorStatuses = ["blocked", "failed"];
// Links from before #388: "enriched" (complete + partial) and "attention" (review + errors) overlapped the other tabs.
const legacyTabs: Record<string, RecordTab> = { enriched: "complete", attention: "review" };
const tabStatuses = (tab: RecordTab) => tab === "error" ? errorStatuses : [tab];
// Every product outside this set is pending; pending rows carry no payload, so the metrics only need these.
const attemptedStatuses = Object.keys(enrichmentStatuses).filter(status => status !== "pending");
const literal = (statuses: string[]) => statuses.map(status => `'${status}'`).join(",");

// Pace of the full catalog pass: 24-hour figures that change slowly, so one minute of reuse is invisible, and the
// linked-product count walks every fitment-bearing source through the coherence check (~100 ms+).
const pace = { at: 0, value: null as Promise<PassPace> | null, refreshing: false };
function passPace() {
  // A 10-minute window counts as active when Trodo answered at least once in it.
  const load = () => db.query<PassPace>(`SELECT
      (SELECT count(DISTINCT COALESCE(i.product_id,ps.product_id))::int FROM enrichment_run_items i
        LEFT JOIN product_sources ps ON ps.supplier_item_id=i.supplier_item_id
        JOIN products p ON p.id=COALESCE(i.product_id,ps.product_id) AND p.merged_into IS NULL
        WHERE i.finished_at>now()-interval '24 hours' AND i.status NOT IN ('queued','collecting','skipped')) AS finished_24h,
      (SELECT count(DISTINCT date_bin('10 minutes',created_at,'2026-01-01'))::int FROM enrichment_request_events
        WHERE host='www.trodo.com' AND created_at>now()-interval '24 hours') AS active_windows_24h,
      (SELECT count(DISTINCT ps.product_id)::int FROM (SELECT DISTINCT supplier_item_id FROM product_vehicle_fitments WHERE vehicle_type_id IS NOT NULL) f
        CROSS JOIN LATERAL (SELECT product_id FROM enrichment_current_sources ps WHERE ps.supplier_item_id=f.supplier_item_id OFFSET 0) ps) AS linked_products,
      (SELECT interval_ms FROM enrichment_source_hosts WHERE host='www.trodo.com') AS interval_ms,
      (SELECT challenge_since FROM enrichment_source_hosts WHERE host='www.trodo.com') AS challenge_since,
      (SELECT blocked FROM enrichment_source_hosts WHERE host='www.trodo.com') AS blocked,
      (SELECT count(*)::int FROM enrichment_source_attempts WHERE queue='pending' AND outcome='found' AND attempted_at>now()-interval '24 hours') AS fallback_pending_found_24h`).then(result => result.rows[0]);
  if (!pace.value) { pace.at = Date.now(); pace.value = load().catch(error => { pace.value = null; throw error; }); }
  else if (Date.now() - pace.at > 60_000 && !pace.refreshing) {
    pace.refreshing = true;
    load().then(value => { pace.value = Promise.resolve(value); pace.at = Date.now(); }).catch(() => {}).finally(() => { pace.refreshing = false; });
  }
  return pace.value;
}

export type PriceOnlyProgress = { published: number; brands: Omit<PriceOnlyStats, "found">[] };
// Dinamik price-list-only codes (#1075): one pass over the enabled brands' rows (~70k, under a second), reused for a
// minute like the pass pace. A database set up before #1075 has no brand table: the card is left out.
const priceOnly = { at: 0, value: null as Promise<PriceOnlyProgress | null> | null, refreshing: false };
function priceOnlyProgress() {
  const load = () => Promise.all([
    db.query<PriceOnlyStats>(priceOnlyStatsSql),
    db.query<{ count: number }>("SELECT count(*)::int AS count FROM storefront_price_only_items"),
  ]).then(([brands, published]): PriceOnlyProgress => ({
    published: published.rows[0].count,
    brands: brands.rows.map(({ label, total, searched, enriched, published, remaining }) => ({ label, total, searched, enriched, published, remaining })),
  })).catch((error: { code?: string }) => { if (error.code === "42P01") return null; throw error; });
  if (!priceOnly.value) { priceOnly.at = Date.now(); priceOnly.value = load().catch(error => { priceOnly.value = null; throw error; }); }
  else if (Date.now() - priceOnly.at > 60_000 && !priceOnly.refreshing) {
    priceOnly.refreshing = true;
    load().then(value => { priceOnly.value = Promise.resolve(value); priceOnly.at = Date.now(); }).catch(() => {}).finally(() => { priceOnly.refreshing = false; });
  }
  return priceOnly.value;
}

// The row's automatic image counts as shown unless an admin blocked it (#1136).
const automaticShown = `(j.image_id IS NOT NULL AND j.image_id NOT IN (${blockedMediaSql}))`;
const like = (value: string) => `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
// SQL twins of partialGaps() over the import note, for the partial tab's header filter and its counts.
const coveredBelow = (label: string) => `(SELECT m[1]::int < m[2]::int FROM regexp_match(g.source_method,'${label} (\\d+)/(\\d+)') m)`;
const gapConditions: Record<PartialGap, string> = {
  // No image the store shows (#596): an upload counts, a hidden automatic image does not.
  image: `NOT ${shownImageSql("j.product_id", automaticShown)}`,
  vehicles_not_collected: "g.source_method ~ 'vehicles not collected'",
  no_vehicles: "g.source_method ~ 'no vehicles listed' AND g.source_method !~ 'vehicles not collected'",
  unresolved_vehicles: `g.source_method !~ 'vehicles not collected' AND COALESCE(${coveredBelow("source IDs covered")},${coveredBelow("vehicle models")},false)`,
  invalid_rows: "g.source_method ~ 'invalid rows [1-9]'",
  failed_makes: "g.source_method ~ 'failed makes [1-9]'",
};
const gapJoin = " LEFT JOIN product_enrichments g ON g.supplier_item_id=j.supplier_item_id";
// The columns of one record row; `source` is a subquery of enrichment_product_states aliased j.
const rowQuery=(source:string)=>`SELECT COALESCE(j.supplier_item_id,j.product_id) AS id,j.product_id,COALESCE(j.supplier_code,j.part_number) AS code,COALESCE(j.supplier_brand,j.product_brand) AS brand,
    COALESCE(j.product_name,'') AS name,j.oem,j.status,j.attempts,j.last_error,j.updated_at,
    j.imported_at,j.source_url,j.manufacturer,j.manufacturer_part_number,j.image_id,
    ${shownImageSql("j.product_id",automaticShown)} AS image_shown,${uploadedImageSql("j.product_id")} AS image_uploaded,
    j.match_type,j.reference,j.oem_count,j.vehicle_count,j.specification_count,
    CASE WHEN j.status='partial' THEN (SELECT e.source_method FROM product_enrichments e WHERE e.supplier_item_id=j.supplier_item_id) END AS source_method,
    -- Trodo's searches are run items of the product; fallback searches are attempt rows of any of its supplier items.
    array_remove(ARRAY[CASE WHEN EXISTS(SELECT 1 FROM enrichment_run_items i WHERE (i.product_id=j.product_id OR i.supplier_item_id=j.supplier_item_id)
      AND i.status NOT IN ('queued','collecting','skipped')) THEN 'trodo' END],NULL)
     -- One ANY over the product's items keeps the attempts index usable; an OR of the two lookups did not.
     ||ARRAY(SELECT DISTINCT a.source FROM enrichment_source_attempts a
      WHERE a.supplier_item_id=ANY(ARRAY(SELECT ps.supplier_item_id FROM product_sources ps WHERE ps.product_id=j.product_id)||j.supplier_item_id) ORDER BY 1) AS searched
    FROM (${source}) j`;
/** One record row for the details dialog; the id is the row id of the list (the supplier item, or the product for pending rows). */
export async function enrichmentRow(id:string){
  const result=await db.query<EnrichmentRow>(rowQuery("SELECT j.* FROM enrichment_product_states j WHERE j.supplier_item_id=$1 OR (j.supplier_item_id IS NULL AND j.product_id=$1) LIMIT 1"),[id]);
  return result.rows[0]??null;
}
export async function enrichmentDashboard(query: { q?: string; status?: string; match?: string; source?: string; name?: string; code?: string; brand?: string; gap?: string; page?: string; sort?: string; dir?: string; tab?: string }) {
  await requireAdmin();
  const tab = dashboardTab(query.tab), records = tab === "records";
  const q = query.q?.trim().slice(0,120) || "";
  const text = (key: "name" | "code" | "brand") => query[key]?.trim().slice(0,120) || "";
  const name = text("name"), code = text("code"), brand = text("brand");
  const gap = query.gap && Object.hasOwn(gapConditions, query.gap) ? query.gap as PartialGap : "";
  const status: RecordTab = legacyTabs[query.status || ""] ?? ((recordTabs as readonly string[]).includes(query.status || "") ? query.status as RecordTab : "complete");
  const match = ["oem_reference","exact_part","cross_reference"].includes(query.match || "") ? query.match! : "all";
  // One row per master product, materialized from enrichment_product_catalog (db/enrichment-states.sql). Writers queue
  // the products they touch; draining the queue here keeps the table current at read time.
  await db.query("SELECT enrichment_product_states_sync()");
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (status === "error") conditions.push(`j.status IN (${literal(errorStatuses)})`);
  else { values.push(status); conditions.push(`j.status=$${values.length}`); }
  if (match !== "all") { values.push(match); conditions.push(`j.match_type=$${values.length}`); }
  const source = query.source && Object.hasOwn(sourceHosts, query.source) ? query.source as SourceKey : "";
  if (source) { values.push(sourceHosts[source]); conditions.push(`split_part(j.source_url,'/',3)=$${values.length}`); }
  // Header filters: typed text on the name and code, one brand chosen from the tab's list.
  if (name) { values.push(like(name)); conditions.push(`j.product_name ILIKE $${values.length}`); }
  if (code) { values.push(like(code)); conditions.push(`COALESCE(j.supplier_code,j.part_number) ILIKE $${values.length}`); }
  let joins = "";
  // Same engine as the storefront: words as prefixes, part/OEM numbers with any spacing.
  if (q) conditions.push(enrichmentStateMatch("j", parseSearchQuery(q), binder(values)));
  // The brand list is counted before the brand condition so another brand can still be chosen.
  // The search conditions hold subqueries with their own WHERE, so the gap join is placed by building the FROM, not by text replacement.
  const facetWhere = conditions.join(" AND "), facetFrom = `FROM enrichment_product_states j WHERE ${facetWhere}`, facetValues = [...values];
  if (brand) { values.push(brand); conditions.push(`COALESCE(j.supplier_brand,j.product_brand)=$${values.length}`); }
  if (gap) { joins += gapJoin; conditions.push(`(${gapConditions[gap]})`); }
  const from = `FROM enrichment_product_states j${joins} WHERE ${conditions.join(" AND ")}`;
  const [active, products, metrics, total, pilot, pass, activity, written, brands, gaps, run, priceOnlyCards] = await Promise.all([
    // `images` counts the enrichment's own images (what the collectors found), not what the store shows (#596).
    db.query<{status:string;count:number;enriched:number;oem_matches:number;direct_matches:number;images:number;oem_numbers:number;vehicles:number;latest:Date|null}>(`SELECT status,count(*)::int AS count,
      count(*) FILTER(WHERE enriched)::int AS enriched,
      count(*) FILTER(WHERE match_type='oem_reference')::int AS oem_matches,
      count(*) FILTER(WHERE match_type='exact_part')::int AS direct_matches,
      count(image_id)::int AS images,COALESCE(sum(vehicle_count),0)::int AS vehicles,COALESCE(sum(oem_count),0)::int AS oem_numbers,
      max(imported_at) AS latest FROM enrichment_product_states WHERE status IN (${literal(attemptedStatuses)}) GROUP BY status`),
    db.query<{count:number}>("SELECT count(*)::int AS count FROM products WHERE merged_into IS NULL"),
    records?Promise.resolve(null):db.query<{bytes:string}>("SELECT COALESCE(sum(size_bytes),0)::bigint AS bytes FROM product_media_objects"),
    records&&(q||match!=="all"||source||name||code||brand||gap)?db.query<{count:number}>(`SELECT count(*)::int AS count ${from}`,values):Promise.resolve(null),
    db.query<{id:string;status:string;sample_size:number;skipped:number;cache_hits:number;processed:number;complete:number;partial:number;review:number;not_found:number;failed:number;requests:number;rate_limits:number;last_response:Date|null}>(`SELECT r.id,r.status,r.sample_size-count(*) FILTER(WHERE i.status='skipped')::int AS sample_size,r.cache_hits,
      count(*) FILTER(WHERE i.status='skipped')::int AS skipped,
      count(*) FILTER(WHERE i.status NOT IN ('queued','collecting','skipped'))::int AS processed,
      count(*) FILTER(WHERE i.status='complete')::int AS complete,
      count(*) FILTER(WHERE i.status='partial')::int AS partial,
      count(*) FILTER(WHERE i.status='review')::int AS review,
      count(*) FILTER(WHERE i.status='not_found')::int AS not_found,
      count(*) FILTER(WHERE i.status='failed')::int AS failed,
      (SELECT count(*)::int FROM enrichment_request_events e WHERE e.run_id=r.id) AS requests,
      (SELECT count(*)::int FROM enrichment_request_events e WHERE e.run_id=r.id AND e.http_status=429) AS rate_limits,
      (SELECT max(created_at) FROM enrichment_request_events e WHERE e.run_id=r.id) AS last_response
      FROM (SELECT * FROM enrichment_runs WHERE kind='products' ORDER BY created_at DESC LIMIT 1) r
      JOIN enrichment_run_items i ON i.run_id=r.id GROUP BY r.id,r.status,r.sample_size,r.cache_hits`),
    passPace(),
    // Trodo's searches are its run items; the other sources' are their attempt rows.
    db.query<SourceActivity>(`SELECT 'trodo' AS source,
        count(*) FILTER(WHERE finished_at>now()-interval '24 hours')::int AS searched,
        count(*) FILTER(WHERE finished_at>now()-interval '24 hours' AND status IN ('complete','partial'))::int AS found,
        count(*) FILTER(WHERE finished_at>now()-interval '24 hours' AND status='failed')::int AS errors,
        count(*) FILTER(WHERE finished_at>now()-interval '1 hour')::int AS last_hour,
        -- A product with a long vehicle list takes many requests, so a finished request also counts as activity.
        GREATEST(max(finished_at),(SELECT max(finished_at) FROM enrichment_source_requests WHERE host='www.trodo.com' AND status='complete')) AS last,NULL AS last_outcome
      FROM enrichment_run_items WHERE status NOT IN ('queued','collecting','skipped')
      UNION ALL
      SELECT s.source,COALESCE(r.searched,0),COALESCE(r.found,0),COALESCE(r.errors,0),COALESCE(r.last_hour,0),l.attempted_at,l.outcome
      FROM (VALUES ('otoparcasan'),('spareto'),('parts2world')) s(source)
      LEFT JOIN LATERAL (SELECT attempted_at,outcome FROM enrichment_source_attempts a WHERE a.source=s.source ORDER BY attempted_at DESC LIMIT 1) l ON true
      LEFT JOIN LATERAL (SELECT count(*) FILTER(WHERE outcome<>'blocked')::int AS searched,count(*) FILTER(WHERE outcome='found')::int AS found,
        count(*) FILTER(WHERE outcome='error')::int AS errors,count(*) FILTER(WHERE outcome<>'blocked' AND attempted_at>now()-interval '1 hour')::int AS last_hour
        FROM enrichment_source_attempts a WHERE a.source=s.source AND attempted_at>now()-interval '24 hours') r ON true`),
    records?Promise.resolve(null):db.query<{host:string;count:number}>("SELECT split_part(source_url,'/',3) AS host,count(*)::int AS count FROM enrichment_product_states WHERE status IN ('complete','partial') GROUP BY 1"),
    !records?Promise.resolve(null):db.query<{value:string;label:string;count:number}>(`SELECT COALESCE(j.supplier_brand,j.product_brand) AS value,COALESCE(j.supplier_brand,j.product_brand) AS label,count(*)::int AS count
      ${facetFrom} AND COALESCE(j.supplier_brand,j.product_brand)<>'' GROUP BY 1 ORDER BY 3 DESC,1 LIMIT 1000`, facetValues),
    records&&status==="partial"?db.query<Record<PartialGap,number>>(`SELECT ${(Object.keys(gapConditions) as PartialGap[]).map(key=>`count(*) FILTER (WHERE ${gapConditions[key]})::int AS ${key}`).join(",")}
      FROM enrichment_product_states j${gapJoin} WHERE ${facetWhere}`, facetValues):Promise.resolve(null),
    // parts2world's latest queue run: products searched (any outcome but a block answer) since it started (#403). A
    // pending run also counts the price-list-only codes it searched (#1075).
    records?Promise.resolve(null):db.query<SourceRun>(`SELECT r.queue,r.total,r.started_at,r.finished_at,r.outcome,a.processed,a.errors,a.last FROM
      (SELECT * FROM enrichment_source_runs WHERE source='parts2world' ORDER BY started_at DESC LIMIT 1) r
      CROSS JOIN LATERAL (SELECT count(DISTINCT t.supplier_item_id) FILTER(WHERE t.outcome<>'blocked')::int AS processed,
        count(*) FILTER(WHERE t.outcome='error')::int AS errors,max(t.attempted_at) AS last FROM enrichment_source_attempts t
        WHERE t.source=r.source AND (t.queue=r.queue OR (r.queue='pending' AND t.queue='price_only'))
         AND t.attempted_at>=r.started_at AND (r.finished_at IS NULL OR t.attempted_at<=r.finished_at)) a`)
      .catch(() => ({ rows: [] as SourceRun[] })),
    records?Promise.resolve(null):priceOnlyProgress(),
  ]);
  const counts={rows:active.rows};
  const pending=products.rows[0].count-counts.rows.reduce((sum,row)=>sum+row.count,0);
  counts.rows.push({status:'pending',count:Math.max(0,pending),enriched:0,oem_matches:0,direct_matches:0,images:0,oem_numbers:0,vehicles:0,latest:null});
  const summary={enriched:0,oem_matches:0,direct_matches:0,images:0,oem_numbers:0,vehicles:0,latest:null as Date|null,bytes:metrics?metrics.rows[0].bytes:null as string|null};
  for(const row of counts.rows){
    for(const key of ['enriched','oem_matches','direct_matches','images','oem_numbers','vehicles'] as const)summary[key]+=row[key];
    if(row.latest&&(!summary.latest||row.latest>summary.latest))summary.latest=row.latest;
  }
  const totalCount=total?.rows[0].count??counts.rows.filter(row=>tabStatuses(status).includes(row.status)).reduce((sum,row)=>sum+row.count,0);
  const pageSize=25, pages=Math.max(1,Math.ceil(totalCount/pageSize));
  const requested=Number(query.page), page=Number.isSafeInteger(requested)?Math.max(1,Math.min(pages,requested)):1;
  // Both keys share a direction so either order is one walk of the (status, sorted_at, supplier_item_id) index; the
  // updated column keeps that shape in both directions (sortOrder's "DESC NULLS LAST" does not match a backward scan).
  const direction=query.sort==='updated'&&query.dir!=='desc'?'ASC':'DESC';
  const sortColumns={updated:"j.sorted_at",name:"j.product_name",brand:"COALESCE(j.supplier_brand,j.product_brand)",code:"COALESCE(j.supplier_code,j.part_number)",
    status:"j.status",source:"split_part(j.source_url,'/',3)",match:"j.match_type",oems:"j.oem_count",vehicles:"j.vehicle_count",specs:"j.specification_count"};
  const order=query.sort==='updated'?`j.sorted_at ${direction},j.supplier_item_id ${direction}`:sortOrder(query, sortColumns, `j.sorted_at DESC,j.supplier_item_id ${direction}`);
  // The page is cut first so the per-row subqueries run for its 25 rows only; in the outer SELECT they also ran for
  // every row OFFSET skipped (a deep pending page took minutes).
  const rows=records?await db.query<EnrichmentRow>(`${rowQuery(`SELECT j.* ${from} ORDER BY ${order} LIMIT ${pageSize} OFFSET $${values.length+1}`)} ORDER BY ${order}`,[...values,(page-1)*pageSize]):{rows:[] as EnrichmentRow[]};
  const sourceSummary=summarizeSources(activity.rows,Object.fromEntries((written?.rows??[]).map(row=>[row.host,row.count])),Boolean(pass.blocked)||pilot.rows[0]?.status==='blocked');
  return { tab, pass, pilot:pilot.rows[0]??null, run:run?.rows[0]??null, priceOnly:priceOnlyCards, sourceSummary, counts:counts.rows, metrics:summary, rows:rows.rows, brands:brands?.rows??[], gaps:gaps?.rows[0]??null,
    total:totalCount, page,pages,pageSize, filters:{q,status,match,source,name,code,brand,gap,sort:query.sort&&Object.hasOwn(sortColumns,query.sort)?query.sort:'',dir:query.dir==='desc'?'desc':''} };
}
