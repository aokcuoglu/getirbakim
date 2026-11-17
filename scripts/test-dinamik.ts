import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { dinamikCost } from "../src/modules/suppliers/dinamik-pricing";
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
  assert.deepEqual(byCode["FEBI 1"].price_data, { marka: "FEBI", stokKodu: "FEBI 1", fiyat: 106.09, kampanyaOrani: 0, nf: 55.43 });
  // Başbuğ-shaped fields the storefront, search and checkout read (see dinamikStorefrontFields).
  assert.deepEqual(Object.fromEntries(["no", "ac", "ac2", "uk", "oe", "dc"].map(key => [key, byCode["FEBI 1"].product_data[key]])),
    { no: "FEBI 1", ac: "EGZOZ ASKI LASTIGI", ac2: "", uk: "FEBI", oe: "", dc: "TRY" });
  // Price-list-only code: minimal product, unknown stock.
  assert.deepEqual(byCode["FEBI 2"].product_data, { stokKodu: "FEBI 2", marka: "FEBI" });
  assert.equal(byCode["FEBI 2"].stock_data, null);
  assert.equal(byCode["FEBI 2"].price_data?.nf, 4.96);
  // No price → no cost: the storefront hides the price instead of selling at zero.
  assert.ok(!("nf" in byCode["FEBI 4"].price_data!));
  // The two lists disagree on the price: kept visible as a conflict, not resolved.
  assert.equal(byCode["FEBI 3"].conflicting, true);
  assert.equal(byCode["FEBI 3"].source_variants.stockListPrice, 50);
  assert.equal(quality.missingPrices, 1);
  assert.equal(quality.missingStocks, 2);
  assert.equal(quality.available, 2);
});

test("cost is the list price less 45 %, 5 % and the campaign rate, one after another (#809)", () => {
  // TUDOR TL955, confirmed 2026-11-16: 13.290,48 × 0,55 × 0,95 × 0,96 = 6.666,50.
  assert.equal(dinamikCost(13290.48, 4), 6666.5);
  assert.equal(dinamikCost(13290.48, 0), 6944.28);
  // A half-kuruş tie rounds up (130 × 0,5225 = 67,925), as the db/commerce.sql backfill's numeric round does.
  assert.equal(dinamikCost(130, 0), 67.93);
  // Up to 4 decimals in the list price (5.219,775 × 0,5225 = 2.727,332…; 74,865 × 0,5225 = 39,1169…) and big prices stay exact.
  assert.equal(dinamikCost(5219.775, 0), 2727.33);
  assert.equal(dinamikCost(74.865, 0), 39.12);
  assert.equal(dinamikCost(1234567.8901, 50), 322530.86);
  // Not a usable percent → no campaign.
  for (const rate of [undefined, null, "4", -5, 100, 150, Number.NaN]) assert.equal(dinamikCost(13290.48, rate), 6944.28, String(rate));
  const { items } = prepareDinamikImport({ brand: "FEBI", stock: [{ ...stockRow("FEBI 1", 13290.48), kampanyaOrani: 4 }], prices: [priceRow("FEBI 1", 13290.48), priceRow("FEBI 2", 13290.48)] });
  assert.deepEqual(items.map(item => item.price_data?.nf), [6666.5, 6944.28], "the campaign comes from the stock row; a price-only code has none");
  assert.equal(items[0].price_data?.fiyat, 13290.48, "the list price stays as the source value");
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
  // "FEBI 1" and "FEBI 1 " are the same row once the code is trimmed; 106,09 and 120 remain.
  assert.equal((items[0].source_variants.prices as unknown[]).length, 2);
  assert.ok(!("stocks" in items[0].source_variants), "identical repeats are not conflicts");
  assert.equal(quality.duplicateCodes, 1);
});

test("duplicate price rows only conflict when they quote different positive prices", () => {
  const { items, quality } = prepareDinamikImport({ brand: "FEBI", stock: [stockRow("FEBI 4", 398.77)], prices: [
    // Same price, code padded differently (ORJINAL 1C0945511A): one row.
    priceRow("FEBI 1", 57.5), priceRow("FEBI 1  ", 57.5),
    // A zero next to a positive price (DELPHI GN10174-12B1): the positive price wins, in either order.
    priceRow("FEBI 2", 458.535), priceRow("FEBI 2 ", 0),
    priceRow("FEBI 3 ", 0), priceRow("FEBI 3", 1248.38),
    // Two positive prices, one row written exactly and one padded (FEBI 171180): the exact row is the supplier's record.
    priceRow("FEBI 4", 398.77), priceRow("FEBI 4  ", 375.86),
    // Two positive prices with no exact row to prefer: held back, nothing chosen.
    priceRow("FEBI 5 ", 10), priceRow("FEBI 5  ", 12),
  ] });
  const byCode = Object.fromEntries(items.map(item => [item.code, item]));
  assert.equal(byCode["FEBI 1"].conflicting, false);
  assert.ok(!("prices" in byCode["FEBI 1"].source_variants));
  assert.equal(byCode["FEBI 2"].conflicting, false);
  assert.equal((byCode["FEBI 2"].price_data as { fiyat: number }).fiyat, 458.535);
  assert.equal(byCode["FEBI 3"].conflicting, false);
  assert.equal((byCode["FEBI 3"].price_data as { nf: number }).nf, 652.28);
  assert.equal(byCode["FEBI 4"].conflicting, false);
  assert.equal((byCode["FEBI 4"].price_data as { nf: number }).nf, 208.36);
  assert.equal((byCode["FEBI 4"].source_variants.prices as unknown[]).length, 2, "the padded row stays visible");
  assert.equal(byCode["FEBI 4"].source_variants.usedExactCode, true);
  assert.equal(byCode["FEBI 5"].conflicting, true);
  assert.equal(quality.conflictingCodes, 1);
});

test("a padded duplicate in the stock list yields to the row written exactly", () => {
  // ORJINAL 1520900Q0H: the padded row is 0 / YOK and names another vehicle; the exact row is the live product.
  const { items } = prepareDinamikImport({ brand: "FEBI",
    stock: [{ ...stockRow("FEBI 6 ", 0, "YOK"), varyok4: "YOK", varyokAll: "YOK", stokAdi: "ESKI KAYIT" }, { ...stockRow("FEBI 6", 1248.38), stokAdi: "YAG FILTRESI" }],
    prices: [priceRow("FEBI 6 ", 0), priceRow("FEBI 6", 1248.38)] });
  assert.equal(items.length, 1);
  assert.equal(items[0].conflicting, false);
  assert.equal((items[0].product_data as { ac: string }).ac, "YAG FILTRESI");
  assert.equal((items[0].price_data as { nf: number }).nf, 652.28);
  assert.equal((items[0].stock_data as { stok: number }).stok, 1);
  assert.equal((items[0].source_variants.stocks as unknown[]).length, 2);
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
    assert.deepEqual(refreshed.gone, [ids["FEBI 2"]]);
    assert.deepEqual(refreshed.failed, {});
    const febi1 = (await pool.query("SELECT price_data,stock_data FROM supplier_items WHERE code='FEBI 1'")).rows[0];
    assert.equal(febi1.price_data.nf, 62.7); assert.equal(febi1.stock_data.varyok1, "VAR"); assert.equal(febi1.stock_data.stok, 1);
    // A code the endpoint no longer returns is not sold on its old stock.
    const febi2 = (await pool.query("SELECT stock_data FROM supplier_items WHERE code='FEBI 2'")).rows[0];
    assert.equal(febi2.stock_data.stok, 0); assert.equal(febi2.stock_data.varyokAll, "YOK");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes")).rows[0].n, before + 2);
    // Same answer again: nothing changes, nothing is logged.
    assert.equal((await refreshDinamikItems(pool, [ids["FEBI 1"]], perCode)).changed, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes")).rows[0].n, before + 2);

    // (#770) A failing code marks only its own line; the other rows are still written.
    const rowsOf = async () => (await pool.query("SELECT code,price_data,stock_data,changed_at FROM supplier_items WHERE code IN ('FEBI 1','FEBI 2') ORDER BY code")).rows;
    const changeCount = async () => (await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes")).rows[0].n;
    const failing = (error: (code: string) => unknown, answer: unknown = [stockRow("FEBI 2", 130, "VAR")]): DinamikFetch => async (_path, body) => {
      const code = (body as { STOK_KODU: string }).STOK_KODU;
      const thrown = error(code);
      if (thrown) throw thrown;
      return answer;
    };
    const febi1Before = (await rowsOf())[0];
    const timedOut = await refreshDinamikItems(pool, [ids["FEBI 1"], ids["FEBI 2"]], failing(code => code === "FEBI 1" && new DOMException("timed out", "TimeoutError")));
    assert.deepEqual(timedOut.failed, { [ids["FEBI 1"]]: "timeout" });
    assert.deepEqual(timedOut.gone, []);
    assert.equal(timedOut.refreshed, 1);
    assert.equal(timedOut.changed, 1);
    assert.equal((await rowsOf())[1].price_data.nf, 67.93);
    assert.deepEqual((await rowsOf())[0], febi1Before);
    const upstream = await refreshDinamikItems(pool, [ids["FEBI 1"], ids["FEBI 2"]], failing(code => code === "FEBI 1" && new DinamikImportError("upstream", "getStock HTTP 500")));
    assert.deepEqual(upstream.failed, { [ids["FEBI 1"]]: "upstream" });
    assert.equal(upstream.changed, 0);
    // An answer of the wrong shape is a contract failure of that line.
    const contract = await refreshDinamikItems(pool, [ids["FEBI 2"]], failing(() => false, [{}]));
    assert.deepEqual(contract.failed, { [ids["FEBI 2"]]: "contract" });
    assert.equal(contract.refreshed, 0);
    // Missing configuration fails every line with "config" instead of throwing.
    const configKeys = ["DINAMIK_BASE"];
    const savedConfig = configKeys.map(key => [key, process.env[key]] as const);
    for (const key of configKeys) delete process.env[key];
    try {
      const unconfigured = await refreshDinamikItems(pool, [ids["FEBI 1"], ids["FEBI 2"]]);
      assert.deepEqual(Object.values(unconfigured.failed), ["config", "config"]);
    } finally { for (const [key, value] of savedConfig) if (value !== undefined) process.env[key] = value; }

    // Rows a running import keeps locked: the checkout gives up quickly, writes nothing, sells the answered line on
    // saved data ("busy") and still reports the code the endpoint no longer returns as gone.
    const lockedBefore = await rowsOf();
    const changesBefore = await changeCount();
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT id FROM supplier_items WHERE code IN ('FEBI 1','FEBI 2') FOR UPDATE");
      const started = Date.now();
      const locked = await refreshDinamikItems(pool, [ids["FEBI 1"], ids["FEBI 2"]], async (_path, body) =>
        (body as { STOK_KODU: string }).STOK_KODU === "FEBI 1" ? [] : [stockRow("FEBI 2", 140, "VAR")]);
      assert.ok(Date.now() - started < 2_000, "the checkout does not wait on the import");
      assert.deepEqual(locked.gone, [ids["FEBI 1"]]);
      // (#788) FEBI 2 is saved at 130 (nf 67.93): a live 140 is a new cost the order must refuse, not sell at 67.93.
      assert.deepEqual(locked.repriced, [ids["FEBI 2"]]);
      assert.deepEqual(locked.soldOut, []);
      assert.deepEqual(locked.failed, {});
      assert.equal(locked.refreshed, 0);
      assert.equal(locked.changed, 0);
      // The same price live: sold on saved data, marked busy.
      const same = await refreshDinamikItems(pool, [ids["FEBI 2"]], async () => [stockRow("FEBI 2", 130, "VAR")]);
      assert.deepEqual(same.failed, { [ids["FEBI 2"]]: "busy" });
      assert.deepEqual([same.soldOut, same.repriced, same.gone], [[], [], []]);
      // Every region YOK live: sold out, refused, whatever the price.
      const allYok = { ...stockRow("FEBI 2", 130), varyok4: "YOK", varyokAll: "YOK" };
      const soldOut = await refreshDinamikItems(pool, [ids["FEBI 2"]], async () => [allYok]);
      assert.deepEqual(soldOut.soldOut, [ids["FEBI 2"]]);
      assert.deepEqual([soldOut.repriced, soldOut.gone, soldOut.failed], [[], [], {}]);
    } finally {
      await holder.query("ROLLBACK").catch(() => undefined);
      holder.release();
    }
    assert.deepEqual(await rowsOf(), lockedBefore);
    assert.equal(await changeCount(), changesBefore);
    // Same rows unlocked: the empty answer is written and still reported gone.
    const written = await refreshDinamikItems(pool, [ids["FEBI 1"]], async () => []);
    assert.deepEqual(written.gone, [ids["FEBI 1"]]);
    assert.equal(written.refreshed, 1);
    assert.equal((await rowsOf())[0].stock_data.stok, 0);

    // A gone code writes only its stock, merged onto the locked row: a brand import that committed while getStock was
    // answering keeps its product and price data, and an empty answer is not a sighting (last_seen_at stays).
    await pool.query("UPDATE supplier_items SET last_seen_at=now()-interval '1 day' WHERE code='FEBI 1'");
    const seenBefore = (await pool.query("SELECT last_seen_at FROM supplier_items WHERE code='FEBI 1'")).rows[0].last_seen_at;
    const concurrent = await refreshDinamikItems(pool, [ids["FEBI 1"]], async () => {
      await pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"YENI AD"}',price_data=price_data||'{"nf":99.5}',
        stock_data=stock_data||'{"stok":1,"varyok1":"VAR","varyokAll":"VAR"}' WHERE code='FEBI 1'`);
      return [];
    });
    assert.deepEqual(concurrent.gone, [ids["FEBI 1"]]);
    const afterPull = (await pool.query("SELECT product_data,price_data,stock_data,last_seen_at FROM supplier_items WHERE code='FEBI 1'")).rows[0];
    assert.equal(afterPull.product_data.ac, "YENI AD");
    assert.equal(afterPull.price_data.nf, 99.5);
    assert.equal(afterPull.stock_data.stok, 0);
    for (const key of ["varyok1", "varyok2", "varyok3", "varyok4", "varyokAll", "kaporta"]) assert.equal(afterPull.stock_data[key], "YOK", key);
    assert.equal(afterPull.last_seen_at.getTime(), seenBefore.getTime());

    // (#789) One budget for the whole check: lines not answered in time are "timeout", later slices are not asked,
    // nothing is written, and an answer arriving after its request's time is dropped.
    const budgetCodes = ["FEBI 3", "FEBI 4", "FEBI 5", "FEBI 6", "FEBI 7", "FEBI 8"];
    const budgetIds = (await pool.query<{ id: string }>("SELECT id FROM supplier_items WHERE code=ANY($1) ORDER BY id", [budgetCodes])).rows.map(row => row.id);
    const budgetRows = async () => (await pool.query("SELECT code,price_data,stock_data,changed_at FROM supplier_items WHERE code=ANY($1) ORDER BY code", [budgetCodes])).rows;
    const budgetBefore = await budgetRows();
    const budgetChanges = await changeCount();
    let slowRequests = 0, lateAnswers = 0;
    const slow: DinamikFetch = async (_path, body) => {
      slowRequests++;
      await new Promise(resolve => setTimeout(resolve, 300));
      lateAnswers++;
      return [stockRow((body as { STOK_KODU: string }).STOK_KODU, 999, "VAR")];
    };
    const budgetStarted = Date.now();
    const overBudget = await refreshDinamikItems(pool, budgetIds, slow, { budgetMs: 100 });
    assert.ok(Date.now() - budgetStarted < 1_000, "the budget bounds the check");
    assert.deepEqual(overBudget.failed, Object.fromEntries(budgetIds.map(id => [id, "timeout"])));
    assert.equal(slowRequests, 4, "the second slice is not asked once the budget is spent");
    assert.equal(overBudget.refreshed, 0);
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(lateAnswers, 4, "the late answers did arrive");
    assert.deepEqual(await budgetRows(), budgetBefore);
    assert.equal(await changeCount(), budgetChanges);
    slowRequests = 0;
    const noBudget = await refreshDinamikItems(pool, budgetIds, slow, { budgetMs: 0 });
    assert.equal(slowRequests, 0);
    assert.deepEqual(Object.values(noBudget.failed), budgetIds.map(() => "timeout"));

    // A brand list that shrinks past the guard disables nothing.
    brands = ["FEBI"];
    await assert.rejects(discoverDinamikBrands(pool, fake), /brand list shrank to 1 of 3/);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_sync_scopes WHERE supplier='dinamik' AND enabled")).rows[0].n, 3);

    // A brand Dinamik stops listing is disabled and its rows retired (logged, not deleted).
    brands = ["FEBI", "EMPTY"];
    const schadekBefore = (await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes c JOIN supplier_items i ON i.id=c.item_id WHERE i.list_group='SCHADEK'")).rows[0].n;
    const gone = await discoverDinamikBrands(pool, fake, { minListedShare: 0.5 });
    assert.deepEqual(gone.disabled, ["SCHADEK"]); assert.deepEqual(gone.retired, { SCHADEK: 1 });
    assert.equal((await pool.query("SELECT enabled FROM supplier_sync_scopes WHERE list_group='SCHADEK'")).rows[0].enabled, false);
    assert.equal((await pool.query("SELECT presence FROM supplier_items WHERE code='SCHADEK 1'")).rows[0].presence, "inactive");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes c JOIN supplier_items i ON i.id=c.item_id WHERE i.list_group='SCHADEK' AND c.kind='inactive'")).rows[0].n, 1);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM supplier_item_changes c JOIN supplier_items i ON i.id=c.item_id WHERE i.list_group='SCHADEK'")).rows[0].n, schadekBefore + 1);
    // Running discovery again retires nothing twice.
    assert.deepEqual((await discoverDinamikBrands(pool, fake, { minListedShare: 0.5 })).retired, {});

    // The brand comes back: its scope is re-enabled and queued, the first import restores its rows.
    brands = ["FEBI", "SCHADEK", "EMPTY"];
    const back = await discoverDinamikBrands(pool, fake);
    assert.deepEqual(back.reenabled, ["SCHADEK"]); assert.deepEqual(back.added, []);
    assert.equal((await pool.query("SELECT enabled FROM supplier_sync_scopes WHERE list_group='SCHADEK' AND next_run_at<=now()")).rows[0].enabled, true);
    assert.equal((await importDinamik(pool, { brand: "SCHADEK" }, fake)).stats.restored, 1);
    assert.equal((await pool.query("SELECT presence FROM supplier_items WHERE code='SCHADEK 1'")).rows[0].presence, "present");
  } finally {
    await pool.end(); await root.query(`DROP SCHEMA ${namespace} CASCADE`); await root.end();
  }
});
