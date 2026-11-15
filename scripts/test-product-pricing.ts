import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { productPricePreview, productPricingSchema } from "../src/modules/admin/product-pricing-schema";
import { parseLira, productPriceValuesSchema } from "../src/modules/admin/product-override-schema";
import { belowCost, costWithVat, overrideValueText } from "../src/modules/admin/product-override-fields";
import { initialPriceForm, liraInput, priceFormReducer } from "../src/modules/admin/product-price-form-state";
import { compareOffers, fixedPrice, listPrice, saleUntil } from "../src/modules/store/best-offer";
import { isolatedSchema } from "./isolated-schema";

test("blank rates inherit, zero overrides and Turkish decimals are accepted", () => {
  const id = randomUUID();
  assert.deepEqual(productPricingSchema.parse({ id, markup: "", vat: "  " }), { id, markup: null, vat: null });
  assert.deepEqual(productPricingSchema.parse({ id, markup: "0", vat: "0,00" }), { id, markup: 0, vat: 0 });
  assert.deepEqual(productPricingSchema.parse({ id, markup: "35,25", vat: "20.50" }), { id, markup: 35.25, vat: 20.5 });
});

test("invalid identifiers, non-decimal input, precision and rate bounds are rejected", () => {
  const valid = { id: randomUUID(), markup: "30", vat: "20" };
  for (const markup of ["-1", "1000.01", "1.234", "1e2", "NaN", "Infinity", "1,2,3"]) assert.equal(productPricingSchema.safeParse({ ...valid, markup }).success, false, markup);
  for (const vat of ["-1", "100.01", "1.234", "abc"]) assert.equal(productPricingSchema.safeParse({ ...valid, vat }).success, false, vat);
  assert.equal(productPricingSchema.safeParse({ ...valid, id: "invalid" }).success, false);
  assert.equal(productPricingSchema.safeParse({ ...valid, markup: null }).success, false);
  assert.equal(productPricingSchema.safeParse({ ...valid, markup: "1000", vat: "100" }).success, true);
});

test("price preview rounds decimal half-cents and respects missing/overflow prices", () => {
  assert.equal(productPricePreview(27.48, 30, 20), 4287);
  assert.equal(productPricePreview(27.48, 50, 10), 4534);
  assert.equal(productPricePreview(1.005, 0, 0), 101);
  assert.equal(productPricePreview(1e-8, 0, 0), null);
  for (const cost of [null, 0, -1, Infinity, 21474836.48]) assert.equal(productPricePreview(cost, 30, 20), null);
  assert.equal(productPricePreview(21474836.47, 0, 0), 2147483647);
  assert.equal(productPricePreview(21474836.47, 30, 20), null);
  assert.equal(productPricePreview(1.005, 0, 0, 2), 201);
  assert.equal(productPricePreview(1.5, 0, 0, 0.67), 101);
  for (const rate of [null, 0, -1, Infinity]) assert.equal(productPricePreview(27.48, 30, 20, rate), null);
});

test("PostgreSQL: per-product rates, inheritance, catalog prices and reset stay isolated", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const root = new Pool({ connectionString: process.env.DATABASE_URL });
  const namespace = `product_pricing_test_${randomBytes(8).toString("hex")}`;
  await root.query(`CREATE SCHEMA ${namespace}`);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace}` });
  try {
    const { persistProductPricing, loadProductPricing } = await import("../src/modules/admin/product-pricing-store");
    await pool.query(await readFile("db/schema.sql", "utf8"));
    const sql = await readFile("db/commerce.sql", "utf8");
    await pool.query(sql);
    await pool.query(sql); // Migration is repeatable and preserves records.
    const admin = (await pool.query("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Test','admin@example.invalid','test','admin',true) RETURNING id")).rows[0].id;
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const [index, id] of ids.entries()) await pool.query(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
      VALUES($1,$2,'TEST','TEST',$7,$3,$4,$5,$6,1,1,1,now(),now(),now())`, [id, index === 2 ? "basbug" : index === 3 ? "seta" : "dinamik", `TEST ${index}`, JSON.stringify({ ac: "Test", uk: "Test", dc: index === 2 ? "EUR" : "TRY" }), JSON.stringify({ nf: 27.48, fiyat: 27.48 }), JSON.stringify({ stok: 1 }), index === 2 ? "MRK" : "ALL"]);
    const importRate = async (rate: number, status: string, age: number) => pool.query(`INSERT INTO supplier_imports(supplier,company,list_group,warehouse,started_at,completed_at,observations,quality,groups_data,currencies_data,status)
      VALUES('basbug','TEST','TEST','MRK',now()-$1*interval '1 minute',now()-$1*interval '1 minute','{}','{}','{}',$2,$3)`, [age, JSON.stringify({ dovizListesi: [{ dovizCinsi: "EUR", satis: String(rate) }] }), status]);
    await importRate(39, "succeeded", 30);
    await importRate(40.125, "succeeded", 10);
    await importRate(99, "rejected", 0); // Rejected data never supplies the sales rate.
    const price = async (id: string) => (await pool.query("SELECT price_kurus,pricing_snapshot FROM commerce_catalog WHERE id=$1", [id])).rows[0];
    const settings = async () => (await pool.query("SELECT markup_percent,vat_percent FROM commerce_settings")).rows[0];
    const general = await settings();
    assert.equal((await price(ids[0])).price_kurus, 4287);
    assert.equal(await persistProductPricing(pool, ids[0], { markup: 50, vat: null }, admin), true);
    let p = await price(ids[0]);
    assert.equal(p.price_kurus, 4946); assert.equal(p.pricing_snapshot.markup_percent, 50); assert.equal(p.pricing_snapshot.vat_percent, 20);
    assert.equal((await price(ids[1])).price_kurus, 4287); assert.deepEqual(await settings(), general);
    await pool.query("UPDATE commerce_settings SET markup_percent=40,vat_percent=10");
    assert.equal((await price(ids[0])).price_kurus, 4534); assert.equal((await price(ids[1])).price_kurus, 4232);
    assert.equal(await persistProductPricing(pool, ids[0], { markup: 0, vat: 0 }, admin), true);
    p = await price(ids[0]); assert.equal(p.price_kurus, 2748); assert.equal(p.pricing_snapshot.markup_percent, 0); assert.equal(p.pricing_snapshot.vat_percent, 0);
    assert.equal((await pool.query("SELECT updated_by FROM commerce_product_pricing WHERE supplier_item_id=$1", [ids[0]])).rows[0].updated_by, admin);
    await pool.query("UPDATE supplier_items SET price_data=$2 WHERE id=$1", [ids[0], JSON.stringify({ nf: 100, fiyat: 100 })]);
    assert.equal((await price(ids[0])).price_kurus, 10000); // Supplier refresh keeps the override.
    assert.equal(await persistProductPricing(pool, ids[0], { markup: null, vat: 0 }, admin), true);
    assert.equal((await price(ids[0])).price_kurus, 14000);
    assert.equal(await persistProductPricing(pool, ids[0], { markup: null, vat: null }, admin), true);
    assert.equal((await price(ids[0])).price_kurus, 15400);
    assert.equal(await persistProductPricing(pool, ids[0], { markup: null, vat: null }, admin), true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM commerce_product_pricing")).rows[0].n, 0);
    for (const id of ids.slice(2)) {
      const pricing = await loadProductPricing(pool, id);
      const rate = id === ids[2] ? 40.125 : 1;
      assert.equal(pricing.exchangeRate, rate);
      assert.equal(pricing.currency, id === ids[2] ? "EUR" : "TRY");
      assert.equal(await persistProductPricing(pool, id, { markup: 50, vat: null }, admin), true);
      assert.equal((await price(id)).price_kurus, productPricePreview(27.48, 50, 10, rate));
      assert.equal((await price(ids[1])).price_kurus, 4232);
      assert.equal(await persistProductPricing(pool, id, { markup: 0, vat: 0 }, admin), true);
      assert.equal((await price(id)).price_kurus, productPricePreview(27.48, 0, 0, rate));
      assert.equal(await persistProductPricing(pool, id, { markup: null, vat: null }, admin), true);
      assert.equal((await price(id)).price_kurus, productPricePreview(27.48, 40, 10, rate));
    }
    assert.equal(await persistProductPricing(pool, randomUUID(), { markup: 50, vat: 10 }, admin), false);
    assert.equal(await persistProductPricing(pool, randomUUID(), { markup: null, vat: null }, admin), false);
    await pool.query("UPDATE supplier_items SET product_data=jsonb_set(product_data,'{dc}','\"UNKNOWN\"') WHERE id=$1", [ids[2]]);
    assert.equal((await loadProductPricing(pool, ids[2])).exchangeRate, null);
    assert.equal((await price(ids[2])).price_kurus, null);
    // Preview and the canonical SQL calculation agree at decimal boundaries.
    for (const [cost, markup, vat, rate] of [[1.005, 0, 0, 1], [27.48, 35.25, 20.5, 40.125], [0.0001, 1000, 100, 1], [10000.005, 10, 20, 1], [1.5, 0, 0, 0.67]]) {
      const actual = (await pool.query("SELECT round($1::numeric*$4::numeric*(1+$2::numeric/100)*(1+$3::numeric/100)*100)::integer AS price", [cost, markup, vat, rate])).rows[0].price;
      assert.equal(productPricePreview(cost, markup, vat, rate), actual > 0 ? actual : null);
    }
    await persistProductPricing(pool, ids[0], { markup: 50, vat: 10 }, admin);
    await pool.query(sql);
    assert.equal((await price(ids[0])).price_kurus, 16500);
    await pool.query("DELETE FROM supplier_items WHERE id=$1", [ids[0]]);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM commerce_product_pricing")).rows[0].n, 0);
  } finally {
    await pool.end(); await root.query(`DROP SCHEMA ${namespace} CASCADE`); await root.end();
  }
});

// Hand-set prices (#580).
const priceInput = (values: Partial<Record<"price" | "sale_price" | "sale_from" | "sale_until", string>>) =>
  productPriceValuesSchema.safeParse({ price: "", sale_price: "", sale_from: "", sale_until: "", ...values });

test("lira input: Turkish or plain decimals become exact kuruş; blanks are the formula", () => {
  for (const [text, kurus] of [["1.249,90", 124990], ["1249.90", 124990], ["1249,9", 124990], ["1249", 124900], ["1.249", 124900], ["0,01", 1],
    ["12.345.678,99", 1234567899], ["21474836,47", 2147483647], [" 15 ", 1500], ["007", 700], ["1249,", 124900], ["1.", 100], ["1.249,", 124900]] as const) assert.equal(parseLira(text), kurus, text);
  assert.equal(parseLira(""), null);
  assert.equal(parseLira("   "), null);
  for (const text of ["0", "0,00", "1,234", "1.249.9", "12,345.67", "-5", "1e3", "abc", "21474836,48", "999999999", "1 249,90", "₺10", ",5", ".", "1,,"]) assert.equal(parseLira(text), "invalid", text);
  assert.deepEqual(priceInput({ price: "1.249,90" }).data, { price_kurus: 124990, sale_price_kurus: null, sale_from: null, sale_until: null });
  assert.equal(liraInput(124990), "1249,90");
  assert.equal(liraInput(124900), "1249");
  assert.equal(liraInput(5), "0,05");
  assert.equal(liraInput(null), "");
  for (const kurus of [1, 99, 100, 124990, 2147483647]) assert.equal(parseLira(liraInput(kurus)), kurus);
});

test("campaign rules: a date needs a campaign price, the campaign sells below the fixed price and ends after it starts", () => {
  const message = (values: Parameters<typeof priceInput>[0]) => { const result = priceInput(values); return result.success ? null : result.error.issues.map(issue => [issue.path[0], issue.message]); };
  assert.equal(message({ price: "200", sale_price: "150", sale_from: "2026-11-20T00:00", sale_until: "2026-11-27T00:00" }), null);
  assert.equal(message({ sale_price: "150" }), null);
  assert.deepEqual(message({ sale_until: "2026-11-27T00:00" }), [["sale_price", "Kampanya tarihleri için kampanya fiyatı girin."]]);
  assert.deepEqual(message({ price: "150", sale_price: "150" }), [["sale_price", "Kampanya fiyatı sabit satış fiyatından düşük olmalı."]]);
  assert.deepEqual(message({ sale_price: "150", sale_from: "2026-11-27T00:00", sale_until: "2026-11-27T00:00" }), [["sale_until", "Kampanya bitişi başlangıçtan sonra olmalı."]]);
  for (const time of ["2026-02-30T10:00", "2026-11-20 10:00", "2026-11-20T24:00", "2026-11-20", "1999-12-31T23:59"]) assert.ok(message({ sale_price: "1", sale_from: time }), time);
  assert.equal(priceInput({ price: "abc" }).success, false);
});

test("best offer: cheapest, then the lower cost, the listing's own row and the id; campaign helpers read the snapshot", () => {
  const offer = (id: string, price_kurus: number | null, cost?: number) => ({ id, price_kurus, pricing_snapshot: cost === undefined ? {} : { cost_kurus: cost } });
  const order = (primary: string, offers: ReturnType<typeof offer>[]) => [...offers].sort(compareOffers(primary)).map(item => item.id);
  assert.deepEqual(order("a", [offer("a", 200, 100), offer("b", 150, 120)]), ["b", "a"]);
  // A fixed price makes every source equal: the cheaper source to buy sells.
  assert.deepEqual(order("a", [offer("a", 200, 120), offer("b", 200, 100)]), ["b", "a"]);
  assert.deepEqual(order("b", [offer("a", 200, 100), offer("b", 200, 100), offer("c", 200)]), ["b", "a", "c"]);
  assert.deepEqual(order("x", [offer("d", 200, 100), offer("c", 200, 100)]), ["c", "d"]);
  assert.deepEqual(order("x", [offer("a", null, 1), offer("b", 500)]), ["b", "a"]);
  const sale = { pricing_snapshot: { source: "override", price_kind: "sale", list_price_kurus: 20000, sale_until: "2026-11-19T21:00:00+00:00", fixed_price_kurus: 20000 } };
  assert.equal(listPrice(sale), 20000);
  assert.equal(saleUntil(sale)?.toISOString(), "2026-11-19T21:00:00.000Z");
  assert.equal(fixedPrice(sale.pricing_snapshot), 20000);
  assert.equal(listPrice({ pricing_snapshot: { source: "override", price_kind: "fixed", fixed_price_kurus: 20000 } }), null);
  assert.equal(fixedPrice({ source: "supplier", fixed_price_kurus: 20000 }), null);
  assert.equal(saleUntil({ pricing_snapshot: { price_kind: "sale", list_price_kurus: 20000, sale_until: null } }), null);
});

test("below cost compares with the VAT-included cost; unknowns never warn; history text shows lira and Istanbul time", () => {
  // Cost 100.00 TL before VAT, 20% VAT: 120.00 TL.
  assert.equal(costWithVat(10000, 20), 12000);
  assert.equal(belowCost(11999, 10000, 20), true);
  assert.equal(belowCost(12000, 10000, 20), false);
  assert.equal(belowCost(11999, null, 20), false);
  assert.equal(belowCost(11999, 10000, null), false);
  assert.equal(belowCost(null, 10000, 20), false);
  assert.equal(belowCost(100, 85.5, 18.5), true);
  assert.equal(overrideValueText("124990", "price_kurus"), (1249.9).toLocaleString("tr-TR", { style: "currency", currency: "TRY" }));
  assert.equal(overrideValueText("2026-11-20T00:00", "sale_from"), "20.11.2026 00:00 (İstanbul)");
  assert.equal(overrideValueText("true", "hidden"), "Gizli");
  assert.equal(overrideValueText(null, "sale_until"), null);
});

test("price form: saves show stored values, a campaign revert resets its window only, stale tabs keep their input", () => {
  const stored = { price_kurus: 20000, sale_price_kurus: 18000, sale_from: "2026-11-20T00:00", sale_until: "2026-11-27T00:00" };
  let state = initialPriceForm(stored, "1");
  assert.deepEqual(state.values, { price: "200", sale_price: "180", sale_from: "2026-11-20T00:00", sale_until: "2026-11-27T00:00" });
  state = priceFormReducer(state, { type: "edit", values: { price: "210", sale_until: "2026-12-01T00:00" } });
  state = priceFormReducer(state, { type: "result", result: { status: "success", reset: "sale_price_kurus", version: "2",
    values: { ...stored, sale_price_kurus: null, sale_from: null, sale_until: null } } });
  assert.deepEqual(state, { version: "2", dirty: ["price"], values: { price: "210", sale_price: "", sale_from: "", sale_until: "" } });
  assert.equal(priceFormReducer(state, { type: "result", result: { status: "error", message: "x" } }), state);
  assert.equal(priceFormReducer(state, { type: "server", values: null, version: "2" }), state);
  // Another tab saved meanwhile: the typed price stays with the old version, so the next save is refused as stale.
  assert.deepEqual(priceFormReducer(state, { type: "server", values: { price_kurus: 30000, sale_price_kurus: 25000, sale_from: null, sale_until: null }, version: "3" }),
    { version: "2", dirty: ["price"], values: { price: "210", sale_price: "250", sale_from: "", sale_until: "" } });
  state = priceFormReducer(state, { type: "result", result: { status: "success", version: "4", values: { price_kurus: 21000, sale_price_kurus: null, sale_from: null, sale_until: null } } });
  assert.deepEqual(state, { version: "4", dirty: [], values: { price: "210", sale_price: "", sale_from: "", sale_until: "" } });
});

test("PostgreSQL: fixed and campaign prices over the formula, per source, with snapshots and history (#580)", { skip: !process.env.DATABASE_URL && "DATABASE_URL not set" }, async () => {
  const schema = await isolatedSchema("product_price_override_test");
  const { pool } = schema;
  try {
    const { storefrontCompanies } = await import("../src/modules/suppliers/storefront-sources");
    const store = await import("../src/modules/admin/product-override-store");
    const [basbug, , dinamik] = storefrontCompanies();
    // Setup is repeatable with the new columns and constraints in place.
    for (const file of ["commerce", "product-overrides"]) await pool.query(await readFile(`db/${file}.sql`, "utf8"));
    const ids: Record<string, string> = {};
    const item = async (key: string, supplier: "basbug" | "dinamik", code: string, nf: number) => {
      ids[key] = (await pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
        product_count,price_count,stock_count,first_seen_at,last_seen_at,changed_at)
        VALUES($1,$2,'G',$3,$4,$5,$6,'{"stok":3}',1,1,1,now(),now()-interval '1 hour',now()) RETURNING id::text`,
      [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code,
        JSON.stringify({ uk: "FEBI", ac: "FEBI BALATA", dc: "TL", ...supplier === "dinamik" ? { marka: "FEBI", stokAdi: "FEBI BALATA" } : {} }), JSON.stringify({ nf })])).rows[0].id;
    };
    await item("basbug", "basbug", "FEB 10010", 100);
    await item("dinamik", "dinamik", "FEBI 10010", 90);
    await pool.query("SELECT refresh_product_matches()");
    const product = (await pool.query<{ product_id: string }>("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids.basbug])).rows[0].product_id;
    assert.equal((await pool.query("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids.dinamik])).rows[0].product_id, product);
    const admin = (await pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Fiyat','price@example.invalid','x','admin',true) RETURNING id::text")).rows[0].id;
    const row = async (key: string) => (await pool.query<{ price_kurus: number | null; pricing_snapshot: Record<string, unknown> }>(
      "SELECT price_kurus,pricing_snapshot FROM commerce_catalog WHERE id=$1", [ids[key]])).rows[0];
    const save = (patch: Parameters<typeof store.persistProductOverride>[2]) => store.persistProductOverride(pool, product, patch, admin);
    const formulaKeys = ["checkout_mode", "company", "cost_kurus", "currency", "exchange_rate", "list_group", "markup_percent", "nf", "observed_at",
      "rate_at", "source", "source_fresh", "stock", "vat_percent", "warehouse"];

    // The formula: 100 TL × 1.30 × 1.20 and 90 TL × 1.30 × 1.20.
    let basbugRow = await row("basbug");
    assert.equal(basbugRow.price_kurus, 15600);
    assert.equal((await row("dinamik")).price_kurus, 14040);
    assert.deepEqual(Object.keys(basbugRow.pricing_snapshot).sort(), formulaKeys);
    assert.equal(basbugRow.pricing_snapshot.source, "supplier");
    assert.equal(Number(basbugRow.pricing_snapshot.cost_kurus), 10000);

    // A fixed price replaces the formula on every source of the product; the snapshot keeps the formula's price.
    assert.ok((await save({ price_kurus: 20000 })).ok);
    for (const [key, auto, cost] of [["basbug", 15600, 10000], ["dinamik", 14040, 9000]] as const) {
      const priced = await row(key);
      assert.equal(priced.price_kurus, 20000, key);
      assert.deepEqual(Object.keys(priced.pricing_snapshot).sort(), [...formulaKeys, "auto_price_kurus", "fixed_price_kurus", "price_kind"].sort());
      assert.deepEqual([priced.pricing_snapshot.source, priced.pricing_snapshot.price_kind, priced.pricing_snapshot.auto_price_kurus, priced.pricing_snapshot.fixed_price_kurus,
        Number(priced.pricing_snapshot.cost_kurus)], ["override", "fixed", auto, 20000, cost]);
    }
    // A changed markup moves the formula, never the fixed price.
    await pool.query("UPDATE commerce_settings SET markup_percent=50");
    basbugRow = await row("basbug");
    assert.equal(basbugRow.price_kurus, 20000);
    assert.equal(basbugRow.pricing_snapshot.auto_price_kurus, 18000);
    await pool.query("UPDATE commerce_settings SET markup_percent=30");

    // A campaign applies only inside its window (NULL ends open), and only below the regular price.
    const window = async (from: string | null, until: string | null) => {
      await pool.query(`UPDATE product_overrides SET sale_price_kurus=18000,sale_from=now()+$2::interval,sale_until=now()+$3::interval WHERE product_id=$1`, [product, from, until]);
      await pool.query("SELECT product_overrides_project(ARRAY[$1::uuid])", [product]);
      return row("basbug");
    };
    assert.equal((await window("1 hour", null)).price_kurus, 20000);
    const running = await window("-1 hour", "1 day");
    assert.equal(running.price_kurus, 18000);
    assert.deepEqual([running.pricing_snapshot.price_kind, running.pricing_snapshot.list_price_kurus, running.pricing_snapshot.auto_price_kurus],
      ["sale", 20000, 15600]);
    assert.ok(Math.abs(new Date(String(running.pricing_snapshot.sale_until)).getTime() - Date.now() - 86_400_000) < 60_000);
    assert.equal((await window(null, null)).price_kurus, 18000);
    const ended = await window("-2 days", "-1 hour");
    assert.equal(ended.price_kurus, 20000);
    assert.equal(ended.pricing_snapshot.price_kind, "fixed");
    assert.equal(ended.pricing_snapshot.list_price_kurus, undefined);
    // Without the fixed price, each source compares the campaign with its own formula price.
    await pool.query("UPDATE product_overrides SET price_kurus=NULL,sale_price_kurus=15000,sale_from=NULL,sale_until=NULL WHERE product_id=$1", [product]);
    await pool.query("SELECT product_overrides_project(ARRAY[$1::uuid])", [product]);
    const [onSale, notBelow] = [await row("basbug"), await row("dinamik")];
    assert.deepEqual([onSale.price_kurus, onSale.pricing_snapshot.source, onSale.pricing_snapshot.price_kind, onSale.pricing_snapshot.list_price_kurus,
      onSale.pricing_snapshot.fixed_price_kurus], [15000, "override", "sale", 15600, undefined]);
    assert.deepEqual([notBelow.price_kurus, notBelow.pricing_snapshot.source, notBelow.pricing_snapshot.price_kind], [14040, "supplier", undefined]);

    // Missing supplier data (stale observation): no formula price, so no price at all, override or not.
    await pool.query("UPDATE supplier_items SET last_seen_at=now()-interval '10 days' WHERE id=$1", [ids.basbug]);
    assert.equal((await row("basbug")).price_kurus, null);
    await pool.query("UPDATE supplier_items SET last_seen_at=now()-interval '1 hour',price_data=NULL WHERE id=$1", [ids.basbug]);
    assert.equal((await row("basbug")).price_kurus, null);
    await pool.query(`UPDATE supplier_items SET price_data='{"nf":100}' WHERE id=$1`, [ids.basbug]);

    // The admin store: Istanbul wall clock in and out, an ended campaign refused, invalid pairs refused by the table.
    assert.deepEqual(await save({ sale_price_kurus: 15000, sale_from: "2026-11-01T00:00", sale_until: "2026-11-02T00:00" }), { ok: false, reason: "sale-expired" });
    const saved = await save({ price_kurus: 20000, sale_price_kurus: 18000, sale_from: "2026-11-20T00:00", sale_until: "2099-01-01T00:00" });
    assert.ok(saved.ok);
    assert.equal((await pool.query("SELECT to_char(sale_from AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI') AS utc FROM product_overrides WHERE product_id=$1", [product])).rows[0].utc, "2026-11-19 21:00");
    const details = await store.loadProductOverride(pool, product);
    assert.deepEqual([details.override?.price_kurus, details.override?.sale_price_kurus, details.override?.sale_from, details.override?.sale_until],
      [20000, 18000, "2026-11-20T00:00", "2099-01-01T00:00"]);
    // The same in another session time zone: the column is a moment, the text is Istanbul's.
    const elsewhere = new URL(process.env.DATABASE_URL!);
    elsewhere.searchParams.set("options", `${elsewhere.searchParams.get("options")} -c timezone=America/New_York`);
    const newYork = new Pool({ connectionString: elsewhere.toString() });
    try {
      assert.equal((await newYork.query("SHOW timezone")).rows[0].TimeZone, "America/New_York");
      assert.equal((await store.loadProductOverride(newYork, product)).override?.sale_from, "2026-11-20T00:00");
    } finally { await newYork.end(); }
    await assert.rejects(save({ sale_price_kurus: 25000 }), /product_overrides_sale_below_price/);
    // History: one row per changed field, as text (kuruş, Istanbul wall clock).
    assert.deepEqual(details.changes.filter(change => change.field === "sale_from").map(change => [change.old_value, change.new_value]), [[null, "2026-11-20T00:00"]]);
    // The fixed price was set, cleared outside the store above (not recorded) and set again.
    assert.deepEqual(details.changes.filter(change => change.field === "price_kurus").map(change => [change.old_value, change.new_value, change.changed_by]),
      [[null, "20000", "Fiyat"], [null, "20000", "Fiyat"]]);

    // An ended campaign left as it is does not block another change (it no longer applies); a new past end does.
    await pool.query("UPDATE product_overrides SET sale_from=now()-interval '2 days',sale_until=now()-interval '1 day' WHERE product_id=$1", [product]);
    const stale = (await store.loadProductOverride(pool, product)).override!;
    assert.ok((await save({ price_kurus: 21000, sale_price_kurus: stale.sale_price_kurus, sale_from: stale.sale_from, sale_until: stale.sale_until })).ok);
    assert.deepEqual(await save({ sale_until: "2026-01-01T00:00" }), { ok: false, reason: "sale-expired" });
    assert.equal((await row("basbug")).price_kurus, 21000);
    // Below cost is reported, never refused: 110.00 TL is under the Başbuğ row's 120.00 TL VAT-included cost.
    assert.ok((await save({ price_kurus: 11000, sale_price_kurus: null, sale_from: null, sale_until: null })).ok);
    assert.deepEqual((await store.belowCostSources(pool, product)).map(source => [source.code, source.price_kurus, source.cost_with_vat_kurus]),
      [["FEB 10010", 11000, 12000]]);

    // Back to automatic: the formula again, no override keys, no projection row.
    assert.ok((await save({ price_kurus: null })).ok);
    basbugRow = await row("basbug");
    assert.equal(basbugRow.price_kurus, 15600);
    assert.deepEqual(Object.keys(basbugRow.pricing_snapshot).sort(), formulaKeys);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM commerce_item_overrides WHERE product_id=$1", [product])).rows[0].n, 0);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM product_overrides WHERE product_id=$1", [product])).rows[0].n, 0);
  } finally {
    await schema.drop();
  }
});
