import "server-only";
import { db } from "@/lib/db";

// /yonetim/yag-verileri: progress of the Trodo engine-oil collection (scripts/vehicle-oil-trodo.ts) and the oil data
// it stored, newest first, so the page can follow a running collection.

export type VehicleOilRow = {
  vehicle_type_id: string; full_name: string; volumes: string[]; viscosities: string[]; specifications: string[]; fetched_at: Date;
};
export type VehicleOilRun = { id: string; status: string; started_at: Date | null; finished_at: Date | null; failed: number };
export type VehicleOilSummary = {
  target: number; collected: number; withOil: number; withSpecifications: number;
  lastTen: number; lastHour: number; lastFetch: Date | null;
};
export type VehicleOilHost = { interval_ms: number; jitter_ms: number; blocked: boolean; challenge_since: Date | null; last_error: string | null };
export type VehicleOilsData = { summary: VehicleOilSummary; run: VehicleOilRun | null; host: VehicleOilHost | null; rows: VehicleOilRow[]; q: string };

export const VEHICLE_OILS_ROWS = 50;

export async function vehicleOilsData(params: Record<string, string | undefined>): Promise<VehicleOilsData> {
  const q = (params.q ?? "").trim().slice(0, 80);
  // Type number, or words of the brand/model/type name ("corsa d 1.4").
  const filter = /^\d{1,10}$/.test(q) ? "t.id=$1::int" : q ? `concat_ws(' ', b.display_name, m.name, t.name) ILIKE ALL ($1::text[])` : "true";
  const filterValue = /^\d{1,10}$/.test(q) ? q : q ? q.split(/\s+/).map(word => `%${word.replace(/[%_\\]/g, "\\$&")}%`) : null;
  const run = (await db.query<VehicleOilRun & { sample_size: number }>(`SELECT r.id, r.status, r.sample_size, r.started_at, r.finished_at,
      (SELECT count(*) FROM enrichment_source_requests q WHERE q.run_id=r.id AND q.status='failed')::int AS failed
    FROM enrichment_runs r WHERE r.kind='vehicle_oil' ORDER BY r.created_at DESC LIMIT 1`)).rows[0] ?? null;
  const [summary, host, rows] = await Promise.all([
    // The run's sample is what was left to collect when it started; types collected before that count towards the target too.
    db.query<VehicleOilSummary>(`SELECT count(*)::int AS collected,
        (count(*) FILTER (WHERE fetched_at < $1::timestamptz) + $2::int)::int AS target,
        count(*) FILTER (WHERE cardinality(viscosities) > 0)::int AS "withOil",
        count(*) FILTER (WHERE cardinality(specifications) > 0)::int AS "withSpecifications",
        count(*) FILTER (WHERE fetched_at > now() - interval '10 minutes')::int AS "lastTen",
        count(*) FILTER (WHERE fetched_at > now() - interval '1 hour')::int AS "lastHour", max(fetched_at) AS "lastFetch"
      FROM vehicle_type_trodo_oils`, [run?.started_at ?? null, run?.sample_size ?? 0]),
    db.query<VehicleOilHost>("SELECT interval_ms, jitter_ms, blocked, challenge_since, last_error FROM enrichment_source_hosts WHERE host='www.trodo.com'"),
    db.query<VehicleOilRow>(`SELECT t.id::text AS vehicle_type_id, concat_ws(' ', b.display_name, m.name, t.name) AS full_name,
        o.volumes, o.viscosities, o.specifications, o.fetched_at
      FROM vehicle_type_trodo_oils o JOIN vehicle_types t ON t.id=o.vehicle_type_id JOIN vehicle_models m ON m.id=t.model_id
      JOIN vehicle_brands b ON b.id=m.brand_id
      WHERE ${filter} ORDER BY o.fetched_at DESC, t.id DESC LIMIT ${VEHICLE_OILS_ROWS}`, filterValue === null ? [] : [filterValue]),
  ]);
  const totals = summary.rows[0];
  return {
    summary: { ...totals, target: Math.max(totals.target, totals.collected) },
    run: run && { id: run.id, status: run.status, started_at: run.started_at, finished_at: run.finished_at, failed: run.failed },
    host: host.rows[0] ?? null, rows: rows.rows, q,
  };
}
