import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { applyFitmentOverrides, type StoreVehicle } from "../src/modules/store/product-fitment-display";
import { fitmentHistoryValue, productFitmentLimit } from "../src/modules/admin/product-fitment-fields";
import { fitmentLevel } from "../src/modules/store/fitment-level";

// Admin-added and removed vehicle fitments (#583) in an isolated copy of the schema: db/product-override-fitments.sql,
// the store's vehicle filter and searches (typeFittedIds), make pages (storefront_make_fits), the product page's
// fitment level, the admin store and merge carry/undo.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let store: typeof import("../src/modules/admin/product-fitment-store");
let fitments: typeof import("../src/modules/store/product-fitments");
let catalog: typeof import("../src/modules/store/catalog");
let level: typeof import("../src/modules/store/fitment-level.server");
let epoch: typeof import("../src/modules/store/listing-epoch");
let sync: typeof import("../src/modules/store/fitment-sync");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const codes: Record<string, { code: string; brand: string }> = {};
const [basbug, , dinamik] = storefrontCompanies();
let admin: string;

const MERCEDES = 1, TOYOTA = 2;
type Item = { supplier: "basbug" | "dinamik"; code: string; brand: string; name: string };
async function item(key: string, { supplier, code, brand, name }: Item) {
  const product = { uk: brand, ac: name, ac2: "", dc: "TL", ...(supplier === "dinamik" ? { marka: brand, stokAdi: name } : {}) };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code, product]);
  ids[key] = rows[0].id;
  codes[key] = { code, brand };
}
const vehicleOf = (typeId: number) => ({ model: "MERCEDES-BENZ 190 (W201)", engineAndCodes: `E ${typeId}`, fuel: "Petrol", kw: 90, ps: 122, cc: 1997,
  from: "09/1984", to: "08/1993", typeId });
/** Fitments are rebuilt from the payload the way imports and rebuild-product-fitments.ts do (syncProductFitments). */
async function rebuildFitments(key: string) {
  const client = await schema.pool.connect();
  try {
    await client.query("BEGIN");
    const payload = (await client.query<{ payload: unknown }>("SELECT payload FROM product_enrichments WHERE supplier_item_id=$1", [ids[key]])).rows[0].payload;
    await sync.syncProductFitments(client, ids[key], payload, await sync.loadFitmentMatcher(client));
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
/** An enrichment of a Dinamik row; `code` other than the row's own is a stale payload the store must not show. */
async function enrich(key: string, typeIds: number[], code = codes[key].code) {
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,$2,$3,'complete')`, [ids[key], code, codes[key].brand]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
    VALUES($1,$2,$3,'https://www.trodo.com/x','test',$4,$5,$6)`,
  [ids[key], code, codes[key].brand, codes[key].brand, code.split(" ").at(-1), JSON.stringify({ specifications: [], vehicles: typeIds.map(vehicleOf), oemNumbers: {}, crossReferences: {} })]);
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const add = (productId: string, typeIds: number[]) => store.addProductFitments(schema.pool, productId, typeIds, admin);
const remove = (productId: string, typeId: number) => store.removeProductFitment(schema.pool, productId, typeId, admin);
const undo = (productId: string, rowId: string) => store.deleteProductFitment(schema.pool, productId, rowId, admin);
const merge = (source: string, target: string) => schema.pool.query<{ id: string | null; carried: { added: number; removed: number } }>(
  `WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT id::text, product_override_fitments_carry($1, id, $3) AS carried FROM merged`, [source, target, admin]);
const history = async (productId: string) => (await schema.pool.query<{ field: string; old_value: string | null; new_value: string | null; reason: string | null }>(
  "SELECT field,old_value,new_value,reason FROM product_override_changes WHERE product_id=$1 ORDER BY id", [productId])).rows;
const decisions = async (productId: string) => (await store.loadProductFitments(schema.pool, productId)).rows.map(row => [row.mode, row.typeId, row.carried]);
/** The store rows of a vehicle type; the listing epoch moves first, as the admin actions do. */
const fitted = async (typeId: number) => { await epoch.invalidateListings(); return new Set(await catalog.typeFittedIds(typeId)); };
/** The make lists after the queue the triggers filled is drained (the actions and the background sync do it). */
async function makes(key: string) {
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  return (await schema.pool.query<{ brand_id: number }>("SELECT brand_id FROM storefront_make_fits WHERE supplier_item_id=$1 ORDER BY 1", [ids[key]])).rows.map(row => row.brand_id);
}
const garage = (typeId: number) => ({ make: "X", model: "Y", year: 2020, vehicleId: String(typeId) });
const fitLevel = (key: string, typeId: number) => level.productFitmentLevel({ id: ids[key], ...codes[key] }, garage(typeId));

before(async () => {
  schema = await isolatedSchema("product_override_fitments_test");
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'MERCEDES-BENZ','MERCEDES-BENZ'),(2,'TOYOTA','TOYOTA');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'190 (W201)'),(20,2,'COROLLA CROSS'),(30,2,'YARIS');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text)
    SELECT id,model,name,1997,'Petrol','Benzin',122,90,'1984-09-01','1993-08-01',name FROM (VALUES (340,10,'2.0'),(344,10,'2.3'),(346,10,'2.5'),
     (802015,20,'2.0 VVTi Hybrid'),(802016,20,'1.8 Hybrid'),(900,30,'1.5')) t(id,model,name);
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
    SELECT 10000+n,30,'T'||n,1500,'Petrol','Benzin',100,74,'2020-01-01','t' FROM generate_series(1,${productFitmentLimit}) n;`);
  await item("febiBasbug", { supplier: "basbug", code: "FEB 10010", brand: "FEBI", name: "FEBI FREN BALATASI" });
  await item("febi", { supplier: "dinamik", code: "FEBI 10010", brand: "FEBI", name: "FEBI BALATA ON" });
  await item("bare", { supplier: "dinamik", code: "AYD 30030", brand: "AYD", name: "AYD ROT BASI" });
  await item("stale", { supplier: "dinamik", code: "TRW 50050", brand: "TRW", name: "TRW BALATA" });
  await item("ngk", { supplier: "basbug", code: "NGK 60060", brand: "NGK", name: "NGK BUJI" });
  await item("skf", { supplier: "basbug", code: "SKF 70070", brand: "SKF", name: "SKF RULMAN" });
  await item("lemA", { supplier: "basbug", code: "LEM 90090", brand: "LEMFORDER", name: "LEMFORDER ROT" });
  await item("lemB", { supplier: "basbug", code: "MOOG 91091", brand: "MOOG", name: "MOOG ROT" });
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  const [{ db }, storeModule, fitmentsModule, catalogModule, levelModule, epochModule, syncModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/admin/product-fitment-store"), import("../src/modules/store/product-fitments"), import("../src/modules/store/catalog"),
    import("../src/modules/store/fitment-level.server"), import("../src/modules/store/listing-epoch"), import("../src/modules/store/fitment-sync")]);
  store = storeModule;
  fitments = fitmentsModule;
  catalog = catalogModule;
  level = levelModule;
  epoch = epochModule;
  sync = syncModule;
  await enrich("febi", [340, 344]);
  await enrich("stale", [900], "TRW 50049");
  await rebuildFitments("febi");
  await rebuildFitments("stale");
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("removed types leave the shown vehicles, added ones follow once; the level and history read the decisions", () => {
  const added = (typeId: number): StoreVehicle => ({ model: "TOYOTA COROLLA CROSS", engineAndCodes: "2.0", fuel: "Petrol", kw: 1, ps: 1, cc: 0, from: "01/2020", to: null,
    vehicleTypeId: typeId, brandId: 2, modelId: 20, catalogEngine: "2.0", catalogBrand: "TOYOTA" });
  const automatic = [{ vehicleTypeId: 340, modelId: 10 }, { vehicleTypeId: null, modelId: null }, { vehicleTypeId: 344, modelId: 10 }];
  assert.equal(applyFitmentOverrides(automatic, { added: [], removed: [] }), automatic);
  assert.deepEqual(applyFitmentOverrides(automatic, { added: [added(344), added(802015)], removed: [340] }).map(row => row.vehicleTypeId), [null, 344, 802015]);
  assert.deepEqual(applyFitmentOverrides([], { added: [added(802015)], removed: [] }).map(row => row.vehicleTypeId), [802015]);
  assert.equal(fitmentLevel({ typeId: "340", modelId: "10" }, [{ vehicleTypeId: 344, modelId: 10 }], [340]), "mismatch");
  assert.equal(fitmentLevel({ typeId: "340", modelId: "10" }, [], [340]), "mismatch");
  assert.equal(fitmentLevel({ typeId: "340", modelId: "10" }, [{ vehicleTypeId: 340, modelId: 10 }], [340]), "guaranteed");
  const names = new Map([["340", "MERCEDES-BENZ 190 (W201) 2.0"]]);
  assert.equal(fitmentHistoryValue("fitment_added", "340", names), "MERCEDES-BENZ 190 (W201) 2.0 · tip 340");
  assert.equal(fitmentHistoryValue("fitment_removed", "7", names), "Araç tipi 7");
  assert.equal(fitmentHistoryValue("fitment_unadded", null, names), "—");
  assert.equal(fitmentHistoryValue("name", "340", names), null);
  assert.equal(fitmentHistoryValue("constructor", "340", names), null);
});

test("the admin list shows the automatic types of every source, guarded like the store", async () => {
  const febi = await productOf("febiBasbug");
  assert.equal(await productOf("febi"), febi);
  const listed = await store.loadProductFitments(schema.pool, febi);
  assert.deepEqual(listed.automatic.map(vehicle => [vehicle.typeId, vehicle.brand, vehicle.model, vehicle.engine, vehicle.fuel, vehicle.from]), [
    [340, "MERCEDES-BENZ", "190 (W201)", "2.0", "Benzin", "09/1984"], [344, "MERCEDES-BENZ", "190 (W201)", "2.3", "Benzin", "09/1984"]]);
  assert.equal(listed.automaticTotal, 2);
  assert.deepEqual(listed.rows, []);
  // A payload of another code describes another part: neither the panel nor the store counts its fitments.
  assert.deepEqual((await store.loadProductFitments(schema.pool, await productOf("stale"))).automatic, []);
  assert.ok(!(await fitted(900)).has(ids.stale));
  assert.deepEqual(await makes("stale"), []);
  assert.deepEqual((await store.loadProductFitments(schema.pool, await productOf("bare"))).automatic, []);
  for (const key of ["febi", "febiBasbug"]) {
    assert.ok((await fitted(340)).has(ids[key]), key);
    assert.deepEqual(await makes(key), [MERCEDES], key);
  }
});

test("remove and add reach every row of the product: vehicle filter, make page, garage note and history", async () => {
  const febi = await productOf("febi"), bare = await productOf("bare");
  assert.deepEqual(await remove(febi, 340), { ok: true });
  for (const key of ["febi", "febiBasbug"]) {
    assert.ok(!(await fitted(340)).has(ids[key]), key);
    // Another type of the same make keeps the row on the make page.
    assert.ok((await fitted(344)).has(ids[key]), key);
    assert.deepEqual(await makes(key), [MERCEDES], key);
    assert.equal(await fitLevel(key, 340), "mismatch", key);
    assert.equal(await fitLevel(key, 344), "guaranteed", key);
  }
  // Removing the make's last fitment takes the product off the make page; showing it again brings it back.
  assert.deepEqual(await remove(febi, 344), { ok: true });
  assert.deepEqual(await makes("febi"), []);
  const removed344 = (await store.loadProductFitments(schema.pool, febi)).rows.find(row => row.typeId === 344)!;
  assert.deepEqual(await undo(febi, removed344.id), { ok: true });
  assert.deepEqual(await makes("febiBasbug"), [MERCEDES]);
  // A product without enrichment fits what the admin added, everywhere.
  assert.deepEqual(await add(bare, [802015]), { ok: true });
  assert.ok((await fitted(802015)).has(ids.bare));
  assert.deepEqual(await makes("bare"), [TOYOTA]);
  assert.equal(await fitLevel("bare", 802015), "guaranteed");
  // The same model, another engine: the model agrees, the engine is not confirmed.
  assert.equal(await fitLevel("bare", 802016), "likely");
  assert.deepEqual((await catalog.browseProducts({ fits: "vehicle", sort: "newest" }, { vehicleTypeId: "802015" })).items.map(row => row.id), [ids.bare]);
  assert.deepEqual((await fitments.getOverrideFitments([ids.febiBasbug, ids.bare])).get(ids.bare)?.added.map(row => [row.vehicleTypeId, row.model, row.catalogBrand, row.from]),
    [[802015, "TOYOTA COROLLA CROSS", "TOYOTA", "09/1984"]]);
  assert.deepEqual((await fitments.getItemFitments(ids.febiBasbug)).removed, [340]);
  assert.deepEqual((await history(febi)).map(change => [change.field, change.old_value, change.new_value]), [
    ["fitment_removed", null, "340"], ["fitment_removed", null, "344"], ["fitment_restored", "344", null]]);
  assert.deepEqual((await history(bare)).map(change => [change.field, change.new_value]), [["fitment_added", "802015"]]);
});

test("an automatic type can be pinned: it stays when the source drops it", async () => {
  const febi = await productOf("febi");
  assert.deepEqual(await add(febi, [344]), { ok: true });
  assert.deepEqual(await decisions(febi), [["remove", 340, false], ["add", 344, false]]);
  assert.deepEqual((await store.loadProductFitments(schema.pool, febi)).rows.map(row => row.automatic), [true, true]);
  await schema.pool.query(`UPDATE product_enrichments SET payload=jsonb_set(payload,'{vehicles}',$2::jsonb),imported_at=now() WHERE supplier_item_id=$1`,
    [ids.febi, JSON.stringify([vehicleOf(340), vehicleOf(346)])]);
  await rebuildFitments("febi");
  assert.deepEqual((await store.loadProductFitments(schema.pool, febi)).automatic.map(vehicle => vehicle.typeId), [340, 346]);
  assert.deepEqual((await store.loadProductFitments(schema.pool, febi)).rows.map(row => [row.typeId, row.automatic]), [[340, true], [344, false]]);
  assert.ok((await fitted(344)).has(ids.febiBasbug));
  assert.ok((await fitted(346)).has(ids.febiBasbug));
  assert.ok(!(await fitted(340)).has(ids.febiBasbug));
  assert.equal(await fitLevel("febi", 344), "guaranteed");
});

test("enrichment imports, fitment rebuilds and matching refreshes leave the decisions alone", async () => {
  const febi = await productOf("febi"), bare = await productOf("bare");
  const before = [await decisions(febi), await decisions(bare)];
  await rebuildFitments("febi");
  await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"FEBI YENI AD"}',changed_at=now() WHERE id=ANY($1::uuid[])`, [[ids.febi, ids.febiBasbug]]);
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  assert.equal(await productOf("febiBasbug"), febi);
  assert.deepEqual([await decisions(febi), await decisions(bare)], before);
  assert.ok(!(await fitted(340)).has(ids.febi));
  assert.ok((await fitted(802015)).has(ids.bare));
  assert.deepEqual(await makes("febi"), [MERCEDES]);
  assert.deepEqual(await makes("bare"), [TOYOTA]);
});

test("supplier syncs, enrichment, fitment rebuilds, the vehicle import and the storefront bundle never touch the decisions", async () => {
  const supplierImports = (await readdir("src/modules/suppliers")).filter(file => file.endsWith("-import.ts")).map(file => `src/modules/suppliers/${file}`);
  const bundle = (await readdir("scripts")).filter(file => file.startsWith("storefront-bundle-") && file.endsWith(".ts")).map(file => `scripts/${file}`);
  const files = [...supplierImports, ...bundle, "scripts/import-storefront-bundle.ts", "scripts/export-storefront-bundle.ts", "scripts/import-storefront-inbound.ts",
    "src/modules/suppliers/sync.ts", "src/modules/enrichment/import.ts", "src/modules/store/fitment-sync.ts", "scripts/rebuild-product-fitments.ts", "scripts/import-vehicles.ts"];
  assert.ok(supplierImports.length >= 4 && bundle.length >= 4);
  for (const file of files) assert.ok(!/product_override_fitment/.test(await readFile(file, "utf8")), file);
});

test("refused: missing or merged product, unknown vehicle, duplicate, removed, not automatic, no change, the limit, stale rows", async () => {
  const febi = await productOf("febi"), bare = await productOf("bare"), ngk = await productOf("ngk"), skf = await productOf("skf");
  assert.deepEqual(await add(randomUUID(), [340]), { ok: false, reason: "not-found" });
  assert.deepEqual(await add(bare, [802016, 123456789]), { ok: false, reason: "unknown-vehicle" });
  assert.deepEqual(await add(bare, [802016, 802015]), { ok: false, reason: "duplicate" });
  assert.deepEqual(await add(febi, [340]), { ok: false, reason: "removed" });
  assert.deepEqual(await remove(bare, 802015), { ok: false, reason: "not-automatic" });
  assert.deepEqual(await remove(febi, 340), { ok: false, reason: "unchanged" });
  assert.deepEqual(await undo(febi, randomUUID()), { ok: false, reason: "stale" });
  // A refused batch writes nothing.
  assert.deepEqual(await decisions(bare), [["add", 802015, false]]);
  // 344 left the source: only "Kaldır" takes the pin back. A pinned automatic type is removed in place.
  assert.deepEqual(await remove(febi, 344), { ok: false, reason: "not-automatic" });
  assert.deepEqual(await add(febi, [346]), { ok: true });
  assert.deepEqual(await remove(febi, 346), { ok: true });
  assert.deepEqual(await decisions(febi), [["remove", 340, false], ["add", 344, false], ["remove", 346, false]]);
  assert.ok(!(await fitted(346)).has(ids.febi));
  assert.deepEqual((await history(febi)).slice(-2).map(change => [change.field, change.old_value, change.new_value]), [
    ["fitment_added", null, "346"], ["fitment_removed", "346", "346"]]);
  await schema.pool.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode)
    SELECT $1,10000+n,'add' FROM generate_series(1,$2::int) n`, [ngk, productFitmentLimit - 1]);
  assert.deepEqual(await add(ngk, [802015, 802016]), { ok: false, reason: "limit" });
  assert.deepEqual(await add(ngk, [802015]), { ok: true });
  assert.equal((await merge(skf, ngk)).rows[0].id, ngk);
  assert.deepEqual(await add(skf, [802015]), { ok: false, reason: "merged" });
  assert.deepEqual(await remove(skf, 340), { ok: false, reason: "merged" });
});

test("a merge carries the decisions (the kept product's own row wins); undoing it takes them back", async () => {
  const lemA = await productOf("lemA"), lemB = await productOf("lemB");
  assert.deepEqual(await add(lemA, [802015, 900]), { ok: true });
  // A removed type (the products have no enrichment here, so the row is written directly).
  await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode,created_at) VALUES($1,340,'remove',now()+interval '1 second')", [lemA]);
  assert.deepEqual(await add(lemB, [900]), { ok: true });
  assert.deepEqual(await makes("lemB"), [TOYOTA]);
  assert.deepEqual((await merge(lemA, lemB)).rows[0], { id: lemB, carried: { added: 1, removed: 1 } });
  // Carried rows keep their time in A, so the list stays in the order the admins made the decisions.
  assert.deepEqual(await decisions(lemB), [["add", 802015, true], ["add", 900, false], ["remove", 340, true]]);
  assert.deepEqual((await history(lemB)).slice(1).map(change => [change.field, change.new_value, change.reason]), [
    ["fitment_added", "802015", "carry"], ["fitment_removed", "340", "carry"]]);
  // Both rows sell as B now and fit the carried type.
  for (const key of ["lemA", "lemB"]) assert.ok((await fitted(802015)).has(ids[key]), key);
  assert.deepEqual(await makes("lemA"), [TOYOTA]);
  // "Geri al": A is revived and B gives the carried rows back; its own row stays, A keeps its own.
  await schema.pool.query("SELECT product_reset_item($1)", [ids.lemA]);
  assert.deepEqual(await decisions(lemB), [["add", 900, false]]);
  assert.deepEqual((await history(lemB)).slice(3).map(change => [change.field, change.old_value, change.reason]).sort(), [
    ["fitment_restored", "340", "uncarry"], ["fitment_unadded", "802015", "uncarry"]].sort());
  assert.equal((await decisions(lemA)).length, 3);
  const types = await fitted(802015);
  assert.ok(types.has(ids.lemA) && !types.has(ids.lemB));
  assert.deepEqual(await makes("lemB"), [TOYOTA]);
  assert.deepEqual(await makes("lemA"), [TOYOTA]);
  // Taking the product's last decision back takes it off the make page (the trigger queues the product).
  await schema.pool.query("DELETE FROM product_override_fitments WHERE product_id=$1", [lemB]);
  assert.deepEqual(await makes("lemB"), []);
});

test("setup can run the files again and moves an old make-list key to supplier_items", async () => {
  // A database set up before #583: the key points at the enrichment links.
  await schema.pool.query(`ALTER TABLE storefront_make_fits DROP CONSTRAINT storefront_make_fits_supplier_item_id_fkey;
    ALTER TABLE storefront_make_fits ADD CONSTRAINT storefront_make_fits_supplier_item_id_fkey FOREIGN KEY (supplier_item_id)
     REFERENCES product_enrichment_shared_links(supplier_item_id) ON DELETE CASCADE NOT VALID`);
  await schema.pool.query(await readFile("db/product-override-fitments.sql", "utf8"));
  await schema.pool.query(await readFile("db/storefront-make-fits.sql", "utf8"));
  assert.equal((await schema.pool.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='product_override_fitments_products_restored'
    AND tgrelid=to_regclass($1)`, [`${schema.name}.products`])).rows[0].n, 1);
  const key = async () => (await schema.pool.query<{ target: string; validated: boolean }>(`SELECT confrelid::regclass::text AS target,convalidated AS validated
    FROM pg_constraint WHERE conname='storefront_make_fits_supplier_item_id_fkey' AND conrelid=to_regclass($1)`, [`${schema.name}.storefront_make_fits`])).rows;
  assert.deepEqual(await key(), [{ target: "supplier_items", validated: true }]);
  await schema.pool.query(await readFile("db/storefront-make-fits.sql", "utf8"));
  assert.deepEqual(await key(), [{ target: "supplier_items", validated: true }]);
});
