import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { syncSharedLinks } from "./test-helpers/shared-links";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { applySpecOverrides } from "../src/modules/store/product-spec-display";
import { productSpecLimit, specHistoryValue } from "../src/modules/admin/product-spec-fields";

// Admin-entered technical specifications (#603) in an isolated copy of the schema: db/product-override-specs.sql, the
// store's product page and cards, the catalog filters and facets, the admin store and merge carry/undo.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let store: typeof import("../src/modules/admin/product-spec-store");
let specs: typeof import("../src/modules/store/product-specs");
let enrichment: typeof import("../src/modules/store/product-enrichment");
let catalog: typeof import("../src/modules/store/catalog");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const codes: Record<string, { code: string; brand: string }> = {};
const [basbug, , dinamik] = storefrontCompanies();
let admin: string;

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
/** An enrichment of a Dinamik row; `code` other than the row's own is a stale payload the store must not show. */
async function enrich(key: string, manufacturer: string, partNumber: string, specifications: [string, string][], code = codes[key].code) {
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,$2,$3,'complete')`, [ids[key], code, codes[key].brand]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
    VALUES($1,$2,$3,'https://www.trodo.com/x','test',$4,$5,$6)`,
  [ids[key], code, codes[key].brand, manufacturer, partNumber, JSON.stringify({ specifications, vehicles: [], oemNumbers: {}, crossReferences: {} })]);
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const set = (productId: string, key: string, value: string) => store.setProductSpec(schema.pool, productId, { key, value }, admin);
const hide = (productId: string, key: string) => store.hideProductSpec(schema.pool, productId, key, admin);
const merge = (source: string, target: string) => schema.pool.query<{ id: string | null; carried: { set: number; hidden: number } }>(
  `WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT id::text, product_override_specs_carry($1, id, $3) AS carried FROM merged`, [source, target, admin]);
const history = async (productId: string) => (await schema.pool.query<{ field: string; old_value: string | null; new_value: string | null; reason: string | null }>(
  "SELECT field,old_value,new_value,reason FROM product_override_changes WHERE product_id=$1 ORDER BY id", [productId])).rows;
const listed = async (productId: string) => (await store.loadProductSpecs(schema.pool, productId)).rows.map(row => [row.action, row.key, row.value, row.carried]);
/** The specifications the store's cards show for one row. */
const card = async (key: string) => (await enrichment.getCatalogProductDetails([{ id: ids[key], ...codes[key] }])).get(ids[key])?.specifications;
/** The listed store row ids of an attribute filter (each filter once: listings are cached for the process). */
const filtered = async (attributes: Record<string, string[]>) => (await catalog.browseProducts({ attributes: JSON.stringify(attributes), sort: "newest" })).items.map(row => row.id);
const facet = (facets: { attributes: { key: string; options: { values: string[] }[] }[] }, key: string) => facets.attributes.find(row => row.key === key)?.options.flatMap(option => option.values).sort();

before(async () => {
  schema = await isolatedSchema("product_override_specs_test");
  await item("febiBasbug", { supplier: "basbug", code: "FEB 10010", brand: "FEBI", name: "FEBI FREN BALATASI" });
  await item("febi", { supplier: "dinamik", code: "FEBI 10010", brand: "FEBI", name: "FEBI BALATA ON" });
  await item("mahle", { supplier: "dinamik", code: "MAHLE 20020", brand: "MAHLE", name: "MAHLE YAG FILTRESI" });
  await item("bare", { supplier: "dinamik", code: "AYD 30030", brand: "AYD", name: "AYD ROT BASI" });
  await item("stale", { supplier: "dinamik", code: "TRW 50050", brand: "TRW", name: "TRW BALATA" });
  await item("ngk", { supplier: "basbug", code: "NGK 60060", brand: "NGK", name: "NGK BUJI" });
  await item("skf", { supplier: "basbug", code: "SKF 70070", brand: "SKF", name: "SKF RULMAN" });
  await item("lemA", { supplier: "basbug", code: "LEM 90090", brand: "LEMFORDER", name: "LEMFORDER ROT" });
  await item("lemB", { supplier: "basbug", code: "MOOG 91091", brand: "MOOG", name: "MOOG ROT" });
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  await enrich("febi", "FEBI", "10010", [["Fitting Position", "Lower Right"], ["Thickness [mm]", "20"], ["Fitting Position", "Lower Left"],
    ["EAN", "4027816285229"], ["Brand class", "Premium"]]);
  await enrich("mahle", "MAHLE", "20020", [["Fitting Position", "Upper Left"], ["Filter type", "Spin-on"]]);
  await enrich("stale", "TRW", "50049", [["Fitting Position", "Rear Axle Left"]], "TRW 50049");
  await syncSharedLinks(schema.pool);
  const [{ db }, storeModule, specsModule, enrichmentModule, catalogModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/admin/product-spec-store"), import("../src/modules/store/product-specs"),
    import("../src/modules/store/product-enrichment"), import("../src/modules/store/catalog")]);
  store = storeModule;
  specs = specsModule;
  enrichment = enrichmentModule;
  catalog = catalogModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("hidden keys leave, set keys keep their place once, added keys follow in order", () => {
  const automatic: [string, string][] = [["Fitting Position", "Lower Right"], ["Thickness [mm]", "20"], ["Fitting Position", "Lower Left"], ["EAN", "1"]];
  assert.deepEqual(applySpecOverrides(automatic, []), automatic);
  assert.deepEqual(applySpecOverrides(automatic, [
    { action: "set", key: "Renk", value: "Siyah" },
    { action: "hide", key: "EAN", value: null },
    { action: "set", key: "Fitting Position", value: "Front Axle" },
    { action: "set", key: "Malzeme", value: "Çelik" },
    { action: "hide", key: "Missing", value: null },
  ]), [["Fitting Position", "Front Axle"], ["Thickness [mm]", "20"], ["Renk", "Siyah"], ["Malzeme", "Çelik"]]);
  assert.deepEqual(applySpecOverrides([], [{ action: "set", key: "Renk", value: "Siyah" }]), [["Renk", "Siyah"]]);
  assert.equal(specHistoryValue("spec_set", "Fitting Position|Front Axle"), "Montaj konumu: Front Axle");
  assert.equal(specHistoryValue("spec_set", "Renk|A|B"), "Renk: A|B");
  assert.equal(specHistoryValue("spec_hidden", "EAN"), "EAN");
  assert.equal(specHistoryValue("spec_removed", null), "—");
  assert.equal(specHistoryValue("name", "x"), null);
  assert.equal(specHistoryValue("constructor", "x"), null);
});

test("the admin list shows the automatic specifications of every source, guarded like the store", async () => {
  const febi = await productOf("febiBasbug");
  assert.equal(await productOf("febi"), febi);
  assert.deepEqual((await store.loadProductSpecs(schema.pool, febi)).automatic.map(row => [row.key, row.value]), [
    ["Fitting Position", "Lower Right"], ["Thickness [mm]", "20"], ["Fitting Position", "Lower Left"], ["EAN", "4027816285229"], ["Brand class", "Premium"]]);
  // A payload of another code describes another part: neither the panel nor the store shows it.
  assert.deepEqual((await store.loadProductSpecs(schema.pool, await productOf("stale"))).automatic, []);
  assert.equal(await card("stale"), undefined);
  assert.deepEqual(await card("febi"), [["Fitting Position", "Lower Right"], ["Thickness [mm]", "20"], ["Fitting Position", "Lower Left"], ["EAN", "4027816285229"], ["Brand class", "Premium"]]);
  assert.equal(await card("bare"), undefined);
  // The facet before any decision (a code search: plain searches are cached per query).
  assert.deepEqual(facet(await catalog.catalogFacets({ q: "MAHLE 20020", searchBy: "code" }), "Fitting Position"), ["Upper Left"]);
});

test("edit, hide and add reach every row of the product, its cards and the history", async () => {
  const febi = await productOf("febi"), bare = await productOf("bare"), stale = await productOf("stale");
  // A Turkish label and value are stored as the source spells them.
  assert.deepEqual(await set(febi, "montaj konumu", "Ön aks"), { ok: true });
  assert.deepEqual(await hide(febi, "EAN"), { ok: true });
  assert.deepEqual(await set(febi, "Renk", "Siyah"), { ok: true });
  // Another casing of a key the product has already is the same key.
  assert.deepEqual(await set(febi, "renk", "Gri"), { ok: true });
  assert.deepEqual(await set(febi, "brand class", "Ekonomik"), { ok: true });
  assert.deepEqual(await listed(febi), [["set", "Fitting Position", "Front Axle", false], ["hide", "EAN", null, false], ["set", "Renk", "Gri", false],
    ["set", "Brand class", "Budget", false]]);
  for (const key of ["febi", "febiBasbug"]) assert.deepEqual((await specs.getItemSpecs(ids[key])).map(row => [row.action, row.key, row.value]), [
    ["set", "Fitting Position", "Front Axle"], ["hide", "EAN", null], ["set", "Renk", "Gri"], ["set", "Brand class", "Budget"]], key);
  assert.deepEqual(await card("febi"), [["Fitting Position", "Front Axle"], ["Thickness [mm]", "20"], ["Brand class", "Budget"], ["Renk", "Gri"]]);
  // A product without enrichment shows what the admin added; so does one whose enrichment no longer describes it.
  assert.deepEqual(await set(bare, "Fitting Position", "Rear Axle"), { ok: true });
  assert.deepEqual(await card("bare"), [["Fitting Position", "Rear Axle"]]);
  assert.deepEqual(await set(stale, "Malzeme", "Seramik"), { ok: true });
  assert.deepEqual(await card("stale"), [["Malzeme", "Seramik"]]);
  assert.deepEqual((await history(febi)).map(change => [change.field, change.old_value, change.new_value]), [
    ["spec_set", null, "Fitting Position|Front Axle"], ["spec_hidden", null, "EAN"], ["spec_set", null, "Renk|Siyah"], ["spec_set", "Renk|Siyah", "Renk|Gri"],
    ["spec_set", null, "Brand class|Budget"]]);
});

test("catalog facets and the attribute filter read the admin's values", async () => {
  const mahle = await productOf("mahle");
  assert.deepEqual(await hide(mahle, "Fitting Position"), { ok: true });
  assert.equal(facet(await catalog.catalogFacets({ q: "MAHLE20020", searchBy: "code" }), "Fitting Position"), undefined);
  // Edited Lower Right/Left and hidden Upper Left are gone; the edited and added values are offered.
  const all = await catalog.catalogFacets({});
  assert.deepEqual(facet(all, "Fitting Position"), ["Front Axle", "Rear Axle"]);
  assert.deepEqual(facet(all, "Brand class"), ["Budget"]);
  assert.deepEqual(facet(all, "Filter type"), ["Spin-on"]);
  const febiRows = (hits: string[]) => hits.some(id => id === ids.febi || id === ids.febiBasbug);
  assert.ok(!febiRows(await filtered({ "Fitting Position": ["Lower Right"] })), "old value");
  assert.ok(febiRows(await filtered({ "Fitting Position": ["Front Axle"] })), "new value");
  assert.deepEqual(await filtered({ "Fitting Position": ["Rear Axle"] }), [ids.bare]);
  assert.deepEqual(await filtered({ "Fitting Position": ["Upper Left"] }), []);
  assert.deepEqual(await filtered({ "Filter type": ["Spin-on"] }), [ids.mahle]);
});

test("enrichment imports, supplier syncs and matching refreshes leave the decisions alone", async () => {
  const febi = await productOf("febi");
  const before = await specs.getItemSpecs(ids.febi);
  await schema.pool.query(`UPDATE product_enrichments SET payload=jsonb_set(payload,'{specifications}','[["Fitting Position","Upper Right"],["Thickness [mm]","22"],["EAN","4027816285229"],["Weight [kg]","1.2"]]'),
    imported_at=now() WHERE supplier_item_id=$1`, [ids.febi]);
  await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"FEBI YENI AD"}',changed_at=now() WHERE id=ANY($1::uuid[])`, [[ids.febi, ids.febiBasbug]]);
  await schema.pool.query("SELECT refresh_product_matches()");
  await syncSharedLinks(schema.pool);
  assert.equal(await productOf("febiBasbug"), febi);
  assert.deepEqual((await schema.pool.query("SELECT action,key,value FROM product_override_specs WHERE product_id=$1 ORDER BY created_at,id", [febi])).rows.length, 4);
  // React's cache() only dedupes inside a request; the module function reads the table again here.
  assert.deepEqual((await specs.getOverrideSpecs([ids.febi])).get(ids.febi), before);
  assert.deepEqual(await card("febi"), [["Fitting Position", "Front Axle"], ["Thickness [mm]", "22"], ["Weight [kg]", "1.2"], ["Renk", "Gri"], ["Brand class", "Budget"]]);
});

test("supplier syncs, enrichment, fitment rebuilds and the storefront bundle never touch the specifications", async () => {
  const supplierImports = (await readdir("src/modules/suppliers")).filter(file => file.endsWith("-import.ts")).map(file => `src/modules/suppliers/${file}`);
  const bundle = (await readdir("scripts")).filter(file => file.startsWith("storefront-bundle-") && file.endsWith(".ts")).map(file => `scripts/${file}`);
  const files = [...supplierImports, ...bundle, "scripts/import-storefront-bundle.ts", "scripts/export-storefront-bundle.ts", "src/modules/suppliers/sync.ts",
    "src/modules/enrichment/import.ts", "src/modules/store/fitment-sync.ts", "scripts/rebuild-product-fitments.ts"];
  assert.ok(supplierImports.length >= 4 && bundle.length >= 4);
  for (const file of files) assert.ok(!/product_override_spec/.test(await readFile(file, "utf8")), file);
});

test("refused: missing or merged product, identity keys, hiding a key the sources lack, no change, the row limit, stale rows", async () => {
  const febi = await productOf("febi"), ngk = await productOf("ngk"), skf = await productOf("skf");
  assert.deepEqual(await set(randomUUID(), "Renk", "Mavi"), { ok: false, reason: "not-found" });
  for (const key of ["EAN", "ean", "Üretici", "Manufacturer Part Number", "Üretici parça numarası", "OEM numarası", "Barkod (EAN)", "Trade numbers"])
    assert.deepEqual(await set(febi, key, "X"), { ok: false, reason: "reserved" }, key);
  assert.deepEqual(await hide(febi, "Renk"), { ok: false, reason: "not-automatic" });
  assert.deepEqual(await hide(febi, "EAN"), { ok: false, reason: "unchanged" });
  assert.deepEqual(await set(febi, "Renk", "Gri"), { ok: false, reason: "unchanged" });
  assert.deepEqual(await store.removeProductSpec(schema.pool, febi, randomUUID(), admin), { ok: false, reason: "stale" });
  // Showing the hidden key again, then removing an added one: the automatic value returns.
  const rows = (await store.loadProductSpecs(schema.pool, febi)).rows;
  const ean = rows.find(row => row.key === "EAN")!, renk = rows.find(row => row.key === "Renk")!;
  assert.deepEqual(await store.removeProductSpec(schema.pool, febi, ean.id, admin), { ok: true });
  assert.deepEqual(await store.removeProductSpec(schema.pool, febi, ean.id, admin), { ok: false, reason: "stale" });
  assert.deepEqual(await store.removeProductSpec(schema.pool, febi, renk.id, admin), { ok: true });
  assert.deepEqual((await history(febi)).slice(-2).map(change => [change.field, change.old_value, change.new_value]), [
    ["spec_shown", "EAN", null], ["spec_removed", "Renk|Gri", null]]);
  assert.ok((await card("febi"))!.some(([key]) => key === "EAN"));
  await schema.pool.query(`INSERT INTO product_override_specs(product_id,action,key,value)
    SELECT $1,'set','K'||n,'V' FROM generate_series(1,$2::int) n`, [ngk, productSpecLimit]);
  assert.deepEqual(await set(ngk, "Renk", "Mavi"), { ok: false, reason: "limit" });
  // Changing a key it has stays possible at the limit.
  assert.deepEqual(await set(ngk, "K1", "W"), { ok: true });
  assert.equal((await merge(skf, ngk)).rows[0].id, ngk);
  assert.deepEqual(await set(skf, "Renk", "Mavi"), { ok: false, reason: "merged" });
  assert.deepEqual(await hide(skf, "Renk"), { ok: false, reason: "merged" });
});

test("a merge carries the specifications (the kept product's own row wins); undoing it takes them back", async () => {
  const lemA = await productOf("lemA"), lemB = await productOf("lemB");
  assert.deepEqual(await set(lemA, "Renk", "Siyah"), { ok: true });
  assert.deepEqual(await set(lemA, "Malzeme", "Çelik"), { ok: true });
  // A hidden key (the products have no enrichment here, so the row is written directly).
  await schema.pool.query("INSERT INTO product_override_specs(product_id,action,key) VALUES($1,'hide','Brand class')", [lemA]);
  assert.deepEqual(await set(lemB, "Malzeme", "Alüminyum"), { ok: true });
  assert.deepEqual((await merge(lemA, lemB)).rows[0], { id: lemB, carried: { set: 1, hidden: 1 } });
  // Carried rows keep their time in A, so the list stays in the order the admins made the decisions.
  assert.deepEqual(await listed(lemB), [["set", "Renk", "Siyah", true], ["hide", "Brand class", null, true], ["set", "Malzeme", "Alüminyum", false]]);
  assert.deepEqual((await history(lemB)).slice(1).map(change => [change.field, change.new_value, change.reason]), [
    ["spec_set", "Renk|Siyah", "carry"], ["spec_hidden", "Brand class", "carry"]]);
  // Both rows sell as B now and read the carried specifications.
  assert.deepEqual((await specs.getOverrideSpecs([ids.lemA])).get(ids.lemA)?.map(row => row.key), ["Renk", "Brand class", "Malzeme"]);
  // "Geri al": A is revived and B gives the carried rows back; its own row stays, A keeps its own.
  await schema.pool.query("SELECT product_reset_item($1)", [ids.lemA]);
  assert.deepEqual(await listed(lemB), [["set", "Malzeme", "Alüminyum", false]]);
  assert.deepEqual((await history(lemB)).slice(3).map(change => [change.field, change.old_value, change.reason]).sort(), [
    ["spec_removed", "Renk|Siyah", "uncarry"], ["spec_shown", "Brand class", "uncarry"]].sort());
  assert.equal((await listed(lemA)).length, 3);
  assert.deepEqual((await specs.getOverrideSpecs([ids.lemA])).get(ids.lemA)?.map(row => [row.key, row.value]), [["Renk", "Siyah"], ["Malzeme", "Çelik"], ["Brand class", null]]);
});

test("setup can run the file again", async () => {
  await schema.pool.query(await readFile("db/product-override-specs.sql", "utf8"));
  assert.equal((await schema.pool.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='product_override_specs_products_restored'
    AND tgrelid=to_regclass($1)`, [`${schema.name}.products`])).rows[0].n, 1);
});

test("facet options merge equivalent translations and keep every raw value in the filter (#703)", async () => {
  await item("posA", { supplier: "basbug", code: "VAR 11011", brand: "VARTA", name: "VARTA ARKA ON" });
  await item("posB", { supplier: "basbug", code: "VAR 12012", brand: "VARTA", name: "VARTA ON ARKA" });
  await schema.pool.query("SELECT refresh_product_matches()");
  assert.deepEqual(await set(await productOf("posA"), "Fitting Position", "Front Axle, Rear Axle"), { ok: true });
  assert.deepEqual(await set(await productOf("posB"), "Fitting Position", "Rear Axle, Front Axle"), { ok: true });
  const facets = await catalog.catalogFacets({ q: "VARTA" });
  const options = facets.attributes.find(row => row.key === "Fitting Position")?.options ?? [];
  assert.equal(options.length, 1, JSON.stringify(options));
  assert.equal(options[0].label, "Ön aks, Arka aks");
  assert.deepEqual([...options[0].values].sort(), ["Front Axle, Rear Axle", "Rear Axle, Front Axle"]);
  const both = await catalog.browseProducts({ attributes: JSON.stringify({ "Fitting Position": options[0].values }), sort: "newest" });
  const each = await Promise.all(options[0].values.map(value => catalog.browseProducts({ attributes: JSON.stringify({ "Fitting Position": [value] }), sort: "newest" })));
  assert.deepEqual(both.items.map(row => row.id).sort(), [ids.posA, ids.posB].sort());
  assert.equal(both.total, each.reduce((sum, page) => sum + page.total, 0));
});
