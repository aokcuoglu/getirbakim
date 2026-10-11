import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";

// Pure SQL helpers from db/product-matching.sql (applied by db:setup); runs against the local database.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
after(() => pool.end());
const one = async (sql: string, values: unknown[]) => (await pool.query(sql, values)).rows[0].value;
const part = (supplier: string, code: string, data: object) => one("SELECT supplier_item_part_number($1,$2,$3) AS value", [supplier, code, JSON.stringify(data)]);
const brand = (value: string) => one("SELECT product_brand_key($1) AS value", [value]);

test("supplier prefixes are dropped; original parts and SETA keep the whole code", async () => {
  assert.equal(await part("basbug", "MANN W 712/95", { uk: "MANN" }), "W71295");
  assert.equal(await part("dinamik", "MANN W712/95", { marka: "MANN" }), "W71295");
  assert.equal(await part("basbug", "BK21 60762 BC35B8", { uk: "OE-FD" }), "BK2160762BC35B8");
  assert.equal(await part("dinamik", "PSA-E 1574.W2", { marka: "PSA ORIJINAL" }), "1574W2");
  assert.equal(await part("seta", "TRA SET 1", { uk: "SETA" }), "TRASET1");
});

test("brand keys ignore spelling and fold original-equipment labels together", async () => {
  assert.equal(await brand("MEAT & DORIA"), await brand("MEAT&DORIA"));
  assert.equal(await brand("BOSCH-AV"), "BOSCH");
  for (const label of ["OE-PSA", "IOE-HYU", "PSA ORIJINAL", "ORJINAL", "OPAR", "GM"]) assert.equal(await brand(label), "ORIJINAL", label);
  assert.equal(await brand("MAHLE FILTRE"), "MAHLEFILTRE"); // left to brand-pair review, not guessed
  assert.equal(await brand("  "), null);
});

test("names come from each supplier's own field", async () => {
  assert.equal(await one("SELECT supplier_item_name('dinamik',$1) AS value", [JSON.stringify({ stokAdi: "ROT BASI" })]), "ROT BASI");
  assert.equal(await one("SELECT supplier_item_name('basbug',$1) AS value", [JSON.stringify({ ac: "" })]), null);
});

test("OEM numbers split on , ; / but keep Ford-style spaces; short fragments are dropped", async () => {
  const oems = (supplier: string, data: object) => one("SELECT supplier_item_oem_numbers($1,$2) AS value", [supplier, JSON.stringify(data)]);
  assert.deepEqual(await oems("basbug", { oe: "6C11 2282 EB" }), ["6C112282EB"]);
  assert.deepEqual(await oems("basbug", { oe: "4254.69 / 1611140880; 3M5Q 9F593 /SET" }), ["1611140880", "3M5Q9F593", "425469"]);
  assert.deepEqual(await oems("seta", { oems: ["25500-2B000"], oe: "ignored for SETA" }), ["255002B000"]);
  assert.deepEqual(await oems("dinamik", { oe: "1234567" }), []);
});

test("only check-digit-valid GTINs count as barcodes", async () => {
  const gtin = (code: string) => one("SELECT gtin_valid($1) AS value", [code]);
  assert.equal(await gtin("5414465978258"), true);
  assert.equal(await gtin("5414465978259"), false);
  assert.equal(await gtin("1617975680"), false); // OEM number stored in a barcode field
  assert.equal(await gtin("0000000000000"), false);
});

test("offer groups are listed under the Başbuğ item and never contain SETA or split items", async () => {
  const count = (sql: string) => one(`SELECT count(*)::int AS value FROM ${sql}`, []);
  assert.equal(await count(`product_offers o JOIN supplier_items p ON p.id=o.primary_id JOIN supplier_items i ON i.id=o.item_id
    WHERE i.supplier='basbug' AND p.supplier<>'basbug'`), 0);
  assert.equal(await count("product_offers o JOIN supplier_items i ON i.id=o.item_id WHERE i.supplier='seta'"), 0);
  // Every offer group is exactly one master product.
  assert.equal(await count(`product_offers o JOIN product_sources a ON a.supplier_item_id=o.item_id
    JOIN product_sources b ON b.supplier_item_id=o.primary_id WHERE a.product_id<>b.product_id`), 0);
});

test("master products: one automatic product per key, symmetric equivalents", async () => {
  const count = (sql: string) => one(`SELECT count(*)::int AS value FROM ${sql}`, []);
  assert.equal(await count(`product_sources s JOIN product_match_items m ON m.supplier_item_id=s.supplier_item_id
    JOIN products p ON p.id=s.product_id WHERE s.method='auto' AND (p.brand,p.part_number,p.variant)<>(m.brand,m.part_number,0)`), 0);
  assert.equal(await count(`product_sources s JOIN products p ON p.id=s.product_id WHERE s.method='manual' AND p.variant=0`), 0);
  assert.equal(await count(`product_equivalents e WHERE NOT EXISTS (SELECT 1 FROM product_equivalents r
    WHERE r.product_id=e.equivalent_id AND r.equivalent_id=e.product_id)`), 0);
});

test("a split row gets its own locked product and rejoins on undo", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const pick = (await client.query<{ item: string; product: string }>(`SELECT s.supplier_item_id AS item, s.product_id AS product
      FROM product_sources s JOIN products p ON p.id=s.product_id AND p.variant=0
      WHERE s.method='auto' AND s.supplier_item_id<>s.product_id LIMIT 1`)).rows[0];
    assert.ok(pick, "expected a product with more than one source");
    const split = (await client.query<{ id: string }>("SELECT product_split_item($1,NULL) AS id", [pick.item])).rows[0].id;
    assert.notEqual(split, pick.product);
    const link = (await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=$1", [pick.item])).rows[0];
    assert.deepEqual(link, { product_id: split, method: "manual" });
    assert.ok((await client.query("SELECT variant FROM products WHERE id=$1", [split])).rows[0].variant > 0);
    assert.equal((await client.query("SELECT product_unsplit_item($1) AS id", [pick.item])).rows[0].id, pick.product);
    assert.deepEqual((await client.query("SELECT product_id,method FROM product_sources WHERE supplier_item_id=$1", [pick.item])).rows[0],
      { product_id: pick.product, method: "auto" });
    assert.equal((await client.query("SELECT merged_into FROM products WHERE id=$1", [split])).rows[0].merged_into, pick.product);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
