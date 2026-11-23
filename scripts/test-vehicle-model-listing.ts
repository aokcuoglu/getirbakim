import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { listingIndexable } from "../src/modules/seo/indexing";
import { listingRangeLabel } from "../src/modules/store/catalog-filters";
import { listingPath, modelPath } from "../src/modules/seo/paths";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { AsyncLocalStorage } from "node:async_hooks";

// Vehicle model and make page listings (#639, #674) and their category pages (#673) in an isolated copy of the schema:
// catalogFilter's model and make branches, the union of engine-level and description fits, the category counts the make and model pages link
// (scopeCategoryCounts) and the 404 / noindex rules of findListing (listing-load.ts; the route's loadListing turns null
// into notFound and listingMetadata the total into robots). Nothing is written to the shared database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let load: typeof import("../src/modules/store/listing-load");
let groups: typeof import("../src/modules/store/vehicle-model-groups.server");
let categories: typeof import("../src/modules/store/listing-categories.server");
let sitemap: typeof import("../src/modules/seo/sitemap-models.server");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();
// More than the 600 price-ordered rows browseProducts caches, so the last page reads live.
const pricedProducts = 620;

async function item(key: string) {
  const product = { uk: "TESTBRAND", ac: `${key} PARCA`, dc: "TL" };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,$4,$5,1,1,1,'present',now(),now(),now()) RETURNING id::text`, [basbug, `TB ${key}`, product, { nf: 100 }, { stok: 1 }]);
  ids[key] = rows[0].id;
}
const fit = (table: "storefront_model_fits" | "product_model_fitments", model: number, key: string) => table === "storefront_model_fits"
  ? schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES($1,$2)", [model, ids[key]])
  : schema.pool.query("INSERT INTO product_model_fitments(supplier_item_id,model_id,source_text) VALUES($2,$1,'test')", [model, ids[key]]);
// The make page reads the description fits' makes precomputed per row (#956); the fixtures write the make table by hand
// rather than through the refresh, so the description makes are mirrored from the view the same way after a change.
const mirrorDescriptionMakes = () => schema.pool.query(`DELETE FROM storefront_make_description_fits;
  INSERT INTO storefront_make_description_fits(brand_id,supplier_item_id) SELECT brand_id,supplier_item_id FROM storefront_make_description_fits_compute()`);
// The category tree (getStoreCategories) calls connection(), which needs a request scope: a static work store lets it
// run. Next reads the global AsyncLocalStorage when its storage module loads (before, ahead of the other imports).
let workStorage: typeof import("next/dist/server/app-render/work-async-storage.external").workAsyncStorage;
const inRequest = <T>(run: () => Promise<T>) => workStorage.run({ route: "/test", forceStatic: true } as Parameters<typeof workStorage.run>[0], run);
const listed = async (query: { make: string; model?: string }) => (await catalog.browseProducts(query)).items.map(row => row.id).sort();

before(async () => {
  schema = await isolatedSchema("vehicle_model_listing_test");
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES
     (10,1,'GOLF VII (5G1)','2012-08-01','2017-03-01'),(11,1,'GOLF VII Variant (BA5)','2013-08-01','2020-12-01'),
     (20,1,'POLO VI (AW1)','2017-06-01',NULL),(30,1,'TIGUAN VII (XX1)','2016-01-01',NULL),(40,1,'PASSAT B8 (3G2)','2014-08-01',NULL)`);
  // golf-7: 12 listed products. g1-g3 engine-level, g1 also from a description (counted once), g4-g10 descriptions
  // (g4 through its secondary offer g4s), g11 on the Variant series, g12 engine-level only and in no make list.
  for (const key of ["g1", "g2", "g3", "g4", "g4s", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12", "p1", "p2", "hidden"]) await item(key);
  // Price-sorted listings (#674): a make with more products than the cached window (20 pages of 24) and varied prices.
  await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(3,'DACIA','DACIA')");
  await schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
     product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    SELECT 'basbug',$1,'G','MRK','TB D'||n,jsonb_build_object('uk','TESTBRAND','ac','D'||n||' PARCA','dc','TL'),
     jsonb_build_object('nf',10+(n*37)%500),'{"stok":1}',1,1,1,'present',now(),now(),now() FROM generate_series(1,${pricedProducts}) n`, [basbug]);
  await schema.pool.query("INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT 3,id FROM supplier_items WHERE code LIKE 'TB D%'");
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1) ON CONFLICT (item_id) DO UPDATE SET primary_id=EXCLUDED.primary_id", [ids.g4, ids.g4s]);
  for (const key of ["g1", "g2", "g3", "g12"]) await fit("storefront_model_fits", 10, key);
  await fit("product_model_fitments", 10, "g1");
  await fit("product_model_fitments", 10, "g5"); await fit("product_model_fitments", 10, "g6"); await fit("product_model_fitments", 10, "g7");
  await fit("product_model_fitments", 10, "g8"); await fit("product_model_fitments", 10, "g9"); await fit("product_model_fitments", 10, "g10");
  await fit("product_model_fitments", 11, "g4s"); await fit("product_model_fitments", 11, "g11");
  // polo-6: two products (below the indexing minimum); passat-b8: fits only on an item an admin hid and on a secondary offer (listed through its primary, not by itself).
  await fit("storefront_model_fits", 20, "p1"); await fit("product_model_fitments", 20, "p2");
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,gen_random_uuid(),true)", [ids.hidden]);
  await fit("product_model_fitments", 40, "hidden");
  await item("gone");
  await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$2)", [ids.gone, ids.g1]);
  await fit("storefront_model_fits", 40, "gone");
  // The make list holds only g1: a model page must not intersect with it.
  await schema.pool.query("INSERT INTO storefront_make_fits(brand_id,supplier_item_id) VALUES(1,$1)", [ids.g1]);
  // Make × category (#674): g1 (engine-level) and g5 (description) are brake parts, so is p1, which no make list holds.
  await schema.pool.query(`UPDATE supplier_items SET product_data=product_data||'{"category":"fren"}' WHERE id=ANY($1::uuid[])`, [[ids.g1, ids.g5, ids.p1]]);
  // REPXPERT specs (#674): Golf 7's types for the model page facts; a BMW make whose R 1200 GS series is all
  // two-wheelers, R 1250 RT mixed and 3 (E90) without specs.
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(2,'BMW','BMW');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(50,2,'R 1200 GS (K25)','2004-01-01','2013-12-01'),
     (51,2,'R 1250 RT (K52)','2018-01-01',NULL),(52,2,'3 (E90)','2004-12-01','2011-12-01');
    INSERT INTO vehicle_types(id,model_id,name,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text) VALUES
     (100,10,'1.4 TSI','Petrol','Benzin',122,90,'2012-08-01',''),(101,10,'2.0 TDI','Diesel','Dizel',150,110,'2012-08-01',''),
     (102,11,'1.6 TDI','Diesel','Dizel',105,77,'2013-08-01',''),(103,11,'1.2 TSI','Petrol','Benzin',105,77,'2013-08-01',''),
     (500,50,'1200','Petrol','Benzin',98,72,'2004-01-01',''),(501,50,'1200 ABS','Petrol','Benzin',98,72,'2004-01-01',''),
     (510,51,'1250','Petrol','Benzin',136,100,'2018-01-01',''),(511,51,'1250 Sidecar','Petrol','Benzin',136,100,'2018-01-01',''),
     (520,52,'320 d','Diesel','Dizel',177,130,'2004-12-01','');
    INSERT INTO vehicle_type_specs(vehicle_type_id,outcome,body_type,engine_codes) VALUES
     (100,'found','Hatchback','{CZCA,CMBA}'),(101,'found','Hatchback','{CRBC,CZCA}'),(102,'found','Station wagon','{CLHA}'),
     (103,'missing',NULL,'{CJZA}'),
     (500,'found','İki tekerlekli taşıt','{}'),(501,'found','İki tekerlekli taşıt','{}'),
     (510,'found','İki tekerlekli taşıt','{}'),(511,'found','Sedan','{}')`);
  // Categories (#673): 3 Yedek parçalar > 252 Fren (legacy "fren") > 269 Fren diskleri; 3 > 241 Filtre (legacy
  // "filtre"); 200 Aydınlatma, empty. Golf 7 in Fren: g1-g3 and g5-g9 by legacy slug, g10 through a Trodo category of a
  // child (trusted enrichment), g11 an admin's category (its automatic "filtre" is dropped): 10. g4 and g12 in Filtre.
  // Not counted: the secondary offer g4s's "fren" (g4, its primary, is in Filtre) and the hidden gh.
  await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw) VALUES
    ('trodo',3,NULL,'Yedek parçalar','yedek-parca','{3}','','{}'),('trodo',252,3,'Fren','fren','{3,252}','','{}'),
    ('trodo',269,252,'Fren diskleri','fren-diskleri-269','{3,252,269}','','{}'),('trodo',241,3,'Filtre','filtre','{3,241}','','{}'),
    ('trodo',200,NULL,'Aydınlatma','aydinlatma-200','{200}','','{}');
    INSERT INTO source_category_labels(source,category_id,locale,name,slug) VALUES
    ('trodo',3,'tr','Yedek parçalar','yedek-parca'),('trodo',252,'tr','Fren','fren'),('trodo',269,'tr','Fren diskleri','fren-diskleri-269'),
    ('trodo',241,'tr','Filtre','filtre'),('trodo',200,'tr','Aydınlatma','aydinlatma-200')`);
  await item("gh");
  await fit("storefront_model_fits", 10, "gh");
  await schema.pool.query("INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hidden) VALUES($1,gen_random_uuid(),true)", [ids.gh]);
  const legacy = (slug: string, keys: string[]) => schema.pool.query(`UPDATE supplier_items SET product_data=product_data||jsonb_build_object('category',$1::text)
    WHERE id=ANY($2::uuid[])`, [slug, keys.map(key => ids[key])]);
  await legacy("fren", ["g1", "g2", "g3", "g5", "g6", "g7", "g8", "g9", "g4s", "gh", "p1", "p2"]);
  // g4 is fitted only through its secondary offer's description: its category still counts for Golf 7.
  await legacy("filtre", ["g4", "g11", "g12"]);
  // g3 is in Fren twice (its legacy slug and a Trodo category): counted once.
  for (const key of ["g10", "g3"]) {
    await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
      VALUES($1,$2,'TESTBRAND','https://example.test/p','test','TESTBRAND',$2,'{"specifications":[],"oemNumbers":{},"crossReferences":{},"vehicles":[]}')`, [ids[key], `TB ${key}`]);
    await schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,imported_at)
      VALUES($1,$2,'TESTBRAND',$1,'','complete',now())`, [ids[key], `TB ${key}`]);
    await schema.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'trodo',269)", [ids[key]]);
  }
  // The test codes are too short for the automatic grouping: g11's product is made by hand, as an admin's split does.
  await schema.pool.query(`WITH product AS (INSERT INTO products(brand,part_number,name,brand_label,code) VALUES('TESTBRAND','G11','g11 PARCA','TESTBRAND','TB g11') RETURNING id),
    source AS (INSERT INTO product_sources(supplier_item_id,product_id,method) SELECT $1,id,'manual' FROM product)
    INSERT INTO product_overrides(product_id,category_id) SELECT id,252 FROM product`, [ids.g11]);
  await mirrorDescriptionMakes();
  Object.assign(globalThis, { AsyncLocalStorage });
  workStorage = (await import("next/dist/server/app-render/work-async-storage.external")).workAsyncStorage;
  const [{ db }, module, listing, groupsModule, scoped, sitemapModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"),
    import("../src/modules/store/listing-load"), import("../src/modules/store/vehicle-model-groups.server"), import("../src/modules/store/listing-categories.server"),
    import("../src/modules/seo/sitemap-models.server")]);
  catalog = module;
  load = listing;
  groups = groupsModule;
  categories = scoped;
  sitemap = sitemapModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("a make × category description states the product count and follows the noindex gate (#1224)", () => inRequest(async () => {
  const { listingMetadata } = await import("../src/app/(store)/katalog/listing-metadata");
  const { listingViewIndexable } = await import("../src/modules/store/manufacturers");
  const fren = (await load.findListing({ category: "fren", make: "vw", search: {} }))!;
  assert.equal(fren.plainTotal, 9);
  const below = listingMetadata(fren);
  assert.ok(String(below.description).includes("9 ürün"), String(below.description));
  assert.ok(String(below.description).includes("araçlar için"));
  assert.equal((below.robots as { index?: boolean }).index, false);
  assert.equal(listingViewIndexable(fren.query, { plainTotal: fren.plainTotal }), below.robots === undefined);
  const enough = listingMetadata({ ...fren, plainTotal: 10 });
  assert.ok(String(enough.description).includes("10 ürün"));
  assert.equal(enough.robots, undefined);
  assert.equal(listingViewIndexable(fren.query, { plainTotal: 10 }), enough.robots === undefined);
}));

test("a search result's title says the query within 65 characters and stays noindex,follow (#1218)", async () => {
  const { listingMetadata } = await import("../src/app/(store)/katalog/listing-metadata");
  for (const q of ["fren", "bosch fren diski ön sol havalandırmalı golf 7 passat b8 tiguan 2.0 tdi"]) {
    const meta = listingMetadata({ query: { q } });
    const title = typeof meta.title === "string" ? meta.title : (meta.title as { absolute: string }).absolute;
    assert.ok(title.startsWith("“") && title.endsWith("” için arama sonuçları"), title);
    assert.ok(title.length + (typeof meta.title === "string" ? " | Getirbakim".length : 0) <= 65, title);
    assert.deepEqual(meta.robots, { index: false, follow: true });
  }
});

test("the root category stays noindex,follow with a self canonical; the plain catalog is indexable (#1222)", async () => {
  const { listingMetadata } = await import("../src/app/(store)/katalog/listing-metadata");
  const root = listingMetadata({ query: { category: "yedek-parca" }, category: { id: 3, parentId: null, name: "Yedek parçalar", slug: "yedek-parca", path: [3], position: 0 } });
  const { listingViewIndexable } = await import("../src/modules/store/manufacturers");
  assert.deepEqual(root.robots, { index: false, follow: true });
  assert.equal(listingViewIndexable({ category: "yedek-parca" }, {}), root.robots === undefined);
  assert.equal(root.alternates?.canonical, "/kategori/yedek-parca");
  const plain = listingMetadata({ query: {} });
  assert.equal(listingViewIndexable({}, {}), plain.robots === undefined);
  assert.equal(plain.robots, undefined);
  assert.equal(plain.alternates?.canonical, "/katalog");
});

test("the make page lists its engine-level fits and the models read from descriptions, each product once (#674)", async () => {
  // g1 is in both sources; g4s's description lists its primary g4; the hidden item stays out. g2, g3, g12 and p1 are
  // only in the model table, which the make page does not read (the make table holds a make's engine-level fits).
  const expected = ["g1", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "p2"].map(key => ids[key]).sort();
  assert.deepEqual(await listed({ make: "vw" }), expected);
  assert.equal(await catalog.listingTotal({ make: "vw" }), expected.length);
  assert.ok(!(await listed({ make: "vw" })).includes(ids.g4s));
});

test("a make × category listing is the intersection of both (#674)", async () => {
  // catalogFilter's two clauses as the category page composes them (its category lookup needs a Next request scope).
  const category = await catalog.categoryProductIds(["fren"], [252]);
  const { rows } = await schema.pool.query<{ id: string }>(`SELECT id::text FROM storefront_catalog_entries catalog
    WHERE catalog.id=ANY(ARRAY(${catalog.makeFitsSql("$1::int")})::uuid[]) AND catalog.id=ANY($2::uuid[]) ORDER BY 1`, [1, category]);
  // With the category fixtures (#673): the engine-level g1, the description-fitted g5-g9 and p2, and g11 by an admin's
  // category; g2/g3 (engine-level model fits outside the make table) and p1 (no make fit) stay out.
  assert.deepEqual(rows.map(row => row.id), ["g1", "g5", "g6", "g7", "g8", "g9", "g11", "p2"].map(key => ids[key]).sort());
});

test("a category with its descendants lists each trusted enrichment link once and keeps the admin's move (#1240)", async () => {
  // c1's donor sits in two of the ids; c2's link points at an old code; c3 matched neither its part nor its OEM;
  // c4 is a trusted link an admin moved to Aydınlatma; c5's link names another brand than the item's. Unfitted, and
  // removed afterwards, so the other tests keep their counts.
  const keys = ["c1", "c2", "c3", "c4", "c5"];
  for (const key of keys) await item(key);
  const items = keys.map(key => ids[key]);
  try {
    for (const [key, code, basis, oem, brand] of [["c1", "TB c1", { type: "exact_part" }, "", "TESTBRAND"], ["c2", "TB c2-old", { type: "exact_part" }, "", "TESTBRAND"],
      ["c3", "TB c3", { type: "oem_reference", supplierOem: "111" }, "222", "TESTBRAND"], ["c4", "TB c4", { type: "exact_part" }, "", "TESTBRAND"],
      ["c5", "TB c5", { type: "exact_part" }, "", "OTHERBRAND"]] as const) {
      await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,match_basis)
        VALUES($1,$2,'TESTBRAND','https://example.test/p','test','TESTBRAND',$2,'{"specifications":[],"oemNumbers":{},"crossReferences":{},"vehicles":[]}',$3)`, [ids[key], code, basis]);
      await schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,imported_at)
        VALUES($1,$2,$4,$1,$3,'complete',now())`, [ids[key], code, oem, brand]);
      await schema.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'trodo',269)", [ids[key]]);
    }
    await schema.pool.query("INSERT INTO product_source_categories(supplier_item_id,source,category_id) VALUES($1,'trodo',252)", [ids.c1]);
    await schema.pool.query(`WITH product AS (INSERT INTO products(brand,part_number,name,brand_label,code) VALUES('TESTBRAND','C4','c4 PARCA','TESTBRAND','TB c4') RETURNING id),
      source AS (INSERT INTO product_sources(supplier_item_id,product_id,method) SELECT $1,id,'manual' FROM product)
      INSERT INTO product_overrides(product_id,category_id) SELECT id,200 FROM product`, [ids.c4]);
    // Yedek parçalar with its descendants, as the root category page asks.
    const listed = await catalog.categoryProductIds([], [3, 252, 269, 241]);
    assert.equal(listed.filter(id => id === ids.c1).length, 1);
    for (const key of ["c2", "c3", "c4", "c5"]) assert.ok(!listed.includes(ids[key]), key);
    // The fixtures' trusted links (g3, g10) and the admin's Fren product (g11) stay in.
    for (const key of ["g3", "g10", "g11"]) assert.ok(listed.includes(ids[key]), key);
    assert.equal(new Set(listed).size, listed.length);
  } finally {
    await schema.pool.query("DELETE FROM products WHERE id IN (SELECT product_id FROM product_sources WHERE supplier_item_id=ANY($1::uuid[]))", [items]);
    await schema.pool.query("DELETE FROM product_source_categories WHERE supplier_item_id=ANY($1::uuid[])", [items]);
    await schema.pool.query("DELETE FROM supplier_items WHERE id=ANY($1::uuid[])", [items]);
    for (const key of keys) delete ids[key];
  }
});

test("a model page skips the make filter and lists the union of engine-level and description fits", async () => {
  const expected = ["g1", "g2", "g3", "g4", "g5", "g6", "g7", "g8", "g9", "g10", "g11", "g12"].map(key => ids[key]).sort();
  assert.deepEqual(await listed({ make: "vw", model: "golf-7" }), expected);
  assert.equal(await catalog.listingTotal({ make: "vw", model: "golf-7" }), 12);
});

test("a description fit on a secondary offer lists the primary product", async () => {
  const golf = await listed({ make: "vw", model: "golf-7" });
  assert.ok(golf.includes(ids.g4));
  assert.ok(!golf.includes(ids.g4s));
});

test("a model name that is not one of the make's units lists nothing", async () => {
  assert.deepEqual(await listed({ make: "vw", model: "golf-9" }), []);
  assert.deepEqual(await listed({ make: "bmw", model: "golf-7" }), []);
});

test("the make page links only units with a listed product", async () => {
  const slugs = (await catalog.getListedModelGroups("1")).map(group => group.slug).sort();
  // tiguan-7 has no fit; passat-b8's fits are a hidden and a missing item.
  assert.deepEqual(slugs, ["golf-7", "polo-6"]);
});

test("a model page without a listed product is a 404", async () => {
  for (const model of ["tiguan-7", "passat-b8"]) assert.equal(await load.findListing({ make: "vw", model, search: {} }), null, model);
  assert.equal(await load.findListing({ make: "vw", model: "no-such-model", search: {} }), null);
});

test("a model page with fewer than 10 products is noindex, with 10 or more it is indexable", async () => {
  const polo = (await load.findListing({ make: "vw", model: "polo-6", search: {} }))!;
  assert.equal(polo.plainTotal, 2);
  assert.equal(listingIndexable(polo.query, polo.plainTotal ?? 0), false);
  const golf = (await load.findListing({ make: "vw", model: "golf-7", search: {} }))!;
  assert.equal(golf.plainTotal, 12);
  assert.equal(listingIndexable(golf.query, golf.plainTotal ?? 0), true);
});

test("each series links to its model page; merged series share it, unknown ids are absent (#674)", async () => {
  const paths = await groups.getModelPagePaths([10, 11, 20, 999]);
  assert.deepEqual([...paths].sort(([a], [b]) => a - b), [[10, "/yedek-parca/vw/golf-7"], [11, "/yedek-parca/vw/golf-7"], [20, "/yedek-parca/vw/polo-6"]]);
  assert.equal((await groups.getModelPagePaths([])).size, 0);
});

test("a series is a motorcycle only when every specified type is a two-wheeler (#674)", async () => {
  assert.deepEqual([...await groups.getMotorcycleModelIds("2")], ["50"]);
  assert.deepEqual([...await groups.getMotorcycleModelIds("1")], []);
});

test("a model page unit's body types and engine codes, most common first (#674)", async () => {
  const facts = await groups.getModelGroupFacts(["10", "11"]);
  assert.deepEqual(facts.bodies, ["Hatchback", "Station wagon"]);
  // CZCA twice, then A→Z; a type without found specs (CJZA) adds nothing.
  assert.deepEqual(facts.engineCodes, ["CZCA", "CLHA", "CMBA", "CRBC"]);
  assert.equal(facts.image, undefined);
  assert.deepEqual(await groups.getModelGroupFacts(["20"]), { bodies: [], engineCodes: [] });
});

test("a price-sorted make listing serves the cached order's pages like the live query; beyond the window it reads live (#674)", async () => {
  // The live price order, as the uncached query sorts it.
  const live = (await schema.pool.query<{ id: string }>(`SELECT id::text FROM storefront_catalog catalog
    WHERE (catalog.source='store' OR catalog.company=ANY($1::text[])) AND catalog.id=ANY(ARRAY(${catalog.makeFitsSql("$2::int")})::uuid[])
    ORDER BY unavailable,price_kurus ASC NULLS LAST,id`, [storefrontCompanies(), 3])).rows.map(row => row.id);
  assert.equal(live.length, pricedProducts);
  const page = async (number: number) => (await catalog.browseProducts({ make: "dacia", sort: "price-asc", page: String(number) })).items.map(row => row.id);
  const [first, second] = [await page(1), await page(2)];
  assert.deepEqual(first, live.slice(0, 24));
  assert.deepEqual(second, live.slice(24, 48));
  assert.ok(first.every(id => !second.includes(id)));
  // Served again from the cached order.
  assert.deepEqual(await page(1), first);
  const last = await catalog.browseProducts({ make: "dacia", sort: "price-asc", page: "26" });
  assert.equal(last.page, 26);
  assert.deepEqual(last.items.map(row => row.id), live.slice(600));
});

test("page 2 of a make listing is its products 25-48 in either order, with the matching range line (#674)", async () => {
  const order = { newest: "unavailable,updated_at DESC,id", "price-asc": "unavailable,price_kurus ASC NULLS LAST,id" } as const;
  for (const [sort, sql] of Object.entries(order)) {
    const live = (await schema.pool.query<{ id: string }>(`SELECT id::text FROM storefront_catalog catalog
      WHERE (catalog.source='store' OR catalog.company=ANY($1::text[])) AND catalog.id=ANY(ARRAY(${catalog.makeFitsSql("$2::int")})::uuid[])
      ORDER BY ${sql}`, [storefrontCompanies(), 3])).rows.map(row => row.id);
    const result = await catalog.browseProducts({ make: "dacia", sort: sort as keyof typeof order, page: "2" });
    assert.deepEqual([result.page, result.pageSize, result.total], [2, 24, pricedProducts], sort);
    assert.deepEqual(result.items.map(row => row.id), live.slice(24, 48), sort);
    assert.equal(listingRangeLabel(result.total, result.page, result.pageSize), "25 – 48 / 620 ürün", sort);
  }
  assert.equal(listingRangeLabel(0, 1, 24), "0 ürün");
});
test("model × category pages: 404 without products, noindex below 10, indexable from 10 (#673)", () => inRequest(async () => {
  const page = (category: string, model: string, search = {}) => load.findListing({ category, make: "vw", model, search });
  const golf = (await page("fren", "golf-7"))!;
  assert.equal(golf.plainTotal, 10);
  assert.equal(golf.category?.slug, "fren");
  assert.equal(listingIndexable(golf.query, golf.plainTotal ?? 0), true);
  const expected = ["g1", "g2", "g3", "g5", "g6", "g7", "g8", "g9", "g10", "g11"].map(key => ids[key]);
  assert.deepEqual((await catalog.browseProducts(golf.query)).items.map(row => row.id).sort(), expected.sort());
  // The child category's product counts for its parents: Yedek parçalar holds every Golf 7 product.
  assert.equal((await page("yedek-parca", "golf-7"))?.plainTotal, 12);
  const disks = (await page("fren-diskleri-269", "golf-7"))!;
  assert.equal(disks.plainTotal, 2);
  assert.equal(listingIndexable(disks.query, disks.plainTotal ?? 0), false);
  const polo = (await page("fren", "polo-6"))!;
  assert.equal(polo.plainTotal, 2);
  assert.equal(listingIndexable(polo.query, polo.plainTotal ?? 0), false);
  // The admin moved g11 out of Filtre: g4 and g12 are left there.
  assert.equal((await page("filtre", "golf-7"))?.plainTotal, 2);
  for (const [category, model] of [["aydinlatma-200", "golf-7"], ["filtre", "polo-6"], ["fren", "tiguan-7"], ["fren", "golf-9"], ["yok-boyle", "golf-7"], ["fren", "Golf-7"]]) {
    assert.equal(await page(category, model), null, `${category}/${model}`);
  }
}));

test("a filtered model × category request is a 404 or not by its unfiltered count (#673)", () => inRequest(async () => {
  const filtered = await load.findListing({ category: "fren", make: "vw", model: "polo-6", search: { brands: '["NOPE"]' } });
  assert.equal(filtered?.plainTotal, 2);
  assert.equal(listingIndexable(filtered!.query, filtered!.plainTotal ?? 0), false);
  assert.equal(await load.findListing({ category: "aydinlatma-200", make: "vw", model: "golf-7", search: { sort: "price-asc" } }), null);
}));

test("make × category pages share the gate: 404 without products, noindex below 10 (#673)", () => inRequest(async () => {
  // The make's engine-level and description fits (#674) in Fren and its child: g1, g5-g10, g11 and p2.
  const fren = (await load.findListing({ category: "fren", make: "vw", search: {} }))!;
  assert.equal(fren.plainTotal, 9);
  assert.equal(listingIndexable(fren.query, fren.plainTotal ?? 0), false);
  assert.equal(await load.findListing({ category: "aydinlatma-200", make: "vw", search: {} }), null);
  // The plain make and category pages are not gated.
  assert.equal((await load.findListing({ make: "vw", search: {} }))?.plainTotal, undefined);
  assert.equal((await load.findListing({ category: "aydinlatma-200", search: {} }))?.plainTotal, undefined);
}));

test("the category counts the make and model pages link equal the category pages' totals (#673)", () => inRequest(async () => {
  const nodes = (await schema.pool.query<{ id: number; slug: string }>("SELECT category_id AS id,slug FROM source_category_labels WHERE source='trodo'")).rows;
  for (const scope of [{ make: "vw", model: "golf-7" }, { make: "vw", model: "polo-6" }, { make: "vw", model: "tiguan-7" }, { make: "vw" }]) {
    const counts = await categories.scopeCategoryCounts(scope);
    for (const node of nodes) {
      assert.equal(counts.get(node.id) ?? 0, await catalog.listingTotal({ ...scope, category: node.slug }), `${JSON.stringify(scope)} ${node.slug}`);
    }
    for (const id of counts.keys()) assert.ok(nodes.some(node => node.id === id), `${id} is a store category`);
  }
  assert.deepEqual([...(await categories.scopeCategoryCounts({ make: "vw", model: "golf-7" })).entries()].sort((a, b) => a[0] - b[0]),
    [[3, 12], [241, 2], [252, 10], [269, 2]]);
  assert.equal((await categories.scopeCategoryCounts({ make: "vw", model: "golf-9" })).size, 0);
  assert.equal((await categories.scopeCategoryCounts({ make: "bmw" })).size, 0);
}));

test("the model sitemaps list exactly the indexable model and model × category pages (#673)", () => inRequest(async () => {
  const units = (await import("../src/modules/store/vehicle-model-groups.server")).getVehicleModelGroups;
  const slugs = (await schema.pool.query<{ slug: string }>("SELECT slug FROM source_category_labels WHERE source='trodo' AND locale='tr'")).rows.map(row => row.slug);
  const models: string[] = [], modelCategories: string[] = [];
  for (const group of await units("1")) {
    const page = await load.findListing({ make: "vw", model: group.slug, search: {} });
    if (page && listingIndexable(page.query, page.plainTotal ?? 0)) models.push(modelPath("vw", group.slug));
    for (const category of slugs) {
      const listing = await load.findListing({ category, make: "vw", model: group.slug, search: {} });
      if (listing && listingIndexable(listing.query, listing.plainTotal ?? 0)) modelCategories.push(listingPath({ makeSlug: "vw", modelSlug: group.slug, categorySlug: category }));
    }
  }
  assert.deepEqual(models, ["/yedek-parca/vw/golf-7"]);
  // The root "Yedek parçalar" × Golf 7 has 12 products but repeats the model page: it answers, noindex, and is not listed.
  assert.deepEqual(modelCategories.sort(), ["/kategori/fren/vw/golf-7"]);
  const root = (await load.findListing({ category: "yedek-parca", make: "vw", model: "golf-7", search: {} }))!;
  assert.equal(root.plainTotal, 12);
  assert.equal(listingIndexable(root.query, root.plainTotal ?? 0), false);
  assert.deepEqual((await sitemap.loadModelPaths()).sort(), models.sort());
  assert.deepEqual((await sitemap.loadModelCategoryPaths()).sort(), modelCategories);
}));

test("the make × category sitemap lists exactly the indexable make × category pages (#1224)", () => inRequest(async () => {
  const slugs = (await schema.pool.query<{ slug: string }>("SELECT slug FROM source_category_labels WHERE source='trodo' AND locale='tr'")).rows.map(row => row.slug);
  const pages = async (minimum?: number) => {
    const { text, values, units } = await sitemap.makeCategoryPathsQuery(minimum);
    const { rows } = await schema.pool.query<{ unit: number; slug: string }>(text, values);
    return rows.map(row => listingPath({ makeSlug: units[row.unit], categorySlug: row.slug })).filter(path => path.endsWith("/vw")).sort();
  };
  const expected: string[] = [], indexable: string[] = [];
  for (const category of slugs) {
    const listing = await load.findListing({ category, make: "vw", search: {} });
    if (!listing || category === "yedek-parca") continue;
    expected.push(listingPath({ makeSlug: "vw", categorySlug: category }));
    if (listingIndexable(listing.query, listing.plainTotal ?? 0)) indexable.push(listingPath({ makeSlug: "vw", categorySlug: category }));
  }
  assert.ok(expected.length > 0);
  assert.deepEqual(await pages(1), expected.sort());
  assert.deepEqual(await pages(), indexable.sort());
  assert.ok(!(await pages(1)).includes("/kategori/yedek-parca/vw"));
  // vw × fren has 9 products: the boundary sits between 9 and 10.
  assert.ok((await pages(9)).includes("/kategori/fren/vw"));
  assert.ok(!(await pages(10)).includes("/kategori/fren/vw"));
}));

test("loadAllVehicleModelGroups returns the same units as the per-make read (#778)", async () => {
  const all = await groups.loadAllVehicleModelGroups();
  const brands = (await schema.pool.query<{ id: string }>("SELECT id::text FROM vehicle_brands ORDER BY id")).rows.map(row => row.id);
  assert.ok(brands.length >= 3);
  for (const brandId of brands) assert.deepEqual(all.get(brandId) ?? [], await groups.getVehicleModelGroups(brandId));
});

test("hidden description models and a vehicle decision (#661, #583) leave the make, model and category pages and the model sitemaps", () => inRequest(async () => {
  const { invalidateListings } = await import("../src/modules/store/listing-epoch");
  // The test codes are too short for the automatic grouping: products made by hand, as an admin's split does.
  const product = async (part: string, keys: string[]) => (await schema.pool.query<{ id: string }>(`WITH product AS (
      INSERT INTO products(brand,part_number,name,brand_label,code) VALUES('TESTBRAND',$2,$2,'TESTBRAND',$2) RETURNING id),
    source AS (INSERT INTO product_sources(supplier_item_id,product_id,method) SELECT unnest($1::uuid[]),id,'manual' FROM product)
    SELECT id::text FROM product`, [keys.map(key => ids[key]), part])).rows[0].id;
  const hideModel = (productId: string, modelId: number) => schema.pool.query(`INSERT INTO product_override_fitment_hides(product_id,kind,model_id,label)
    VALUES($1,'description_model',$2,'test')`, [productId, modelId]);
  // A Tiguan description fit on g7 links the unit; hiding it unlinks it again.
  await fit("product_model_fitments", 30, "g7");
  const g7 = await product("G7", ["g7"]);
  await invalidateListings();
  assert.deepEqual((await catalog.getListedModelGroups("1")).map(group => group.slug).sort(), ["golf-7", "polo-6", "tiguan-7"]);
  await hideModel(g7, 30);
  // g5's Golf description hidden; g4 listed only through its secondary offer g4s's description, hidden on the product
  // they share; g6 has a vehicle decision, so none of its description models count.
  await hideModel(await product("G5", ["g5"]), 10);
  await hideModel(await product("G4", ["g4", "g4s"]), 11);
  await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,100,'remove')", [await product("G6", ["g6"])]);
  await mirrorDescriptionMakes();
  await invalidateListings();
  assert.deepEqual((await catalog.getListedModelGroups("1")).map(group => group.slug).sort(), ["golf-7", "polo-6"]);
  assert.deepEqual(await listed({ make: "vw" }), ["g1", "g7", "g8", "g9", "g10", "g11", "p2"].map(key => ids[key]).sort());
  const golf = ["g1", "g2", "g3", "g7", "g8", "g9", "g10", "g11", "g12"].map(key => ids[key]).sort();
  assert.deepEqual(await listed({ make: "vw", model: "golf-7" }), golf);
  // Nine products: the model page and Fren × Golf 7 (eight) fall below the indexing minimum, so do their sitemap entries.
  const page = (await load.findListing({ make: "vw", model: "golf-7", search: {} }))!;
  assert.equal(page.plainTotal, 9);
  assert.equal(listingIndexable(page.query, page.plainTotal ?? 0), false);
  assert.equal((await load.findListing({ category: "fren", make: "vw", model: "golf-7", search: {} }))?.plainTotal, 8);
  assert.deepEqual(await sitemap.loadModelPaths(), []);
  assert.deepEqual(await sitemap.loadModelCategoryPaths(), []);
  const nodes = (await schema.pool.query<{ id: number; slug: string }>("SELECT category_id AS id,slug FROM source_category_labels WHERE source='trodo'")).rows;
  for (const scope of [{ make: "vw", model: "golf-7" }, { make: "vw", model: "tiguan-7" }, { make: "vw" }]) {
    const counts = await categories.scopeCategoryCounts(scope);
    for (const node of nodes) assert.equal(counts.get(node.id) ?? 0, await catalog.listingTotal({ ...scope, category: node.slug }), `${JSON.stringify(scope)} ${node.slug}`);
  }
  assert.deepEqual([...(await categories.scopeCategoryCounts({ make: "vw", model: "golf-7" })).entries()].sort((a, b) => a[0] - b[0]),
    [[3, 9], [241, 1], [252, 8], [269, 2]]);
}));
