import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { DinamikImportError, discoverDinamikBrands, importDinamik, prepareDinamikImport, refreshDinamikItems, type DinamikFetch } from "../src/modules/suppliers/dinamik-import";

// Shapes copied from live getStockList / getPriceList responses (FEBI, 2026-10-11).
const stockRow = (code: string, fiyat = 106.09, varyok1 = "YOK") => ({ $type: "customer", varyok1, varyok2: "YOK", varyok3: "YOK", varyok4: "VAR", kaporta: "YOK", varyokAll: "VAR",
  stokKodu: code, stokAdi: "EGZOZ ASKI LASTIGI", ingilizceAdi: null, marka: "FEBI", kull1s: "PSA", kull3s: "FEBI", kull7s: "KAUCUK-TAKOZ-HORTUM", kull8s: "EGZOZ ASKI LASTIGI",
  resimUrl: "", oemListe: "", esdegerListe: "", fiyat, barkod1: "", barkod2: "", barkod3: "", kampanyaOrani: 0, paketMiktari: 1, koliMiktari: 1, olcuBirimi: "AD", desi: 0.02 });
const priceRow = (code: string, fiyat: number | null = 106.09) => ({ marka: "FEBI", stokKodu: code, fiyat });

test("stock and price lists merge per code without inventing missing data", () => {
  const { items, quality } = prepareDinamikImport({ brand: "FEBI",
    stock: [stockRow("FEBI 1"), stockRow("FEBI 3", 50)],
    prices: [priceRow("FEBI 1"), priceRow("FEBI 2", 9.5), priceRow("FEBI 3", 51), priceRow("FEBI 4", null)] });
  const byCode = Object.fromEntries(items.map(item => [item.code, item]));
  assert.deepEqual(Object.keys(byCode), ["FEBI 1", "FEBI 2", "FEBI 3", "FEBI 4"]);
  // Product fields stay in product_data, availability flags in stock_data, prices in price_data.
  assert.equal(byCode["FEBI 1"].product_data.stokAdi, "EGZOZ ASKI LASTIGI");
  assert.ok(!("fiyat" in byCode["FEBI 1"].product_data) && !("varyok1" in byCode["FEBI 1"].product_data) && !("$type" in byCode["FEBI 1"].product_data));
  assert.deepEqual(byCode["FEBI 1"].stock_data, { varyok1: "YOK", varyok2: "YOK", varyok3: "YOK", varyok4: "VAR", varyokAll: "VAR", kaporta: "YOK", stok: 1 });
  assert.deepEqual(byCode["FEBI 1"].price_data, { marka: "FEBI", stokKodu: "FEBI 1", fiyat: 106.09, kampanyaOrani: 0, nf: 106.09 });
  // Başbuğ-shaped fields the storefront, search and checkout read (see dinamikStorefrontFields).
  assert.deepEqual(Object.fromEntries(["no", "ac", "ac2", "uk", "oe", "dc"].map(key => [key, byCode["FEBI 1"].product_data[key]])),
    { no: "FEBI 1", ac: "EGZOZ ASKI LASTIGI", ac2: "", uk: "FEBI", oe: "", dc: "TRY" });
  // Price-list-only code: minimal product, unknown stock.
  assert.deepEqual(byCode["FEBI 2"].product_data, { stokKodu: "FEBI 2", marka: "FEBI" });
  assert.equal(byCode["FEBI 2"].stock_data, null);
  assert.equal(byCode["FEBI 2"].price_data?.nf, 9.5);
  // No price → no cost: the storefront hides the price instead of selling at zero.
  assert.ok(!("nf" in byCode["FEBI 4"].price_data!));
  // The two lists disagree on the price: kept visible as a conflict, not resolved.
  assert.equal(byCode["FEBI 3"].conflicting, true);
  assert.equal(byCode["FEBI 3"].source_variants.stockListPrice, 50);
  assert.equal(quality.missingPrices, 1);
  assert.equal(quality.missingStocks, 2);
  assert.equal(quality.available, 2);
});

test("stok is 1 only when some regional flag says VAR", () => {
  const { items } = prepareDinamikImport({ brand: "FEBI", stock: [{ ...stockRow("FEBI 1"), varyok4: "YOK", varyokAll: "YOK" }, { ...stockRow("FEBI 2"), varyok4: "YOK", varyokAll: "VAR" }], prices: [] });
  assert.deepEqual(items.map(item => item.stock_data?.stok), [0, 1]);
});

test("repeated and contradicting rows are counted and preserved", () => {
  const { items, quality } = prepareDinamikImport({ brand: "FEBI",
    stock: [stockRow("FEBI 1"), stockRow("FEBI 1")], prices: [priceRow("FEBI 1"), priceRow("FEBI 1 "), priceRow("FEBI 1", 120)] });
  assert.equal(items.length, 1);
  assert.equal(items[0].price_count, 3);
  assert.equal(items[0].stock_count, 2);
  assert.equal(items[0].conflicting, true);
  assert.equal((items[0].source_variants.prices as unknown[]).length, 3);
  assert.ok(!("stocks" in items[0].source_variants), "identical repeats are not conflicts");
  assert.equal(quality.duplicateCodes, 1);
});

test("unexpected response shapes are refused", () => {
  assert.throws(() => prepareDinamikImport({ brand: "FEBI", stock: { error: "x" }, prices: [] }));
  assert.throws(() => prepareDinamikImport({ brand: "FEBI", stock: [], prices: [{ marka: "FEBI", fiyat: 1 }] }));
  assert.throws(() => prepareDinamikImport({ brand: "FEBI", stock: [], prices: [priceRow("FEBI 1", "1,5" as unknown as number)] }));
});

test("PostgreSQL: discovery, import lifecycle, empty brands and anomaly rejection", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL });
  const namespace = `dinamik_test_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${namespace}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace}` });
  let lists: Record<string, { stock: unknown; prices: unknown }> = {};
  let brands = ["FEBI", "SCHADEK", "EMPTY"];
  const fake: DinamikFetch = async path => {
    if (path === "getBrandList") return brands.map(brand => ({ brand }));
    const [kind, brand] = path.split("/");
    const list = lists[decodeURIComponent(brand)] ?? { stock: [], prices: [] };
    if (kind === "getStockList") return list.stock;
    if (kind === "getPriceList") return list.prices;
    throw new Error(`unexpected ${path}`);
  };
  try {
    await pool.query(await readFile("db/schema.sql", "utf8"));
    const discovery = await discoverDinamikBrands(pool, fake);
    assert.deepEqual(discovery.added.sort(), ["EMPTY", "FEBI", "SCHADEK"]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_sync_scopes WHERE supplier='dinamik' AND enabled AND warehouse='ALL'")).rows[0].n, 3);

    lists = { FEBI: { stock: [stockRow("FEBI 1")], prices: Array.from({ length: 10 }, (_, i) => priceRow(`FEBI ${i + 1}`)) }, SCHADEK: { stock: [], prices: [priceRow("SCHADEK 1")] } };
    const first = await importDinamik(pool, { brand: "FEBI" }, fake);
    assert.equal(first.stats.added, 10);
    assert.equal((await importDinamik(pool, { brand: "FEBI" }, fake)).stats.unchanged, 10);
    assert.equal((await importDinamik(pool, { brand: "SCHADEK" }, fake)).stats.added, 1);
    // A brand that never listed anything succeeds without rows.
    assert.equal((await importDinamik(pool, { brand: "EMPTY" }, fake)).uniqueProducts, 0);

    // Price change → one change event; disappearance → pending_missing, then inactive.
    lists.FEBI.prices = Array.from({ length: 9 }, (_, i) => priceRow(`FEBI ${i + 1}`, i === 0 ? 200 : 106.09));
    const changed = await importDinamik(pool, { brand: "FEBI" }, fake);
    assert.equal(changed.stats.changed, 1); assert.equal(changed.stats.missing, 1);
    assert.equal((await pool.query("SELECT presence FROM supplier_items WHERE code='FEBI 10'")).rows[0].presence, "pending_missing");

    // A brand that suddenly lists nothing is rejected and its rows stay untouched.
    lists.FEBI = { stock: [], prices: [] };
    await assert.rejects(importDinamik(pool, { brand: "FEBI" }, fake), (error: unknown) => error instanceof DinamikImportError && error.reason === "rejected");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_items WHERE list_group='FEBI' AND presence='present'")).rows[0].n, 9);
    const scope = (await pool.query("SELECT consecutive_failures,next_run_at>now() AS backoff FROM supplier_sync_scopes WHERE list_group='FEBI'")).rows[0];
    assert.equal(scope.consecutive_failures, 1); assert.equal(scope.backoff, true);

    // Upstream failure: run recorded as failed without the error body.
    const broken: DinamikFetch = async () => { throw new DinamikImportError("upstream", "getStockList HTTP 500"); };
    await assert.rejects(importDinamik(pool, { brand: "SCHADEK" }, broken), (error: unknown) => error instanceof DinamikImportError && error.reason === "upstream");
    assert.equal((await pool.query("SELECT error_reason FROM supplier_imports WHERE list_group='SCHADEK' ORDER BY started_at DESC LIMIT 1")).rows[0].error_reason, "upstream: getStockList: HTTP 500");

    // Success resets the failure counter and schedules the next nightly run.
    lists.FEBI = { stock: [stockRow("FEBI 1")], prices: Array.from({ length: 9 }, (_, i) => priceRow(`FEBI ${i + 1}`)) };
    await importDinamik(pool, { brand: "FEBI" }, fake);
    assert.equal((await pool.query("SELECT consecutive_failures FROM supplier_sync_scopes WHERE list_group='FEBI'")).rows[0].consecutive_failures, 0);

    // Checkout refresh: one getStock call per cart row; only real changes are written and logged.
    const ids = Object.fromEntries((await pool.query<{ id: string; code: string }>("SELECT id,code FROM supplier_items WHERE code IN ('FEBI 1','FEBI 2')")).rows.map(r => [r.code, r.id]));
    const asked: string[] = [];
    const perCode: DinamikFetch = async (path, body) => {
      assert.equal(path, "getStock");
      const code = (body as { STOK_KODU: string }).STOK_KODU; asked.push(code);
      return code === "FEBI 1" ? [stockRow("FEBI 1", 120, "VAR")] : [];
    };
    const before = (await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes")).rows[0].n;
    const refreshed = await refreshDinamikItems(pool, [ids["FEBI 1"], ids["FEBI 2"]], perCode);
    assert.deepEqual(asked.sort(), ["FEBI 1", "FEBI 2"]);
    assert.equal(refreshed.changed, 2);
    const febi1 = (await pool.query("SELECT price_data,stock_data FROM supplier_items WHERE code='FEBI 1'")).rows[0];
    assert.equal(febi1.price_data.nf, 120); assert.equal(febi1.stock_data.varyok1, "VAR"); assert.equal(febi1.stock_data.stok, 1);
    // A code the endpoint no longer returns is not sold on its old stock.
    const febi2 = (await pool.query("SELECT stock_data FROM supplier_items WHERE code='FEBI 2'")).rows[0];
    assert.equal(febi2.stock_data.stok, 0); assert.equal(febi2.stock_data.varyokAll, "YOK");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes")).rows[0].n, before + 2);
    // Same answer again: nothing changes, nothing is logged.
    assert.equal((await refreshDinamikItems(pool, [ids["FEBI 1"]], perCode)).changed, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes")).rows[0].n, before + 2);

    // A brand Dinamik stops listing is disabled, not deleted.
    brands = ["FEBI", "SCHADEK"];
    assert.deepEqual((await discoverDinamikBrands(pool, fake)).disabled, ["EMPTY"]);
    assert.equal((await pool.query("SELECT enabled FROM supplier_sync_scopes WHERE list_group='EMPTY'")).rows[0].enabled, false);
  } finally {
    await pool.end(); await root.query(`DROP SCHEMA ${namespace} CASCADE`); await root.end();
  }
});
