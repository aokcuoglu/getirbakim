import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The equivalent search of the admin product page (#584) in an isolated copy of the schema.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let search: typeof import("../src/modules/admin/product-target-search");
const ids: Record<string, string> = {};
const [basbug, , dinamik] = storefrontCompanies();
let admin: string;

type Item = { supplier: "basbug" | "dinamik"; code: string; brand: string; name: string; extra?: Record<string, unknown> };
async function item(key: string, { supplier, code, brand, name, extra = {} }: Item) {
  const product = { uk: brand, ac: name, ac2: "", dc: "TL", ...supplier === "dinamik" ? { marka: brand, stokAdi: name } : {}, ...extra };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code, product]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const find = async (self: string, query: string) => (await search.searchEquivalentTargets(schema.pool, await productOf(self), query)).targets;
before(async () => {
  schema = await isolatedSchema("product_equivalents_test");
  // Başbuğ lists its OEM numbers in "oe"; both Başbuğ rows below share OEM 8E0615301.
  await item("febi", { supplier: "basbug", code: "FEB 10010", brand: "FEBI", name: "FEBI FREN BALATASI", extra: { oe: "8E0615301" } });
  await item("mahle", { supplier: "basbug", code: "MAH 20020", brand: "MAHLE", name: "MAHLE FREN BALATASI", extra: { oe: "8E0615301" } });
  await item("ngk", { supplier: "basbug", code: "NGK 30030", brand: "NGK", name: "NGK BUJI" });
  await item("skf", { supplier: "basbug", code: "SKF 40040", brand: "SKF", name: "SKF RULMAN" });
  await item("sachs", { supplier: "dinamik", code: "SACHS 50050", brand: "SACHS", name: "SACHS AMORTISOR" });
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  search = await import("../src/modules/admin/product-target-search");
});
after(async () => { const { db } = await import("../src/lib/db"); await db.end(); await schema?.drop(); });

test("a product is found by part number and supplier code, never itself", async () => {
  const hits = await find("febi", "40040");
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0].via, ["code"]);
  assert.equal(hits[0].brand_label, "SKF");
  assert.equal((await find("skf", "40040")).length, 0);
});

test("a shared OEM number finds the product by the oem arm", async () => {
  const found = await find("mahle", "8E0 615 301");
  const febi = found.find(hit => hit.brand_label === "FEBI");
  assert.ok(febi, "the FEBI product shares the OEM number");
  assert.deepEqual(febi.via, ["oem"]);
  assert.equal(found.some(hit => hit.brand_label === "MAHLE"), false);
});

test("a hand-entered OEM or cross number finds its product by the reference arm", async () => {
  const sachs = await productOf("sachs");
  await schema.pool.query(`INSERT INTO product_override_references(product_id,kind,action,brand,number,created_by) VALUES($1,'oem','add','VW','1K0 411 105',$2)`, [sachs, admin]);
  await schema.pool.query(`INSERT INTO product_override_references(product_id,kind,action,brand,number,created_by) VALUES($1,'oem','hide','VW','9Z9 999 999',$2)`, [sachs, admin]);
  const found = await find("ngk", "1K0411105");
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].via, ["reference"]);
  assert.equal((await find("ngk", "9Z9999999")).length, 0, "a hidden number is not a match");
});

test("a merged product is not offered", async () => {
  const [ngk, skf] = [await productOf("ngk"), await productOf("skf")];
  await schema.pool.query("UPDATE products SET merged_into=$1 WHERE id=$2", [ngk, skf]);
  assert.equal((await find("febi", "40040")).length, 0);
  await schema.pool.query("UPDATE products SET merged_into=NULL WHERE id=$1", [skf]);
  assert.equal((await find("febi", "40040")).length, 1);
});

test("linked pairs are marked equivalent and removed automatic pairs rejected", async () => {
  const [febi, mahle] = [await productOf("febi"), await productOf("mahle")];
  // The shared OEM number linked the pair automatically at the refresh.
  const linked = (await find("mahle", "FEB"))[0];
  assert.deepEqual([linked.equivalent, linked.rejected], [true, false]);
  assert.equal((await find("mahle", "40040"))[0].equivalent, false);
  await schema.pool.query("DELETE FROM product_equivalents WHERE product_id IN ($1,$2)", [febi, mahle]);
  const [a, b] = [febi, mahle].sort();
  await schema.pool.query("INSERT INTO product_equivalent_decisions(product_a,product_b,status,decided_by) VALUES($1,$2,'unrelated',$3)", [a, b, admin]);
  const hit = (await find("mahle", "FEB"))[0];
  assert.deepEqual([hit.equivalent, hit.rejected], [false, true]);
  await schema.pool.query("DELETE FROM product_equivalent_decisions WHERE product_a=$1 AND product_b=$2", [a, b]);
  await schema.pool.query("INSERT INTO product_equivalents(product_id,equivalent_id,kind,brand,part_number) VALUES($1,$2,'manual','FEBI','10010')", [mahle, febi]);
  assert.equal((await find("mahle", "FEB"))[0].equivalent, true);
});

test("a query shorter than three characters finds nothing", async () => {
  const result = await search.searchEquivalentTargets(schema.pool, await productOf("febi"), "FE");
  assert.deepEqual(result, { q: "FE", targets: [] });
});

async function enrich(payload: unknown) {
  await schema.pool.query("DELETE FROM product_enrichments WHERE supplier_item_id=$1", [ids.skf]);
  await schema.pool.query("DELETE FROM product_enrichment_jobs WHERE supplier_item_id=$1", [ids.skf]);
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,'SKF 40040','SKF','complete')`, [ids.skf]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
    VALUES($1,'SKF 40040','SKF','https://www.trodo.com/skf','test','SKF','40040',$2)`, [ids.skf, JSON.stringify(payload)]);
  await schema.pool.query("DELETE FROM product_enrichment_shared_queue");
  await schema.pool.query("SELECT product_enrichment_shared_refresh(NULL,NULL)");
}
// Back to the plain enriched state, so one failing assertion cannot cascade into the next test.
async function reset() {
  await schema.pool.query("UPDATE supplier_items SET code='SKF 40040' WHERE id=$1", [ids.skf]);
  await schema.pool.query("DELETE FROM product_override_references WHERE product_id=$1", [await productOf("skf")]);
  await enrich(skfOems);
}
const skfOems = { specifications: [], vehicles: [], oemNumbers: { VW: ["7H0 407 621 A"], BMW: ["31 22 6 765 601"], SHORT: ["A12B"], WORDS: ["ABCDE"] } };

test("an enrichment OEM number finds its product by the enrichment arm, exactly", async () => {
  await reset();
  const found = await find("febi", "7h0-407 621 a");
  assert.equal(found.length, 1);
  assert.equal(found[0].brand_label, "SKF");
  assert.deepEqual(found[0].via, ["enrichment"]);
  assert.equal((await find("skf", "7h0-407 621 a")).length, 0, "never itself");
  assert.equal((await find("febi", "7H0407621")).length, 0, "a partial number is not a match");
});

test("a number that is also hand-entered shows both paths", async () => {
  await reset();
  const skf = await productOf("skf");
  await schema.pool.query(`INSERT INTO product_override_references(product_id,kind,action,brand,number,created_by) VALUES($1,'oem','add','VW','7H0 407 621 A',$2)`, [skf, admin]);
  assert.deepEqual((await find("febi", "7H0407621A"))[0].via, ["enrichment", "reference"]);
});

test("a hidden enrichment OEM number is not a match, the others stay", async () => {
  await reset();
  const skf = await productOf("skf");
  await schema.pool.query(`INSERT INTO product_override_references(product_id,kind,action,brand,number,created_by) VALUES($1,'oem','hide','VW','7H0 407 621 A',$2)`, [skf, admin]);
  assert.equal((await find("febi", "7H0407621A")).length, 0);
  assert.deepEqual((await find("febi", "31226765601"))[0].via, ["enrichment"]);
});

test("the enrichment arm needs five characters", async () => {
  assert.equal((await find("febi", "A12B")).length, 0);
});

test("malformed oemNumbers do not break the search", async () => {
  for (const oemNumbers of [["7H0407621A"], "7H0407621A", { VW: "7H0407621A" }]) {
    await enrich({ specifications: [], vehicles: [], oemNumbers });
    assert.equal((await find("febi", "7H0407621A")).length, 0);
  }
});

test("the enrichment arm needs a digit in the query", async () => {
  await reset();
  assert.equal((await find("febi", "ABCDE")).length, 0);
});

test("an enrichment that does not describe the row, or only loosely matches it, is not a match", async () => {
  await reset();
  assert.equal((await find("febi", "7H0407621A")).length, 1);
  await schema.pool.query(`UPDATE product_enrichments SET match_basis='{"type":"oem_reference","supplierOem":"X1"}' WHERE supplier_item_id=$1`, [ids.skf]);
  await schema.pool.query("DELETE FROM product_enrichment_shared_queue");
  await schema.pool.query("SELECT product_enrichment_shared_refresh(NULL,NULL)");
  assert.equal((await find("febi", "7H0407621A")).length, 0, "a reference match to another OEM number is not the product's own enrichment");
  await reset();
  await schema.pool.query(`UPDATE product_enrichments SET match_basis='{"type":"cross_reference"}' WHERE supplier_item_id=$1`, [ids.skf]);
  await schema.pool.query("DELETE FROM product_enrichment_shared_queue");
  await schema.pool.query("SELECT product_enrichment_shared_refresh(NULL,NULL)");
  assert.equal((await find("febi", "7H0407621A")).length, 0, "a cross-reference enrichment is valid for the view but not exact: the arm excludes it");
  await reset();
  await schema.pool.query("UPDATE supplier_items SET code='SKF 99999' WHERE id=$1", [ids.skf]);
  assert.equal((await find("febi", "7H0407621A")).length, 0, "the enrichment of another code does not describe the row");
  await reset();
});
