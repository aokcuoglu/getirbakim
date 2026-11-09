import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { productPricePreview, productPricingSchema } from "../src/modules/admin/product-pricing-schema";

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
