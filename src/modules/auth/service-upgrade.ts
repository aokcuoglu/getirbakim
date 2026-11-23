import "server-only";
import { db } from "@/lib/db";

/** The customer's open service-account request (#1259), or null when there is none. */
export async function serviceUpgradePending(accountId: string) {
  const { rows } = await db.query<{ service_name: string; created_at: Date }>(
    "SELECT service_name,created_at FROM service_upgrade_requests WHERE account_id=$1", [accountId]);
  return rows[0] ?? null;
}
