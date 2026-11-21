import assert from "node:assert/strict";
import test from "node:test";
import { currencyAnomaly, currencyUnderpriced, offerOutlier, priceAnomalyThresholds, type CurrencyCandidate, type OfferCandidate } from "../src/modules/suppliers/price-anomalies";
import { isolatedSchema } from "./isolated-schema";

// Measured on Başbuğ (19 Nov 2026): KENTPAR's single EUR row among 196 TRY rows, and a DELPHI injector whose high
// price another supplier confirms.
const kentpar: CurrencyCandidate = { brandRows: 197, currencyRows: 1, costTry: 76968.29, medianTry: 1469.23, relabelledTry: 1390.71, otherOfferTry: 1372.08,
  lowTry: 400, otherOfferMinTry: 1372.08 };

test("a single wrongly labelled row is an anomaly; a corroborated expensive part is not", () => {
  assert.deepEqual(currencyAnomaly(kentpar), { anomaly: true, reason: null });
  assert.deepEqual(currencyAnomaly({ ...kentpar, otherOfferTry: null }), { anomaly: true, reason: null });
  const delphi: CurrencyCandidate = { brandRows: 50, currencyRows: 1, costTry: 15467, medianTry: 611, relabelledTry: 280, otherOfferTry: 11942, lowTry: 200, otherOfferMinTry: 11942 };
  assert.deepEqual(currencyAnomaly(delphi), { anomaly: false, reason: "corroborated" });
  // Corroboration starts at a third of the cost.
  assert.equal(currencyAnomaly({ ...delphi, otherOfferTry: 15467 / 3 }).reason, "corroborated");
  assert.equal(currencyAnomaly({ ...delphi, otherOfferTry: 15467 / 3 - 0.01 }).anomaly, true);
});

test("an EUR-priced brand's lone TL row is judged in TL: cheap is below the ratio, expensive is not a relabel", () => {
  // 60 EUR rows with a 39.5 EUR median at 55 TL/EUR; the TL row read as EUR would be absurd.
  const base = { brandRows: 61, currencyRows: 1, medianTry: 2172.5, otherOfferTry: null, lowTry: 600, otherOfferMinTry: null };
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

// Measured on Başbuğ (21 Nov 2026): GLASER G 10118910 at 13.37 TL among 168 EUR rows with a 1,061 TL median and a
// 61.57 TL first percentile; read as EUR (55.397) it costs 740.66 TL.
const glaser: CurrencyCandidate = { brandRows: 169, currencyRows: 1, costTry: 13.37, medianTry: 1061.13, relabelledTry: 740.66,
  otherOfferTry: null, lowTry: 61.57, otherOfferMinTry: null };

test("an underpriced rare-currency row is an anomaly in the reverse direction; currencyAnomaly ignores it", () => {
  assert.deepEqual(currencyUnderpriced(glaser), { anomaly: true, reason: null });
  assert.equal(currencyAnomaly(glaser).reason, "below-ratio");
  // The expensive KENTPAR row is not underpriced.
  assert.equal(currencyUnderpriced(kentpar).reason, "below-ratio");
  // IBRAS/IOE-FD: a TL row at 1/10 of the median but above the brand's cheapest 1 % is a cheap part, not a relabel.
  assert.equal(currencyUnderpriced({ ...glaser, lowTry: 13.37 }).reason, "below-ratio");
  assert.equal(currencyUnderpriced({ ...glaser, brandRows: 49 }).reason, "mixed-brand");
  assert.equal(currencyUnderpriced({ ...glaser, brandRows: 19 }).reason, "few-brand-rows");
});

test("underpriced boundaries: exactly a tenth of the median, the percentile, the relabel window and corroboration", () => {
  const base: CurrencyCandidate = { brandRows: 200, currencyRows: 1, costTry: 100, medianTry: 1000, relabelledTry: 5000, otherOfferTry: null, lowTry: 150, otherOfferMinTry: null };
  assert.equal(currencyUnderpriced(base).anomaly, true);
  assert.equal(currencyUnderpriced({ ...base, costTry: 100.01 }).reason, "below-ratio");
  assert.equal(currencyUnderpriced({ ...base, lowTry: 100 }).reason, "below-ratio");
  assert.equal(currencyUnderpriced({ ...base, medianTry: 0 }).reason, "below-ratio");
  // Read in the dominant currency it must land strictly inside (median / 10, median × 10).
  assert.equal(currencyUnderpriced({ ...base, relabelledTry: 10000 }).reason, "not-relabel");
  assert.equal(currencyUnderpriced({ ...base, relabelledTry: 9999.99 }).anomaly, true);
  assert.equal(currencyUnderpriced({ ...base, relabelledTry: 100 }).reason, "not-relabel");
  assert.equal(currencyUnderpriced({ ...base, relabelledTry: 100.01 }).anomaly, true);
  // Another supplier selling at up to 3× the cost confirms the low price.
  assert.equal(currencyUnderpriced({ ...base, otherOfferMinTry: 300 }).reason, "corroborated");
  assert.equal(currencyUnderpriced({ ...base, otherOfferMinTry: 300.01 }).anomaly, true);
});

// A currency the brand really prices in (MIN_RELABEL_ROWS, MIN_RELABEL_SHARE of a 1,000-row brand).
const used = (currency: string, costTry: number) => ({ currency, costTry, rows: 500 });

test("cross-offer outliers: a relabel into a currency the brand uses is an anomaly, anything else is not", () => {
  // FEBI 01197: 28.64 TL where Dinamik sells it for 1,683.62 TL; FEBI has 1,781 EUR rows among 12,946, read as EUR the
  // row costs 1,586.57 TL.
  const febi: OfferCandidate = { costTry: 28.64, otherMinTry: 1683.62, otherMaxTry: 1683.62, brandRows: 12946,
    relabels: [{ currency: "EUR", costTry: 28.64 * 55.397, rows: 1781 }] };
  assert.deepEqual(offerOutlier(febi), { anomaly: true, direction: "low", relabelCurrency: "EUR", reason: null });
  // IOE-VW 03L129711E: 321.68 EUR = 17,820 TL where Dinamik sells it for 660.96 TL. The brand is priced in EUR (1,137
  // rows, 5 USD, no TL): the Başbuğ price is likely right, so it is not blamed.
  const vw: OfferCandidate = { costTry: 321.68 * 55.397, otherMinTry: 660.96, otherMaxTry: 660.96, brandRows: 1142,
    relabels: [{ currency: "USD", costTry: 321.68 * 50.4936, rows: 5 }] };
  assert.deepEqual(offerOutlier(vw), { anomaly: false, direction: "high", relabelCurrency: null, reason: "not-relabel" });
  // Had the brand priced in TL as well, reading the row as TL would fit the offer.
  assert.deepEqual(offerOutlier({ ...vw, relabels: [used("TRY", 321.68)], brandRows: 1000 }), { anomaly: true, direction: "high", relabelCurrency: "TRY", reason: null });
  // A single-currency brand has nothing to relabel into: a row 55× below the other offer is not flagged.
  assert.equal(offerOutlier({ costTry: 100, otherMinTry: 5500, otherMaxTry: 5500, brandRows: 800, relabels: [] }).reason, "not-relabel");
  // OE-FD: a TL row 10× below the offer that no currency explains (a wrong link or a different part).
  assert.deepEqual(offerOutlier({ costTry: 100, otherMinTry: 1000, otherMaxTry: 1000, brandRows: 1000, relabels: [used("EUR", 5540), used("USD", 5049)] }),
    { anomaly: false, direction: "low", relabelCurrency: null, reason: "not-relabel" });
  assert.deepEqual(offerOutlier({ ...febi, costTry: 1683.62 / 9.99 }), { anomaly: false, direction: null, relabelCurrency: null, reason: "within-ratio" });
  assert.equal(offerOutlier({ ...vw, costTry: 660.96 * 9.99 }).reason, "within-ratio");
});

test("cross-offer boundaries: exactly 10×, exactly the 3× band, the brand's use of the currency, and the nearest relabel", () => {
  const brandRows = 1000;
  const relabels = [used("EUR", 1000)];
  assert.equal(offerOutlier({ costTry: 1000, otherMinTry: 50, otherMaxTry: 100, brandRows, relabels: [used("TRY", 100)] }).direction, "high");
  assert.equal(offerOutlier({ costTry: 999.99, otherMinTry: 50, otherMaxTry: 100, brandRows, relabels: [used("TRY", 100)] }).reason, "within-ratio");
  assert.equal(offerOutlier({ costTry: 100, otherMinTry: 1000, otherMaxTry: 2000, brandRows, relabels }).direction, "low");
  assert.equal(offerOutlier({ costTry: 100.01, otherMinTry: 1000, otherMaxTry: 2000, brandRows, relabels }).reason, "within-ratio");
  // A relabel must land within [min / 3, max × 3] of the other offers.
  const low = { costTry: 10, otherMinTry: 300, otherMaxTry: 300, brandRows };
  assert.equal(offerOutlier({ ...low, relabels: [used("EUR", 100)] }).anomaly, true);
  assert.equal(offerOutlier({ ...low, relabels: [used("EUR", 900)] }).anomaly, true);
  assert.equal(offerOutlier({ ...low, relabels: [used("EUR", 99.99)] }).reason, "not-relabel");
  assert.equal(offerOutlier({ ...low, relabels: [used("EUR", 900.01)] }).reason, "not-relabel");
  // The brand must use the currency: at least 20 rows and 5 % of the brand.
  const { MIN_RELABEL_ROWS, MIN_RELABEL_SHARE } = priceAnomalyThresholds;
  assert.deepEqual([MIN_RELABEL_ROWS, MIN_RELABEL_SHARE], [20, 0.05]);
  assert.equal(offerOutlier({ ...low, brandRows: 400, relabels: [{ currency: "EUR", costTry: 100, rows: 20 }] }).anomaly, true);
  assert.equal(offerOutlier({ ...low, brandRows: 401, relabels: [{ currency: "EUR", costTry: 100, rows: 20 }] }).reason, "not-relabel");
  assert.equal(offerOutlier({ ...low, brandRows: 100, relabels: [{ currency: "EUR", costTry: 100, rows: 19 }] }).reason, "not-relabel");
  // Several fit: the one closest to the offers (in ratio) wins.
  assert.equal(offerOutlier({ costTry: 10, otherMinTry: 1000, otherMaxTry: 1000, brandRows,
    relabels: [used("USD", 400), used("EUR", 1100), used("GBP", 2900)] }).relabelCurrency, "EUR");
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

    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 1, removed: 0, ratesMissing: false, unrated: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: kentEur, status: "open" }]);
    const evidence = (await pool.query("SELECT evidence FROM supplier_price_anomalies")).rows[0].evidence;
    assert.deepEqual([evidence.currency, evidence.dominant_currency, evidence.brand_rows, evidence.currency_rows, evidence.cost_kurus, evidence.median_kurus],
      ["EUR", "TRY", 197, 1, Math.round(1390.71 * 55 * 100), 149750]);
    assert.equal(await price(kentEur), null);
    assert.deepEqual([await price(kentTl[0]), await price(boschTl), await price(delphiEur)], [before.tl, before.bosch, before.delphi]);

    // Dismissed: priced again, and a later refresh keeps the decision.
    await pool.query("UPDATE supplier_price_anomalies SET status='dismissed'");
    assert.equal(await price(kentEur), before.eur);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 0, removed: 0, ratesMissing: false, unrated: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: kentEur, status: "dismissed" }]);
    assert.equal(await price(kentEur), before.eur);

    // A run that merely misses the dismissed row (a corroborating offer appears, then goes) keeps the decision.
    const [kentDinamik] = await rows("KENTPAR", "TRY", 30000, 1, "dinamik");
    const kentProduct = (await pool.query<{ id: string }>("INSERT INTO products(brand,part_number,brand_label,code) VALUES('KENTPAR','152T01901','KENTPAR','KENT 152 T019 01') RETURNING id::text")).rows[0].id;
    await pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$3),($2,$3)", [kentEur, kentDinamik, kentProduct]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 0, open: 0, removed: 0, ratesMissing: false, unrated: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: kentEur, status: "dismissed" }]);
    assert.equal(await price(kentEur), before.eur);
    await pool.query("DELETE FROM product_sources WHERE supplier_item_id=$1", [kentDinamik]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 0, removed: 0, ratesMissing: false, unrated: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: kentEur, status: "dismissed" }]);
    assert.equal(await price(kentEur), before.eur);

    // The latest import has no EUR rate: the run cannot judge EUR rows and deletes nothing.
    await pool.query("UPDATE supplier_price_anomalies SET status='open'");
    const rates = (await pool.query("SELECT currencies_data FROM supplier_imports")).rows[0].currencies_data;
    await pool.query(`UPDATE supplier_imports SET currencies_data='{"dovizListesi":[]}'`);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 0, open: 1, removed: 0, ratesMissing: true, unrated: 1 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: kentEur, status: "open" }]);
    await pool.query("UPDATE supplier_imports SET currencies_data=$1", [rates]);

    // Another refresh holding the lock: skipped, nothing written.
    const holder = await pool.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(20261001,11)");
      assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: true });
    } finally { await holder.query("ROLLBACK"); holder.release(); }

    // The supplier corrects the currency: even a dismissed anomaly is deleted and the row priced from its TL cost.
    await pool.query("UPDATE supplier_price_anomalies SET status='dismissed'");
    await pool.query(`UPDATE supplier_items SET product_data=jsonb_set(product_data,'{dc}','"TL"') WHERE id=$1`, [kentEur]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 0, open: 0, removed: 1, ratesMissing: false, unrated: 0 });
    assert.deepEqual(await anomalies(), []);
    assert.ok((await price(kentEur) ?? 0) > 0);

    // Without the corroborating Dinamik offer, the DELPHX row would be flagged.
    await pool.query("DELETE FROM product_sources WHERE supplier_item_id=$1", [dinamik]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 1, removed: 0, ratesMissing: false, unrated: 0 });
    assert.deepEqual(await anomalies(), [{ supplier_item_id: delphiEur, status: "open" }]);
    // An open anomaly the next run no longer detects (the offer is linked again) is deleted.
    await pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [dinamik, product]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 0, open: 0, removed: 1, ratesMissing: false, unrated: 0 });
  } finally {
    await schema.drop();
  }
});

test("PostgreSQL: cross-offer outliers and underpriced rows (#1050)", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const schema = await isolatedSchema("price_outliers_test");
  const { pool } = schema;
  try {
    const { refreshPriceAnomalies } = await import("../src/modules/suppliers/price-anomalies");
    await pool.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
      VALUES('basbug','BASBUG','G','MRK',now(),now(),'{}','{}','{}',$1,'succeeded')`, [JSON.stringify({ dovizListesi: [{ dovizCinsi: "EUR", satis: "55" }, { dovizCinsi: "USD", satis: "50" }] })]);
    const rows = async (brand: string, currency: string, first: number, count: number, supplier = "basbug") => (await pool.query<{ id: string }>(
      `INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
      SELECT $1,$6,'G',$7,$2||' '||$3||' '||($4::numeric+n),jsonb_build_object('uk',$2,'marka',$2,'ac','Test','dc',$3),jsonb_build_object('nf',$4::numeric+n),'{"stok":1}',1,1,1,now(),now(),now()
      FROM generate_series(0,$5::int-1) n RETURNING id::text`,
      [supplier, brand, currency, first, count, supplier === "basbug" ? "BASBUG" : "DINAMIK", supplier === "basbug" ? "MRK" : "ALL"])).rows.map(row => row.id);
    const link = async (code: string, ...items: string[]) => {
      const product = (await pool.query<{ id: string }>("INSERT INTO products(brand,part_number,brand_label,code) VALUES('X',$1,'X',$1) RETURNING id::text", [code])).rows[0].id;
      for (const item of items) await pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [item, product]);
    };
    // A brand priced in both currencies: the currency rule leaves it alone.
    await rows("MIXB", "EUR", 20, 30);
    const [mixCheap, mixOdd] = await rows("MIXB", "TL", 1000, 30);
    // Dinamik sells mixCheap's product 55× higher: 1,000 "TL" is 1,000 EUR.
    await link("P1", mixCheap, ...await rows("MIXB", "TRY", 55000, 1, "dinamik"));
    // 12× higher but no currency explains it (1,001 × 55 or × 50 is far above 3 × 12,012): not flagged.
    await link("P2", mixOdd, ...await rows("MIXB", "TRY", 12012, 1, "dinamik"));
    // A lone cheap TL row in an EUR brand (median 69.5 EUR): currency/low, and also an offer outlier, stored once.
    await rows("LOWB", "EUR", 40, 60);
    const [lowTl] = await rows("LOWB", "TL", 50, 1);
    await link("P3", lowTl, ...await rows("LOWB", "TRY", 2750, 1, "dinamik"));
    // A brand priced in TL and EUR with one EUR row 51× Dinamik's TL offer: read as TL it fits (high direction).
    await rows("HIGHB", "TL", 100, 40);
    await rows("HIGHB", "EUR", 2, 40);
    const [highEur] = await rows("HIGHB", "EUR", 300, 1);
    await link("P4", highEur, ...await rows("HIGHB", "TRY", 320, 1, "dinamik"));
    // A TL-only brand has no other currency to relabel into: 55× below the offer, but not flagged.
    const [soloTl] = await rows("SOLOB", "TL", 500, 30);
    await link("P5", soloTl, ...await rows("SOLOB", "TRY", 27500, 1, "dinamik"));
    // A linked row in a currency without a rate is skipped and counted; the run still judges (and deletes) the rest.
    const [gbp] = await rows("GBPB", "GBP", 10, 1);
    await link("P6", gbp, ...await rows("GBPB", "TRY", 5000, 1, "dinamik"));

    const price = async (id: string) => (await pool.query<{ price_kurus: number | null }>("SELECT price_kurus FROM commerce_catalog WHERE id=$1", [id])).rows[0].price_kurus;
    const anomalies = async () => (await pool.query<{ supplier_item_id: string; kind: string; status: string; direction: string }>(
      "SELECT supplier_item_id::text,kind,status,evidence->>'direction' AS direction FROM supplier_price_anomalies ORDER BY kind,supplier_item_id")).rows;
    assert.ok((await price(mixCheap) ?? 0) > 0);

    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 3, open: 3, removed: 0, ratesMissing: false, unrated: 1 });
    assert.deepEqual(await anomalies(), [
      { supplier_item_id: lowTl, kind: "currency", status: "open", direction: "low" },
      ...[{ supplier_item_id: mixCheap, kind: "offer-outlier", status: "open", direction: "low" },
        { supplier_item_id: highEur, kind: "offer-outlier", status: "open", direction: "high" }].sort((a, b) => a.supplier_item_id.localeCompare(b.supplier_item_id)),
    ]);
    const high = (await pool.query("SELECT evidence FROM supplier_price_anomalies WHERE supplier_item_id=$1", [highEur])).rows[0].evidence;
    assert.deepEqual([high.currency, high.relabel_currency, high.cost_kurus, high.other_offer_kurus], ["EUR", "TRY", 300 * 55 * 100, 32000]);
    assert.equal(await price(highEur), null);
    assert.ok((await price(soloTl) ?? 0) > 0);
    const evidence = (await pool.query("SELECT evidence FROM supplier_price_anomalies WHERE supplier_item_id=$1", [mixCheap])).rows[0].evidence;
    assert.deepEqual([evidence.currency, evidence.relabel_currency, evidence.dominant_currency, evidence.cost_kurus, evidence.median_kurus, evidence.other_offer_min_kurus, evidence.other_offers],
      ["TRY", "EUR", "EUR", 100000, 0, 5500000, 1]);
    assert.ok(evidence.ratio < 1);
    assert.equal(await price(mixCheap), null);
    assert.equal(await price(lowTl), null);
    assert.ok((await price(mixOdd) ?? 0) > 0);

    // Dismissed: priced again, and the next refresh keeps the decision.
    await pool.query("UPDATE supplier_price_anomalies SET status='dismissed' WHERE supplier_item_id=$1", [mixCheap]);
    assert.ok((await price(mixCheap) ?? 0) > 0);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 3, open: 2, removed: 0, ratesMissing: false, unrated: 1 });
    assert.equal((await anomalies()).find(row => row.supplier_item_id === mixCheap)?.status, "dismissed");

    // An open outlier whose product link goes away is no longer detected: deleted and priced again.
    await pool.query("UPDATE supplier_price_anomalies SET status='open' WHERE supplier_item_id=$1", [mixCheap]);
    await pool.query("DELETE FROM product_sources WHERE supplier_item_id=$1", [mixCheap]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 2, open: 2, removed: 1, ratesMissing: false, unrated: 1 });
    assert.deepEqual((await anomalies()).map(row => row.supplier_item_id), [lowTl, highEur]);
    assert.ok((await price(mixCheap) ?? 0) > 0);
  } finally {
    await schema.drop();
  }
});

test("PostgreSQL: an anomaly the run cannot judge for want of a rate is kept (#1050)", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const schema = await isolatedSchema("price_unrated_test");
  const { pool } = schema;
  try {
    const { refreshPriceAnomalies } = await import("../src/modules/suppliers/price-anomalies");
    const rates = JSON.stringify({ dovizListesi: [{ dovizCinsi: "EUR", satis: "55" }] });
    await pool.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
      VALUES('basbug','BASBUG','G','MRK',now(),now(),'{}','{}','{}',$1,'succeeded')`, [rates]);
    const rows = async (brand: string, currency: string, first: number, count: number, supplier = "basbug") => (await pool.query<{ id: string }>(
      `INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
      SELECT $1,$6,'G',$7,$2||' '||$3||' '||($4::numeric+n),jsonb_build_object('uk',$2,'marka',$2,'ac','Test','dc',$3),jsonb_build_object('nf',$4::numeric+n),'{"stok":1}',1,1,1,now(),now(),now()
      FROM generate_series(0,$5::int-1) n RETURNING id::text`,
      [supplier, brand, currency, first, count, supplier === "basbug" ? "BASBUG" : "DINAMIK", supplier === "basbug" ? "MRK" : "ALL"])).rows.map(row => row.id);
    const link = async (code: string, ...items: string[]) => {
      const product = (await pool.query<{ id: string }>("INSERT INTO products(brand,part_number,brand_label,code) VALUES('X',$1,'X',$1) RETURNING id::text", [code])).rows[0].id;
      for (const item of items) await pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [item, product]);
    };
    // No rare-currency candidate: both brands are priced in TL and EUR alike.
    await rows("MIXB", "EUR", 20, 30);
    const [tryRow] = await rows("MIXB", "TL", 1000, 30);
    await link("P1", tryRow, ...await rows("MIXB", "TRY", 55000, 1, "dinamik"));
    await rows("HIGHB", "TL", 100, 40);
    await rows("HIGHB", "EUR", 2, 40);
    const [eurRow] = await rows("HIGHB", "EUR", 300, 1);
    await link("P2", eurRow, ...await rows("HIGHB", "TRY", 320, 1, "dinamik"));
    const price = async (id: string) => (await pool.query<{ price_kurus: number | null }>("SELECT price_kurus FROM commerce_catalog WHERE id=$1", [id])).rows[0].price_kurus;

    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 2, open: 2, removed: 0, ratesMissing: false, unrated: 0 });
    // The latest import loses its EUR rate: the TL row's relabel (EUR) and the EUR row's own rate are gone. Neither row
    // can be judged, so neither is deleted, and the TL row stays unpriced instead of selling at its wrong price.
    await pool.query(`UPDATE supplier_imports SET currencies_data='{"dovizListesi":[]}'`);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 0, open: 2, removed: 0, ratesMissing: false, unrated: 1 });
    assert.equal(await price(tryRow), null);
    assert.equal(await price(eurRow), null);
    // The rate is back: both detected again; then the TL row's link goes and only it is deleted.
    await pool.query("UPDATE supplier_imports SET currencies_data=$1", [rates]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 2, open: 2, removed: 0, ratesMissing: false, unrated: 0 });
    await pool.query("DELETE FROM product_sources WHERE supplier_item_id=$1", [tryRow]);
    assert.deepEqual(await refreshPriceAnomalies(pool, "basbug"), { skipped: false, flagged: 1, open: 1, removed: 1, ratesMissing: false, unrated: 0 });
    assert.ok((await price(tryRow) ?? 0) > 0);
  } finally {
    await schema.drop();
  }
});
