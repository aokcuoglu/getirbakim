import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The add-to-cart dialog's related parts (#704) in an isolated copy of the schema: the category rules, the vehicle fit,
// and what is never suggested (the product's equivalents, cart items, parts fitted to another vehicle, oil barrels).
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let related: typeof import("../src/modules/store/related-suggestions");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();

let nextCode = 10010;
async function item(key: string, name: string) {
  const product = { uk: "TESTBRAND", ac: name, dc: "TL" };
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,$4,$5,1,1,1,'present',now(),now(),now()) RETURNING id::text`, [basbug, `TB ${nextCode++}`, product, { nf: 100 }, { stok: 5 }]);
  ids[key] = rows[0].id;
}
const productOf = async (key: string) => (await schema.pool.query<{ id: string }>("SELECT product_id::text AS id FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].id;
const suggested = async (key: string, context: Parameters<typeof related.relatedSuggestions>[1] = {}) =>
  (await related.relatedSuggestions(ids[key], context)).map(product => Object.entries(ids).find(([, id]) => id === product.id)?.[0]);

before(async () => {
  schema = await isolatedSchema("related_query_test");
  const items: [string, string, number][] = [
    ["disc", "FREN DISKI ON", 269], ["pad", "FREN BALATASI ON", 268], ["cartPad", "FREN BALATASI ARKA", 268],
    ["equivalentPad", "FREN BALATASI MUADIL", 268], ["otherCarPad", "FREN BALATASI BASKA ARAC", 268], ["fluid", "FREN HIDROLIGI DOT4", 960],
    ["oilFilter", "YAG FILTRESI", 242], ["barrel", "MOTOR YAGI 5W30 208 LT", 957], ["can", "MOTOR YAGI 5W30 4 LT", 957],
  ];
  for (const [key, name] of items) await item(key, name);
  await schema.pool.query("SELECT refresh_product_matches()");
  for (const id of [252, 241, 956]) await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
    VALUES('trodo',$1,NULL,$2,$2,$3,'https://www.trodo.com/x','{}')`, [id, `root-${id}`, [id]]);
  for (const [, , category] of items) {
    const root = category === 242 ? 241 : category >= 956 ? 956 : 252;
    await schema.pool.query(`INSERT INTO source_categories(source,category_id,parent_id,name,slug,path_ids,source_url,raw)
      VALUES('trodo',$1,$2,$3,$3,$4,'https://www.trodo.com/x','{}') ON CONFLICT DO NOTHING`, [category, root, `c-${category}`, [root, category]]);
  }
  for (const [key, , category] of items) await schema.pool.query("INSERT INTO product_overrides(product_id,category_id) VALUES($1,$2)", [await productOf(key), category]);
  await schema.pool.query(`INSERT INTO product_equivalents(product_id,equivalent_id,kind,brand,part_number) VALUES($1,$2,'manual','TESTBRAND','X'),($2,$1,'manual','TESTBRAND','X')`,
    [await productOf("disc"), await productOf("equivalentPad")]);
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VW');
    INSERT INTO vehicle_models(id,brand_id,name,date_from,date_to) VALUES(10,1,'GOLF VII (5G1)','2012-08-01',NULL),(20,1,'POLO VI (AW1)','2017-06-01',NULL)`);
  for (const [model, key] of [[10, "disc"], [10, "pad"], [20, "otherCarPad"]] as const)
    await schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES($1,$2)", [model, ids[key]]);
  const [{ db }, module] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/related-suggestions")]);
  related = module;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("an unknown product or one without complements gets no related parts", async () => {
  assert.deepEqual(await related.relatedSuggestions(randomUUID(), {}), []);
  assert.deepEqual(await related.relatedSuggestions(randomUUID(), { vehicle: { make: "Volkswagen", model: "Golf", year: 2016, vehicleId: "1" }, cartIds: [randomUUID()] }), []);
  assert.deepEqual(await suggested("fluid"), []);
});

test("a brake disc suggests a fitting pad and brake fluid, never its equivalent, a cart item or another car's pad", async () => {
  assert.deepEqual(await suggested("disc", { cartIds: [ids.cartPad] }), ["pad", "fluid"]);
  // Without a cart the fitting pad still comes first; the pad without fitment data stays a candidate.
  assert.deepEqual(await suggested("disc"), ["pad", "fluid"]);
  assert.deepEqual(await suggested("disc", { cartIds: [ids.pad] }), ["cartPad", "fluid"]);
  // Left: the equivalent and the pad fitted only to another car, neither of which is suggested.
  assert.deepEqual(await suggested("disc", { cartIds: [ids.pad, ids.cartPad] }), ["fluid"]);
});

test("an oil filter suggests engine oil in a can, not a barrel", async () => {
  assert.deepEqual(await suggested("oilFilter"), ["can"]);
});
