import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The engine-oil filter reads the admin's specification decisions (#603) like the product page does (#623), in an
// isolated copy of the schema.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let oils: typeof import("../src/modules/store/vehicle-oil.server");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [, , dinamik] = storefrontCompanies();
const vehicle = "9001";
const viscosity = new Set(["viscosity"] as const);

async function oil(key: string, code: string, name: string, specifications: [string, string][]) {
  const product = { uk: "TESTOIL", ac: name, ac2: "", dc: "TL", marka: "TESTOIL", stokAdi: name };
  ids[key] = (await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('dinamik',$1,'G','ALL',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [dinamik, code, product])).rows[0].id;
  pending.push(() => enrich(key, code, specifications));
}
const pending: (() => Promise<void>)[] = [];
async function enrich(key: string, code: string, specifications: [string, string][]) {
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status) VALUES($1,$2,'TESTOIL','complete')`, [ids[key], code]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
    VALUES($1,$2,'TESTOIL','https://www.trodo.com/x','test','TESTOIL',$3,$4)`, [ids[key], code, code.replace("TESTOIL ", ""), JSON.stringify({ specifications, vehicles: [], oemNumbers: {}, crossReferences: {} })]);
}
const override = async (key: string, action: "set" | "hide", specKey: string, value: string | null) => {
  const product = (await schema.pool.query<{ product_id: string }>("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [ids[key]])).rows[0].product_id;
  await schema.pool.query("INSERT INTO product_override_specs(product_id,action,key,value) VALUES($1,$2,$3,$4)", [product, action, specKey, value]);
};
const matching = async () => (await oils.vehicleOilProductIds(vehicle, viscosity)).sort();
/** The oil list is cached for 10 minutes: move the clock past it and let the background refresh finish. */
async function refreshed() {
  mock.timers.tick(11 * 60 * 1000);
  await matching();
  await new Promise(resolve => setTimeout(resolve, 500));
}

before(async () => {
  schema = await isolatedSchema("vehicle_oil_overrides_test");
  await schema.pool.query("INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'TEST','Test')");
  await schema.pool.query("INSERT INTO vehicle_models(id,brand_id,name) VALUES(1,1,'MODEL')");
  await schema.pool.query(`INSERT INTO vehicle_types(id,model_id,name,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
    VALUES($1,1,'1.6','petrol','Benzin',100,74,'2010-01-01','test model 1.6')`, [vehicle]);
  await schema.pool.query(`INSERT INTO vehicle_type_oil_specs(vehicle_type_id,viscosities,acea,api,approvals,capacity_min_l,capacity_max_l) VALUES($1,'{5W-30}','{}','{}','{}',4,4)`, [vehicle]);
  // The names state no grade: only the enrichment (or the admin) does. "MOTOR YAĞI" makes them candidates.
  await oil("stated", "TESTOIL 10001", "TESTOIL MOTOR YAGI 1L", [["SAE viscosity class", "5W-30"]]);
  await oil("other", "TESTOIL 10002", "TESTOIL MOTOR YAGI 2L", [["SAE viscosity class", "10W-40"]]);
  await oil("bare", "TESTOIL 10003", "TESTOIL MOTOR YAGI 3L", [["Colour", "Gold"]]);
  await schema.pool.query("SELECT refresh_product_matches()");
  for (const run of pending) await run();
  await schema.pool.query("SELECT product_enrichment_shared_refresh()");
  const [{ db }, oilModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/vehicle-oil.server")]);
  oils = oilModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

test("an enrichment spec matches until an override edits, hides or adds the grade", async () => {
  mock.timers.enable({ apis: ["Date"] });
  assert.deepEqual(await matching(), [ids.stated].sort());
  await override("stated", "hide", "SAE viscosity class", null);
  await override("other", "set", "SAE viscosity class", "5W-30");
  await override("bare", "set", "Viscosity", "SAE 5W30");
  await refreshed();
  // The hidden grade no longer matches; an edited one and an added one do.
  assert.deepEqual(await matching(), [ids.other, ids.bare].sort());
  // An override of a key the oil filter does not read changes nothing.
  await override("stated", "set", "Colour", "5W-30");
  await refreshed();
  assert.deepEqual(await matching(), [ids.other, ids.bare].sort());
  mock.timers.reset();
});
