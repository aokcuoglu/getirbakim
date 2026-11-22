import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";

/** A rate-limit key that never stores the address or email itself: `${prefix}:${kind}:${sha256 hex}`. */
export const attemptKey = (prefix: string, kind: string, value: string) => `${prefix}:${kind}:${createHash("sha256").update(value).digest("hex")}`;

/**
 * Spends one attempt on a key's hourly window and returns the attempts made in it. The table is shared with the service
 * application and the customer signup; the key's prefix keeps the budgets apart. Old rows go nightly (#1260).
 */
export async function spendAttempt(key: string) {
  const { rows } = await db.query<{ attempts: number }>(`INSERT INTO service_application_attempts AS a (key,attempts) VALUES ($1,1)
    ON CONFLICT (key) DO UPDATE SET
    attempts=CASE WHEN a.window_start<now()-interval '1 hour' THEN 1 ELSE a.attempts+1 END,
    window_start=CASE WHEN a.window_start<now()-interval '1 hour' THEN now() ELSE a.window_start END
    RETURNING attempts`, [key]);
  return rows[0].attempts;
}

/** Spends the budgets narrowest first and stops at the first refusal, so one client cannot use up the shared one. */
export async function withinBudgets(budgets: [string, number][]) {
  for (const [key, limit] of budgets) if (await spendAttempt(key) > limit) return false;
  return true;
}
