import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { listingIndexable } from "../src/modules/seo/indexing";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// Vehicle model page listings (#639) in an isolated copy of the schema: catalogFilter's model branch, the union of
// engine-level and description fits, and the 404 / noindex rules of findListing (listing-load.ts; the route's loadListing turns null into notFound and listingMetadata the total into robots). Nothing is written to the shared
// database's tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let load: typeof import("../src/modules/store/listing-load");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();

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
  const [{ db }, module, listing] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog"), import("../src/modules/store/listing-load")]);
  catalog = module;
  load = listing;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("the make page lists the make's engine-level fits", async () => {
  assert.deepEqual(await listed({ make: "vw" }), [ids.g1]);
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
