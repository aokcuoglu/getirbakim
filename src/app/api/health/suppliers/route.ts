import { db } from "@/lib/db";
import { supplierHealth } from "@/modules/suppliers/health";

export const dynamic = "force-dynamic";
// For an external uptime monitor: 503 when the scheduler stopped or any enabled group is stale/failing.
// Only aggregate status is exposed; group names, errors and prices stay in the admin screen.
export async function GET() {
  try {
    const health = await supplierHealth(db);
    const commerce = health.scopes.map(scope => scope.commerce_last_success_at?.getTime() ?? 0);
    return Response.json({
      status: health.healthy ? "ok" : "degraded",
      scheduler: health.heartbeat?.alive ? "alive" : "stopped",
      groups: health.scopes.length, issues: health.issues.length,
      oldest_commerce_success: commerce.length && Math.min(...commerce) ? new Date(Math.min(...commerce)).toISOString() : null,
    }, { status: health.healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
