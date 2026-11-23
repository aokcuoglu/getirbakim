import { db } from "@/lib/db";
import { supplierHealth, supplierHealthBody } from "@/modules/suppliers/health";
import { openPriceAnomalyCount } from "@/modules/suppliers/price-anomalies";

export const dynamic = "force-dynamic";
// For an external uptime monitor: 503 when the scheduler stopped or any enabled group is stale/failing.
// Only aggregate status is exposed; group names, errors and prices stay in the admin screen.
// open_price_anomalies is informational (#1049): it never changes the status, and a failing count reads null.
// A blocked count must not delay the monitor's answer: null after 2 s.
async function boundedAnomalyCount() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000); });
  try { return await Promise.race([openPriceAnomalyCount(db).catch(() => null), timeout]); } finally { clearTimeout(timer); }
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
