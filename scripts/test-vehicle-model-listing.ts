import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { listingIndexable } from "../src/modules/seo/indexing";
import { listingRangeLabel } from "../src/modules/store/catalog-filters";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// Vehicle model and make page listings (#639, #674) in an isolated copy of the schema: catalogFilter's model and make branches, the union of
// engine-level and description fits, and the 404 / noindex rules of findListing (listing-load.ts; the route's loadListing turns null into notFound and listingMetadata the total into robots). Nothing is written to the shared
// database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let load: typeof import("../src/modules/store/listing-load");
let groups: typeof import("../src/modules/store/vehicle-model-groups.server");
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
  // Price-sorted listings (#674): a make with more products than the cached window (20 pages of 30) and varied prices.
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
  const [{ db }, module, listing, groupsModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"),
    import("../src/modules/store/listing-load"), import("../src/modules/store/vehicle-model-groups.server")]);
  catalog = module;
  load = listing;
  groups = groupsModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

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
  assert.deepEqual(rows.map(row => row.id), [ids.g1, ids.g5].sort());
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
  assert.equal(polo.modelTotal, 2);
  assert.equal(listingIndexable(polo.query, polo.modelTotal ?? 0), false);
  const golf = (await load.findListing({ make: "vw", model: "golf-7", search: {} }))!;
  assert.equal(golf.modelTotal, 12);
  assert.equal(listingIndexable(golf.query, golf.modelTotal ?? 0), true);
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
  assert.deepEqual(first, live.slice(0, 30));
  assert.deepEqual(second, live.slice(30, 60));
  assert.ok(first.every(id => !second.includes(id)));
  // Served again from the cached order.
  assert.deepEqual(await page(1), first);
  const last = await catalog.browseProducts({ make: "dacia", sort: "price-asc", page: "21" });
  assert.equal(last.page, 21);
  assert.deepEqual(last.items.map(row => row.id), live.slice(600));
});

test("page 2 of a make listing is its products 31-60 in either order, with the matching range line (#674)", async () => {
  const order = { newest: "unavailable,updated_at DESC,id", "price-asc": "unavailable,price_kurus ASC NULLS LAST,id" } as const;
  for (const [sort, sql] of Object.entries(order)) {
    const live = (await schema.pool.query<{ id: string }>(`SELECT id::text FROM storefront_catalog catalog
      WHERE (catalog.source='store' OR catalog.company=ANY($1::text[])) AND catalog.id=ANY(ARRAY(${catalog.makeFitsSql("$2::int")})::uuid[])
      ORDER BY ${sql}`, [storefrontCompanies(), 3])).rows.map(row => row.id);
    const result = await catalog.browseProducts({ make: "dacia", sort: sort as keyof typeof order, page: "2" });
    assert.deepEqual([result.page, result.pageSize, result.total], [2, 30, pricedProducts], sort);
    assert.deepEqual(result.items.map(row => row.id), live.slice(30, 60), sort);
    assert.equal(listingRangeLabel(result.total, result.page, result.pageSize), "31 – 60 / 620 ürün", sort);
  }
  assert.equal(listingRangeLabel(0, 1, 30), "0 ürün");
});
