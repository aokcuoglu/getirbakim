import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { syncSharedLinks } from "./test-helpers/shared-links";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { applyFitmentOverrides, emptyFitmentOverrides, modelFallbacks, sourceVehicleKey, type FitmentOverrides, type StoreVehicle } from "../src/modules/store/product-fitment-display";
import { fitmentHistoryValue, isFitmentChange, productFitmentHideLimit, productFitmentLimit } from "../src/modules/admin/product-fitment-fields";
import { fitmentLevel, type FitmentLevel } from "../src/modules/store/fitment-level";
import type { GarageVehicle } from "../src/modules/store/garage";

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
let enrichment: typeof import("../src/modules/store/product-enrichment");
let description: typeof import("../src/modules/store/description-fitment.server");
let hides: typeof import("../src/modules/admin/product-fitment-hide-store");
let copies: typeof import("../src/modules/admin/product-fitment-copy");
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
/** Decisions without hidden source rows. */
const overridesOf = (added: StoreVehicle[], removed: number[], hidden: Partial<FitmentOverrides["hidden"]> = {}): FitmentOverrides =>
  ({ added, removed, hidden: { vehicles: hidden.vehicles ?? [], models: hidden.models ?? [] } });
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
async function enrich(key: string, typeIds: number[], code = codes[key].code, extra: Record<string, unknown> = {}) {
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,$2,$3,'complete')`, [ids[key], code, codes[key].brand]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
    VALUES($1,$2,$3,'https://www.trodo.com/x','test',$4,$5,$6)`,
  [ids[key], code, codes[key].brand, codes[key].brand, code.split(" ").at(-1), JSON.stringify({ specifications: [], vehicles: typeIds.map(vehicleOf), oemNumbers: {}, crossReferences: {}, ...extra })]);
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const add = (productId: string, typeIds: number[]) => store.addProductFitments(schema.pool, productId, typeIds, admin);
const remove = (productId: string, typeId: number) => store.removeProductFitment(schema.pool, productId, typeId, admin);
const undo = (productId: string, rowId: string) => store.deleteProductFitment(schema.pool, productId, rowId, admin);
const merge = (source: string, target: string) => schema.pool.query<{ id: string | null; carried: { added: number; removed: number; hidden: number } }>(
  `WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT id::text, product_override_fitments_carry($1, id, $3) AS carried FROM merged`, [source, target, admin]);
const history = async (productId: string) => (await schema.pool.query<{ field: string; old_value: string | null; new_value: string | null; reason: string | null }>(
  "SELECT field,old_value,new_value,reason FROM product_override_changes WHERE product_id=$1 ORDER BY id", [productId])).rows;
const decisions = async (productId: string) => (await store.loadProductFitments(schema.pool, productId)).rows.map(row => [row.mode, row.typeId, row.carried]);
/** The store rows of a vehicle type; the listing epoch moves first, as the admin actions do. */
const fitted = async (typeId: number) => { await epoch.invalidateListings(); return new Set(await catalog.typeFittedIds(typeId)); };
/** The make lists after the queue the triggers filled is drained (the actions and the background sync do it). */
async function makes(key: string) {
  await syncSharedLinks(schema.pool);
  return (await schema.pool.query<{ brand_id: number }>("SELECT brand_id FROM storefront_make_fits WHERE supplier_item_id=$1 ORDER BY 1", [ids[key]])).rows.map(row => row.brand_id);
}
/** The series whose model pages list the row (#674), as the product page reads them, after the same drain. */
async function modelFits(key: string) {
  await syncSharedLinks(schema.pool);
  return [...await fitments.getItemModelFits(ids[key])].sort((a, b) => a - b);
}
const garage = (typeId: number) => ({ make: "X", model: "Y", year: 2020, vehicleId: String(typeId) });
type Product = { id: string; code: string; brand: string };
/** The order path before #708, one product at a time. */
async function referenceLevel(product: Product, vehicle: GarageVehicle | null) {
  if (!vehicle) return fitmentLevel(null, []);
  const [resolved, enriched, overrides] = await Promise.all([level.fitmentVehicle(vehicle), enrichment.getProductEnrichment(product),
    fitments.getOverrideFitments([product.id]).then(all => all.get(product.id) ?? emptyFitmentOverrides())]);
  const vehicles = applyFitmentOverrides(enriched?.vehicles ?? [], overrides);
  const fallbacks = modelFallbacks(overrides, vehicles, enriched?.vehicleModels ?? []);
  if (!fallbacks.description) return fitmentLevel(resolved, vehicles, overrides.removed);
  return fitmentLevel(resolved, (await description.getDescriptionFitments(product.id)).map(row => ({ vehicleTypeId: null, modelId: row.modelId })));
}
/** Every product with every kind of vehicle in one bulk call, against the reference. */
async function matchesReference(products: Product[]) {
  const vehicles: (GarageVehicle | null)[] = [...[340, 344, 346, 802015, 802016, 900, 999999].map(garage), { make: "Fiat", model: "Doblo", year: 2015 }, null];
  const lines = products.flatMap(product => vehicles.map(vehicle => ({ product, vehicle })));
  const expected: FitmentLevel[] = [];
  for (const line of lines) expected.push(await referenceLevel(line.product, line.vehicle));
  assert.deepEqual(await level.productFitmentLevels(lines), expected);
  return { lines, expected };
}
const fitLevel = (key: string, typeId: number) => level.productFitmentLevel({ id: ids[key], ...codes[key] }, garage(typeId));

before(async () => {
  schema = await isolatedSchema("product_override_fitments_test");
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'MERCEDES-BENZ','MERCEDES-BENZ'),(2,'TOYOTA','TOYOTA');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'190 (W201)'),(20,2,'COROLLA CROSS'),(30,2,'YARIS');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text)
    SELECT id,model,name,1997,'Petrol','Benzin',122,90,'1984-09-01','1993-08-01',name FROM (VALUES (340,10,'2.0'),(344,10,'2.3'),(346,10,'2.5'),
     (802015,20,'2.0 VVTi Hybrid'),(802016,20,'1.8 Hybrid'),(900,30,'1.5')) t(id,model,name);
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
    SELECT 10000+n,30,'T'||n,1500,'Petrol','Benzin',100,74,'2020-01-01','t' FROM generate_series(1,${productFitmentLimit}) n;
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(40,2,'AURIS');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
    SELECT 20000+n,40,'A'||lpad(n::text,2,'0'),1600,'Petrol','Benzin',110,81,'2012-01-01','a' FROM generate_series(1,75) n;`);
  await item("febiBasbug", { supplier: "basbug", code: "FEB 10010", brand: "FEBI", name: "FEBI FREN BALATASI" });
  await item("febi", { supplier: "dinamik", code: "FEBI 10010", brand: "FEBI", name: "FEBI BALATA ON" });
  await item("bare", { supplier: "dinamik", code: "AYD 30030", brand: "AYD", name: "AYD ROT BASI" });
  await item("stale", { supplier: "dinamik", code: "TRW 50050", brand: "TRW", name: "TRW BALATA" });
  await item("ngk", { supplier: "basbug", code: "NGK 60060", brand: "NGK", name: "NGK BUJI" });
  await item("skf", { supplier: "basbug", code: "SKF 70070", brand: "SKF", name: "SKF RULMAN" });
  await item("lemA", { supplier: "basbug", code: "LEM 90090", brand: "LEMFORDER", name: "LEMFORDER ROT" });
  await item("lemB", { supplier: "basbug", code: "MOOG 91091", brand: "MOOG", name: "MOOG ROT" });
  // #662: a whole model added at once, and copies between products.
  await item("bulk", { supplier: "basbug", code: "CORTECO 15015", brand: "CORTECO", name: "CORTECO KECE" });
  await item("copySource", { supplier: "dinamik", code: "BREMBO 16016", brand: "BREMBO", name: "BREMBO DISK" });
  await item("copyTarget", { supplier: "dinamik", code: "ATE 17017", brand: "ATE", name: "ATE DISK" });
  await item("copyFull", { supplier: "basbug", code: "TEXTAR 18018", brand: "TEXTAR", name: "TEXTAR BALATA" });
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  const [{ db }, storeModule, fitmentsModule, catalogModule, levelModule, epochModule, syncModule, enrichmentModule, descriptionModule, hideModule] = await Promise.all([
    import("../src/lib/db"), import("../src/modules/admin/product-fitment-store"), import("../src/modules/store/product-fitments"),
    import("../src/modules/store/catalog"), import("../src/modules/store/fitment-level.server"), import("../src/modules/store/listing-epoch"),
    import("../src/modules/store/fitment-sync"), import("../src/modules/store/product-enrichment"), import("../src/modules/store/description-fitment.server"),
    import("../src/modules/admin/product-fitment-hide-store")]);
  copies = await import("../src/modules/admin/product-fitment-copy");
  store = storeModule;
  fitments = fitmentsModule;
  catalog = catalogModule;
  level = levelModule;
  epoch = epochModule;
  sync = syncModule;
  enrichment = enrichmentModule;
  description = descriptionModule;
  hides = hideModule;
  await enrich("febi", [340, 344]);
  await enrich("stale", [900], "TRW 50049");
  await rebuildFitments("febi");
  await rebuildFitments("stale");
  await enrich("copySource", [340, 344, 346]);
  await enrich("copyTarget", [340, 344]);
  await rebuildFitments("copySource");
  await rebuildFitments("copyTarget");
  await syncSharedLinks(schema.pool);
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("removed types leave the shown vehicles, added ones follow once; the level and history read the decisions", () => {
  const added = (typeId: number): StoreVehicle => ({ model: "TOYOTA COROLLA CROSS", engineAndCodes: "2.0", fuel: "Petrol", kw: 1, ps: 1, cc: 0, from: "01/2020", to: null,
    vehicleTypeId: typeId, brandId: 2, modelId: 20, catalogEngine: "2.0", catalogBrand: "TOYOTA" });
  const automatic = [{ vehicleTypeId: 340, modelId: 10 }, { vehicleTypeId: null, modelId: null }, { vehicleTypeId: 344, modelId: 10 }];
  assert.equal(applyFitmentOverrides(automatic, emptyFitmentOverrides()), automatic);
  assert.deepEqual(applyFitmentOverrides(automatic, overridesOf([added(344), added(802015)], [340])).map(row => row.vehicleTypeId), [null, 344, 802015]);
  assert.deepEqual(applyFitmentOverrides([], overridesOf([added(802015)], [])).map(row => row.vehicleTypeId), [802015]);
  assert.equal(fitmentLevel({ typeId: "340", modelId: "10" }, [{ vehicleTypeId: 344, modelId: 10 }], [340]), "mismatch");
  assert.equal(fitmentLevel({ typeId: "340", modelId: "10" }, [], [340]), "mismatch");
  assert.equal(fitmentLevel({ typeId: "340", modelId: "10" }, [{ vehicleTypeId: 340, modelId: 10 }], [340]), "guaranteed");
  // Model-level lists stand in only while the admin has not decided the product's vehicles.
  const none = emptyFitmentOverrides();
  assert.deepEqual(modelFallbacks(none, [], ["GOLF"]), { vehicleModels: ["GOLF"], description: false });
  assert.deepEqual(modelFallbacks(none, [], []), { vehicleModels: [], description: true });
  assert.deepEqual(modelFallbacks(none, automatic, []), { vehicleModels: [], description: false });
  assert.deepEqual(modelFallbacks(overridesOf([], [340]), [], ["GOLF"]), { vehicleModels: [], description: false });
  assert.deepEqual(modelFallbacks(overridesOf([], [340]), [], []), { vehicleModels: [], description: false });
  assert.deepEqual(modelFallbacks(overridesOf([added(802015)], []), [added(802015)], ["GOLF"]), { vehicleModels: [], description: false });
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

test("remove and add reach every row of the product: vehicle filter, make and model pages, garage note and history", async () => {
  const febi = await productOf("febi"), bare = await productOf("bare");
  assert.deepEqual(await remove(febi, 340), { ok: true });
  for (const key of ["febi", "febiBasbug"]) {
    assert.ok(!(await fitted(340)).has(ids[key]), key);
    // Another type of the same make keeps the row on the make page.
    assert.ok((await fitted(344)).has(ids[key]), key);
    assert.deepEqual(await makes(key), [MERCEDES], key);
    assert.deepEqual(await modelFits(key), [10], key);
    assert.equal(await fitLevel(key, 340), "mismatch", key);
    assert.equal(await fitLevel(key, 344), "guaranteed", key);
  }
  // Removing the make's last fitment takes the product off the make page; showing it again brings it back.
  assert.deepEqual(await remove(febi, 344), { ok: true });
  assert.deepEqual(await makes("febi"), []);
  // The product page stops linking the series' model page with it (#674).
  assert.deepEqual(await modelFits("febi"), []);
  const removed344 = (await store.loadProductFitments(schema.pool, febi)).rows.find(row => row.typeId === 344)!;
  assert.deepEqual(await undo(febi, removed344.id), { ok: true });
  assert.deepEqual(await makes("febiBasbug"), [MERCEDES]);
  assert.deepEqual(await modelFits("febiBasbug"), [10]);
  // A product without enrichment fits what the admin added, everywhere.
  assert.deepEqual(await add(bare, [802015]), { ok: true });
  assert.ok((await fitted(802015)).has(ids.bare));
  assert.deepEqual(await makes("bare"), [TOYOTA]);
  assert.deepEqual(await modelFits("bare"), [20]);
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
  await syncSharedLinks(schema.pool);
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
  assert.deepEqual((await merge(lemA, lemB)).rows[0], { id: lemB, carried: { added: 1, removed: 1, hidden: 0 } });
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

test("description models stand in only without enrichment and admin decisions; unlinked source rows keep the level unknown", async () => {
  await item("bosch", { supplier: "basbug", code: "BOS 80080", brand: "BOSCH", name: "BOSCH FILTRE" });
  await item("valeo", { supplier: "dinamik", code: "VALEO 81081", brand: "VALEO", name: "VALEO DEBRIYAJ" });
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("INSERT INTO product_model_fitments(supplier_item_id,model_id,source_text) VALUES($1,10,'MERCEDES 190')", [ids.bosch]);
  // 555 is no catalog type: its source row stays unlinked.
  await enrich("valeo", [802015, 555]);
  await rebuildFitments("valeo");
  await syncSharedLinks(schema.pool);
  assert.deepEqual((await description.getDescriptionModelIds([ids.bosch, ids.valeo])), new Map([[ids.bosch, [10]]]));
  assert.deepEqual(await level.productFitmentLevels([340, 900, 802015, 802016, 900].map((typeId, index) =>
    ({ product: { id: ids[index < 2 ? "bosch" : "valeo"], ...codes[index < 2 ? "bosch" : "valeo"] }, vehicle: garage(typeId) }))),
  ["likely", "unknown", "guaranteed", "likely", "unknown"]);
  assert.deepEqual(await level.productFitmentLevels([{ product: { id: ids.bosch, ...codes.bosch }, vehicle: null }]), ["no_vehicle"]);
  await matchesReference([{ id: ids.bosch, ...codes.bosch }, { id: ids.valeo, ...codes.valeo }]);
  // Once the admin decided the product's vehicles, the description's models no longer count.
  assert.deepEqual(await add(await productOf("bosch"), [900]), { ok: true });
  assert.equal(await fitLevel("bosch", 340), "mismatch");
  assert.equal(await fitLevel("bosch", 900), "guaranteed");
  // The store reads the description models through storefront_description_fits: a decided product lists none (#661).
  assert.deepEqual(await description.getDescriptionFitments(ids.bosch), []);
});

test("hidden source rows (#661): unlinked vehicles by their source fields, model-list entries by text; hides are no decision", () => {
  const source = vehicleOf(555);
  const key = sourceVehicleKey(source);
  // The key is the fields in a fixed order: the same row read twice (or with extra fields) gives the same key.
  assert.equal(key, JSON.stringify(["MERCEDES-BENZ 190 (W201)", "E 555", "Petrol", 90, 122, 1997, "09/1984", "08/1993", 555]));
  assert.equal(sourceVehicleKey({ ...source, vehicleTypeId: null, extra: 1 } as typeof source), key);
  assert.equal(sourceVehicleKey({ ...source, typeId: undefined }), JSON.stringify(["MERCEDES-BENZ 190 (W201)", "E 555", "Petrol", 90, 122, 1997, "09/1984", "08/1993", null]));
  assert.notEqual(sourceVehicleKey({ ...source, engineAndCodes: "E 556" }), key);
  const rows = [{ vehicleTypeId: 340, modelId: 10, sourceKey: null }, { vehicleTypeId: null, modelId: null, sourceKey: key }, { vehicleTypeId: null, modelId: null, sourceKey: "other" }];
  assert.deepEqual(applyFitmentOverrides(rows, overridesOf([], [], { vehicles: [key] })).map(row => row.vehicleTypeId ?? row.sourceKey), [340, "other"]);
  // A linked row is never hidden by key, only removed by type.
  assert.deepEqual(applyFitmentOverrides([{ vehicleTypeId: 340, modelId: 10, sourceKey: key }], overridesOf([], [], { vehicles: [key] })).length, 1);
  assert.deepEqual(modelFallbacks(overridesOf([], [], { models: ["GOLF"] }), [], ["GOLF", "POLO"]), { vehicleModels: ["POLO"], description: false });
  // Every listed model hidden and no vehicle left: the description's models stand in (a hide is no vehicle decision).
  assert.deepEqual(modelFallbacks(overridesOf([], [], { models: ["GOLF"] }), [], ["GOLF"]), { vehicleModels: [], description: true });
  assert.deepEqual(modelFallbacks(overridesOf([], [340], { models: ["GOLF"] }), [], ["POLO"]), { vehicleModels: [], description: false });
  assert.equal(fitmentHistoryValue("fitment_vehicle_hidden", "MERCEDES-BENZ 190 (W201) E 555 · 09/1984–08/1993", new Map()), "MERCEDES-BENZ 190 (W201) E 555 · 09/1984–08/1993");
  assert.equal(fitmentHistoryValue("fitment_description_shown", null, new Map()), "—");
});

test("hiding source rows: checked against the sources, applied by the product page, the level and the description reads", async () => {
  await item("mann", { supplier: "dinamik", code: "MANN 12012", brand: "MANN", name: "MANN FILTRE" });
  await schema.pool.query("SELECT refresh_product_matches()");
  // 802015 links; 555 and 556 are no catalog types and stay unlinked.
  await enrich("mann", [802015, 555, 556], codes.mann.code, { vehicleModels: ["TOYOTA YARIS", "TOYOTA COROLLA"] });
  await rebuildFitments("mann");
  await schema.pool.query("INSERT INTO product_model_fitments(supplier_item_id,model_id,year_from,year_to,source_text) VALUES($1,20,2019,NULL,'COROLLA CROSS'),($1,30,NULL,NULL,'YARIS')", [ids.mann]);
  await syncSharedLinks(schema.pool);
  const mann = await productOf("mann"), product = { id: ids.mann, ...codes.mann };
  const key555 = sourceVehicleKey(vehicleOf(555)), key556 = sourceVehicleKey(vehicleOf(556));
  const sources = await hides.loadProductFitmentSources(schema.pool, mann);
  assert.deepEqual(sources.vehicles.map(row => [row.key, row.hidden]), [[key555, null], [key556, null]]);
  assert.equal(sources.vehiclesTotal, 2);
  assert.deepEqual(sources.models, [{ name: "TOYOTA COROLLA", hidden: null }, { name: "TOYOTA YARIS", hidden: null }]);
  assert.deepEqual(sources.descriptionModels.map(row => [row.modelId, row.brand, row.model, row.yearFrom]), [[20, "TOYOTA", "COROLLA CROSS", 2019], [30, "TOYOTA", "YARIS", null]]);
  assert.deepEqual([sources.decided, sources.orphans], [false, []]);
  assert.equal(await fitLevel("mann", 900), "unknown");

  const hide = (target: Parameters<typeof hides.hideProductFitment>[2], productId = mann) => hides.hideProductFitment(schema.pool, productId, target, admin);
  assert.deepEqual(await hide({ kind: "source_vehicle", key: key555 }), { ok: true });
  assert.deepEqual(await hide({ kind: "source_vehicle", key: key555 }), { ok: false, reason: "unchanged" });
  // A linked row, another product's row, a reworded row and a malformed key are not this product's unlinked rows.
  for (const key of [sourceVehicleKey(vehicleOf(802015)), sourceVehicleKey({ ...vehicleOf(556), ps: 123 }), "{", "[1,2]"]) {
    assert.deepEqual(await hide({ kind: "source_vehicle", key }), { ok: false, reason: "not-in-source" }, key);
  }
  assert.deepEqual(await hide({ kind: "source_model", key: "TOYOTA YARIS" }), { ok: true });
  assert.deepEqual(await hide({ kind: "source_model", key: "OPEL ASTRA" }), { ok: false, reason: "not-in-source" });
  assert.deepEqual(await hide({ kind: "description_model", modelId: 20 }), { ok: true });
  assert.deepEqual(await hide({ kind: "description_model", modelId: 10 }), { ok: false, reason: "not-in-source" });
  assert.deepEqual(await hide({ kind: "source_model", key: "TOYOTA YARIS" }, randomUUID()), { ok: false, reason: "not-found" });
  assert.deepEqual((await history(mann)).map(change => [change.field, change.old_value, change.new_value]), [
    ["fitment_vehicle_hidden", null, "MERCEDES-BENZ 190 (W201) E 555 · 09/1984–08/1993"],
    ["fitment_model_hidden", null, "TOYOTA YARIS"],
    ["fitment_description_hidden", null, "TOYOTA COROLLA CROSS · 2019–"]]);

  // The store: the product page's vehicles and model list, the description models and the level.
  assert.deepEqual((await fitments.getItemFitments(ids.mann)).hidden, { vehicles: [key555], models: ["TOYOTA YARIS"] });
  const overrides = (await fitments.getOverrideFitments([ids.mann])).get(ids.mann)!;
  const enriched = await enrichment.getProductEnrichment(product);
  const shown = applyFitmentOverrides(enriched!.vehicles, overrides);
  assert.deepEqual(shown.map(row => row.vehicleTypeId ?? row.engineAndCodes), [802015, "E 556"]);
  assert.deepEqual(modelFallbacks(overrides, shown, enriched!.vehicleModels).vehicleModels, ["TOYOTA COROLLA"]);
  assert.deepEqual((await description.getDescriptionFitments(ids.mann)).map(row => row.modelId), [30]);
  assert.deepEqual(await description.getDescriptionModelIds([ids.mann]), new Map([[ids.mann, [30]]]));
  assert.equal(await fitLevel("mann", 900), "unknown");
  // With every unlinked row hidden the linked rows say it all: another type is a mismatch now, no longer unknown.
  assert.deepEqual(await hide({ kind: "source_vehicle", key: key556 }), { ok: true });
  assert.equal(await fitLevel("mann", 900), "mismatch");
  assert.equal(await fitLevel("mann", 802015), "guaranteed");
  await matchesReference([product]);

  // The admin list marks the hidden rows; a hide whose source row is gone is listed apart.
  await schema.pool.query("INSERT INTO product_override_fitment_hides(product_id,kind,source_key,label) VALUES($1,'source_model','TOYOTA AURIS','TOYOTA AURIS')", [mann]);
  const listed = await hides.loadProductFitmentSources(schema.pool, mann);
  assert.deepEqual(listed.vehicles.map(row => Boolean(row.hidden)), [true, true]);
  assert.deepEqual(listed.models.map(row => [row.name, Boolean(row.hidden)]), [["TOYOTA COROLLA", false], ["TOYOTA YARIS", true]]);
  assert.deepEqual(listed.descriptionModels.map(row => [row.modelId, Boolean(row.hidden)]), [[20, true], [30, false]]);
  assert.deepEqual(listed.orphans.map(row => [row.kind, row.label, row.carried]), [["source_model", "TOYOTA AURIS", false]]);

  // Showing a row again; a row gone already is stale.
  const described = listed.descriptionModels[0].hidden!;
  assert.deepEqual(await hides.showProductFitment(schema.pool, mann, described.id, admin), { ok: true });
  assert.deepEqual(await hides.showProductFitment(schema.pool, mann, described.id, admin), { ok: false, reason: "stale" });
  assert.deepEqual((await history(mann)).at(-1), { field: "fitment_description_shown", old_value: "TOYOTA COROLLA CROSS · 2019–", new_value: null, reason: null });
  assert.deepEqual((await description.getDescriptionFitments(ids.mann)).map(row => row.modelId), [20, 30]);

  // A vehicle decision: the description's models leave the store (storefront_description_fits), the panel says so.
  assert.deepEqual(await add(mann, [900]), { ok: true });
  assert.equal((await hides.loadProductFitmentSources(schema.pool, mann)).decided, true);
  assert.deepEqual(await description.getDescriptionFitments(ids.mann), []);
  assert.deepEqual(await description.getDescriptionModelIds([ids.mann]), new Map());

  // The limit counts every kind; a merged product is refused.
  const count = (await schema.pool.query<{ n: number }>("SELECT count(*)::int AS n FROM product_override_fitment_hides WHERE product_id=$1", [mann])).rows[0].n;
  await schema.pool.query(`INSERT INTO product_override_fitment_hides(product_id,kind,source_key,label)
    SELECT $1,'source_model','YOK '||n,'YOK '||n FROM generate_series(1,$2::int) n`, [mann, productFitmentHideLimit - count]);
  assert.deepEqual(await hide({ kind: "source_model", key: "TOYOTA COROLLA" }), { ok: false, reason: "hide-limit" });
  const merged = (await schema.pool.query<{ id: string }>("SELECT id::text FROM products WHERE merged_into IS NOT NULL LIMIT 1")).rows[0].id;
  assert.deepEqual(await hide({ kind: "source_model", key: "TOYOTA COROLLA" }, merged), { ok: false, reason: "merged" });
});

test("a merge carries the hidden rows (the kept product's own row wins); undoing it takes them back", async () => {
  await item("hideA", { supplier: "basbug", code: "SACHS 13013", brand: "SACHS", name: "SACHS AMORTISOR" });
  await item("hideB", { supplier: "basbug", code: "KYB 14014", brand: "KYB", name: "KYB AMORTISOR" });
  await schema.pool.query("SELECT refresh_product_matches()");
  const a = await productOf("hideA"), b = await productOf("hideB");
  await schema.pool.query(`INSERT INTO product_override_fitment_hides(product_id,kind,model_id,source_key,label,created_at)
    VALUES($1,'description_model',10,NULL,'MERCEDES-BENZ 190 (W201)',now()),($1,'source_model',NULL,'GOLF','GOLF A',now()+interval '1 second'),
     ($2,'source_model',NULL,'GOLF','GOLF B',now())`, [a, b]);
  assert.deepEqual((await merge(a, b)).rows[0], { id: b, carried: { added: 0, removed: 0, hidden: 1 } });
  const rows = async (productId: string) => (await schema.pool.query<{ kind: string; label: string; carried: boolean }>(
    "SELECT kind,label,carried_from IS NOT NULL AS carried FROM product_override_fitment_hides WHERE product_id=$1 ORDER BY created_at,id", [productId])).rows;
  assert.deepEqual((await rows(b)).map(row => [row.kind, row.label, row.carried]).sort(), [["description_model", "MERCEDES-BENZ 190 (W201)", true], ["source_model", "GOLF B", false]].sort());
  assert.deepEqual((await history(b)).map(change => [change.field, change.new_value, change.reason]), [["fitment_description_hidden", "MERCEDES-BENZ 190 (W201)", "carry"]]);
  assert.equal((await hides.loadProductFitmentSources(schema.pool, b)).orphans.find(row => row.kind === "description_model")?.carried, true);
  await schema.pool.query("SELECT product_reset_item($1)", [ids.hideA]);
  assert.deepEqual((await rows(b)).map(row => row.label), ["GOLF B"]);
  assert.deepEqual((await history(b)).at(-1), { field: "fitment_description_shown", old_value: "MERCEDES-BENZ 190 (W201)", new_value: null, reason: "uncarry" });
  assert.equal((await rows(a)).length, 2);
});

test("a whole model is added in one change: every type in order, one history row each, the product queued for the make pages (#662)", async () => {
  const bulk = await productOf("bulk");
  const types = Array.from({ length: 75 }, (_, index) => 20001 + index);
  await syncSharedLinks(schema.pool);
  assert.deepEqual(await add(bulk, types), { ok: true });
  assert.deepEqual((await decisions(bulk)).map(([mode, typeId]) => [mode, typeId]), types.map(typeId => ["add", typeId]));
  assert.deepEqual((await history(bulk)).map(change => [change.field, change.old_value, change.new_value]), types.map(typeId => ["fitment_added", null, String(typeId)]));
  assert.equal((await schema.pool.query("SELECT 1 FROM product_enrichment_shared_queue WHERE kind='p' AND id=$1", [bulk])).rowCount, 1);
  assert.deepEqual(await makes("bulk"), [TOYOTA]);
});

test("copying fitments (#662): the source's shown types come, decided and automatic types of the target are skipped", async () => {
  const source = await productOf("copySource"), target = await productOf("copyTarget");
  // The source removes 346 and adds 900, 802016 and 802015; it hides a model-list entry. The target removed 340 and added 802015.
  assert.deepEqual(await remove(source, 346), { ok: true });
  assert.deepEqual(await add(source, [900, 802016, 802015]), { ok: true });
  await schema.pool.query("INSERT INTO product_override_fitment_hides(product_id,kind,source_key,label) VALUES($1,'source_model','GOLF','GOLF')", [source]);
  assert.deepEqual(await remove(target, 340), { ok: true });
  assert.deepEqual(await add(target, [802015]), { ok: true });

  const preview = await copies.previewFitmentCopy(schema.pool, target, source);
  assert.ok(preview);
  assert.deepEqual({ ...preview, add: preview.add.map(vehicle => vehicle.typeId) }, {
    source: (await schema.pool.query("SELECT id::text,brand_label,code,name FROM products WHERE id=$1", [source])).rows[0],
    total: 5, add: [802016, 900], addCount: 2, skipped: { added: 1, removed: 1, automatic: 1 },
    remaining: productFitmentLimit - 2, exceeds: false, targetHasDecisions: true });
  const merged = (await schema.pool.query<{ id: string }>("SELECT id::text FROM products WHERE merged_into IS NOT NULL LIMIT 1")).rows[0].id;
  for (const id of [target, randomUUID(), merged]) assert.equal(await copies.previewFitmentCopy(schema.pool, target, id), null, id);
  assert.equal(await copies.previewFitmentCopy(schema.pool, merged, source), null);

  const copy = (sourceId: string, expected: number, targetId = target) => copies.copyProductFitments(schema.pool, targetId, sourceId, expected, admin);
  for (const id of [target, randomUUID(), merged]) assert.deepEqual(await copy(id, 2), { ok: false, reason: "bad-source" }, id);
  const before = await history(target);
  assert.deepEqual(await copy(source, 3), { ok: false, reason: "stale" });
  assert.deepEqual(await history(target), before);
  assert.deepEqual(await copy(source, 2), { ok: true, added: 2 });
  const rows = (await schema.pool.query<{ vehicle_type_id: number; mode: string; carried: boolean }>(`SELECT vehicle_type_id,mode,carried_from IS NOT NULL AS carried
    FROM product_override_fitments WHERE product_id=$1 ORDER BY created_at,id`, [target])).rows;
  assert.deepEqual(rows.map(row => [row.mode, row.vehicle_type_id, row.carried]), [["remove", 340, false], ["add", 802015, false], ["add", 802016, false], ["add", 900, false]]);
  const { brand_label: brand, code } = preview.source;
  assert.deepEqual((await history(target)).slice(before.length).map(change => [change.field, change.old_value, change.new_value]), [
    ["fitment_added", null, "802016"], ["fitment_added", null, "900"], ["fitment_copied", null, `${brand} ${code} ürününden 2 araç tipi`]]);
  // Hides and removes of the source stay there.
  assert.equal((await schema.pool.query("SELECT 1 FROM product_override_fitment_hides WHERE product_id=$1", [target])).rowCount, 0);
  assert.ok((await fitted(900)).has(ids.copyTarget));
  assert.ok((await fitted(802016)).has(ids.copyTarget));
  assert.ok(!(await fitted(346)).has(ids.copyTarget));
  assert.deepEqual(await makes("copyTarget"), [MERCEDES, TOYOTA]);
  assert.deepEqual(await copy(source, 2), { ok: false, reason: "nothing-to-copy" });
  assert.equal((await copies.previewFitmentCopy(schema.pool, target, source))?.addCount, 0);

  // Beyond the product's remaining decisions the copy is refused whole: nothing is written.
  const full = await productOf("copyFull");
  await schema.pool.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode)
    SELECT $1,10000+n,'add' FROM generate_series(1,$2::int) n`, [full, productFitmentLimit - 1]);
  const over = await copies.previewFitmentCopy(schema.pool, full, source);
  assert.deepEqual([over?.addCount, over?.remaining, over?.exceeds], [5, 1, true]);
  assert.deepEqual(await copy(source, 5, full), { ok: false, reason: "limit" });
  assert.equal((await decisions(full)).length, productFitmentLimit - 1);
  assert.deepEqual(await history(full), []);

  assert.equal(fitmentHistoryValue("fitment_copied", "BREMBO 16016 ürününden 2 araç tipi", new Map()), "BREMBO 16016 ürününden 2 araç tipi");
  assert.equal(isFitmentChange("fitment_copied"), false);
});

test("copy sources: the linked equivalents without a query, the equivalent search with one; never the product itself or a merged one", async () => {
  const source = await productOf("copySource"), target = await productOf("copyTarget");
  const merged = (await schema.pool.query<{ id: string }>("SELECT id::text FROM products WHERE merged_into IS NOT NULL LIMIT 1")).rows[0].id;
  // refresh_product_matches rebuilds the table: the links are written here, after the other tests' refreshes.
  await schema.pool.query(`INSERT INTO product_equivalents(product_id,equivalent_id,kind,brand,part_number)
    VALUES($1,$2,'manual','BREMBO','16016'),($1,$3,'manual','SKF','70070')`, [target, source, merged]);
  const product = async (id: string) => (await schema.pool.query("SELECT id::text,brand_label,code,name,suppliers FROM products WHERE id=$1", [id])).rows[0];
  assert.deepEqual(await copies.loadFitmentCopySources(schema.pool, target, undefined), { q: "", sources: [{ ...await product(source), equivalent: true }] });
  assert.deepEqual(await copies.loadFitmentCopySources(schema.pool, target, "  "), { q: "", sources: [{ ...await product(source), equivalent: true }] });
  assert.deepEqual(await copies.loadFitmentCopySources(schema.pool, target, " - / "), { q: "", sources: [{ ...await product(source), equivalent: true }] });
  // A code search finds the source (marked as linked); the product's own code and a merged product's code do not list them.
  const found = await copies.loadFitmentCopySources(schema.pool, target, "brembo 16016");
  assert.equal(found.q, "BREMBO16016");
  assert.deepEqual(found.sources.map(row => [row.id, row.equivalent]), [[source, true]]);
  assert.deepEqual((await copies.loadFitmentCopySources(schema.pool, target, "ATE 17017")).sources, []);
  assert.ok(!(await copies.loadFitmentCopySources(schema.pool, target, "70070")).sources.some(row => row.id === merged));
  assert.deepEqual((await copies.loadFitmentCopySources(schema.pool, source, "ATE 17017")).sources.map(row => [row.id, row.equivalent]), [[target, false]]);
  assert.deepEqual(await copies.loadFitmentCopySources(schema.pool, target, "ab"), { q: "AB", sources: [] });
});

test("bulk levels equal the per-product reference", async () => {
  const products = Object.keys(ids).map(key => ({ id: ids[key], ...codes[key] }));
  // The stale payload's own code: the store row does not show it, the level must not either.
  products.push({ id: ids.stale, code: "TRW 50049", brand: "TRW" });
  const { lines, expected } = await matchesReference(products);
  assert.equal(new Set(expected).size, 5, expected.join());
  // One line at a time gives the same, and a product the resolver did not preload is refused.
  for (const [index, line] of lines.entries()) assert.equal(await level.productFitmentLevel(line.product, line.vehicle), expected[index]);
  const resolver = await level.fitmentLevelResolver([ids.febi], [garage(340)]);
  assert.equal(resolver.level({ id: ids.bare, ...codes.bare }, garage(340)), null);
  assert.equal(resolver.level({ id: ids.febi, ...codes.febi }, garage(344)), null);
  assert.equal(resolver.level({ id: ids.febi, ...codes.febi }, garage(340)), expected[lines.findIndex(line => line.product.id === ids.febi && line.vehicle?.vehicleId === "340")]);
});

test("setup can run the files again and moves an old make-list key to supplier_items", async () => {
  // A database set up before #583: the key points at the enrichment links (under another name: found by its target).
  await schema.pool.query(`ALTER TABLE storefront_make_fits DROP CONSTRAINT storefront_make_fits_supplier_item_id_fkey;
    ALTER TABLE storefront_make_fits ADD CONSTRAINT make_fits_renamed_key FOREIGN KEY (supplier_item_id)
     REFERENCES product_enrichment_shared_links(supplier_item_id) ON DELETE CASCADE NOT VALID`);
  await schema.pool.query(await readFile("db/product-override-fitments.sql", "utf8"));
  await schema.pool.query(await readFile("db/storefront-make-fits.sql", "utf8"));
  assert.equal((await schema.pool.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='product_override_fitments_products_restored'
    AND tgrelid=to_regclass($1)`, [`${schema.name}.products`])).rows[0].n, 1);
  // The hidden rows and the description view survive the re-run.
  const hidden = await schema.pool.query("SELECT count(*)::int AS n FROM product_override_fitment_hides");
  await schema.pool.query(await readFile("db/product-override-fitments.sql", "utf8"));
  assert.deepEqual((await schema.pool.query("SELECT count(*)::int AS n FROM product_override_fitment_hides")).rows, hidden.rows);
  assert.ok(hidden.rows[0].n > 0);
  assert.deepEqual((await description.getDescriptionFitments(ids.mann)).map(row => row.modelId), []);
  const key = async () => (await schema.pool.query<{ name: string; target: string; validated: boolean }>(`SELECT conname AS name,confrelid::regclass::text AS target,
    convalidated AS validated FROM pg_constraint WHERE contype='f' AND conrelid=to_regclass($1) AND confrelid<>to_regclass($2)`,
  [`${schema.name}.storefront_make_fits`, `${schema.name}.vehicle_brands`])).rows;
  assert.deepEqual(await key(), [{ name: "storefront_make_fits_supplier_item_id_fkey", target: "supplier_items", validated: true }]);
  await schema.pool.query(await readFile("db/storefront-make-fits.sql", "utf8"));
  assert.deepEqual(await key(), [{ name: "storefront_make_fits_supplier_item_id_fkey", target: "supplier_items", validated: true }]);
});
