/**
 * Live checkout refresh order (#711): independent suppliers run side by side, one supplier's scopes stay serial.
 * - Başbuğ: every import takes the single try-lock (20261001,1); a second scope started alongside would fail
 *   with "busy", so its scopes run one after another.
 * - SETA: own lock (20261001,4) and a single list, so it runs once next to the others.
 * - Dinamik: refreshes only the cart's own rows by id without an advisory lock.
 * Writes are filtered by supplier and staging tables are per connection, so the branches do not collide.
 */
export type CheckoutRefreshScope = { supplier: "basbug" | "seta" | "dinamik"; company: string; list_group: string; warehouse: string };
export type CheckoutRefreshers = {
  seta(): Promise<unknown>;
  basbug(scope: CheckoutRefreshScope): Promise<unknown>;
  dinamik(): Promise<unknown>;
};

export async function refreshSuppliersConcurrently(scopes: CheckoutRefreshScope[], run: CheckoutRefreshers): Promise<void> {
  const branches: { supplier: CheckoutRefreshScope["supplier"]; work: Promise<unknown> }[] = [];
  if (scopes.some(scope => scope.supplier === "seta")) branches.push({ supplier: "seta", work: run.seta() });
  const basbug = scopes.filter(scope => scope.supplier === "basbug");
  if (basbug.length) branches.push({ supplier: "basbug", work: (async () => { for (const scope of basbug) await run.basbug(scope); })() });
  if (scopes.some(scope => scope.supplier === "dinamik")) branches.push({ supplier: "dinamik", work: run.dinamik() });
  // Wait for every branch before failing: a retry while an import still holds its lock would only get "busy".
  const results = await Promise.allSettled(branches.map(branch => branch.work));
  const failures = results.flatMap((result, index) => result.status === "rejected" ? [{ supplier: branches[index].supplier, reason: result.reason as unknown }] : []);
  for (const { supplier, reason } of failures)
    console.error("Checkout supplier refresh failed", { supplier, reason: reason instanceof Error ? reason.message : reason });
  if (failures.length) throw failures[0].reason;
}
