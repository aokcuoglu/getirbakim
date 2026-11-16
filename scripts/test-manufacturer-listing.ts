import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// Manufacturer page listings (#660) in an isolated copy of the schema: catalogFilter's manufacturer branch (the master
// brand's name and supplier labels), the page's count and the sitemap's count of the same pages, and the shown brand
// (display_brand: the master brand name, #811). Nothing is written to the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let sitemap: typeof import("../src/modules/seo/manufacturer-sitemap.server");
let invalidateListings: () => Promise<void>;
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug, , dinamik] = storefrontCompanies();

async function item(key: string, supplier: "basbug" | "dinamik", brand: string) {
  const product = { uk: brand, ac: `${key} PARCA`, ac2: "", dc: "TL", ...(supplier === "dinamik" ? { marka: brand, stokAdi: `${key} PARCA` } : {}) };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,'present',now(),now(),now()) RETURNING id::text`,
  [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", `${brand} ${key}`, product]);
  ids[key] = rows[0].id;
}
const sorted = (keys: string[]) => keys.map(key => ids[key]).sort();

before(async () => {
  schema = await isolatedSchema("manufacturer_listing_test");
  // BOSCH: two labels from two suppliers; MAHLE one label; MANN a name none of its labels has (MANN-FILTER); ORIJINAL a
  // group of genuine parts, no manufacturer. SACHS has no master brand row: it shows its raw label.
  const brand = async (key: string, name: string) => (await schema.pool.query<{ id: string }>("INSERT INTO brands(key,name) VALUES($1,$2) RETURNING id::text", [key, name])).rows[0].id;
  const [bosch, mahle, orijinal, mann] = [await brand("BOSCH", "BOSCH"), await brand("MAHLE", "MAHLE"), await brand("ORIJINAL", "ORIJINAL"),
    await brand("MANN", "MANN")];
  await schema.pool.query(`INSERT INTO supplier_brands(supplier,label,brand_id,items) VALUES
    ('basbug','BOSCH',$1,7),('dinamik','BOSCH AV',$1,6),('basbug','MAHLE',$2,9),('dinamik','VAG ORIJINAL',$3,12),('basbug','MANN-FILTER',$4,3)`,
  [bosch, mahle, orijinal, mann]);
  // BOSCH lists 10: b1-b6 (BOSCH) and a1-a4 (BOSCH AV); a5 is a secondary offer of b1, hidden an admin-hidden row.
  for (const key of ["b1", "b2", "b3", "b4", "b5", "b6", "hidden"]) await item(key, "basbug", "BOSCH");
  for (const key of ["a1", "a2", "a3", "a4", "a5"]) await item(key, "dinamik", "BOSCH AV");
  for (let index = 1; index <= 9; index++) await item(`m${index}`, "basbug", "MAHLE");
  for (let index = 1; index <= 12; index++) await item(`o${index}`, "dinamik", "VAG ORIJINAL");
  for (let index = 1; index <= 3; index++) await item(`f${index}`, "basbug", "MANN-FILTER");
  await item("other", "basbug", "SACHS");
  await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1)", [ids.b1, ids.a5]);
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,$1,true)", [ids.hidden]);
  // One vehicle type an admin fitted to b1 (BOSCH) and m1 (MAHLE): the garage count of a manufacturer page counts b1 only.
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'GOLF IV');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text) VALUES(100,10,'1.6',1598,'P','Benzin',101,74,'1998-01-01','golf 1.6')`);
  for (const key of ["b1", "m1"]) {
    const product = (await schema.pool.query<{ id: string }>("INSERT INTO products(brand,part_number,brand_label,code) VALUES($1,$1,$1,$1) RETURNING id::text", [key])).rows[0].id;
    await schema.pool.query("INSERT INTO product_sources(supplier_item_id,product_id) VALUES($1,$2)", [ids[key], product]);
    await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,100,'add')", [product]);
  }
  const [{ db }, catalogModule, sitemapModule, epoch] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"),
    import("../src/modules/seo/manufacturer-sitemap.server"), import("../src/modules/store/listing-epoch")]);
  catalog = catalogModule;
  sitemap = sitemapModule;
  invalidateListings = epoch.invalidateListings;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("the store shows the master brand name instead of the supplier's label", async () => {
  const row = async (key: string) => (await schema.pool.query<{ brand: string; display_brand: string }>(
    "SELECT brand,display_brand FROM storefront_catalog_entries WHERE id=$1", [ids[key]])).rows[0];
  // The raw label stays in `brand` (orders, enrichment, matching).
  assert.deepEqual(await row("a1"), { brand: "BOSCH AV", display_brand: "BOSCH" });
  assert.deepEqual(await row("o1"), { brand: "VAG ORIJINAL", display_brand: "ORIJINAL" });
  assert.deepEqual(await row("f1"), { brand: "MANN-FILTER", display_brand: "MANN" });
  assert.deepEqual(await row("other"), { brand: "SACHS", display_brand: "SACHS" });
  assert.equal((await schema.pool.query<{ display_brand: string }>("SELECT display_brand FROM commerce_catalog WHERE id=$1", [ids.a1])).rows[0].display_brand, "BOSCH");
});

test("a manufacturer page lists every label of its master brand and nothing else", async () => {
  const listed = (await catalog.browseProducts({ manufacturer: "bosch" })).items.map(row => row.id).sort();
  assert.deepEqual(listed, sorted(["b1", "b2", "b3", "b4", "b5", "b6", "a1", "a2", "a3", "a4"]));
  assert.equal(await catalog.listingTotal({ manufacturer: "bosch" }), 10);
  assert.equal(await catalog.listingTotal({ manufacturer: "mahle" }), 9);
  // A brand whose name is none of its labels lists its products (shown under its name).
  assert.equal(await catalog.listingTotal({ manufacturer: "mann" }), 3);
  // An unknown slug and a label's alias slug list nothing (the page answers 404 / redirects before reading).
  assert.equal(await catalog.listingTotal({ manufacturer: "yok-boyle-marka" }), 0);
  assert.equal(await catalog.listingTotal({ manufacturer: "bosch-av" }), 0);
});

test("filters narrow the manufacturer page and the facets stay within it", async () => {
  // Every label of a master brand shows its name: the brand facet and filter read master names.
  const narrowed = await catalog.browseProducts({ manufacturer: "bosch", brands: '["BOSCH"]' });
  assert.deepEqual(narrowed.items.map(row => row.id).sort(), sorted(["b1", "b2", "b3", "b4", "b5", "b6", "a1", "a2", "a3", "a4"]));
  assert.equal((await catalog.browseProducts({ manufacturer: "bosch", brands: '["BOSCH AV"]' })).total, 0);
  assert.deepEqual((await catalog.catalogFacets({ manufacturer: "bosch" })).brands, ["BOSCH"]);
});

test("a search on a manufacturer page stays within the manufacturer's labels", async () => {
  // Every test row is named "<key> PARCA": a plain search would list MAHLE, ORIJINAL and SACHS rows too.
  const all = (await catalog.browseProducts({ q: "PARCA" })).items.map(row => row.display_brand);
  assert.ok(all.includes("MAHLE"));
  const found = await catalog.browseProducts({ manufacturer: "bosch", q: "PARCA" });
  assert.equal(found.total, 10);
  assert.deepEqual([...new Set(found.items.map(row => row.display_brand))].sort(), ["BOSCH"]);
  // The search's brand facet (summarizeSearch) lists master names; a label without a master brand stays as written.
  const facet = (await catalog.catalogFacets({ q: "PARCA" })).brands;
  assert.ok(facet.includes("BOSCH") && facet.includes("MANN") && facet.includes("ORIJINAL") && facet.includes("SACHS"), facet.join());
  assert.ok(!facet.includes("BOSCH AV") && !facet.includes("MANN-FILTER") && !facet.includes("VAG ORIJINAL"), facet.join());
  const code = await catalog.browseProducts({ manufacturer: "mahle", q: "BOSCH b2", searchBy: "code" });
  assert.equal(code.total, 0);
});

test("the garage vehicle's count stays within the manufacturer page", async () => {
  assert.equal(await catalog.vehicleFitCount({ manufacturer: "bosch" }, "100"), 1);
  assert.equal(await catalog.vehicleFitCount({ manufacturer: "mahle" }, "100"), 1);
  assert.equal(await catalog.vehicleFitCount({}, "100"), 2);
});

test("the sitemap lists the manufacturers the page indexes: 10 products in, 9 out, ORIJINAL never", async () => {
  assert.deepEqual(await sitemap.loadManufacturerSlugs(), ["bosch"]);
  assert.equal(await catalog.listingTotal({ manufacturer: "orijinal" }), 12);
});

test("a brand rename shows at once: the page moves with the name and keeps its products", async () => {
  await schema.pool.query("UPDATE brands SET name='ROBERT BOSCH' WHERE key='BOSCH'");
  await invalidateListings();
  assert.equal((await schema.pool.query<{ display_brand: string }>("SELECT display_brand FROM storefront_catalog_entries WHERE id=$1", [ids.b1])).rows[0].display_brand, "ROBERT BOSCH");
  assert.equal(await catalog.listingTotal({ manufacturer: "robert-bosch" }), 10);
  assert.deepEqual((await catalog.catalogFacets({ manufacturer: "robert-bosch" })).brands, ["ROBERT BOSCH"]);
  assert.deepEqual(await sitemap.loadManufacturerSlugs(), ["robert-bosch"]);
});
