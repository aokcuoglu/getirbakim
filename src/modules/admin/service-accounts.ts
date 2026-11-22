import "server-only";
// Callers check the admin session (actions.ts); kept free of it so tests can run the query.
import { db } from "@/lib/db";

/**
 * Approves a waiting service application with its discount: a waiting service account, or an individual customer's
 * upgrade request (#1259), which turns the same account (its email, password, orders and sessions) into a service
 * account carrying the requested details. One statement, so the request and the role change land together.
 * False when there is nothing to approve.
 */
export async function approveServiceAccount(id: string, discount: number) {
  const { rows } = await db.query<{ n: number }>(`WITH req AS (DELETE FROM service_upgrade_requests WHERE account_id=$1 RETURNING *),
    upgraded AS (UPDATE accounts a SET role='service',approved=true,discount_percent=$2,name=req.service_name,contact_name=req.contact_name,
      phone=req.phone,city=req.city,applied_at=req.created_at FROM req WHERE a.id=req.account_id AND a.role='customer' AND a.approved RETURNING 1),
    waiting AS (UPDATE accounts SET approved=true,discount_percent=$2 WHERE id=$1 AND role='service' AND NOT approved RETURNING 1)
    SELECT ((SELECT count(*) FROM upgraded)+(SELECT count(*) FROM waiting))::int AS n`, [id, discount]);
  return rows[0].n > 0;
}

/** Rejects an individual customer's upgrade request (#1259); the account stays a customer. False if there was none. */
export async function rejectServiceUpgrade(id: string) {
  const result = await db.query("DELETE FROM service_upgrade_requests WHERE account_id=$1", [id]);
  return Boolean(result.rowCount);
}
