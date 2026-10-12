import "server-only";
import { db } from "@/lib/db";
import { sortOrder } from "@/lib/table-sort";
import { parseSearchQuery } from "@/modules/search/query";
import { binder, supplierItemMatch } from "@/modules/search/sql";
import type { PassPace } from "./enrichment-pace";

export const enrichmentStatuses: Record<string, string> = {
  complete: "Tamamlandı", partial: "Kısmi veri", review: "İnceleme gerekiyor", not_found: "Eşleşme bulunamadı",
  pending: "Bekliyor", blocked: "Erişim engellendi", failed: "Başarısız",
};
export type EnrichmentRow = {
  id: string; product_id: string; code: string; brand: string; name: string; oem: string; status: string; attempts: number;
  last_error: string | null; updated_at: Date; imported_at: Date | null; source_url: string | null;
  manufacturer: string | null; manufacturer_part_number: string | null; image_id: string | null;
  match_type: string | null; reference: string | null; oem_count: number; vehicle_count: number; specification_count: number;
};
// Outside this set every product is pending by definition: none of its supplier rows has an enrichment or a non-pending job.
// Identity drift (no source agrees with the master product any more) needs a full catalog scan, so it is cached.
const drift={at:0,ids:null as Promise<string[]>|null,refreshing:false};
function identityDrift() {
  // Grouped, not an anti-join: the planner expects one coherent source and picks a quadratic nested loop.
  const scan=()=>db.query<{id:string}>(`SELECT product_id AS id FROM enrichment_product_candidates GROUP BY product_id HAVING NOT bool_or(coherent)
    UNION ALL SELECT p.id FROM products p WHERE p.merged_into IS NULL AND NOT EXISTS(SELECT 1 FROM product_sources ps WHERE ps.product_id=p.id)`)
    .then(result=>result.rows.map(row=>row.id));
  if(!drift.ids){drift.at=Date.now();drift.ids=scan().catch(error=>{drift.ids=null;throw error;});}
  else if(Date.now()-drift.at>5*60_000&&!drift.refreshing){
    drift.refreshing=true;
    scan().then(ids=>{drift.ids=Promise.resolve(ids);drift.at=Date.now();}).catch(()=>{}).finally(()=>{drift.refreshing=false;});
  }
  return drift.ids;
}
// OFFSET 0 keeps each product a point lookup; inlined, the view is evaluated for the whole catalog.
const activeCatalog=(ids:string)=>`(SELECT c.* FROM (SELECT ps.product_id FROM product_sources ps WHERE ps.supplier_item_id IN
  (SELECT supplier_item_id FROM product_enrichment_jobs WHERE status<>'pending' UNION ALL SELECT supplier_item_id FROM product_enrichments)
  UNION SELECT unnest(${ids}::uuid[])) t(product_id)
  CROSS JOIN LATERAL (SELECT * FROM enrichment_product_catalog c WHERE c.product_id=t.product_id OFFSET 0) c)`;
export async function enrichmentDashboard(query: { q?: string; status?: string; match?: string; page?: string; sort?: string; dir?: string }) {
  const q = query.q?.trim().slice(0,120) || "";
  const status = query.status && (enrichmentStatuses[query.status] || query.status === "attention") ? query.status : "enriched";
  const match = ["oem_reference","exact_part"].includes(query.match || "") ? query.match! : "all";
  const drifted = await identityDrift();
  const values: unknown[] = [];
  const conditions: string[] = [];
  if (status === "enriched") conditions.push("j.payload IS NOT NULL");
  else if (status === "attention") conditions.push("j.status IN ('review','blocked','failed')");
  else { values.push(status); conditions.push(`j.status=$${values.length}`); }
  if (match !== "all") { values.push(match); conditions.push(`j.match_basis->>'type'=$${values.length}`); }
  if (q) {
    // Same engine as the storefront: words as prefixes, part/OEM numbers with any spacing.
    const parsed = parseSearchQuery(q), bind = binder(values);
    const enriched = parsed.compact.length >= 3 ? (() => {
      const key = bind(`%${parsed.compact}%`);
      return ` OR search_compact(COALESCE(j.manufacturer_part_number,'')) LIKE ${key}
      OR EXISTS(SELECT 1 FROM jsonb_each(COALESCE(j.payload->'oemNumbers','{}'::jsonb)) r,
        jsonb_array_elements_text(r.value) n WHERE search_compact(n) LIKE ${key})`;
    })() : "";
    conditions.push(`(${supplierItemMatch("s", parsed, bind)}${enriched})`);
  }
  // A payload only comes from product_enrichments, so start there and look each source up; over the whole view the
  // planner underestimates the coherence filter and re-runs the enrichment subplan per source row (never finishes).
  const catalog=status==='enriched'?`(SELECT DISTINCT ON (product_id) c.* FROM (SELECT supplier_item_id AS id FROM product_enrichments) t
    CROSS JOIN LATERAL (SELECT * FROM enrichment_product_candidates c WHERE c.supplier_item_id=t.id OFFSET 0) c
    WHERE coherent AND payload IS NOT NULL ORDER BY product_id,priority,present DESC,oem<>'' DESC,supplier_item_id=product_id DESC,supplier_item_id)`:status==='pending'?'enrichment_product_catalog':activeCatalog(`$${values.push(drifted)}`);
  const from = `FROM ${catalog} j ${q?"LEFT JOIN supplier_items s ON s.id=j.supplier_item_id":""} WHERE ${conditions.join(" AND ")}`;
  const [active, products, metrics, sources, total, pilot, pass] = await Promise.all([
    db.query<{status:string;count:number;enriched:number;oem_matches:number;direct_matches:number;images:number;oem_numbers:number;vehicles:number;latest:Date|null}>(`SELECT status,count(*)::int AS count,
      count(*) FILTER(WHERE payload IS NOT NULL)::int AS enriched,
      count(*) FILTER(WHERE match_basis->>'type'='oem_reference')::int AS oem_matches,
      count(*) FILTER(WHERE match_basis->>'type'='exact_part')::int AS direct_matches,
      count(image_id)::int AS images,COALESCE(sum(jsonb_array_length(payload->'vehicles')),0)::int AS vehicles,
      COALESCE(sum((SELECT sum(jsonb_array_length(value)) FROM jsonb_each(payload->'oemNumbers'))),0)::int AS oem_numbers,
      max(imported_at) AS latest FROM ${activeCatalog("$1")} j GROUP BY status`,[drifted]),
    db.query<{count:number}>("SELECT count(*)::int AS count FROM products WHERE merged_into IS NULL"),
    db.query<{bytes:string}>("SELECT COALESCE(sum(size_bytes),0)::bigint AS bytes FROM product_media_objects"),
    db.query<{host:string; status:string; http_status:number|null; checked_at:Date}>("SELECT host,status,http_status,checked_at FROM product_enrichment_sources ORDER BY host"),
    q||match!=="all"?db.query<{count:number}>(`SELECT count(*)::int AS count ${from}`,values):Promise.resolve(null),
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
      FROM (SELECT * FROM enrichment_runs ORDER BY created_at DESC LIMIT 1) r
      JOIN enrichment_run_items i ON i.run_id=r.id GROUP BY r.id,r.status,r.sample_size,r.cache_hits`),
    // Pace of the full catalog pass. A 10-minute window counts as active when Trodo answered at least once in it.
    db.query<PassPace>(`SELECT
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
      (SELECT blocked FROM enrichment_source_hosts WHERE host='www.trodo.com') AS blocked`),
  ]);
  const counts={rows:active.rows.filter(row=>row.status!=='pending')};
  const pending=products.rows[0].count-counts.rows.reduce((sum,row)=>sum+row.count,0);
  counts.rows.push({status:'pending',count:pending,enriched:0,oem_matches:0,direct_matches:0,images:0,oem_numbers:0,vehicles:0,latest:null});
  const summary={enriched:0,oem_matches:0,direct_matches:0,images:0,oem_numbers:0,vehicles:0,latest:null as Date|null,bytes:metrics.rows[0].bytes};
  for(const row of counts.rows){
    for(const key of ['enriched','oem_matches','direct_matches','images','oem_numbers','vehicles'] as const)summary[key]+=row[key];
    if(row.latest&&(!summary.latest||row.latest>summary.latest))summary.latest=row.latest;
  }
  const totalCount=total?.rows[0].count??(status==='enriched'?summary.enriched:counts.rows.filter(row=>status==='attention'?['review','blocked','failed'].includes(row.status):row.status===status).reduce((sum,row)=>sum+row.count,0));
  const pageSize=25, pages=Math.max(1,Math.ceil(totalCount/pageSize));
  const requested=Number(query.page), page=Number.isSafeInteger(requested)?Math.max(1,Math.min(pages,requested)):1;
  const rows=await db.query<EnrichmentRow>(`SELECT COALESCE(j.supplier_item_id,j.product_id) AS id,j.product_id,COALESCE(j.supplier_code,j.part_number) AS code,COALESCE(j.supplier_brand,j.product_brand) AS brand,
    COALESCE(j.product_name,'') AS name,j.oem,j.status,j.attempts,j.last_error,j.updated_at,
    j.imported_at,j.source_url,j.manufacturer,j.manufacturer_part_number,j.image_id,
    j.match_basis->>'type' AS match_type,j.match_basis->>'reference' AS reference,
    COALESCE((SELECT sum(jsonb_array_length(value)) FROM jsonb_each(j.payload->'oemNumbers')),0)::int AS oem_count,
    COALESCE(jsonb_array_length(j.payload->'vehicles'),0) AS vehicle_count,
    COALESCE(jsonb_array_length(j.payload->'specifications'),0) AS specification_count
    ${from} ORDER BY ${sortOrder(query, { updated: "COALESCE(j.imported_at,j.updated_at)" }, "COALESCE(j.imported_at,j.updated_at) DESC,j.supplier_item_id")}
    LIMIT ${pageSize} OFFSET $${values.length+1}`,[...values,(page-1)*pageSize]);
  return { pass:pass.rows[0], pilot:pilot.rows[0]??null, counts:counts.rows, metrics:summary, sources:sources.rows, rows:rows.rows,
    total:totalCount, page,pages,pageSize, filters:{q,status,match,sort:query.sort==='updated'?'updated':'',dir:query.dir==='desc'?'desc':''} };
}
