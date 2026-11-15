import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The add-to-cart dialog's related parts (#704) in an isolated copy of the schema: the category rules, the vehicle fit,
// and what is never suggested (the product's equivalents, cart items, parts fitted to another vehicle, oil barrels, a second
// fluid of a kind, transmission oil after engine oil); engine oil ranked by the vehicle's oil specification (#715).
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let related: typeof import("../src/modules/store/related-suggestions");
let purchase: typeof import("../src/modules/store/purchase-preview");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();

let nextCode = 10010;
async function item(key: string, name: string, net = 100) {
  const product = { uk: "TESTBRAND", ac: name, dc: "TL" };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,$4,$5,1,1,1,'present',now(),now(),now()) RETURNING id::text`, [basbug, `TB ${nextCode++}`, product, { nf: net }, { stok: 5 }]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ id: string }>("SELECT product_id::text AS id FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].id;
const name = (id: string) => Object.entries(ids).find(([, value]) => value === id)?.[0];
const suggested = async (key: string, context: Parameters<typeof related.relatedSuggestions>[1] = {}, limit?: number) =>
  (await related.relatedSuggestions(ids[key], context, limit)).map(product => name(product.id));
const equivalent = async (a: string, b: string) => schema.pool.query(`INSERT INTO product_equivalents(product_id,equivalent_id,kind,brand,part_number)
  VALUES($1,$2,'manual','TESTBRAND','X'),($2,$1,'manual','TESTBRAND','X')`, [await productOf(a), await productOf(b)]);
const fluids = ["fluid", "fluid2", "fluidTwin"];
// Engine oils in packs a shopper carries home; the barrel and (behind them) the 1 L bottle are not suggested first.
const cans = ["can", "canOther", "namedOil"];
const golf = { make: "Volkswagen", model: "Golf", year: 2016, vehicleId: "1" };

before(async () => {
  schema = await isolatedSchema("related_query_test");
  const items: [string, string, number][] = [
    ["disc", "FREN DISKI ON", 269], ["pad", "FREN BALATASI ON", 268], ["pad2", "FREN BALATASI ON 2", 268], ["cartPad", "FREN BALATASI ARKA", 268],
    ["equivalentPad", "FREN BALATASI MUADIL", 268], ["otherCarPad", "FREN BALATASI BASKA ARAC", 268],
    ["fluid", "FREN HIDROLIGI DOT4", 960], ["fluid2", "FREN HIDROLIGI DOT5", 960], ["fluidTwin", "FREN HIDROLIGI DOT4 MUADIL", 960],
    ["drumFit", "FREN KAMPANASI", 274], ["drumUnknown", "FREN KAMPANASI UYUMSUZ", 274],
    ["oilFilter", "YAG FILTRESI", 242], ["barrel", "MOTOR YAGI 5W30 208 LT", 957], ["can", "MOTOR YAGI 5W30 4 LT", 957],
    ["canOther", "MOTOR YAGI 10W40 4 LT", 957], ["bottle", "MOTOR YAGI 5W30 1 LT", 957], ["gearOil", "SANZIMAN YAGI 75W90 1 LT", 958],
    ["typedFilter", "YAG FILTRESI GOLF", 242],
  ];
  for (const [key, label] of items) await item(key, label);
  // The pad's cheaper second supplier: a secondary offer, the price the pad's suggestion shows.
  await item("padOffer", "FREN BALATASI ON IKINCI", 50);
  // No category at all.
  await item("lone", "TAKIM CANTASI");
  // An engine oil recognised by its name only (listed under engine oil by name, no category of its own).
  await item("namedOil", "MOTOR YAGI 5W30 5 LT");
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("INSERT INTO product_offers(item_id,primary_id) VALUES($1,$1),($2,$1) ON CONFLICT (item_id) DO UPDATE SET primary_id=EXCLUDED.primary_id", [ids.pad, ids.padOffer]);
  for (const id of [252, 241, 956]) await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
    VALUES('trodo',$1,NULL,$2,$2,$3,'https://www.trodo.com/x','{}')`, [id, `root-${id}`, [id]]);
  for (const [, , category] of items) {
    const root = category === 242 ? 241 : category >= 956 ? 956 : 252;
    await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
      VALUES('trodo',$1,$2,$3,$3,$4,'https://www.trodo.com/x','{}') ON CONFLICT DO NOTHING`, [category, root, `c-${category}`, [root, category]]);
  }
  for (const [key, , category] of items) await schema.pool.query("INSERT INTO product_overrides(product_id,category_id) VALUES($1,$2)", [await productOf(key), category]);
  await equivalent("disc", "equivalentPad");
  await equivalent("fluid", "fluidTwin");
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF VII (5G1)','2012-08-01',NULL),(20,1,'POLO VI (AW1)','2017-06-01',NULL);
    INSERT INTO vehicle_types(id,model_id,name,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text) VALUES(1,10,'1.6 TDI','D','Dizel',110,81,'2012-08-01','golf');
    INSERT INTO vehicle_type_oil_specs(vehicle_type_id,viscosities,capacity_min_l,capacity_max_l) VALUES(1,'{10W-40}',4.0,4.0)`);
  // The typed filter's enrichment fits vehicle type 1: its oil ranking reads the type's recommendation without a garage vehicle.
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status)
    SELECT id,code,product_data->>'uk','complete' FROM supplier_items WHERE id=$1`, [ids.typedFilter]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
    SELECT id,code,product_data->>'uk','https://www.trodo.com/x','test','TESTBRAND','X',$2 FROM supplier_items WHERE id=$1`,
  [ids.typedFilter, JSON.stringify({ vehicles: [{ model: "GOLF" }], specifications: [], oemNumbers: {} })]);
  await schema.pool.query(`INSERT INTO product_vehicle_fitments(supplier_item_id,source_index,source_vehicle,vehicle_type_id,match_status,matcher_version)
    VALUES($1,0,'{"model":"GOLF"}',1,'matched','t')`, [ids.typedFilter]);
  await schema.pool.query("SELECT product_enrichment_shared_sync()");
  for (const [model, key] of [[10, "disc"], [10, "pad"], [10, "pad2"], [10, "equivalentPad"], [20, "otherCarPad"], [10, "drumFit"]] as const)
    await schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES($1,$2)", [model, ids[key]]);
  const [{ db }, module, preview] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/related-suggestions"),
    import("../src/modules/store/purchase-preview")]);
  related = module;
  purchase = preview;
  closeDb = () => db.end();
});
// Lookups a preview left running in the background: awaited before the pool closes.
const lookups: Promise<unknown>[] = [];
const options = (budgetMs: number) => ({ budgetMs, onLookup: (lookup: Promise<unknown>) => { lookups.push(lookup); } });
// Content assertions must not depend on the runner's speed (the 250 ms budget is for the live dialog).
const unhurried = options(60_000);
after(async () => { await Promise.allSettled(lookups); await closeDb?.(); await schema?.drop(); });

test("an unknown product or one without complements gets no related parts", async () => {
  assert.deepEqual(await related.relatedSuggestions(randomUUID(), {}), []);
  assert.deepEqual(await related.relatedSuggestions(randomUUID(), { vehicle: { make: "Volkswagen", model: "Golf", year: 2016, vehicleId: "1" }, cartIds: [randomUUID()] }), []);
  assert.deepEqual(await suggested("oilFilter", { cartIds: [ids.can] }), [], "no complement left, no fluid under filters");
});

test("a brake disc suggests fitting pads and one brake fluid, never an equivalent, a part of unknown fit or another car's", async () => {
  const shown = await suggested("disc", {}, 5);
  // One per category first, then a second fitting pad (never a second brake fluid), then a fitting part of Fren sistemi.
  assert.equal(shown.length, 4, shown.join());
  assert.equal(shown[0]?.startsWith("pad"), true, shown.join());
  assert.ok(fluids.includes(shown[1]!), shown.join());
  assert.deepEqual(new Set([shown[0], shown[2]]), new Set(["pad", "pad2"]));
  assert.equal(shown[3], "drumFit");
  assert.deepEqual(await suggested("disc", {}, 5), shown, "the same product gets the same suggestions");
});

test("the cart's parts and their categories are not suggested again, also through a secondary offer", async () => {
  const pads = (shown: (string | undefined)[]) => shown.filter(key => key?.toLowerCase().includes("pad"));
  assert.deepEqual(pads(await suggested("disc", { cartIds: [ids.cartPad] })), [], "a pad in the cart covers the pad category");
  assert.deepEqual(pads(await suggested("disc", { cartIds: [ids.padOffer] })), [], "the pad's secondary offer is the pad");
});

test("a short list is filled from the top-level category with fitting parts only, never with unrelated products", async () => {
  // Pads covered by the cart: one brake fluid, then the fitting drum of Fren sistemi; the drum of unknown fit never.
  const shown = await suggested("disc", { cartIds: [ids.padOffer] });
  assert.equal(shown.length, 2, shown.join());
  assert.ok(fluids.includes(shown[0]!), shown.join());
  assert.equal(shown[1], "drumFit");
  // Without a vehicle (the drum has no fitment of its own) no vehicle-specific part is suggested.
  assert.deepEqual(await suggested("drumUnknown"), []);
  // A fluid's filler is other fluids of its top-level category, one of each: engine oil in a can (not a barrel), gear oil.
  const forFluid = await suggested("fluid");
  assert.equal(forFluid.length, 2, forFluid.join());
  assert.ok(cans.includes(forFluid[0]!), forFluid.join());
  assert.equal(forFluid[1], "gearOil");
});

test("an oil filter gets one engine oil in a can, the garage vehicle's grade when it has oil data", async () => {
  const shown = await suggested("oilFilter");
  assert.equal(shown.length, 1, shown.join());
  assert.ok(cans.includes(shown[0]!), shown.join());
  assert.deepEqual(await suggested("oilFilter"), shown, "the same filter gets the same oil");
  // Golf (type 1) takes 10W-40: only that oil, never a 5W-30.
  assert.deepEqual(await suggested("oilFilter", { vehicle: golf }), ["canOther"]);
  // Without a garage vehicle, the vehicle types the filter fits decide (type 1 through its enrichment).
  assert.deepEqual(await suggested("typedFilter"), ["canOther"]);
  // An oil in the cart, also one recognised by its name only, covers engine oil.
  assert.deepEqual(await suggested("oilFilter", { cartIds: [ids.namedOil] }), []);
});

test("engine oil gets one fluid of each kind and no transmission oil; with a vehicle its fitting filter", async () => {
  const forOil = await suggested("can");
  assert.equal(forOil.length, 1, forOil.join());
  assert.ok(fluids.includes(forOil[0]!), forOil.join());
  const withCar = await suggested("can", { vehicle: golf });
  assert.deepEqual(new Set(withCar), new Set(["typedFilter", forOil[0]]), withCar.join());
  assert.ok(!withCar.includes("gearOil"));
});

test("the dialog's suggestion adds the best offer it shows, and nothing unrelated fills the dialog", async () => {
  const preview = await purchase.purchasePreview(ids.disc, 1, 0, {}, unhurried);
  assert.ok(preview, "disc preview");
  assert.equal(preview.suggestionsPending, false);
  const shown = preview.suggestions.map(suggestion => name(suggestion.id));
  assert.ok(shown.includes("padOffer"), shown.join());
  assert.ok(!shown.includes("pad"), shown.join());
  // A product without a category gets no suggestions: no newest-products filler (the dialog shows one column).
  const lone = await purchase.purchasePreview(ids.lone, 1, 0, {}, unhurried);
  assert.ok(lone);
  assert.deepEqual(lone.suggestions, []);
  // The dialog's follow-up request (no time budget) answers alike.
  const follow = (await purchase.suggestionPreviews(ids.disc, 0, { cartIds: [ids.padOffer] })).map(suggestion => name(suggestion.id));
  assert.equal(follow[1], "drumFit", follow.join());
});

test("a slow lookup gives way to the budget and is reported as pending", async () => {
  assert.equal(await purchase.withinBudget(new Promise<string[]>(() => undefined), 20), null);
  // A lookup over the budget: the dialog opens with the added product and loads the suggestions itself.
  const pending = await purchase.purchasePreview(ids.disc, 1, 0, {}, options(0));
  assert.ok(pending);
  assert.equal(pending.suggestionsPending, true);
  assert.deepEqual(pending.suggestions, []);
  assert.equal(name(pending.added.id), "disc");
  assert.deepEqual(await purchase.withinBudget(Promise.resolve([] as string[]), 1000), []);
  assert.deepEqual(await purchase.withinBudget(Promise.resolve(["a"]), 1000), ["a"]);
});
