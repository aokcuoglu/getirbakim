import { boundedQuery, db } from "@/lib/db";
import { supplierHealth, supplierHealthBody } from "@/modules/suppliers/health";
import { openPriceAnomaliesSql } from "@/modules/suppliers/price-anomalies";

export const dynamic = "force-dynamic";
// For an external uptime monitor: 503 when the scheduler stopped or any enabled group is stale/failing.
// Only aggregate status is exposed; group names, errors and prices stay in the admin screen.
// open_price_anomalies is informational (#1049): it never changes the status, and a failing count reads null.
// A blocked count must not delay the monitor's answer: null after 2 s. The race also covers the wait for a pool
// connection; the count's own 2 s server-side limit (#1377) stops it on the database too, instead of leaving it running.
async function boundedAnomalyCount() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); });
  const count = boundedQuery<{ count: number }>("health.openPriceAnomalies", openPriceAnomaliesSql, [], 2_000).then(result => result.rows[0].count);
  try { return await Promise.race([count.catch(() => null), timeout]); } finally { clearTimeout(timer); }
}

export async function GET() {
  try {
    const [health, openPriceAnomalies] = await Promise.all([supplierHealth(db), boundedAnomalyCount()]);
    const { status, body } = supplierHealthBody(health, openPriceAnomalies);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
