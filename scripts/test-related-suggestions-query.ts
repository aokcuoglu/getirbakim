import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The add-to-cart dialog's related parts (#704) in an isolated copy of the schema: the category rules, the vehicle fit,
// and what is never suggested (the product's equivalents, cart items, parts fitted to another vehicle, oil barrels).
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

before(async () => {
  schema = await isolatedSchema("related_query_test");
  const items: [string, string, number][] = [
    ["disc", "FREN DISKI ON", 269], ["pad", "FREN BALATASI ON", 268], ["pad2", "FREN BALATASI ON 2", 268], ["cartPad", "FREN BALATASI ARKA", 268],
    ["equivalentPad", "FREN BALATASI MUADIL", 268], ["otherCarPad", "FREN BALATASI BASKA ARAC", 268],
    ["fluid", "FREN HIDROLIGI DOT4", 960], ["fluid2", "FREN HIDROLIGI DOT5", 960], ["fluidTwin", "FREN HIDROLIGI DOT4 MUADIL", 960],
    ["oilFilter", "YAG FILTRESI", 242], ["barrel", "MOTOR YAGI 5W30 208 LT", 957], ["can", "MOTOR YAGI 5W30 4 LT", 957],
  ];
  for (const [key, label] of items) await item(key, label);
  // The pad's cheaper second supplier: a secondary offer, the price the pad's suggestion shows.
  await item("padOffer", "FREN BALATASI ON IKINCI", 50);
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
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF VII (5G1)','2012-08-01',NULL),(20,1,'POLO VI (AW1)','2017-06-01',NULL)`);
  for (const [model, key] of [[10, "disc"], [10, "pad"], [10, "pad2"], [10, "equivalentPad"], [20, "otherCarPad"]] as const)
    await schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES($1,$2)", [model, ids[key]]);
  const [{ db }, module, preview] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/related-suggestions"),
    import("../src/modules/store/purchase-preview")]);
  related = module;
  purchase = preview;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("an unknown product or one without complements gets no related parts", async () => {
  assert.deepEqual(await related.relatedSuggestions(randomUUID(), {}), []);
  assert.deepEqual(await related.relatedSuggestions(randomUUID(), { vehicle: { make: "Volkswagen", model: "Golf", year: 2016, vehicleId: "1" }, cartIds: [randomUUID()] }), []);
  assert.deepEqual(await suggested("fluid"), []);
});

test("a brake disc suggests fitting pads and brake fluid, never an equivalent, a part of unknown fit or another car's", async () => {
  const shown = await suggested("disc", {}, 5);
  assert.equal(shown.length, 4, shown.join());
  // One per category first, then a second fitting part of each.
  assert.equal(shown[0]?.startsWith("pad"), true, shown.join());
  assert.ok(fluids.includes(shown[1]!), shown.join());
  assert.deepEqual(new Set([shown[0], shown[2]]), new Set(["pad", "pad2"]));
  assert.ok(fluids.includes(shown[3]!), shown.join());
  // The second fluid is never the first one's equivalent.
  assert.ok(!(shown.includes("fluid") && shown.includes("fluidTwin")), shown.join());
});

test("the cart's parts and their categories are not suggested again, also through a secondary offer", async () => {
  const pads = (shown: (string | undefined)[]) => shown.filter(key => key?.toLowerCase().includes("pad"));
  assert.deepEqual(pads(await suggested("disc", { cartIds: [ids.cartPad] })), [], "a pad in the cart covers the pad category");
  assert.deepEqual(pads(await suggested("disc", { cartIds: [ids.padOffer] })), [], "the pad's secondary offer is the pad");
  const fluidsOnly = await suggested("disc", { cartIds: [ids.padOffer] });
  assert.equal(fluidsOnly.length, 2, fluidsOnly.join());
});

test("engine oil comes in a can with an oil filter; without a vehicle oil gets no vehicle-specific parts", async () => {
  assert.deepEqual(await suggested("oilFilter"), ["can"]);
  assert.deepEqual(await suggested("can"), []);
  assert.deepEqual(await suggested("can", { vehicle: { make: "Volkswagen", model: "Golf", year: 2016, vehicleId: "1" } }), []);
});

test("the dialog's suggestion adds the best offer it shows", async () => {
  const preview = await purchase.purchasePreview(ids.disc, 1, 0);
  assert.ok(preview, "disc preview");
  const shown = preview.suggestions.map(suggestion => name(suggestion.id));
  assert.ok(shown.includes("padOffer"), shown.join());
  assert.ok(!shown.includes("pad"), shown.join());
});

test("a slow lookup gives way to the budget", async () => {
  assert.deepEqual(await purchase.withinBudget(new Promise<string[]>(() => undefined), 20), []);
  assert.deepEqual(await purchase.withinBudget(Promise.resolve(["a"]), 1000), ["a"]);
});
