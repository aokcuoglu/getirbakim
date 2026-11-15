import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { applyReferenceOverrides, gtinProperty, type ReferenceOverride } from "../src/modules/store/product-reference-display";
import { referenceHistoryValue, productReferenceLimit } from "../src/modules/admin/product-reference-fields";

// Admin-entered reference numbers (#582) in an isolated copy of the schema: db/product-override-references.sql, the
// store's read path, search and reference links, the admin store and merge carry/undo.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let store: typeof import("../src/modules/admin/product-reference-store");
let references: typeof import("../src/modules/store/product-references");
let catalog: typeof import("../src/modules/store/catalog");
let links: typeof import("../src/modules/store/reference-links");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
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
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
const add = (productId: string, kind: "oem" | "cross" | "ean", brand: string, number: string) => store.addProductReference(schema.pool, productId, { kind, brand, number }, admin);
const hide = (productId: string, kind: "oem" | "cross", brand: string, number: string) => store.hideProductReference(schema.pool, productId, { kind, brand, number }, admin);
const merge = (source: string, target: string) => schema.pool.query<{ id: string | null; carried: { added: number; hidden: number } }>(
  `WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT id::text, product_override_references_carry($1, id, $3) AS carried FROM merged`, [source, target, admin]);
const history = async (productId: string) => (await schema.pool.query<{ field: string; old_value: string | null; new_value: string | null; reason: string | null }>(
  "SELECT field,old_value,new_value,reason FROM product_override_changes WHERE product_id=$1 ORDER BY id", [productId])).rows;
const listed = async (productId: string) => (await store.loadProductReferences(schema.pool, productId)).added.map(row => [row.kind, row.brand, row.number, row.carried]);
/** Store row ids a code search lists (each query once: plain searches are cached for the process). */
const found = async (q: string) => (await catalog.browseProducts({ q, searchBy: "code", sort: "newest" })).items.map(row => row.id);
const row = (kind: ReferenceOverride["kind"], action: ReferenceOverride["action"], brand: string, number: string): ReferenceOverride =>
  ({ kind, action, brand, number, brand_key: brand.toUpperCase().replace(/[^A-Z0-9]/g, ""), number_key: number.toUpperCase().replace(/[^A-Z0-9]/g, "") });

before(async () => {
  schema = await isolatedSchema("product_override_references_test");
  await item("febiBasbug", { supplier: "basbug", code: "FEB 10010", brand: "FEBI", name: "FEBI FREN BALATASI" });
  await item("febiDinamik", { supplier: "dinamik", code: "FEBI 10010", brand: "FEBI", name: "FEBI BALATA ON" });
  await item("mahle", { supplier: "basbug", code: "MAH 20020", brand: "MAHLE", name: "MAHLE YAG FILTRESI" });
  await item("ngk", { supplier: "basbug", code: "NGK 30030", brand: "NGK", name: "NGK BUJI" });
  await item("skf", { supplier: "basbug", code: "SKF 40040", brand: "SKF", name: "SKF RULMAN" });
  await item("lemA", { supplier: "basbug", code: "LEM 90090", brand: "LEMFORDER", name: "LEMFORDER ROT" });
  await item("lemB", { supplier: "basbug", code: "TRW 91091", brand: "TRW", name: "TRW ROT" });
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  // Enrichment of the Dinamik FEBI row, shared with the Başbuğ row of the same product.
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,'FEBI 10010','FEBI','complete')`, [ids.febiDinamik]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
    VALUES($1,'FEBI 10010','FEBI','https://www.trodo.com/febi','test','FEBI BILSTEIN','10010',$2)`,
  [ids.febiDinamik, JSON.stringify({ specifications: [], vehicles: [], oemNumbers: { VW: ["1K0 615 301 AA", "1K0615301AB"], AUDI: ["8E0615301Q"] },
    crossReferences: { BOSCH: ["0 986 424 797"] } })]);
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  const [{ db }, storeModule, referencesModule, catalogModule, linksModule] = await Promise.all([import("../src/lib/db"),
    import("../src/modules/admin/product-reference-store"), import("../src/modules/store/product-references"),
    import("../src/modules/store/catalog"), import("../src/modules/store/reference-links")]);
  store = storeModule;
  references = referencesModule;
  catalog = catalogModule;
  links = linksModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("hidden numbers leave their group, added ones join the brand's group once", () => {
  const automatic = { oemNumbers: { VW: ["1K0 615 301 AA", "1K0615301AB"], AUDI: ["8E0615301Q"] }, crossReferences: { BOSCH: ["0 986 424 797"] } };
  const result = applyReferenceOverrides(automatic, [
    row("oem", "hide", "vw", "1K0615301AA"),
    row("oem", "hide", "Audi", "8E0-615-301-Q"),
    row("oem", "add", "V.W.", "1K0615301AC"),
    row("oem", "add", "VW", "1k0 615 301 ab"),
    row("oem", "add", "SKODA", "5Q0615301"),
    row("cross", "add", "TRW", "GDB1550"),
    row("cross", "hide", "TRW", "GDB1551"),
    row("ean", "add", "", "4006584112302"),
    row("ean", "add", "", "4006584112302"),
  ]);
  // AUDI lost its only number; VW kept AB once and took AC; SKODA is new under the admin's spelling.
  assert.deepEqual(result.oemNumbers, { VW: ["1K0615301AB", "1K0615301AC"], SKODA: ["5Q0615301"] });
  assert.deepEqual(result.crossReferences, { BOSCH: ["0 986 424 797"], TRW: ["GDB1550"] });
  assert.deepEqual(result.eans, ["4006584112302"]);
  assert.deepEqual(applyReferenceOverrides({ oemNumbers: {}, crossReferences: {} }, []), { oemNumbers: {}, crossReferences: {}, eans: [] });
  assert.deepEqual(["12345670", "036000291452", "4006584112302", "14006584112308", "123"].map(gtinProperty), ["gtin8", "gtin12", "gtin13", "gtin14", null]);
  assert.equal(referenceHistoryValue("reference_added", "oem|VW|1K0615301AA"), "OEM · VW · 1K0615301AA");
  assert.equal(referenceHistoryValue("reference_added", "ean||4006584112302"), "EAN · 4006584112302");
  assert.equal(referenceHistoryValue("reference_shown", "cross|A|B|C 12"), "Muadil · A|B · C 12");
  assert.equal(referenceHistoryValue("name", "x"), null);
});

test("enrichment OEM numbers are compacted into one indexed search text", async () => {
  const oemSearch = async (payload: unknown) => (await schema.pool.query<{ text: string }>("SELECT enrichment_oem_search($1::jsonb) AS text", [JSON.stringify(payload)])).rows[0].text;
  assert.equal(await oemSearch({ oemNumbers: { VW: ["1K0 615 301 AA", null, "1K0-615.301 AB"], X: "bad" } }), "1k0615301aa 1k0615301ab");
  assert.equal(await oemSearch({}), "");
  assert.equal(await oemSearch({ oemNumbers: [] }), "");
  assert.equal((await schema.pool.query("SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname='product_enrichments_oem_search_idx'", [schema.name])).rowCount, 1);
});

test("added numbers reach every supplier row of the product; the admin list shows the automatic ones", async () => {
  const febi = await productOf("febiBasbug");
  assert.deepEqual(await add(febi, "oem", "SKODA", "5Q0 615 301"), { ok: true });
  assert.deepEqual(await add(febi, "cross", "TRW", "GDB-1550"), { ok: true });
  assert.deepEqual(await add(febi, "ean", "BOSCH", "4006584112302"), { ok: true });
  for (const key of ["febiBasbug", "febiDinamik"]) assert.deepEqual((await references.getItemReferences(ids[key])).map(r => [r.kind, r.action, r.brand, r.number, r.number_key]), [
    ["oem", "add", "SKODA", "5Q0 615 301", "5Q0615301"], ["cross", "add", "TRW", "GDB-1550", "GDB1550"], ["ean", "add", "", "4006584112302", "4006584112302"]], key);
  assert.deepEqual(await references.getItemReferences(ids.mahle), []);
  const loaded = await store.loadProductReferences(schema.pool, febi);
  assert.deepEqual(loaded.automatic.map(r => [r.kind, r.brand, r.number, r.hiddenId, r.supplierOem]), [
    ["oem", "AUDI", "8E0615301Q", null, false], ["oem", "VW", "1K0 615 301 AA", null, false], ["oem", "VW", "1K0615301AB", null, false],
    ["cross", "BOSCH", "0 986 424 797", null, false]]);
  assert.deepEqual((await history(febi)).map(change => [change.field, change.new_value]), [
    ["reference_added", "oem|SKODA|5Q0 615 301"], ["reference_added", "cross|TRW|GDB-1550"], ["reference_added", "ean||4006584112302"]]);
});

test("code search finds added OEM, cross and barcode numbers, and not a hidden enrichment OEM", async () => {
  const febi = await productOf("febiBasbug");
  const febiRows = (hits: string[]) => hits.some(id => id === ids.febiBasbug || id === ids.febiDinamik);
  assert.ok(febiRows(await found("5Q0615301")), "added OEM");
  assert.ok(febiRows(await found("gdb 1550")), "added cross code");
  assert.ok(febiRows(await found("4006584112302")), "added barcode");
  assert.ok(!febiRows(await found("9999999999")));
  assert.deepEqual(await hide(febi, "oem", "VW", "1K0 615 301 AA"), { ok: true });
  assert.ok(!febiRows(await found("1K0615301AA")), "hidden enrichment OEM");
  assert.ok(febiRows(await found("1K0-615-301-AB")), "the product's other OEM");
  const loaded = await store.loadProductReferences(schema.pool, febi);
  const hidden = loaded.hidden.map(r => r.id);
  assert.equal(hidden.length, 1);
  assert.deepEqual(loaded.automatic.filter(r => r.hiddenId).map(r => [r.brand, r.number, r.hiddenId]), [["VW", "1K0 615 301 AA", hidden[0]]]);
  // The store page leaves it out.
  const page = applyReferenceOverrides({ oemNumbers: { VW: ["1K0 615 301 AA", "1K0615301AB"] }, crossReferences: {} }, await references.getItemReferences(ids.febiBasbug));
  assert.deepEqual(page.oemNumbers, { VW: ["1K0615301AB"], SKODA: ["5Q0 615 301"] });
});

test("an OEM number added to another product links from the product page", async () => {
  const mahle = await productOf("mahle");
  assert.deepEqual(await add(mahle, "oem", "VW", "06A 115 561 B"), { ok: true });
  const href = await links.getReferenceLinks(ids.febiBasbug, [{ brand: "VW", kind: "oem", codes: ["06A115561B", "1K0615301AB"] }]);
  assert.equal(href("VW", "06A115561B"), "/katalog?q=06A115561B&searchBy=code");
  assert.equal(href("VW", "1K0615301AB"), undefined);
  // The product's own added number does not link back to itself (through any of its rows).
  const own = await links.getReferenceLinks(ids.febiDinamik, [{ brand: "SKODA", kind: "oem", codes: ["5Q0615301"] }]);
  assert.equal(own("SKODA", "5Q0615301"), undefined);
});

test("enrichment imports, supplier syncs and matching refreshes leave the numbers alone", async () => {
  const febi = await productOf("febiBasbug");
  const before = await references.getItemReferences(ids.febiDinamik);
  await schema.pool.query(`UPDATE product_enrichments SET payload=jsonb_set(payload,'{oemNumbers}','{"VW":["1K0 615 301 AA","1K0615301AD"]}'),imported_at=now() WHERE supplier_item_id=$1`, [ids.febiDinamik]);
  await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"FEBI YENI AD","oe":"1K0615301ZZ"}',changed_at=now() WHERE id=ANY($1::uuid[])`, [[ids.febiBasbug, ids.febiDinamik]]);
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  assert.equal(await productOf("febiBasbug"), febi);
  // The OEM search index (#609) follows the rewritten payload.
  assert.ok((await found("1K0 615 301 AD")).some(id => id === ids.febiBasbug || id === ids.febiDinamik), "new enrichment OEM");
  assert.deepEqual(await references.getItemReferences(ids.febiDinamik), before);
  const loaded = await store.loadProductReferences(schema.pool, febi);
  // The rewritten payload is listed; the hidden number is still hidden; the supplier OEM is read-only.
  assert.deepEqual(loaded.automatic.map(r => [r.kind, r.brand, r.number, Boolean(r.hiddenId), r.supplierOem]), [
    ["oem", "VW", "1K0 615 301 AA", true, false], ["oem", "VW", "1K0615301AD", false, false], ["cross", "BOSCH", "0 986 424 797", false, false],
    ["oem", "", "1K0615301ZZ", false, true]]);
});

test("supplier syncs, enrichment, fitment rebuilds and the storefront bundle never touch the numbers", async () => {
  const supplierImports = (await readdir("src/modules/suppliers")).filter(file => file.endsWith("-import.ts")).map(file => `src/modules/suppliers/${file}`);
  const bundle = (await readdir("scripts")).filter(file => file.startsWith("storefront-bundle-") && file.endsWith(".ts")).map(file => `scripts/${file}`);
  const files = [...supplierImports, ...bundle, "scripts/import-storefront-bundle.ts", "scripts/export-storefront-bundle.ts", "src/modules/suppliers/sync.ts",
    "src/modules/enrichment/import.ts", "src/modules/store/fitment-sync.ts", "scripts/rebuild-product-fitments.ts"];
  assert.ok(supplierImports.length >= 4 && bundle.length >= 4);
  for (const file of files) assert.ok(!/product_override_reference/.test(await readFile(file, "utf8")), file);
});

test("refused: missing or merged product, invalid barcode, duplicates, adding a hidden number, the row limit", async () => {
  const febi = await productOf("febiBasbug"), ngk = await productOf("ngk"), skf = await productOf("skf");
  assert.deepEqual(await add(randomUUID(), "oem", "VW", "1K0615301AA"), { ok: false, reason: "not-found" });
  assert.deepEqual(await add(febi, "ean", "", "4006584112301"), { ok: false, reason: "ean" });
  assert.deepEqual(await add(febi, "ean", "", "ABC12345"), { ok: false, reason: "ean" });
  assert.deepEqual(await add(febi, "oem", "skoda", "5Q0-615-301"), { ok: false, reason: "duplicate" });
  assert.deepEqual(await add(febi, "oem", "V W", "1K0615301AA"), { ok: false, reason: "hidden" });
  assert.deepEqual(await hide(febi, "oem", "VW", "1K0615301AA"), { ok: false, reason: "duplicate" });
  // A cross code and an OEM may share a number.
  assert.deepEqual(await add(febi, "cross", "SKODA", "5Q0615301"), { ok: true });
  // Removing: a stale id, then showing a hidden number again.
  assert.deepEqual(await store.removeProductReference(schema.pool, febi, randomUUID(), admin), { ok: false, reason: "stale" });
  const hidden = (await store.loadProductReferences(schema.pool, febi)).hidden[0];
  assert.deepEqual(await store.removeProductReference(schema.pool, febi, hidden.id, admin), { ok: true });
  assert.deepEqual(await store.removeProductReference(schema.pool, febi, hidden.id, admin), { ok: false, reason: "stale" });
  assert.deepEqual((await history(febi)).slice(-2).map(change => [change.field, change.old_value, change.new_value]), [
    ["reference_added", null, "cross|SKODA|5Q0615301"], ["reference_shown", "oem|VW|1K0 615 301 AA", null]]);
  await schema.pool.query(`INSERT INTO product_override_references(product_id,kind,action,brand,number)
    SELECT $1,'cross','add','NGK','X'||lpad(n::text,4,'0') FROM generate_series(1,$2::int) n`, [ngk, productReferenceLimit]);
  assert.deepEqual(await add(ngk, "cross", "NGK", "Y0001"), { ok: false, reason: "limit" });
  assert.equal((await merge(skf, ngk)).rows[0].id, ngk);
  assert.deepEqual(await add(skf, "oem", "VW", "1K0615301AA"), { ok: false, reason: "merged" });
  assert.deepEqual(await hide(skf, "oem", "VW", "1K0615301AA"), { ok: false, reason: "merged" });
});

test("a merge carries the numbers (the kept product's own row wins); undoing it takes them back", async () => {
  const lemA = await productOf("lemA"), lemB = await productOf("lemB");
  assert.deepEqual(await add(lemA, "oem", "BMW", "31126774826"), { ok: true });
  assert.deepEqual(await add(lemA, "cross", "MOOG", "BM-ES-4812"), { ok: true });
  assert.deepEqual(await hide(lemA, "oem", "MINI", "6774826"), { ok: true });
  // B has its own row for the same cross code: it stays B's.
  assert.deepEqual(await add(lemB, "cross", "moog", "BMES4812"), { ok: true });
  assert.deepEqual((await merge(lemA, lemB)).rows[0], { id: lemB, carried: { added: 1, hidden: 1 } });
  assert.deepEqual(await listed(lemB), [["cross", "moog", "BMES4812", false], ["oem", "BMW", "31126774826", true]]);
  assert.deepEqual((await store.loadProductReferences(schema.pool, lemB)).hidden.map(r => [r.brand, r.number, r.carried]), [["MINI", "6774826", true]]);
  assert.deepEqual((await history(lemB)).slice(1).map(change => [change.field, change.new_value, change.reason]), [
    ["reference_added", "oem|BMW|31126774826", "carry"], ["reference_hidden", "oem|MINI|6774826", "carry"]]);
  // Both rows sell as B now and read the carried numbers.
  assert.deepEqual((await references.getItemReferences(ids.lemA)).map(r => r.number).sort(), ["31126774826", "6774826", "BMES4812"]);
  // "Geri al": A is revived and B gives the carried rows back; its own row stays, A keeps its own.
  await schema.pool.query("SELECT product_reset_item($1)", [ids.lemA]);
  assert.deepEqual(await listed(lemB), [["cross", "moog", "BMES4812", false]]);
  assert.deepEqual((await store.loadProductReferences(schema.pool, lemB)).hidden, []);
  assert.deepEqual((await history(lemB)).slice(3).map(change => [change.field, change.old_value, change.reason]).sort(), [
    ["reference_removed", "oem|BMW|31126774826", "uncarry"], ["reference_shown", "oem|MINI|6774826", "uncarry"]]);
  assert.equal((await listed(lemA)).length, 2);
  assert.deepEqual((await references.getItemReferences(ids.lemA)).map(r => r.number).sort(), ["31126774826", "6774826", "BM-ES-4812"]);
});

test("setup can run the file again", async () => {
  await schema.pool.query(await readFile("db/product-override-references.sql", "utf8"));
  await schema.pool.query(await readFile("db/product-enrichment.sql", "utf8"));
  assert.equal((await schema.pool.query(`SELECT count(*)::int AS n FROM pg_trigger WHERE tgname='product_override_references_products_restored'
    AND tgrelid=to_regclass($1)`, [`${schema.name}.products`])).rows[0].n, 1);
});
