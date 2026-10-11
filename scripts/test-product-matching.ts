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
