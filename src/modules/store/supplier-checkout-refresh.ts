/**
 * Live checkout refresh order (#711, #763): independent suppliers run side by side, each supplier once.
 * - Başbuğ: checks only the cart's own codes (MalzemeAra) without an advisory lock; per-code failures come back
 *   in its own result, so its branch only rejects on an unexpected error.
 * - SETA: own lock (20261001,4) and a single list, so it runs once next to the others.
 * - Dinamik: refreshes only the cart's own rows by id without an advisory lock.
 * Writes are filtered by supplier and staging tables are per connection, so the branches do not collide.
 * A failing branch never fails the checkout: the caller sells those lines on their saved data and marks them.
 */
export type CheckoutSupplier = "basbug" | "seta" | "dinamik";
export type CheckoutRefreshers = {
  seta(): Promise<unknown>;
  basbug(): Promise<unknown>;
  dinamik(): Promise<unknown>;
};

/** Runs the branches of the suppliers present in `items` and returns the ones that rejected, after all have settled. */
export async function refreshSuppliersConcurrently(items: { supplier: CheckoutSupplier }[], run: CheckoutRefreshers): Promise<{ supplier: CheckoutSupplier; reason: unknown }[]> {
  const suppliers = (["seta", "basbug", "dinamik"] as const).filter(supplier => items.some(item => item.supplier === supplier));
  const branches = suppliers.map(supplier => ({ supplier, work: run[supplier]() }));
  // Wait for every branch: a branch still running would otherwise write after the order was placed.
  const results = await Promise.allSettled(branches.map(branch => branch.work));
  const failures = results.flatMap((result, index) => result.status === "rejected" ? [{ supplier: branches[index].supplier, reason: result.reason as unknown }] : []);
  for (const { supplier, reason } of failures)
    console.error("Checkout supplier refresh failed", { supplier, reason: reason instanceof Error ? reason.message : reason });
  return failures;
}
