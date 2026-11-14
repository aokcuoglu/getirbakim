import assert from "node:assert/strict";
import test from "node:test";
import type { ClientBase } from "pg";
import { productMatchIntervalHours, refreshProductMatchesIfDue } from "../src/modules/suppliers/product-match-schedule";

// A fake client: answers the due check with `due` and the refresh with `stats` (or throws `fail`).
function client(due: boolean, stats: Record<string, number> = {}, fail?: Error & { code?: string }) {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const query = async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes("refresh_product_matches")) { if (fail) throw fail; return { rows: [{ stats }] }; }
    return { rows: [{ due }] };
  };
  return { calls, client: { query } as unknown as ClientBase };
}

test("the interval defaults to 6 hours, 0 turns the refresh off, and nonsense is rejected", () => {
  assert.equal(productMatchIntervalHours(undefined), 6);
  assert.equal(productMatchIntervalHours(""), 6);
  assert.equal(productMatchIntervalHours("0"), 0);
  assert.equal(productMatchIntervalHours("12"), 12);
  assert.throws(() => productMatchIntervalHours("-1"));
  assert.throws(() => productMatchIntervalHours("abc"));
});

test("off: nothing is queried", async () => {
  const fake = client(true);
  assert.deepEqual(await refreshProductMatchesIfDue(fake.client, 0), { productMatch: "off" });
  assert.equal(fake.calls.length, 0);
});

test("not due: the refresh does not run; the interval is passed to the check", async () => {
  const fake = client(false);
  assert.deepEqual(await refreshProductMatchesIfDue(fake.client, 6), { productMatch: "not_due" });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].values, [6]);
  assert.match(fake.calls[0].sql, /supplier_item_changes/);
});

test("due: the refresh runs and reports the brand review counts", async () => {
  const fake = client(true, { pending_brands: 3, new_brands: 2, brand_merge_suggestions: 1 });
  const result = await refreshProductMatchesIfDue(fake.client, 6);
  assert.equal(result.productMatch, "refreshed");
  assert.deepEqual(result.productMatch === "refreshed" && { ...result, seconds: 0 },
    { productMatch: "refreshed", seconds: 0, pendingBrands: 3, newBrands: 2, brandSuggestions: 1 });
  assert.equal(fake.calls.length, 2);
});

test("a failed refresh is reported with its code, not thrown", async () => {
  const fake = client(true, {}, Object.assign(new Error("canceling statement"), { code: "57014" }));
  assert.deepEqual(await refreshProductMatchesIfDue(fake.client, 6), { productMatch: "failed", code: "57014" });
});
