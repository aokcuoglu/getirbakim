import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The partner product search (#1093) in an isolated copy of the schema: limit past one storefront page, the vehicle's
// fits first (engine type, then model), nothing dropped, and the short answer cache. Nothing is written to the shared
// database's tables. The ordering and filter rules themselves are unit-tested in scripts/test-partner.ts.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let partner: typeof import("../src/modules/partner/catalog");
let catalog: typeof import("../src/modules/store/catalog");
let closeDb: () => Promise<void>;
const ids: string[] = [];
const [basbug] = storefrontCompanies();
const vehicleTypeId = 100;

before(async () => {
  schema = await isolatedSchema("partner_search_test");
  // 40 brake pads: more than one storefront page (24) and than the partner's limit (30).
  for (let index = 0; index < 40; index++) {
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
    [basbug, `TEX ${1000 + index}`, { uk: "TEXTAR", ac: "TEXTAR FREN BALATASI ON", ac2: "", dc: "TL" }]);
    ids.push(rows[0].id);
  }
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'GOLF VII'),(11,1,'PASSAT');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text) VALUES
     (100,10,'1.6 TDI',1598,'Diesel','Dizel',110,81,'2013-01-01','2020-12-01','1.6 TDI'),
     (101,10,'1.4 TSI',1395,'Petrol','Benzin',125,92,'2013-01-01','2020-12-01','1.4 TSI'),
     (110,11,'2.0 TDI',1968,'Diesel','Dizel',150,110,'2015-01-01','2020-12-01','2.0 TDI');`);
  const [{ db }, partnerModule, catalogModule] = await Promise.all([
    import("../src/lib/db"), import("../src/modules/partner/catalog"), import("../src/modules/store/catalog")]);
  partner = partnerModule;
  catalog = catalogModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

const search = (q: string, input: { limit?: number; vehicleTypeId?: number | null; partNo?: string } = {}) =>
  partner.searchPartnerProducts({ q, partNo: input.partNo, limit: input.limit ?? 30, vehicleTypeId: input.vehicleTypeId ?? null, discountBps: 0 });

test("limit 30 returns 30 parts in the storefront's order, past one storefront page (#1093)", async () => {
  const ranked = await catalog.rankedSearchIds("textar fren balatasi", "all");
  assert.equal(ranked.length, 40);
  const { products } = await search("textar fren balatasi");
  assert.equal(products.length, 30);
  assert.deepEqual(products.map(product => product.id), ranked.slice(0, 30));
  assert.ok(products.every(product => product.contractVersion === "1.3" && product.fitmentLevel === null && product.exactFitment.status === "NOT_REQUESTED"));
});

test("an exact part number returns that part only", async () => {
  const { products, source } = await search("", { partNo: "tex-1033" });
  assert.equal(source, "part_no");
  assert.deepEqual(products.map(product => product.partNo), ["TEX 1033"]);
});

test("with a vehicle: the engine type's fits first, then the model's, then the rest, none dropped (#1093)", async () => {
  // Deep in the ranking: an admin linked the 36th part to the type, the 26th fits another type of the model (engine
  // level), the 31st names the model in its description.
  const ranked = await catalog.rankedSearchIds("textar balata", "all");
  const product = async (id: string) => (await schema.pool.query<{ product_id: string }>("SELECT product_id::text FROM product_sources WHERE supplier_item_id=$1", [id])).rows[0].product_id;
  await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,$2,'add')", [await product(ranked[35]), vehicleTypeId]);
  await schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES(10,$1)", [ranked[25]]);
  await schema.pool.query("INSERT INTO product_model_fitments(supplier_item_id,model_id,source_text) VALUES($1,10,'GOLF VII')", [ranked[30]]);
  const { products } = await search("textar balata", { vehicleTypeId });
  assert.equal(products.length, 30);
  assert.deepEqual(products.slice(0, 3).map(item => [item.id, item.fitmentLevel, item.exactFitment.status]), [
    [ranked[35], "guaranteed", "CONFIRMED"], [ranked[25], "likely", "NOT_CONFIRMED"], [ranked[30], "likely", "NOT_CONFIRMED"]]);
  assert.deepEqual(products[0].exactFitment.matchedVehicleTypeIds, [vehicleTypeId]);
  assert.deepEqual(products.slice(3).map(item => item.id), ranked.slice(0, 28).filter(id => id !== ranked[25]));
  assert.ok(products.slice(3).every(item => item.fitmentLevel === "unknown"));
  // Another model's vehicle: nothing fits, the search's order stays.
  const other = await search("textar balata", { vehicleTypeId: 110 });
  assert.deepEqual(other.products.map(item => item.id), ranked.slice(0, 30));
});

test("an identical request within the window is answered from memory; another limit is not (#1093)", async () => {
  const first = await search("tex balata", { limit: 10 });
  const again = await search("TEX BALATA", { limit: 10 });
  assert.equal(again.products, first.products);
  const other = await search("tex balata", { limit: 11 });
  assert.notEqual(other.products, first.products);
  assert.deepEqual(other.products.slice(0, 10).map(item => item.id), first.products.map(item => item.id));
});
