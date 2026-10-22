import "server-only";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, supplierItemMatch } from "@/modules/search/sql";
import { sourceHosts, summarizeSources, type PassPace, type SourceActivity, type SourceKey } from "./enrichment-pace";

export const enrichmentStatuses: Record<string, string> = {
  complete: "Tamamlandı", partial: "Kısmi veri", review: "İnceleme gerekiyor", not_found: "Eşleşme bulunamadı",
  pending: "Bekliyor", blocked: "Erişim engellendi", failed: "Başarısız",
};
export type EnrichmentRow = {
  id: string; product_id: string; code: string; brand: string; name: string; oem: string; status: string; attempts: number;
  last_error: string | null; updated_at: Date; imported_at: Date | null; source_url: string | null;
  manufacturer: string | null; manufacturer_part_number: string | null; image_id: string | null;
  match_type: string | null; reference: string | null; oem_count: number; vehicle_count: number; specification_count: number;
  /** The adapter's import note, read only for partial rows to explain what is missing. */
  source_method: string | null;
  /** Sources that already searched the product, data source included. */
  searched: SourceKey[];
};
const attentionStatuses = ["review", "blocked", "failed"];
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

const like = (value: string) => `%${value.replace(/[\\%_]/g, match => `\\${match}`)}%`;
export async function enrichmentDashboard(query: { q?: string; status?: string; match?: string; source?: string; name?: string; code?: string; brand?: string; page?: string; sort?: string; dir?: string }) {
  const q = query.q?.trim().slice(0,120) || "";
  const text = (key: "name" | "code" | "brand") => query[key]?.trim().slice(0,120) || "";
  const name = text("name"), code = text("code"), brand = text("brand");
  const status = query.status && (enrichmentStatuses[query.status] || query.status === "attention") ? query.status : "enriched";
  const match = ["oem_reference","exact_part","cross_reference"].includes(query.match || "") ? query.match! : "all";
  // One row per master product, materialized from enrichment_product_catalog (db/enrichment-states.sql). Writers queue
  // the products they touch; draining the queue here keeps the table current at read time.
  await db.query("SELECT enrichment_product_states_sync()");
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (status === "enriched") conditions.push("j.enriched");
  else if (status === "attention") conditions.push(`j.status IN (${literal(attentionStatuses)})`);
  else { values.push(status); conditions.push(`j.status=$${values.length}`); }
  if (match !== "all") { values.push(match); conditions.push(`j.match_type=$${values.length}`); }
  const source = query.source && query.source in sourceHosts ? query.source as SourceKey : "";
  if (source) { values.push(sourceHosts[source]); conditions.push(`split_part(j.source_url,'/',3)=$${values.length}`); }
  // Header filters: typed text on the name and code, one brand chosen from the tab's list.
  if (name) { values.push(like(name)); conditions.push(`j.product_name ILIKE $${values.length}`); }
  if (code) { values.push(like(code)); conditions.push(`COALESCE(j.supplier_code,j.part_number) ILIKE $${values.length}`); }
  let joins = "";
  if (q) {
    // Same engine as the storefront: words as prefixes, part/OEM numbers with any spacing.
    const parsed = parseSearchQuery(q), bind = binder(values);
    const enriched = parsed.compact.length >= 3 ? (() => {
      const key = bind(`%${parsed.compact}%`);
      return ` OR search_compact(COALESCE(j.manufacturer_part_number,'')) LIKE ${key}
      OR EXISTS(SELECT 1 FROM jsonb_each(COALESCE(e.payload->'oemNumbers','{}'::jsonb)) r,
        jsonb_array_elements_text(r.value) n WHERE search_compact(n) LIKE ${key})`;
    })() : "";
    conditions.push(`(${supplierItemMatch("s", parsed, bind)}${enriched})`);
    joins = " LEFT JOIN supplier_items s ON s.id=j.supplier_item_id LEFT JOIN product_enrichments e ON j.enriched AND e.supplier_item_id=j.supplier_item_id";
  }
  // The brand list is counted before the brand condition so another brand can still be chosen.
  const facetFrom = `FROM enrichment_product_states j${joins} WHERE ${conditions.join(" AND ")}`, facetValues = [...values];
  if (brand) { values.push(brand); conditions.push(`COALESCE(j.supplier_brand,j.product_brand)=$${values.length}`); }
  const from = `FROM enrichment_product_states j${joins} WHERE ${conditions.join(" AND ")}`;
  const [active, products, metrics, total, pilot, pass, activity, written, brands] = await Promise.all([
    db.query<{status:string;count:number;enriched:number;oem_matches:number;direct_matches:number;images:number;oem_numbers:number;vehicles:number;latest:Date|null}>(`SELECT status,count(*)::int AS count,
      count(*) FILTER(WHERE enriched)::int AS enriched,
      count(*) FILTER(WHERE match_type='oem_reference')::int AS oem_matches,
      count(*) FILTER(WHERE match_type='exact_part')::int AS direct_matches,
      count(image_id)::int AS images,COALESCE(sum(vehicle_count),0)::int AS vehicles,COALESCE(sum(oem_count),0)::int AS oem_numbers,
      max(imported_at) AS latest FROM enrichment_product_states WHERE status IN (${literal(attemptedStatuses)}) GROUP BY status`),
    db.query<{count:number}>("SELECT count(*)::int AS count FROM products WHERE merged_into IS NULL"),
    db.query<{bytes:string}>("SELECT COALESCE(sum(size_bytes),0)::bigint AS bytes FROM product_media_objects"),
    q||match!=="all"||source||name||code||brand?db.query<{count:number}>(`SELECT count(*)::int AS count ${from}`,values):Promise.resolve(null),
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
    // Trodo's searches are its run items; otoparcasan's and spareto's are their attempt rows.
    db.query<SourceActivity>(`SELECT 'trodo' AS source,
        count(*) FILTER(WHERE finished_at>now()-interval '24 hours')::int AS searched,
        count(*) FILTER(WHERE finished_at>now()-interval '24 hours' AND status IN ('complete','partial'))::int AS found,
        count(*) FILTER(WHERE finished_at>now()-interval '24 hours' AND status='failed')::int AS errors,
        max(finished_at) AS last,NULL AS last_outcome
      FROM enrichment_run_items WHERE status NOT IN ('queued','collecting','skipped')
      UNION ALL
      SELECT s.source,COALESCE(r.searched,0),COALESCE(r.found,0),COALESCE(r.errors,0),l.attempted_at,l.outcome
      FROM (VALUES ('otoparcasan'),('spareto')) s(source)
      LEFT JOIN LATERAL (SELECT attempted_at,outcome FROM enrichment_source_attempts a WHERE a.source=s.source ORDER BY attempted_at DESC LIMIT 1) l ON true
      LEFT JOIN LATERAL (SELECT count(*) FILTER(WHERE outcome<>'blocked')::int AS searched,count(*) FILTER(WHERE outcome='found')::int AS found,
        count(*) FILTER(WHERE outcome='error')::int AS errors FROM enrichment_source_attempts a WHERE a.source=s.source AND attempted_at>now()-interval '24 hours') r ON true`),
    db.query<{host:string;count:number}>("SELECT split_part(source_url,'/',3) AS host,count(*)::int AS count FROM enrichment_product_states WHERE status IN ('complete','partial') GROUP BY 1"),
    db.query<{value:string;label:string;count:number}>(`SELECT COALESCE(j.supplier_brand,j.product_brand) AS value,COALESCE(j.supplier_brand,j.product_brand) AS label,count(*)::int AS count
      ${facetFrom} AND COALESCE(j.supplier_brand,j.product_brand)<>'' GROUP BY 1 ORDER BY 3 DESC,1 LIMIT 1000`, facetValues),
  ]);
  const counts={rows:active.rows};
  const pending=products.rows[0].count-counts.rows.reduce((sum,row)=>sum+row.count,0);
  counts.rows.push({status:'pending',count:Math.max(0,pending),enriched:0,oem_matches:0,direct_matches:0,images:0,oem_numbers:0,vehicles:0,latest:null});
  const summary={enriched:0,oem_matches:0,direct_matches:0,images:0,oem_numbers:0,vehicles:0,latest:null as Date|null,bytes:metrics.rows[0].bytes};
  for(const row of counts.rows){
    for(const key of ['enriched','oem_matches','direct_matches','images','oem_numbers','vehicles'] as const)summary[key]+=row[key];
    if(row.latest&&(!summary.latest||row.latest>summary.latest))summary.latest=row.latest;
  }
  const totalCount=total?.rows[0].count??(status==='enriched'?summary.enriched:counts.rows.filter(row=>status==='attention'?attentionStatuses.includes(row.status):row.status===status).reduce((sum,row)=>sum+row.count,0));
  const pageSize=25, pages=Math.max(1,Math.ceil(totalCount/pageSize));
  const requested=Number(query.page), page=Number.isSafeInteger(requested)?Math.max(1,Math.min(pages,requested)):1;
  // Both keys share a direction so either order is one walk of the (status, sorted_at, supplier_item_id) index.
  const direction=query.sort==='updated'&&query.dir!=='desc'?'ASC':'DESC';
  const sortColumns={updated:"j.sorted_at",name:"j.product_name",brand:"COALESCE(j.supplier_brand,j.product_brand)",code:"COALESCE(j.supplier_code,j.part_number)",
    status:"j.status",source:"split_part(j.source_url,'/',3)",match:"j.match_type",oems:"j.oem_count",vehicles:"j.vehicle_count",specs:"j.specification_count"};
  const rows=await db.query<EnrichmentRow>(`SELECT COALESCE(j.supplier_item_id,j.product_id) AS id,j.product_id,COALESCE(j.supplier_code,j.part_number) AS code,COALESCE(j.supplier_brand,j.product_brand) AS brand,
    COALESCE(j.product_name,'') AS name,j.oem,j.status,j.attempts,j.last_error,j.updated_at,
    j.imported_at,j.source_url,j.manufacturer,j.manufacturer_part_number,j.image_id,
    j.match_type,j.reference,j.oem_count,j.vehicle_count,j.specification_count,
    CASE WHEN j.status='partial' THEN (SELECT e.source_method FROM product_enrichments e WHERE e.supplier_item_id=j.supplier_item_id) END AS source_method,
    -- Trodo's searches are run items of the product; fallback searches are attempt rows of any of its supplier items.
    array_remove(ARRAY[CASE WHEN EXISTS(SELECT 1 FROM enrichment_run_items i WHERE (i.product_id=j.product_id OR i.supplier_item_id=j.supplier_item_id)
      AND i.status NOT IN ('queued','collecting','skipped')) THEN 'trodo' END],NULL)
     ||ARRAY(SELECT DISTINCT a.source FROM enrichment_source_attempts a WHERE a.supplier_item_id=j.supplier_item_id
      OR a.supplier_item_id IN (SELECT ps.supplier_item_id FROM product_sources ps WHERE ps.product_id=j.product_id) ORDER BY 1) AS searched
    ${from} ORDER BY ${sortOrder(query, sortColumns, `j.sorted_at DESC,j.supplier_item_id ${direction}`)}
    LIMIT ${pageSize} OFFSET $${values.length+1}`,[...values,(page-1)*pageSize]);
  const sourceSummary=summarizeSources(activity.rows,Object.fromEntries(written.rows.map(row=>[row.host,row.count])),Boolean(pass.blocked)||pilot.rows[0]?.status==='blocked');
  return { pass, pilot:pilot.rows[0]??null, sourceSummary, counts:counts.rows, metrics:summary, rows:rows.rows, brands:brands.rows,
    total:totalCount, page,pages,pageSize, filters:{q,status,match,source,name,code,brand,sort:query.sort&&Object.hasOwn(sortColumns,query.sort)?query.sort:'',dir:query.dir==='desc'?'desc':''} };
}
