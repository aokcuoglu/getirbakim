import { setTimeout as sleep } from "node:timers/promises";
import type { Pool } from "pg";

/**
 * CHECK value lists a release widens on an existing table (#1050). Inside setup's schema transaction DROP + ADD CONSTRAINT
 * holds ACCESS EXCLUSIVE on the table until the whole schema commits, queueing every reader of it and of the views built
 * on it. scripts/setup.ts runs these first, each in its own short transaction, so the lock lasts only the swap itself.
 * The CREATE TABLE in the schema file carries the same list inline for a new database; a missing table is left to it.
 * `values` must match that inline CHECK exactly.
 */
export const constraintSwaps = [
  // db/commerce.sql, supplier_price_anomalies.kind (#1050).
  { table: "supplier_price_anomalies", name: "supplier_price_anomalies_kind_check", column: "kind", values: ["currency", "offer-outlier"] },
  // db/commerce.sql, commerce_order_emails.kind (#1036).
  { table: "commerce_order_emails", name: "commerce_order_emails_kind_check", column: "kind", values: ["confirmation", "shipped", "cancelled", "refunded"] },
  // db/schema.sql, accounts.role (#1254)
  { table: "accounts", name: "accounts_role_check", column: "role", values: ["admin", "service", "customer"] },
] as const;

// The validated constraint's quoted values, in order; empty when the table or the constraint is missing.
const currentValues = `SELECT to_regclass($1) IS NOT NULL AS exists, ARRAY(
  SELECT r.m[1] FROM pg_constraint k, regexp_matches(pg_get_constraintdef(k.oid),'''([^'']*)''','g') WITH ORDINALITY r(m,i)
  WHERE k.conrelid=to_regclass($1) AND k.conname=$2 AND k.convalidated ORDER BY r.i) AS "values"`;

/**
 * Replaces each `constraintSwaps` CHECK whose validated value list differs; returns the names replaced. Idempotent: a
 * matching list is left alone without taking any lock beyond the catalog read. A lock wait gives up after 5 s (55P03)
 * or deadlocks (40P01) and is retried, up to 3 times.
 */
export async function swapConstraints(pool: Pool, retryDelayMs = 5000) {
  const replaced: string[] = [];
  for (const swap of constraintSwaps) {
    for (let attempt = 1; ; attempt++) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout = '5s'");
        const { rows: [state] } = await client.query<{ exists: boolean; values: string[] }>(currentValues, [swap.table, swap.name]);
        if (!state.exists || state.values.join("\u0000") === swap.values.join("\u0000")) {
          await client.query("ROLLBACK");
          break;
        }
        // Identifiers and values are the constants above, not input.
        const list = swap.values.map(value => `'${value}'`).join(",");
        await client.query(`ALTER TABLE ${swap.table} DROP CONSTRAINT IF EXISTS ${swap.name},
          ADD CONSTRAINT ${swap.name} CHECK (${swap.column} IN (${list}))`);
        await client.query("COMMIT");
        replaced.push(swap.name);
        console.log(`Replaced constraint ${swap.name}.`);
        break;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        if (attempt >= 3 || (code !== "40P01" && code !== "55P03")) throw error;
        console.warn(`Constraint ${swap.name} attempt ${attempt} hit a lock conflict (${code}); retrying.`);
        await sleep(attempt * retryDelayMs);
      } finally {
        client.release();
      }
    }
  }
  return replaced;
}
