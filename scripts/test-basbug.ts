import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { BasbugImportError, prepareBasbugImport } from "../src/modules/suppliers/basbug-import";
import { basbugItemClient, basbugLiveVerdict, prepareBasbugItemCheck, refreshBasbugItems } from "../src/modules/suppliers/basbug-item-refresh";
import { fallbackReason } from "../src/modules/suppliers/checkout-fallback";
import { basbugStockLabel, basbugWarehouseStock } from "../src/modules/suppliers/basbug-stock";

const product = { no: "TEST 001", ac: "Test", ac2: "", uk: "MARKA", oe: "60 607 218", lgk: "FIAT", m: "MODEL", mo: "", y: "07-", b: "ADET", dc: "EUR", lf: 4.05, mkk: "" };
const price = { no: product.no, nf: 3.01, mif: 3.27, k: 0 };
const stock = { no: product.no, stok: 1, sYol: 0, sDepo: "MRK", sFarkliDepo: 1 };

test("duplicates consolidate without converting source currency or stock into saleable values", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product, product] }, prices: { fiyatListesi: [price, price] }, stock: { stokListesi: [stock] } });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].product_count, 2);
  assert.equal(result.items[0].conflicting, false);
  assert.equal(result.items[0].product_data.dc, "EUR");
  assert.equal(result.items[0].product_data.oe, "60 607 218");
  assert.equal(result.items[0].stock_data?.stok, 1);
  assert.equal(result.quality.duplicateCodes, 1);
});

test("missing prices and stock remain absent, orphan records are counted", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [{ ...price, no: "OTHER" }] }, stock: { stokListesi: [] } });
  assert.equal(result.items[0].price_data, null);
  assert.equal(result.items[0].stock_data, null);
  assert.equal(result.quality.missingPrices, 1);
  assert.equal(result.quality.missingStocks, 1);
  assert.equal(result.quality.orphanPrices, 1);
});

test("conflicting duplicates are flagged rather than silently overwriting", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [price, { ...price, nf: 9 }] }, stock: { stokListesi: [stock] } });
  assert.equal(result.items[0].conflicting, true);
  assert.equal(result.items[0].price_data?.nf, 3.01);
  assert.equal(result.quality.conflictingCodes, 1);
  assert.equal(result.items[0].source_variants.prices?.length, 2);
});

test("JSON field order alone does not create a conflict", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product, Object.fromEntries(Object.entries(product).reverse())] }, prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } });
  assert.equal(result.quality.conflictingCodes, 0);
});

test("malformed or empty product responses cannot replace a successful snapshot", () => {
  for (const products of [{ malzemeListesi: [] }, { malzemeListesi: [{ ...product, no: "" }] }, { malzemeListesi: [{ ...product, lf: "4.05" }] }]) {
    assert.throws(() => prepareBasbugImport({ products, prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } }));
  }
});

test("warehouse stocks attach per-depot flags to the primary stock record", () => {
  const depot = (sDepo: string, stok: number) => ({ stokListesi: [{ ...stock, sDepo, stok }] });
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [price] }, stock: depot("MRK", 1),
    warehouseStocks: { MRK: depot("MRK", 1), IZM: depot("IZM", 0), IAN: { stokListesi: [{ ...stock, sDepo: "IAN" }, { ...stock, sDepo: "IAN", stok: 0 }] }, TRK: { stokListesi: [] } } });
  const item = result.items[0];
  assert.deepEqual(item.stock_data?.depolar, { MRK: { stok: 1, sYol: 0 }, IZM: { stok: 0, sYol: 0 }, IAN: { stok: 1, sYol: 0 } });
  assert.equal(item.stock_count, 1);
  assert.equal(item.conflicting, true);
  assert.equal(item.source_variants.warehouseStocks?.IAN.length, 2);
});

test("warehouse availability distinguishes absent data from zero and uses only the MRK legacy fallback", () => {
  assert.equal(basbugWarehouseStock(stock, "MRK"), 1);
  assert.equal(basbugWarehouseStock({ ...stock, sDepo: "IZM" }, "IZM"), null);
  assert.equal(basbugWarehouseStock(null, "MRK"), null);
  const data = { ...stock, depolar: { MRK: { stok: 0, sYol: 0 }, IZM: { stok: 3, sYol: 0 } } };
  assert.equal(basbugWarehouseStock(data, "MRK"), 0);
  assert.equal(basbugStockLabel(basbugWarehouseStock(data, "IZM")), "Stok var");
  assert.equal(basbugStockLabel(basbugWarehouseStock(data, "MRK")), "Stok yok");
  assert.equal(basbugStockLabel(basbugWarehouseStock(data, "KYS")), "Veri yok");
});

test("other depot data survives a missing MRK row without pretending the primary stock is known", () => {
  const result = prepareBasbugImport({ products: { malzemeListesi: [product] }, prices: { fiyatListesi: [price] }, stock: { stokListesi: [] },
    warehouseStocks: { IZM: { stokListesi: [{ ...stock, sDepo: "MRK,TRK", stok: 1 }] }, KYS: { stokListesi: [] } } });
  assert.equal(result.quality.missingStocks, 1);
  assert.equal(basbugWarehouseStock(result.items[0].stock_data, "MRK"), null);
  assert.equal(basbugWarehouseStock(result.items[0].stock_data, "IZM"), 1);
  assert.equal(basbugWarehouseStock(result.items[0].stock_data, "KYS"), null);
});

test("a repeated row that only fills an empty field merges instead of conflicting", () => {
  // FILT AP 026/5: the same product twice, ac2 empty in one row and "HAVA FILTRESI" in the other.
  const result = prepareBasbugImport({ products: { malzemeListesi: [{ ...product, ac2: "" }, { ...product, ac2: "HAVA FILTRESI" }] },
    prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } });
  assert.equal(result.items[0].conflicting, false);
  assert.equal((result.items[0].product_data as { ac2: string }).ac2, "HAVA FILTRESI");
  assert.equal(result.quality.conflictingCodes, 0);
  // Two different filled values still conflict, also after a merge.
  const clash = prepareBasbugImport({ products: { malzemeListesi: [{ ...product, ac2: "" }, { ...product, ac2: "HAVA FILTRESI" }, { ...product, ac2: "YAG FILTRESI" }] },
    prices: { fiyatListesi: [price] }, stock: { stokListesi: [stock] } });
  assert.equal(clash.items[0].conflicting, true);
  assert.equal((clash.items[0].source_variants.products as unknown[]).length, 3);
});

test("a MalzemeAra answer maps to the stored price fields and the MRK stock (#763)", () => {
  // The verified field set of one item (16 Nov 2026): numbers as JSON numbers, product fields alongside.
  const response = { no: "FILT AP 026/5", ac: "HAVA FILTRESI", uk: "MANN", dc: "EUR", nf: 62.92, mif: 68.5, k: 0, sMrk: 1, sIzm: 0, sAnk: 2, sAdn: 0, sErz: 0, sYol: 3 };
  // sYol is in transit, not a depot.
  assert.deepEqual(prepareBasbugItemCheck("FILT AP 026/5", response),
    { price: { no: "FILT AP 026/5", nf: 62.92, mif: 68.5, k: 0 }, depots: { MRK: 1, IZM: 0, ANK: 2, ADN: 0, ERZ: 0 } });
  // Another code in the answer, or a missing or textual depot stock, is a broken contract rather than a stock of zero.
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/6", response), (error: unknown) => error instanceof BasbugImportError && error.reason === "contract");
  const withoutStock: Record<string, unknown> = { ...response };
  delete withoutStock.sMrk;
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/5", withoutStock), (error: unknown) => fallbackReason(error) === "upstream" && error instanceof Error && error.name === "ZodError");
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/5", { ...response, sMrk: "1" }));
  const withoutDepot: Record<string, unknown> = { ...response };
  delete withoutDepot.sErz;
  assert.throws(() => prepareBasbugItemCheck("FILT AP 026/5", withoutDepot));
});

test("supplier errors map to order-line fallback reasons", () => {
  const timeout = new Error("timed out"); timeout.name = "TimeoutError";
  assert.equal(fallbackReason(timeout), "timeout");
  assert.equal(fallbackReason(new DOMException("timed out", "TimeoutError")), "timeout");
  for (const reason of ["busy", "paused", "config", "contract", "upstream"] as const)
    assert.equal(fallbackReason(new BasbugImportError(reason)), reason);
  // SETA and Dinamik errors carry the same `reason` field.
  assert.equal(fallbackReason({ reason: "busy" }), "busy");
  assert.equal(fallbackReason(new BasbugImportError("rejected")), "upstream");
  assert.equal(fallbackReason(new Error("socket hang up")), "upstream");
  assert.equal(fallbackReason("text"), "upstream");
});

// Per-code checkout check (#763) without a database: a fake pool answers the row lookup, fetch is mocked.
const env = { BASBUG_BASE_URL: "https://api.basbug.com.tr", BASBUG_USERNAME: "T", BASBUG_PASSWORD: "T", BASBUG_CLIENT_ID: "T", BASBUG_CLIENT_SECRET: "T" };
const unsetEnv = ["SUPPLIER_EGRESS_PROXY", "SUPPLIER_EGRESS_PROXY_FOR"];
const savedEnv = new Map([...Object.keys(env), ...unsetEnv].map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch, originalCwd = process.cwd();
let sandbox = "";
before(async () => {
  Object.assign(process.env, env);
  for (const key of unsetEnv) delete process.env[key];
  // Away from the operator's real pause marker (.local/basbug-paused).
  sandbox = await mkdtemp(join(tmpdir(), "getirbakim-basbug-"));
  process.chdir(sandbox);
});
after(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  await rm(sandbox, { recursive: true, force: true });
  for (const [key, value] of savedEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});

const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003",
  "00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005"];
/** Answers the row lookup only: any write would call connect(), which the read-only fake does not have unless given. */
function fakePool(connect?: () => Promise<unknown>) {
  return { query: async () => ({ rows: ids.map((id, index) => ({ id, code: `TEST ${index}`, company: "TEST", nf: 1, depolar: {} })) }), ...(connect ? { connect } : {}) } as unknown as Pool;
}
const item = (code: string) => ({ no: code, nf: 1, mif: 1, k: 0, sMrk: 1, sIzm: 0, sAnk: 0, sAdn: 0, sErz: 0 });

test("a spent budget fails every row as timeout without a request or a write", async () => {
  let requests = 0;
  const result = await refreshBasbugItems(fakePool(), ids, { budgetMs: 0, fetchItem: async () => { requests++; return Response.json({}); } });
  assert.equal(requests, 0);
  assert.deepEqual(Object.values(result.failed), ids.map(() => "timeout"));
  assert.equal(result.refreshed, 0);
});

test("a rejected login fails every row with the same reason after one attempt", async () => {
  const urls: string[] = [];
  globalThis.fetch = async input => { urls.push(String(input)); return new Response("no", { status: 403 }); };
  const result = await refreshBasbugItems(fakePool(), ids);
  assert.deepEqual(urls.map(url => new URL(url).pathname), ["/auth/Login"]);
  assert.deepEqual(Object.values(result.failed), ids.map(() => "upstream"));
});

test("a 401 renews the token once and retries the request", async () => {
  const calls: string[] = [];
  let logins = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/Login") { logins++; return Response.json({ token: `token-${logins}`, tokenTipi: "Bearer", tokenBitisSuresi: 300 }); }
    const bearer = new Headers(init?.headers).get("Authorization");
    calls.push(`${url.searchParams.get("MalzemeNo")}:${bearer}`);
    return bearer === "Bearer token-1" ? new Response("expired", { status: 401 }) : Response.json(item(url.searchParams.get("MalzemeNo")!));
  };
  const fetchItem = basbugItemClient();
  const response = await fetchItem("TEST", "TEST 0");
  assert.equal(response.status, 200);
  assert.equal(logins, 2);
  assert.deepEqual(calls, ["TEST 0:Bearer token-1", "TEST 0:Bearer token-2"]);
  assert.deepEqual(prepareBasbugItemCheck("TEST 0", await response.json()).depots.MRK, 1);
});

/** A write connection whose FOR UPDATE times out, as against rows a running import holds; records what was sent. */
function lockedClient() {
  const statements: string[] = [];
  const sent: string[] = [];
  const client = {
    query: async (sql: string) => {
      sent.push(sql);
      statements.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      if (sql.includes("FOR UPDATE")) throw Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" });
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return { client, statements, sent };
}

test("rows a running import keeps locked are marked busy, a 604 is still gone, and nothing is written", async () => {
  const { client, statements, sent } = lockedClient();
  const result = await refreshBasbugItems(fakePool(async () => client), ids, {
    fetchItem: async (_company, code) => code === "TEST 0" ? { status: 604, json: async () => null } : Response.json(item(code)),
  });
  assert.deepEqual(result.gone, [ids[0]]);
  assert.equal(ids[0] in result.failed, false);
  assert.deepEqual(result.failed, Object.fromEntries(ids.slice(1).map(id => [id, "busy"])));
  assert.deepEqual([result.soldOut, result.repriced], [[], []]);
  assert.equal(result.refreshed, 0);
  assert.equal(result.changed, 0);
  assert.deepEqual(statements, ["BEGIN", "SET LOCAL", "SELECT id", "ROLLBACK"]);
  // Below Postgres' default deadlock_timeout (1 s): in a two-party wait the checkout gives up before the deadlock check.
  const timeout = sent.find(sql => sql.startsWith("SET LOCAL"))?.match(/^SET LOCAL lock_timeout = '(\d+)ms'$/);
  assert.ok(timeout, "lock_timeout is set in milliseconds");
  assert.ok(Number(timeout[1]) < 1000);
});

test("a live answer that cannot be saved still refuses a sold-out or repriced line (#788)", async () => {
  const { client, statements } = lockedClient();
  const result = await refreshBasbugItems(fakePool(async () => client), ids, {
    fetchItem: async (_company, code) => Response.json(code === "TEST 1" ? { ...item(code), sMrk: 0 } : code === "TEST 2" ? { ...item(code), nf: 2 } : item(code)),
  });
  assert.deepEqual(result.soldOut, [ids[1]]);
  assert.deepEqual(result.repriced, [ids[2]]);
  assert.deepEqual(result.gone, []);
  assert.deepEqual(result.failed, Object.fromEntries([ids[0], ids[3], ids[4]].map(id => [id, "busy"])));
  assert.deepEqual(statements, ["BEGIN", "SET LOCAL", "SELECT id", "ROLLBACK"]);
});

test("the live verdict merges depots as the write does: any depot with stock is available, sYol is not", () => {
  const zero = { MRK: 0, IZM: 0, ANK: 0, ADN: 0, ERZ: 0 };
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: {} }, { nf: 1, depots: zero }), "sold_out");
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: { MRK: { stok: 0 } } }, { nf: 1, depots: zero }), "sold_out");
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: { MRK: { stok: 0, sYol: 4 } as { stok: number } } }, { nf: 1, depots: zero }), "sold_out");
  // KYS is a StokGetir depot MalzemeAra does not return: its saved stock still counts.
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: { KYS: { stok: 7 } } }, { nf: 1, depots: zero }), "same");
  // A live depot replaces its saved stock.
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: { IZM: { stok: 5 } } }, { nf: 1, depots: zero }), "sold_out");
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: { MRK: { stok: 3 } } }, { nf: 1, depots: { ...zero, MRK: 3 } }), "same");
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: {} }, { nf: 1.5, depots: { ...zero, ERZ: 2 } }), "repriced");
  assert.equal(basbugLiveVerdict({ nf: null, depolar: {} }, { nf: 1, depots: { ...zero, MRK: 1 } }), "repriced");
  // Sold out wins over a new price: the order refuses the line as unavailable.
  assert.equal(basbugLiveVerdict({ nf: 1, depolar: {} }, { nf: 2, depots: zero }), "sold_out");
});

test("codes the supplier no longer knows stay gone when their zeroed stock cannot be saved", async () => {
  const { client, statements } = lockedClient();
  const result = await refreshBasbugItems(fakePool(async () => client), ids, { fetchItem: async () => ({ status: 604, json: async () => null }) });
  assert.deepEqual(result.gone, ids);
  assert.deepEqual(result.failed, {});
  assert.equal(result.refreshed, 0);
  assert.deepEqual(statements, ["BEGIN", "SET LOCAL", "SELECT id", "ROLLBACK"]);
});
