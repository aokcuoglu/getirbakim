import assert from "node:assert/strict";
import test from "node:test";
import { currencyAnomaly, priceAnomalyThresholds, type CurrencyCandidate } from "../src/modules/suppliers/price-anomalies";
import { isolatedSchema } from "./isolated-schema";

// Measured on Başbuğ (19 Nov 2026): KENTPAR's single EUR row among 196 TRY rows, and a DELPHI injector whose high
// price another supplier confirms.
const kentpar: CurrencyCandidate = { brandRows: 197, currencyRows: 1, costTry: 76968.29, medianTry: 1469.23, relabelledTry: 1390.71, otherOfferTry: 1372.08 };

test("a single wrongly labelled row is an anomaly; a corroborated expensive part is not", () => {
  assert.deepEqual(currencyAnomaly(kentpar), { anomaly: true, reason: null });
  assert.deepEqual(currencyAnomaly({ ...kentpar, otherOfferTry: null }), { anomaly: true, reason: null });
  const delphi: CurrencyCandidate = { brandRows: 50, currencyRows: 1, costTry: 15467, medianTry: 611, relabelledTry: 280, otherOfferTry: 11942 };
  assert.deepEqual(currencyAnomaly(delphi), { anomaly: false, reason: "corroborated" });
  // Corroboration starts at a third of the cost.
  assert.equal(currencyAnomaly({ ...delphi, otherOfferTry: 15467 / 3 }).reason, "corroborated");
  assert.equal(currencyAnomaly({ ...delphi, otherOfferTry: 15467 / 3 - 0.01 }).anomaly, true);
});

test("an EUR-priced brand's lone TL row is judged in TL: cheap is below the ratio, expensive is not a relabel", () => {
  // 60 EUR rows with a 39.5 EUR median at 55 TL/EUR; the TL row read as EUR would be absurd.
  const base = { brandRows: 61, currencyRows: 1, medianTry: 2172.5, otherOfferTry: null };
  assert.equal(currencyAnomaly({ ...base, costTry: 5000, relabelledTry: 5000 * 55 }).reason, "below-ratio");
  assert.equal(currencyAnomaly({ ...base, costTry: 50000, relabelledTry: 50000 * 55 }).reason, "not-relabel");
});

test("brands priced in two currencies and small brands are left alone", () => {
  // BSG/FEBI: many rows in each currency.
  assert.equal(currencyAnomaly({ ...kentpar, brandRows: 2718, currencyRows: 1300 }).reason, "mixed-brand");
  assert.equal(currencyAnomaly({ ...kentpar, brandRows: 19 }).reason, "few-brand-rows");
  // One row needs a brand of 50: below that it is more than 2 % of the brand.
  assert.equal(currencyAnomaly({ ...kentpar, brandRows: 50 }).anomaly, true);
  assert.equal(currencyAnomaly({ ...kentpar, brandRows: 49 }).reason, "mixed-brand");
});

test("boundaries: exactly the ratio, exactly the share, three rows but not four", () => {
  const { RATIO, MAX_CURRENCY_ROWS, MAX_CURRENCY_SHARE } = priceAnomalyThresholds;
  assert.equal(currencyAnomaly({ ...kentpar, costTry: RATIO * kentpar.medianTry }).anomaly, true);
  assert.equal(currencyAnomaly({ ...kentpar, costTry: RATIO * kentpar.medianTry - 0.01 }).reason, "below-ratio");
  assert.equal(currencyAnomaly({ ...kentpar, relabelledTry: RATIO * kentpar.medianTry }).reason, "not-relabel");
  // 3 of 150 rows is exactly 2 %; 3 of 149 is above it.
  assert.equal(MAX_CURRENCY_ROWS, 3);
  assert.equal(MAX_CURRENCY_SHARE, 0.02);
  assert.equal(currencyAnomaly({ ...kentpar, brandRows: 150, currencyRows: 3 }).anomaly, true);
  assert.equal(currencyAnomaly({ ...kentpar, brandRows: 149, currencyRows: 3 }).reason, "mixed-brand");
  assert.equal(currencyAnomaly({ ...kentpar, brandRows: 1000, currencyRows: 4 }).reason, "mixed-brand");
  assert.equal(currencyAnomaly({ ...kentpar, medianTry: 0 }).reason, "below-ratio");
});

test("PostgreSQL: detection, unpriced catalog row, dismissal, auto-resolve and corroboration", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const schema = await isolatedSchema("price_anomalies_test");
  const { pool } = schema;
  try {
    const { refreshPriceAnomalies } = await import("../src/modules/suppliers/price-anomalies");
    await pool.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
      VALUES('basbug','BASBUG','G','MRK',now(),now(),'{}','{}','{}',$1,'succeeded')`, [JSON.stringify({ dovizListesi: [{ dovizCinsi: "EUR", satis: "55" }] })]);
    // rows(brand, currency, first nf, count): nf runs first..first+count-1.
    const rows = async (brand: string, currency: string, first: number, count: number, supplier = "basbug") => (await pool.query<{ id: string }>(
      `INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
      SELECT $1,$6,'G',$7,$2||' '||$3||' '||n,jsonb_build_object('uk',$2,'marka',$2,'ac','Test','dc',$3),jsonb_build_object('nf',$4::numeric+n),'{"stok":1}',1,1,1,now(),now(),now()
      FROM generate_series(0,$5::int-1) n RETURNING id::text`,
      [supplier, brand, currency, first, count, supplier === "basbug" ? "BASBUG" : "DINAMIK", supplier === "basbug" ? "MRK" : "ALL"])).rows.map(row => row.id);
    const kentTl = await rows("KENTPAR", "TL", 1400, 196);
    const [kentEur] = await rows("KENTPAR", "EUR", 1390.71, 1);
    await rows("BOSCHX", "EUR", 10, 60);
    const [boschTl] = await rows("BOSCHX", "TL", 50000, 1);
    await rows("DELPHX", "TL", 600, 50);
    const [delphiEur] = await rows("DELPHX", "EUR", 280, 1);
    // Dinamik sells the same injector at 11,942 TL: the price is real.
    const [dinamik] = await rows("DELPHX", "TRY", 11942, 1, "dinamik");
    const product = (await pool.query<{ id: string }>("INSERT INTO products(brand,part_number,brand_label,code) VALUES('DELPHX','28565336','DELPHX','DELPHX 28565336') RETURNING id::text")).rows[0].id;
    await pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$3),($2,$3)", [delphiEur, dinamik, product]);

    const price = async (id: string) => {
      const found = (await pool.query<{ price_kurus: number | null }>("SELECT price_kurus FROM commerce_catalog WHERE id=$1", [id])).rows;
      assert.equal(found.length, 1, "the row stays in the catalog");
      return found[0].price_kurus;
    };
    const anomalies = async () => (await pool.query<{ supplier_item_id: string; status: string }>(
      "SELECT supplier_item_id::text,status FROM supplier_price_anomalies ORDER BY supplier_item_id")).rows;
    const before = { eur: await price(kentEur), tl: await price(kentTl[0]), bosch: await price(boschTl), delphi: await price(delphiEur) };
    for (const value of Object.values(before)) assert.ok(value && value > 0);

    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 1, removed: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: kentEur, status: "open" }]);
    const evidence = (await pool.query("SELECT evidence FROM supplier_price_anomalies")).rows[0].evidence;
    assert.deepEqual([evidence.currency, evidence.dominant_currency, evidence.brand_rows, evidence.currency_rows, evidence.cost_kurus, evidence.median_kurus],
      ["EUR", "TRY", 197, 1, Math.round(1390.71 * 55 * 100), 149750]);
    assert.equal(await price(kentEur), null);
    assert.deepEqual([await price(kentTl[0]), await price(boschTl), await price(delphiEur)], [before.tl, before.bosch, before.delphi]);

    // Dismissed: priced again, and a later refresh keeps the decision.
    await pool.query("UPDATE supplier_price_anomalies SET status='dismissed'");
    assert.equal(await price(kentEur), before.eur);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 0, removed: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: kentEur, status: "dismissed" }]);
    assert.equal(await price(kentEur), before.eur);

    // Another refresh holding the lock: skipped, nothing written.
    await pool.query("UPDATE supplier_price_anomalies SET status='open'");
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(20261001,11)");
      assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: true });
    } finally { await holder.query("ROLLBACK"); holder.release(); }

    // The supplier corrects the currency: the anomaly is deleted and the row priced from its TL cost.
    await pool.query(`UPDATE supplier_items SET product_data=jsonb_set(product_data,'{dc}','"TL"') WHERE id=$1`, [kentEur]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 0, open: 0, removed: 1 });
    assert.deepEqual(await anomalies(), []);
    assert.ok((await price(kentEur) ?? 0) > 0);

    // Without the corroborating Dinamik offer, the DELPHX row would be flagged.
    await pool.query("DELETE FROM product_sources WHERE supplier_item_id=$1", [dinamik]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 1, removed: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: delphiEur, status: "open" }]);
  } finally {
    await schema.drop();
  }
});
