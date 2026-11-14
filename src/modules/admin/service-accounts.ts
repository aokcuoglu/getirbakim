import "server-only";
// Callers check the admin session (actions.ts); kept free of it so tests can run the query.
import { db } from "@/lib/db";

/** Approves a waiting service account with its discount; false if it is not a waiting service account. */
export async function approveServiceAccount(id: string, discount: number) {
  const result = await db.query("UPDATE accounts SET approved=true,discount_percent=$2 WHERE id=$1 AND role='service' AND NOT approved", [id, discount]);
  return Boolean(result.rowCount);
}
