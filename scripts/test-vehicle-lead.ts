import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";

// The garage vehicle's fits put first on a listing (#884) in an isolated copy of the schema: vehicleLead is the listing's
// `fits=vehicle` page 1, cut to its limit, with that listing's total and filters. Nothing is written to the shared tables.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let catalog: typeof import("../src/modules/store/catalog");
let closeDb: () => Promise<void>;
const ids: Record<string, string> = {};
const [basbug] = storefrontCompanies();
const GOLF = 340, CLIO = 900;

async function item(key: string, brand: string, name: string, cost: number) {
  const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    VALUES('basbug',$1,'G','MRK',$2,$3,$4,'{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
  [basbug, `${brand.slice(0, 3)} ${key.toUpperCase()}`, { uk: brand, ac: name, ac2: "", dc: "TL" }, { nf: cost }]);
  ids[key] = rows[0].id;
}

before(async () => {
  schema = await isolatedSchema("vehicle_lead_test");
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VOLKSWAGEN','VOLKSWAGEN'),(2,'RENAULT','RENAULT');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'GOLF VII'),(20,2,'CLIO IV');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,search_text)
    VALUES(${GOLF},10,'1.6 TDI',1598,'Diesel','Dizel',110,81,'2012-08-01','golf'),(${CLIO},20,'1.5 dCi',1461,'Diesel','Dizel',90,66,'2012-11-01','clio')`);
  // Seven fitting products (five brake pads), three that do not fit.
  const fitting = [["trw1", "TRW", "TRW FREN BALATASI ON", 300], ["trw2", "TRW", "TRW FREN BALATASI ARKA", 200], ["bosch1", "BOSCH", "BOSCH FREN BALATASI", 500],
    ["bosch2", "BOSCH", "BOSCH FREN BALATASI ARKA", 100], ["febi1", "FEBI", "FEBI FREN BALATASI", 400], ["febi2", "FEBI", "FEBI HAVA FILTRESI", 150],
    ["mann1", "MANN", "MANN YAG FILTRESI", 250]] as const;
  const other = [["ate1", "ATE", "ATE FREN BALATASI", 120], ["ate2", "ATE", "ATE FREN DISKI", 220], ["mann2", "MANN", "MANN HAVA FILTRESI", 90]] as const;
  for (const [key, brand, name, cost] of [...fitting, ...other]) await item(key, brand, name, cost);
  await schema.pool.query("SELECT refresh_product_matches()");
  // An admin's added fitment (#583) is a fit the store lists, enriched or not.
  await schema.pool.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode)
    SELECT ps.product_id,$2,'add' FROM product_sources ps WHERE ps.supplier_item_id=ANY($1::uuid[])`, [fitting.map(([key]) => ids[key]), GOLF]);
  const [{ db }, module] = await Promise.all([import("../src/lib/db"), import("../src/modules/store/catalog")]);
  catalog = module;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

const idsOf = (items: { id: string }[]) => items.map(item => item.id);
const fittingKeys = ["trw1", "trw2", "bosch1", "bosch2", "febi1", "febi2", "mann1"];

test("the lead is the first cards of the fits=vehicle listing, with its total", async () => {
  const lead = await catalog.vehicleLead({}, String(GOLF), 3);
  const listing = await catalog.browseProducts({ fits: "vehicle" }, { vehicleTypeId: String(GOLF) });
  assert.equal(lead.items.length, 3);
  assert.equal(lead.total, 7);
  assert.equal(lead.total, listing.total);
  assert.equal(lead.total, await catalog.vehicleFitCount({}, String(GOLF)));
  assert.deepEqual(idsOf(lead.items), idsOf(listing.items).slice(0, 3));
  assert.deepEqual(new Set(idsOf(listing.items)), new Set(fittingKeys.map(key => ids[key])));
});

test("the default limit is four cards; a page number of the listing does not move the lead", async () => {
  const lead = await catalog.vehicleLead({ page: "2" }, String(GOLF));
  assert.equal(lead.items.length, 4);
  assert.deepEqual(idsOf(lead.items), idsOf((await catalog.vehicleLead({}, String(GOLF))).items));
});

test("a limit is a whole number of cards between one and a page", async () => {
  assert.equal((await catalog.vehicleLead({}, String(GOLF), 2.7)).items.length, 2);
  assert.equal((await catalog.vehicleLead({}, String(GOLF), 0)).items.length, 1);
  assert.equal((await catalog.vehicleLead({}, String(GOLF), Number.NaN)).items.length, 7);
  assert.equal((await catalog.vehicleLead({}, String(GOLF), Number.POSITIVE_INFINITY)).items.length, 7);
});

test("the lead keeps the listing's search, brand filter and order", async () => {
  const searched = await catalog.vehicleLead({ q: "fren balatası" }, String(GOLF), 6);
  assert.equal(searched.total, 5);
  assert.deepEqual(new Set(idsOf(searched.items)), new Set(["trw1", "trw2", "bosch1", "bosch2", "febi1"].map(key => ids[key])));
  assert.equal(searched.total, await catalog.vehicleFitCount({ q: "fren balatası" }, String(GOLF)));
  const branded = await catalog.vehicleLead({ brand: "TRW" }, String(GOLF));
  assert.equal(branded.total, 2);
  assert.deepEqual(new Set(idsOf(branded.items)), new Set([ids.trw1, ids.trw2]));
  // Later pages' offer box counts the same fits=vehicle listing, every filter kept (#884).
  assert.equal(await catalog.vehicleFitCount({ brand: "TRW", page: "2" }, String(GOLF)), branded.total);
  assert.equal(await catalog.vehicleFitCount({ q: "fren balatası", brand: "BOSCH" }, String(GOLF)), (await catalog.vehicleLead({ q: "fren balatası", brand: "BOSCH" }, String(GOLF))).total);
  assert.equal(await catalog.vehicleFitCount({ availability: "out_of_stock" }, String(GOLF)), 0);
  const cheapest = await catalog.vehicleLead({ sort: "price-asc" }, String(GOLF), 2);
  const sorted = await catalog.browseProducts({ fits: "vehicle", sort: "price-asc" }, { vehicleTypeId: String(GOLF) });
  assert.deepEqual(idsOf(cheapest.items), idsOf(sorted.items).slice(0, 2));
  assert.deepEqual(idsOf(cheapest.items), [ids.bosch2, ids.febi2]);
  const ranked = await catalog.vehicleLead({ q: "fren balatası", sort: "price-desc" }, String(GOLF), 1);
  assert.deepEqual(idsOf(ranked.items), [ids.bosch1]);
  // A price-sorted search has the listing's total in either order (#1345); the search and the fits are one id set here,
  // read through its clause (two or more are priced by id array: test-vehicle-model-listing).
  assert.equal(ranked.total, searched.total);
  const pricedSearch = await catalog.browseProducts({ q: "fren balatası", fits: "vehicle", sort: "price-asc" }, { vehicleTypeId: String(GOLF) });
  assert.deepEqual(idsOf(pricedSearch.items), [ids.bosch2, ids.trw2, ids.trw1, ids.febi1, ids.bosch1]);
});

test("a vehicle without fits in the listing has no lead", async () => {
  assert.deepEqual(await catalog.vehicleLead({}, String(CLIO)), { items: [], total: 0 });
  assert.equal((await catalog.vehicleLead({ brand: "ATE" }, String(GOLF))).total, 0);
});
