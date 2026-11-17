import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { syncSharedLinks } from "./test-helpers/shared-links";
import { syncProductStates } from "./test-helpers/product-states";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// A supplier OEM field hidden on a product (#615) also stops the enrichment matched through that OEM (#865), in an
// isolated copy of the schema: enrichment_valid_data drops it, so the storefront link, make/model lists and the
// dashboard state follow; exact part, cross reference and own part code matches stay. The raw rows are never deleted,
// and showing the OEM again brings everything back.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let overrides: typeof import("../src/modules/admin/product-override-store");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();
let admin: string;
const brandId = 9101, modelId = 9102, typeId = 9103;
const vehicle = { model: "GOLF", engine: "1.6" };
const payload = JSON.stringify({ vehicles: [vehicle], specifications: [{ name: "Çap", value: "80 mm" }], oemNumbers: {} });

async function item(key: string, code: string, brand: string, oe?: string) {
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [basbug, code, { dc: "TL", ac2: "", uk: brand, ac: `${brand} PARCA`, ...(oe ? { oe } : {}) }]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
/** A finished job and its enrichment (with one matched vehicle) for the item, matched by `basis`. */
async function enrich(key: string, basis: Record<string, string>, importedAt: string) {
  const s = (await schema.pool.query<{ code: string; uk: string; oe: string }>(
    "SELECT code,product_data->>'uk' AS uk,COALESCE(product_data->>'oe','') AS oe FROM supplier_items WHERE id=$1", [ids[key]])).rows[0];
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,status,supplier_code,supplier_brand,oem)
    VALUES($1,'complete',$2,$3,$4)`, [ids[key], s.code, s.uk, s.oe]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,
    manufacturer_part_number,payload,match_basis,imported_at) VALUES($1,$2,$3,'https://www.trodo.com/test','test','TEST','P1',$4,$5,$6)`,
  [ids[key], s.code, s.uk, payload, { ...basis, supplierOem: s.oe }, importedAt]);
  await schema.pool.query(`INSERT INTO product_vehicle_fitments(supplier_item_id,source_index,source_vehicle,vehicle_type_id,match_status,matcher_version)
    VALUES($1,0,$2,$3,'matched','t')`, [ids[key], JSON.stringify(vehicle), typeId]);
}
const drain = async () => { await syncSharedLinks(schema.pool); await syncProductStates(schema.pool); };
const setOemHidden = async (key: string, hidden: boolean) => {
  const result = await overrides.persistProductOverride(schema.pool, await productOf(key), { hide_supplier_oem: hidden }, admin);
  assert.ok(result.ok);
};
const valid = async (key: string) => (await schema.pool.query(
  "SELECT 1 FROM enrichment_valid_data WHERE supplier_item_id=$1", [ids[key]])).rowCount === 1;
const donorOf = async (key: string) => (await schema.pool.query<{ donor: string }>(
  "SELECT donor_item_id::text AS donor FROM product_enrichment_shared_links WHERE supplier_item_id=$1", [ids[key]])).rows[0]?.donor ?? null;
const makeFits = async (key: string) => (await schema.pool.query<{ n: number }>(`SELECT
  ((SELECT count(*) FROM storefront_make_fits WHERE supplier_item_id=$1 AND brand_id=$2)+
  (SELECT count(*) FROM storefront_model_fits WHERE supplier_item_id=$1 AND model_id=$3))::int AS n`, [ids[key], brandId, modelId])).rows[0].n;
const state = async (key: string) => (await schema.pool.query<{ status: string; enriched: boolean }>(
  "SELECT status,enriched FROM enrichment_product_states WHERE product_id=$1", [await productOf(key)])).rows[0];
const raw = async (keys: string[]) => (await schema.pool.query<{ e: number; f: number }>(`SELECT
  (SELECT count(*)::int FROM product_enrichments WHERE supplier_item_id::text=ANY($1)) AS e,
  (SELECT count(*)::int FROM product_vehicle_fitments WHERE supplier_item_id::text=ANY($1)) AS f`, [keys.map(key => ids[key])])).rows[0];

before(async () => {
  schema = await isolatedSchema("hidden_oem_enrichment_test");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(${brandId},'VW','Volkswagen');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(${modelId},${brandId},'GOLF');
    INSERT INTO vehicle_types(id,model_id,name,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
     VALUES(${typeId},${modelId},'1.6','petrol','Benzin',102,75,'2004-01-01','vw golf 1.6')`);
  // (a) one source, matched through its supplier OEM.
  await item("single", "BOS 10010001", "BOSCH", "1K0615301AA");
  // (b) one product with two offers: the newer enrichment through the supplier OEM, the older one by exact part.
  await item("viaOem", "FEB 20020002", "FEBI", "7701208266");
  await item("exact", "FBI 20020002", "FEBI");
  // (c) other match bases, each on its own product.
  await item("exactOnly", "MAH 30030003", "MAHLE", "6020030303");
  await item("cross", "MEY 40040004", "MEYLE", "4410020011");
  await item("ownCode", "9673689380", "OE-PSA", "9673689380");
  await item("legacyOem", "VAL 50050005", "VALEO", "5520030044");
  await schema.pool.query("SELECT refresh_product_matches()");
  await enrich("single", { type: "oem_reference", reference: "1K0615301AA", referenceSource: "supplier_oem" }, "2026-11-10T10:00:00Z");
  await enrich("viaOem", { type: "oem_reference", reference: "7701208266", referenceSource: "supplier_oem" }, "2026-11-10T10:00:00Z");
  await enrich("exact", { type: "exact_part" }, "2026-11-01T10:00:00Z");
  await enrich("exactOnly", { type: "exact_part" }, "2026-11-10T10:00:00Z");
  await enrich("cross", { type: "cross_reference", reference: "4410020011" }, "2026-11-10T10:00:00Z");
  await enrich("ownCode", { type: "oem_reference", reference: "9673689380", referenceSource: "original_manufacturer_part_code" }, "2026-11-10T10:00:00Z");
  // Written before referenceSource existed: read as the supplier's OEM.
  await enrich("legacyOem", { type: "oem_reference", reference: "5520030044" }, "2026-11-10T10:00:00Z");
  await drain();
  const [{ db }, overridesModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/admin/product-override-store")]);
  overrides = overridesModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("the fixture's enrichments reach the store before any OEM is hidden", async () => {
  assert.equal(await productOf("viaOem"), await productOf("exact"), "both FEBI offers form one product");
  for (const key of ["single", "viaOem", "exact", "exactOnly", "cross", "ownCode", "legacyOem"]) assert.ok(await valid(key), key);
  assert.equal(await donorOf("single"), ids.single);
  assert.equal(await donorOf("exact"), ids.viaOem, "the newer enrichment is shared");
  assert.equal(await makeFits("single"), 2);
  assert.deepEqual(await state("single"), { status: "complete", enriched: true });
});

test("hiding the supplier OEM drops enrichment matched through it and keeps the raw rows", async () => {
  const before = await raw(["single"]);
  await setOemHidden("single", true);
  await drain();
  assert.equal(await valid("single"), false);
  assert.equal(await donorOf("single"), null);
  assert.equal(await makeFits("single"), 0);
  assert.deepEqual(await state("single"), { status: "not_found", enriched: false });
  assert.deepEqual(await raw(["single"]), before);
  await setOemHidden("single", false);
  await drain();
  assert.equal(await valid("single"), true);
  assert.equal(await donorOf("single"), ids.single);
  assert.equal(await makeFits("single"), 2);
  assert.deepEqual(await state("single"), { status: "complete", enriched: true });
});

test("a product with another source shares that source's enrichment while the OEM is hidden", async () => {
  await setOemHidden("viaOem", true);
  await drain();
  assert.equal(await valid("viaOem"), false);
  assert.equal(await valid("exact"), true);
  assert.equal(await donorOf("viaOem"), ids.exact);
  assert.equal(await donorOf("exact"), ids.exact);
  assert.equal(await makeFits("viaOem"), 2, "the exact part's vehicles");
  await setOemHidden("viaOem", false);
  await drain();
  assert.equal(await donorOf("exact"), ids.viaOem);
});

test("only supplier OEM matches drop: exact part, cross reference and own part code stay", async () => {
  for (const key of ["exactOnly", "cross", "ownCode", "legacyOem"]) await setOemHidden(key, true);
  await drain();
  for (const key of ["exactOnly", "cross", "ownCode"]) {
    assert.equal(await valid(key), true, key);
    assert.equal(await donorOf(key), ids[key], key);
  }
  assert.equal(await valid("legacyOem"), false, "an OEM match without referenceSource is the supplier's OEM");
  assert.equal(await donorOf("legacyOem"), null);
  for (const key of ["exactOnly", "cross", "ownCode", "legacyOem"]) await setOemHidden(key, false);
  await drain();
  assert.equal(await donorOf("legacyOem"), ids.legacyOem);
});

test("only hide_oem changes queue the item and the product for both refreshes", async () => {
  const queued = async () => ({
    item: (await schema.pool.query("SELECT 1 FROM product_enrichment_shared_queue WHERE kind='i' AND id=$1", [ids.single])).rowCount,
    product: (await schema.pool.query("SELECT 1 FROM enrichment_product_state_queue WHERE product_id=$1", [await productOf("single")])).rowCount,
  });
  const clear = () => schema.pool.query("DELETE FROM product_enrichment_shared_queue;DELETE FROM enrichment_product_state_queue");
  await clear();
  await setOemHidden("single", true);
  assert.deepEqual(await queued(), { item: 1, product: 1 }, "hide");
  await drain();
  await setOemHidden("single", false);
  assert.deepEqual(await queued(), { item: 1, product: 1 }, "unhide");
  await drain();
  // The triggers themselves, on plain SQL writes: update, delete and insert.
  const product = await productOf("single");
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [ids.single, product]);
  for (const sql of [
    "UPDATE commerce_item_overrides SET hide_oem=true WHERE supplier_item_id=$1",
    "DELETE FROM commerce_item_overrides WHERE supplier_item_id=$1",
    "INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hide_oem) VALUES($1,$2,true)",
  ]) {
    await clear();
    await schema.pool.query(sql, sql.startsWith("INSERT") ? [ids.single, product] : [ids.single]);
    assert.deepEqual(await queued(), { item: 1, product: 1 }, sql);
  }
  // Writes that leave hide_oem unset or unchanged queue nothing. The row is hidden here: a name edit keeps it hidden.
  const writes: [string, boolean][] = [
    ["UPDATE commerce_item_overrides SET name='Yeni ad' WHERE supplier_item_id=$1", false],
    ["UPDATE commerce_item_overrides SET hide_oem=false WHERE supplier_item_id=$1", true],
    ["UPDATE commerce_item_overrides SET price_kurus=12345 WHERE supplier_item_id=$1", false],
    ["DELETE FROM commerce_item_overrides WHERE supplier_item_id=$1", false],
    ["INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hide_oem) VALUES($1,$2,false)", false],
  ];
  for (const [sql, queues] of writes) {
    await clear();
    await schema.pool.query(sql, sql.startsWith("INSERT") ? [ids.single, product] : [ids.single]);
    assert.deepEqual(await queued(), queues ? { item: 1, product: 1 } : { item: 0, product: 0 }, sql);
  }
  // Through the admin: a name and price edit of a product whose OEM is shown.
  await clear();
  const edit = await overrides.persistProductOverride(schema.pool, await productOf("exactOnly"), { name: "MAHLE YAĞ FİLTRESİ", price_kurus: 99900 }, admin);
  assert.ok(edit.ok);
  assert.equal((await schema.pool.query("SELECT 1 FROM product_enrichment_shared_queue WHERE id=$1", [ids.exactOnly])).rowCount, 0);
  assert.equal((await schema.pool.query("SELECT 1 FROM enrichment_product_state_queue WHERE product_id=$1", [await productOf("exactOnly")])).rowCount, 0);
  await schema.pool.query("DELETE FROM commerce_item_overrides WHERE supplier_item_id=$1", [ids.single]);
  await setOemHidden("single", false);
  await drain();
  assert.equal(await donorOf("single"), ids.single);
});

test("a fresh copy of the hidden enrichment (storefront sync) stays out", async () => {
  await setOemHidden("single", true);
  await drain();
  // What a storefront:sync import writes: the same enrichment upserted with a new import time, the job complete.
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,
    manufacturer_part_number,payload,match_basis,imported_at)
    SELECT supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,match_basis,now()
    FROM product_enrichments WHERE supplier_item_id=$1
    ON CONFLICT (supplier_item_id) DO UPDATE SET payload=EXCLUDED.payload,match_basis=EXCLUDED.match_basis,imported_at=EXCLUDED.imported_at`, [ids.single]);
  await schema.pool.query("UPDATE product_enrichment_jobs SET status='complete',updated_at=now() WHERE supplier_item_id=$1", [ids.single]);
  await drain();
  assert.equal(await donorOf("single"), null);
  assert.equal(await makeFits("single"), 0);
  assert.deepEqual(await state("single"), { status: "not_found", enriched: false });
});

test("collectors do not pick the hidden product up again", async () => {
  // enrichment-worker.ts and spareto-enrichment.ts select status 'pending' from enrichment_product_catalog.
  const { rows } = await schema.pool.query<{ status: string }>("SELECT status FROM enrichment_product_catalog WHERE product_id=$1", [await productOf("single")]);
  assert.deepEqual(rows, [{ status: "not_found" }]);
  await setOemHidden("single", false);
  await drain();
  assert.deepEqual(await state("single"), { status: "complete", enriched: true });
});
