import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { productDescription, productMeta, productTitle, type StoreOverride } from "../src/modules/store/product-override-display";
import { productOverrideValuesSchema } from "../src/modules/admin/product-override-schema";
import { initialOverrideForm, overrideFormReducer } from "../src/modules/admin/product-override-form-state";

// Admin edits of the store card (#575) in an isolated copy of the schema: db/product-overrides.sql, the catalog views
// reading its projection, the store catalog and the admin store. Nothing is written to the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let store: typeof import("../src/modules/admin/product-override-store");
let cart: typeof import("../src/modules/store/cart");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug, , dinamik] = storefrontCompanies();
let admin: string;

type Item = { supplier: "basbug" | "dinamik"; code: string; brand: string; name: string; description?: string; category?: string };
async function item(key: string, { supplier, code, brand, name, description = "", category }: Item) {
  const product = { uk: brand, ac: name, ac2: description, dc: "TL", ...category ? { category } : {},
    ...(supplier === "dinamik" ? { marka: brand, stokAdi: name } : {}) };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code, product]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ product_id: string }>(
  "SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
// The changed fields of a save (its stored values and version are checked on their own below).
const persist = async (...args: Parameters<typeof store.persistProductOverride>) => {
  const result = await store.persistProductOverride(...args);
  return result.ok ? { ok: true as const, changed: result.changed } : result;
};
const projected = async () => (await schema.pool.query<{ supplier_item_id: string; name: string | null; hidden: boolean }>(
  "SELECT supplier_item_id::text,name,hidden FROM commerce_item_overrides ORDER BY supplier_item_id")).rows;

before(async () => {
  schema = await isolatedSchema("product_overrides_test");
  await item("febiBasbug", { supplier: "basbug", code: "FEB 10010", brand: "FEBI", name: "FEBI FREN BALATASI" });
  await item("febiDinamik", { supplier: "dinamik", code: "FEBI 10010", brand: "FEBI", name: "FEBI BALATA ON" });
  await item("mahle", { supplier: "basbug", code: "MAH 20020", brand: "MAHLE", name: "MAHLE YAG FILTRESI" });
  await item("ngk", { supplier: "basbug", code: "NGK 30030", brand: "NGK", name: "NGK BUJI" });
  await item("skf", { supplier: "basbug", code: "SKF 40040", brand: "SKF", name: "SKF RULMAN", category: "fren" });
  await item("sachs", { supplier: "dinamik", code: "SACHS 50050", brand: "SACHS", name: "SACHS AMORTISOR", description: "zirvekalite uyumlu" });
  await schema.pool.query("SELECT refresh_product_matches()");
  admin = (await schema.pool.query<{ id: string }>(`INSERT INTO accounts(name,email,password_hash,role,approved)
    VALUES('Test Yönetici',$1,'x','admin',true) RETURNING id::text`, [`${randomUUID()}@example.com`])).rows[0].id;
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
    VALUES('trodo',200,NULL,'Rulmanlar','rulmanlar','{200}','','{}')`);
  const [{ db }, catalogModule, storeModule, cartModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"),
    import("../src/modules/admin/product-override-store"), import("../src/modules/store/cart")]);
  catalog = catalogModule;
  store = storeModule;
  cart = cartModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("an edited name and description reach the product page, the cart and the listings", async () => {
  assert.deepEqual(await persist(schema.pool, await productOf("mahle"), { name: "Mahle Özel Yağ Filtresi", description: "Elle yazıldı" }, admin),
    { ok: true, changed: ["name", "description"] });
  const page = await catalog.getStorefrontProduct(ids.mahle);
  assert.equal(page?.name, "Mahle Özel Yağ Filtresi");
  assert.equal(page?.description, "Elle yazıldı");
  assert.equal((await catalog.getProduct(ids.mahle))?.name, "Mahle Özel Yağ Filtresi");
  const listed = await catalog.browseProducts({ q: "MAH 20020", searchBy: "code", sort: "newest" });
  assert.deepEqual(listed.items.map(row => [row.id, row.name]), [[ids.mahle, "Mahle Özel Yağ Filtresi"]]);
  // Saving the same values again changes nothing and records nothing.
  assert.deepEqual(await persist(schema.pool, await productOf("mahle"), { name: "Mahle Özel Yağ Filtresi" }, admin), { ok: true, changed: [] });
});

test("a supplier sync rewriting the row keeps the edit", async () => {
  await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"ac":"MAHLE YENI AD","ac2":"tedarikci"}',changed_at=now() WHERE id=$1`, [ids.mahle]);
  const page = await catalog.getStorefrontProduct(ids.mahle);
  assert.equal(page?.name, "Mahle Özel Yağ Filtresi");
  assert.equal(page?.description, "Elle yazıldı");
});

test("a matching refresh keeps the edit", async () => {
  await schema.pool.query("SELECT refresh_product_matches()");
  assert.equal((await catalog.getStorefrontProduct(ids.mahle))?.name, "Mahle Özel Yağ Filtresi");
  assert.deepEqual((await projected()).map(row => row.supplier_item_id), [ids.mahle]);
});

test("a merge carries the edits to a product without its own; split rows leave them behind", async () => {
  const febi = await productOf("febiBasbug"), mahle = await productOf("mahle");
  assert.equal(await productOf("febiDinamik"), febi);
  // As the merge actions do: product_merge, then product_overrides_carry in the same statement.
  const merge = (source: string, target: string) => schema.pool.query<{ id: string | null; carried: { fields: string[]; hidden: boolean } }>(`WITH merged AS (SELECT product_merge($1,$2,$3) AS id)
    SELECT id::text, product_overrides_carry($1, id, $3) AS carried FROM merged`, [source, target, admin]);
  assert.deepEqual((await merge(mahle, febi)).rows[0], { id: febi, carried: { fields: ["name", "description"], hidden: false } });
  for (const key of ["febiBasbug", "febiDinamik", "mahle"]) assert.equal((await catalog.getStorefrontProduct(ids[key]))?.name, "Mahle Özel Yağ Filtresi", key);
  // The edit stays on the merged product's id too; the target's history records the carried values.
  assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM product_overrides WHERE product_id=$1", [mahle])).rows[0].n, 1);
  assert.deepEqual((await store.loadProductOverride(schema.pool, febi)).changes.map(change => [change.field, change.old_value, change.new_value]).sort(),
    [["description", null, "Elle yazıldı"], ["name", null, "Mahle Özel Yağ Filtresi"]]);
  // A target with every field of its own keeps them.
  assert.deepEqual((await schema.pool.query("SELECT product_overrides_carry($1,$2,$3) AS carried", [mahle, febi, admin])).rows[0].carried, { fields: [], hidden: false });
  await persist(schema.pool, febi, { name: "Febi Ön Balata" }, admin);
  for (const key of ["febiBasbug", "febiDinamik", "mahle"]) assert.equal((await catalog.getStorefrontProduct(ids[key]))?.name, "Febi Ön Balata", key);
  // Split off, the MAHLE row is a product of its own without an edit.
  await schema.pool.query("SELECT product_split_item($1,$2)", [ids.mahle, admin]);
  assert.equal((await catalog.getStorefrontProduct(ids.mahle))?.name, "MAHLE YENI AD");
  assert.equal((await catalog.getStorefrontProduct(ids.febiDinamik))?.name, "Febi Ön Balata");
  assert.deepEqual((await projected()).map(row => row.supplier_item_id).sort(), [ids.febiBasbug, ids.febiDinamik].sort());
});

test("a merge fills only the target's automatic fields and always carries hidden", async () => {
  await item("bosch", { supplier: "basbug", code: "BOS 70070", brand: "BOSCH", name: "BOSCH SILECEK" });
  await item("conti", { supplier: "basbug", code: "CON 80080", brand: "CONTITECH", name: "CONTI KAYIS" });
  await schema.pool.query("SELECT refresh_product_matches()");
  const bosch = await productOf("bosch"), conti = await productOf("conti");
  await persist(schema.pool, conti, { name: "Conti hedef adı" }, admin);
  await persist(schema.pool, bosch, { name: "Bosch kaynak adı", seo_title: "Bosch SEO", hidden: true }, admin);
  const { rows } = await schema.pool.query<{ id: string; carried: { fields: string[]; hidden: boolean } }>(`WITH merged AS (SELECT product_merge($1,$2,$3) AS id)
    SELECT id::text, product_overrides_carry($1, id, $3) AS carried FROM merged`, [bosch, conti, admin]);
  assert.deepEqual(rows[0], { id: conti, carried: { fields: ["seo_title", "hidden"], hidden: true } });
  const { override } = await store.loadProductOverride(schema.pool, conti);
  assert.deepEqual([override?.name, override?.seo_title, override?.hidden], ["Conti hedef adı", "Bosch SEO", true]);
  for (const key of ["bosch", "conti"]) assert.equal(await catalog.getStorefrontProduct(ids[key]), undefined, key);
});

test("undoing a merge takes back what it carried, except fields an admin changed since", async () => {
  await item("lemA", { supplier: "basbug", code: "LEM 90090", brand: "LEMFORDER", name: "LEMFORDER ROT" });
  await item("lemB", { supplier: "basbug", code: "TRW 91091", brand: "TRW", name: "TRW ROT" });
  await schema.pool.query("SELECT refresh_product_matches()");
  const a = await productOf("lemA"), b = await productOf("lemB");
  await persist(schema.pool, a, { name: "AAAx", seo_title: "A SEO", hidden: true }, admin);
  await schema.pool.query("WITH merged AS (SELECT product_merge($1,$2,$3) AS id) SELECT product_overrides_carry($1, id, $3) FROM merged", [a, b, admin]);
  assert.equal(await catalog.getStorefrontProduct(ids.lemB), undefined);
  // The admin rewrites the carried SEO title on B: that field is B's own now.
  await persist(schema.pool, b, { seo_title: "B SEO" }, admin);
  // "Geri al" on the moved row: it returns to A, which is revived.
  await schema.pool.query("SELECT product_reset_item($1)", [ids.lemA]);
  assert.equal((await schema.pool.query("SELECT merged_into FROM products WHERE id=$1", [a])).rows[0].merged_into, null);
  const { override, changes } = await store.loadProductOverride(schema.pool, b);
  assert.deepEqual([override?.name, override?.seo_title, override?.hidden], [null, "B SEO", false]);
  assert.deepEqual(changes.filter(change => change.reason === "uncarry").map(change => [change.field, change.old_value, change.new_value]).sort(),
    [["hidden", "true", null], ["name", "AAAx", null]]);
  assert.equal((await catalog.getStorefrontProduct(ids.lemB))?.name, "TRW ROT");
  // A keeps its own edits and hides its row again.
  assert.equal(await catalog.getStorefrontProduct(ids.lemA), undefined);
  assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM product_override_carries WHERE source=$1", [a])).rows[0].n, 0);
});

test("a hidden product is off sale everywhere and its old links do not loop", async () => {
  await persist(schema.pool, await productOf("ngk"), { hidden: true }, admin);
  assert.equal(await catalog.getStorefrontProduct(ids.ngk), undefined);
  assert.equal(await catalog.getProduct(ids.ngk), undefined);
  assert.deepEqual((await catalog.browseProducts({ q: "NGK 30030", searchBy: "code", sort: "newest" })).items, []);
  assert.deepEqual(await catalog.searchProducts("NGK 30030"), []);
  assert.deepEqual(await catalog.searchCatalogItems("NGK 30030", "code"), []);
  assert.deepEqual(await catalog.getStoreProduct(ids.ngk), {});
  // Already in a cart: shown as no longer on sale, and it cannot be added again.
  const owner = { kind: "guest" as const, id: randomUUID().replace(/-/g, "") };
  await schema.pool.query("INSERT INTO guest_carts(token_hash) VALUES($1)", [owner.id]);
  await schema.pool.query("INSERT INTO commerce_cart_items(owner_kind,owner_id,product_id,quantity) VALUES('guest',$1,$2,1)", [owner.id, ids.ngk]);
  const [line] = await cart.cartFor(owner, schema.pool);
  assert.equal(line.name, "Ürün artık satışta değil");
  assert.equal(line.available, false);
  assert.equal(await cart.setCartQuantity(owner, ids.ngk, 1), false);
  // A product sold by two rows: neither row redirects to the other.
  await persist(schema.pool, await productOf("febiBasbug"), { hidden: true }, admin);
  assert.deepEqual(await catalog.getStoreProduct(ids.febiBasbug), {});
  assert.deepEqual(await catalog.getStoreProduct(ids.febiDinamik), {});
  assert.deepEqual((await catalog.browseProducts({ q: "FEBI 10010", searchBy: "code", sort: "newest" })).items, []);
  // Shown again: the name edit still applies.
  await persist(schema.pool, await productOf("febiBasbug"), { hidden: false }, admin);
  assert.equal((await catalog.getStorefrontProduct(ids.febiDinamik))?.name, "Febi Ön Balata");
});

test("a new supplier row of a hidden product is visible until the matching refresh links it (known limit)", async () => {
  await item("ngkDinamik", { supplier: "dinamik", code: "NGK 30030", brand: "NGK", name: "NGK BUJI YENI" });
  assert.ok(await catalog.getStorefrontProduct(ids.ngkDinamik));
  await schema.pool.query("SELECT refresh_product_matches()");
  assert.equal(await productOf("ngkDinamik"), await productOf("ngk"));
  assert.equal(await catalog.getStorefrontProduct(ids.ngkDinamik), undefined);
});

test("search finds a product by its edited name and ranks the edit", async () => {
  await persist(schema.pool, await productOf("skf"), { name: "Zirvekalite Teker Rulmanı" }, admin);
  const found = await catalog.browseProducts({ q: "zirvekalite" });
  // The edited name (weight A) ranks above a supplier description mentioning the word (weight D).
  assert.deepEqual(found.items.map(row => row.id), [ids.skf, ids.sachs]);
  assert.equal(found.items[0].name, "Zirvekalite Teker Rulmanı");
  assert.deepEqual((await catalog.searchCatalogItems("zirvekalite rulman", "all")).map(row => row.id), [ids.skf]);
  // The supplier's old name still finds it.
  assert.deepEqual((await catalog.browseProducts({ q: "skf rulman", sort: "newest" })).items.map(row => row.id), [ids.skf]);
});

test("an edited category moves the product between category listings", async () => {
  assert.ok((await catalog.categoryProductIds(["fren"], [252])).includes(ids.skf));
  assert.deepEqual(await persist(schema.pool, await productOf("skf"), { category_id: 200 }, admin), { ok: true, changed: ["category_id"] });
  assert.ok(!(await catalog.categoryProductIds(["fren"], [252, 999])).includes(ids.skf));
  assert.deepEqual(await catalog.categoryProductIds([], [200]), [ids.skf]);
});

test("returning a field to automatic restores the source value and the history names old, new and who", async () => {
  const skf = await productOf("skf");
  assert.deepEqual(await persist(schema.pool, skf, { name: null }, admin), { ok: true, changed: ["name"] });
  assert.equal((await catalog.getStorefrontProduct(ids.skf))?.name, "SKF RULMAN");
  const details = await store.loadProductOverride(schema.pool, skf);
  assert.equal(details.override?.name, null);
  assert.equal(details.override?.category_id, 200);
  assert.equal(details.automatic.name, "SKF RULMAN");
  assert.deepEqual(details.changes.filter(change => change.field === "name").map(change => [change.old_value, change.new_value, change.changed_by]),
    [["Zirvekalite Teker Rulmanı", null, "Test Yönetici"], [null, "Zirvekalite Teker Rulmanı", "Test Yönetici"]]);
  // Every field automatic again: the row goes, the history stays.
  await persist(schema.pool, skf, { category_id: null }, admin);
  assert.equal((await store.loadProductOverride(schema.pool, skf)).override, null);
  assert.equal((await store.loadProductOverride(schema.pool, skf)).changes.length, 4);
});

test("edits of a missing or merged product and unknown categories are refused", async () => {
  assert.deepEqual(await persist(schema.pool, randomUUID(), { name: "x" }, admin), { ok: false, reason: "not-found" });
  const merged = (await schema.pool.query<{ id: string }>("SELECT id::text FROM products WHERE merged_into IS NOT NULL LIMIT 1")).rows[0].id;
  assert.deepEqual(await persist(schema.pool, merged, { name: "x" }, admin), { ok: false, reason: "merged" });
  assert.deepEqual(await persist(schema.pool, await productOf("sachs"), { category_id: 123456 }, admin), { ok: false, reason: "category" });
});

test("a save from a form opened before another save is refused", async () => {
  const sachs = await productOf("sachs");
  assert.deepEqual(await persist(schema.pool, sachs, { seo_title: "Sachs amortisör" }, admin, store.automaticVersion), { ok: true, changed: ["seo_title"] });
  const { override } = await store.loadProductOverride(schema.pool, sachs);
  assert.ok(override);
  // The tab still holding "auto" is stale now; the current version saves.
  assert.deepEqual(await persist(schema.pool, sachs, { seo_title: "Eski sekme" }, admin, store.automaticVersion), { ok: false, reason: "stale" });
  assert.deepEqual(await persist(schema.pool, sachs, { seo_title: null }, admin, override.version), { ok: true, changed: ["seo_title"] });
  assert.deepEqual(await persist(schema.pool, sachs, { seo_title: "Yine eski" }, admin, override.version), { ok: false, reason: "stale" });
});

test("a dropped row of a hidden product is no unavailable card; a deleted row takes its projection with it", async () => {
  await item("valeo", { supplier: "basbug", code: "VAL 60060", brand: "VALEO", name: "VALEO SILECEK" });
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("UPDATE supplier_items SET presence='inactive',stock_data='{\"stok\":0}' WHERE id=$1", [ids.valeo]);
  const unavailable = async () => (await schema.pool.query<{ id: string }>("SELECT id::text FROM commerce_unavailable_items")).rows.map(row => row.id);
  assert.ok((await unavailable()).includes(ids.valeo));
  const valeo = await productOf("valeo");
  await persist(schema.pool, valeo, { hidden: true }, admin);
  assert.ok(!(await unavailable()).includes(ids.valeo));
  assert.equal(await catalog.getStorefrontProduct(ids.valeo), undefined);
  // The supplier row goes (cascading to product_sources, whose delete trigger runs): the copy goes, the product's edit stays.
  await schema.pool.query("DELETE FROM supplier_items WHERE id=$1", [ids.valeo]);
  assert.ok(!(await projected()).some(row => row.supplier_item_id === ids.valeo));
  assert.equal((await schema.pool.query("SELECT count(*)::int AS n FROM product_overrides WHERE product_id=$1", [valeo])).rows[0].n, 1);
});

test("setup keeps the source triggers instead of recreating them", async () => {
  const triggers = async () => (await schema.pool.query<{ oid: number }>(`SELECT oid::int FROM pg_trigger
    WHERE tgrelid='product_sources'::regclass AND tgname LIKE 'product_overrides_sources_%' ORDER BY tgname`)).rows.map(row => row.oid);
  const before = await triggers();
  assert.equal(before.length, 3);
  await schema.pool.query(await readFile("db/product-overrides.sql", "utf8"));
  assert.deepEqual(await triggers(), before);
});

test("a save returns the stored values and their version", async () => {
  const sachs = await productOf("sachs");
  const saved = await store.persistProductOverride(schema.pool, sachs, { name: "Sachs ön amortisör", category_id: 200 }, admin);
  assert.ok(saved.ok);
  assert.deepEqual(saved.values, { name: "Sachs ön amortisör", description: null, seo_title: null, seo_description: null, category_id: 200, hidden: false });
  assert.equal(saved.version, (await store.loadProductOverride(schema.pool, sachs)).override?.version);
  const cleared = await store.persistProductOverride(schema.pool, sachs, { name: null, category_id: null }, admin, saved.version);
  assert.ok(cleared.ok);
  assert.equal(cleared.version, store.automaticVersion);
  assert.deepEqual(cleared.values, { name: null, description: null, seo_title: null, seo_description: null, category_id: null, hidden: false });
});

test("the form shows stored values after a save, keeps other input on a revert and everything on an error", () => {
  const stored = { name: "Ad", description: null, seo_title: null, seo_description: null, category_id: 241, hidden: true };
  let state = initialOverrideForm(stored, "1");
  assert.deepEqual(state.values, { name: "Ad", description: "", seo_title: "", seo_description: "", category_id: "241", published: false });
  state = overrideFormReducer(state, { type: "edit", values: { name: "Yazılan ad", seo_title: "Yazılan SEO" } });
  // Reverting the category: only the category takes the stored (automatic) value; typed text stays.
  state = overrideFormReducer(state, { type: "result", result: { status: "success", reset: "category_id", version: "2",
    values: { ...stored, category_id: null } } });
  assert.deepEqual(state, { version: "2", dirty: ["name", "seo_title"],
    values: { name: "Yazılan ad", description: "", seo_title: "Yazılan SEO", seo_description: "", category_id: "", published: false } });
  // The page refresh after our own save carries the version already adopted: nothing changes.
  assert.equal(overrideFormReducer(state, { type: "server", values: { ...stored, category_id: null }, version: "2" }), state);
  // An error (stale, unknown category) keeps every typed value and the version.
  assert.equal(overrideFormReducer(state, { type: "result", result: { status: "error", message: "x" } }), state);
  // A full save shows every stored value, the category and the hidden switch included.
  state = overrideFormReducer(state, { type: "result", result: { status: "success", version: "3",
    values: { name: "Yazılan ad", description: null, seo_title: "Yazılan SEO", seo_description: null, category_id: 241, hidden: true } } });
  assert.deepEqual(state.values, { name: "Yazılan ad", description: "", seo_title: "Yazılan SEO", seo_description: "", category_id: "241", published: false });
  // Reverting hidden publishes the switch only.
  state = overrideFormReducer(overrideFormReducer(state, { type: "edit", values: { name: "Yeni" } }),
    { type: "result", result: { status: "success", reset: "hidden", version: "4", values: { name: "Yazılan ad", description: null, seo_title: "Yazılan SEO", seo_description: null, category_id: 241, hidden: false } } });
  assert.deepEqual([state.values.name, state.values.category_id, state.values.published, state.version], ["Yeni", "241", true, "4"]);
  // Edited "Yeni" is still unsaved: another version from the page keeps it and the old version; untouched inputs follow.
  assert.deepEqual(overrideFormReducer(state, { type: "server", values: null, version: "auto" }),
    { version: "4", dirty: ["name"], values: { name: "Yeni", description: "", seo_title: "", seo_description: "", category_id: "", published: true } });
  // Nothing edited: another version is adopted as a whole.
  const clean = initialOverrideForm(stored, "5");
  assert.deepEqual(overrideFormReducer(clean, { type: "server", values: null, version: "auto" }),
    { version: "auto", dirty: [], values: { name: "", description: "", seo_title: "", seo_description: "", category_id: "", published: true } });
});

test("a second tab's stale save keeps what it typed, whatever the page refresh brings", () => {
  // Both tabs opened at version 1; tab 1 saved name "AAAx" (version 2) meanwhile.
  const opened = { name: "Ad", description: "Eski", seo_title: null, seo_description: null, category_id: null, hidden: false };
  let tab2 = initialOverrideForm(opened, "1");
  tab2 = overrideFormReducer(tab2, { type: "edit", values: { name: "BBB" } });
  tab2 = overrideFormReducer(tab2, { type: "edit", values: { description: "DESC-B" } });
  const typed = tab2;
  tab2 = overrideFormReducer(tab2, { type: "result", result: { status: "error", message: "Bu ürün siz düzenlerken … değiştirildi." } });
  assert.equal(tab2, typed);
  // The refresh after the action renders tab 1's save (name AAAx, description cleared): typed fields stay, so does version 1.
  tab2 = overrideFormReducer(tab2, { type: "server", values: { ...opened, name: "AAAx", description: null, seo_title: "Tab 1 SEO" }, version: "2" });
  assert.deepEqual(tab2, { version: "1", dirty: ["name", "description"],
    values: { name: "BBB", description: "DESC-B", seo_title: "Tab 1 SEO", seo_description: "", category_id: "", published: true } });
});

test("the form schema trims, empties to automatic and reads the published switch", () => {
  const base = { name: "  Ad  ", description: "", seo_title: " ", seo_description: "", category_id: "" };
  assert.deepEqual(productOverrideValuesSchema.parse({ ...base, published: "on" }),
    { name: "Ad", description: null, seo_title: null, seo_description: null, category_id: null, hidden: false });
  assert.equal(productOverrideValuesSchema.parse(base).hidden, true);
  assert.equal(productOverrideValuesSchema.parse({ ...base, category_id: "241" }).category_id, 241);
  assert.equal(productOverrideValuesSchema.safeParse({ ...base, category_id: "12a" }).success, false);
  assert.equal(productOverrideValuesSchema.safeParse({ ...base, seo_title: "x".repeat(121) }).success, false);
});

test("supplier syncs, enrichment, fitment rebuilds and the storefront bundle never write the edits", async () => {
  const supplierImports = (await readdir("src/modules/suppliers")).filter(file => file.endsWith("-import.ts")).map(file => `src/modules/suppliers/${file}`);
  const bundle = (await readdir("scripts")).filter(file => file.startsWith("storefront-bundle-") && file.endsWith(".ts")).map(file => `scripts/${file}`);
  const files = [...supplierImports, ...bundle, "scripts/import-storefront-bundle.ts", "src/modules/enrichment/import.ts",
    "src/modules/store/fitment-sync.ts", "scripts/rebuild-product-fitments.ts"];
  assert.ok(supplierImports.length >= 4 && bundle.length >= 4);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.ok(!/product_overrides|commerce_item_overrides|product_override_changes/.test(source), file);
  }
});

test("an edit wins over the enrichment, which wins over the supplier", () => {
  const none: StoreOverride = { name: null, description: null, seo_title: null, seo_description: null, category_id: null };
  const edited: StoreOverride = { ...none, name: "Elle ad", description: "Elle açıklama", seo_title: "SEO", seo_description: "SEO açıklama" };
  assert.equal(productTitle(edited, "Zengin ad", "Tedarikçi"), "Elle ad");
  assert.equal(productTitle(none, "Zengin ad", "Tedarikçi"), "Zengin ad");
  assert.equal(productTitle(null, null, "Tedarikçi"), "Tedarikçi");
  assert.equal(productDescription(edited, "Zengin", "Tedarikçi"), "Elle açıklama");
  assert.equal(productDescription(none, "", "Tedarikçi"), "Tedarikçi");
  assert.equal(productDescription(null, undefined, ""), "");
  assert.deepEqual(productMeta(edited, { title: "T", description: "D" }), { title: "SEO", description: "SEO açıklama" });
  assert.deepEqual(productMeta(none, { title: "T", description: "D" }), { title: "T", description: "D" });
});
