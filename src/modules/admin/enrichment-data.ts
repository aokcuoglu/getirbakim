import "server-only";
import { db } from "@/lib/db";

export const enrichmentStatuses: Record<string, string> = {
  complete: "Tamamlandı", partial: "Kısmi veri", review: "İnceleme gerekiyor", not_found: "Eşleşme bulunamadı",
  pending: "Bekliyor", blocked: "Erişim engellendi", failed: "Başarısız",
};
export type EnrichmentRow = {
  id: string; code: string; brand: string; name: string; oem: string; status: string; attempts: number;
  last_error: string | null; updated_at: Date; imported_at: Date | null; source_url: string | null;
  manufacturer: string | null; manufacturer_part_number: string | null; image_id: string | null;
  match_type: string | null; reference: string | null; oem_count: number; vehicle_count: number; specification_count: number;
};
export async function enrichmentDashboard(query: { q?: string; status?: string; match?: string; page?: string }) {
  const q = query.q?.trim().slice(0,120) || "";
  const status = query.status && (enrichmentStatuses[query.status] || query.status === "attention") ? query.status : "enriched";
  const match = ["oem_reference","exact_part"].includes(query.match || "") ? query.match! : "all";
  const values: string[] = [];
  const conditions: string[] = [];
  if (status === "enriched") conditions.push("e.supplier_item_id IS NOT NULL");
  else if (status === "attention") conditions.push("j.status IN ('review','blocked','failed')");
  else { values.push(status); conditions.push(`j.status=$${values.length}`); }
  if (match !== "all") { values.push(match); conditions.push(`e.match_basis->>'type'=$${values.length}`); }
  if (q) {
    values.push(`%${q.replace(/[\\%_]/g,"\\$&")}%`);
    const key = `$${values.length}`;
    conditions.push(`(j.supplier_code ILIKE ${key} OR j.supplier_brand ILIKE ${key} OR j.oem ILIKE ${key}
      OR s.product_data->>'ac' ILIKE ${key} OR e.manufacturer_part_number ILIKE ${key}
      OR EXISTS(SELECT 1 FROM jsonb_each(COALESCE(e.payload->'oemNumbers','{}'::jsonb)) r,
        jsonb_array_elements_text(r.value) n WHERE n ILIKE ${key}))`);
  }
  const from = `FROM product_enrichment_jobs j JOIN supplier_items s ON s.id=j.supplier_item_id
    LEFT JOIN product_enrichments e ON e.supplier_item_id=j.supplier_item_id WHERE ${conditions.join(" AND ")}`;
  const [counts, metrics, sources, total, pilot] = await Promise.all([
    db.query<{status:string; count:number}>("SELECT status,count(*)::int AS count FROM product_enrichment_jobs GROUP BY status"),
    db.query<{enriched:number; oem_matches:number; direct_matches:number; images:number; oem_numbers:number; vehicles:number; latest:Date|null; bytes:string}>(`SELECT count(*)::int AS enriched,
      count(*) FILTER(WHERE match_basis->>'type'='oem_reference')::int AS oem_matches,
      count(*) FILTER(WHERE match_basis->>'type'='exact_part')::int AS direct_matches,
      count(image_id)::int AS images,COALESCE(sum(jsonb_array_length(payload->'vehicles')),0)::int AS vehicles,
      COALESCE(sum((SELECT sum(jsonb_array_length(value)) FROM jsonb_each(payload->'oemNumbers'))),0)::int AS oem_numbers,
      max(imported_at) AS latest,(SELECT COALESCE(sum(size_bytes),0)::bigint FROM product_media_objects) AS bytes FROM product_enrichments`),
    db.query<{host:string; status:string; http_status:number|null; checked_at:Date}>("SELECT host,status,http_status,checked_at FROM product_enrichment_sources ORDER BY host"),
    db.query<{count:number}>(`SELECT count(*)::int AS count ${from}`,values),
    db.query<{id:string;status:string;sample_size:number;cache_hits:number;processed:number;complete:number;partial:number;review:number;not_found:number;failed:number;requests:number;rate_limits:number;last_response:Date|null}>(`SELECT r.id,r.status,r.sample_size,r.cache_hits,
      count(*) FILTER(WHERE i.status NOT IN ('queued','collecting'))::int AS processed,
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
  ]);
  const pageSize=25, pages=Math.max(1,Math.ceil(total.rows[0].count/pageSize));
  const requested=Number(query.page), page=Number.isSafeInteger(requested)?Math.max(1,Math.min(pages,requested)):1;
  const rows=await db.query<EnrichmentRow>(`SELECT j.supplier_item_id AS id,j.supplier_code AS code,j.supplier_brand AS brand,
    COALESCE(s.product_data->>'ac','') AS name,j.oem,j.status,j.attempts,j.last_error,j.updated_at,
    e.imported_at,e.source_url,e.manufacturer,e.manufacturer_part_number,e.image_id,
    e.match_basis->>'type' AS match_type,e.match_basis->>'reference' AS reference,
    COALESCE((SELECT sum(jsonb_array_length(value)) FROM jsonb_each(e.payload->'oemNumbers')),0)::int AS oem_count,
    COALESCE(jsonb_array_length(e.payload->'vehicles'),0) AS vehicle_count,
    COALESCE(jsonb_array_length(e.payload->'specifications'),0) AS specification_count
    ${from} ORDER BY COALESCE(e.imported_at,j.last_attempt_at,j.created_at) DESC,j.supplier_item_id
    LIMIT ${pageSize} OFFSET $${values.length+1}`,[...values,(page-1)*pageSize]);
  return { pilot:pilot.rows[0]??null, counts:counts.rows, metrics:metrics.rows[0], sources:sources.rows, rows:rows.rows,
    total:total.rows[0].count, page,pages,pageSize, filters:{q,status,match} };
}
