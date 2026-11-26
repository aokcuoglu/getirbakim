import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { isolatedSchema } from "./isolated-schema";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import type { CatalogQuery } from "../src/modules/store/catalog-query";

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

type Catalog = typeof import("../src/modules/store/catalog");
let processes = 0;
/** Another app process: a second copy of the catalog module, with its own process caches, on the same database. */
const otherProcess = async () => await import(`../src/modules/store/catalog.ts?stock-scope-${++processes}`) as Catalog;
/** `run` with these environment variables set (undefined: unset), restored afterwards. */
async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const saved = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  const apply = (next: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  try {
    return await run();
  } finally {
    apply(saved);
  }
}
/** The text of every statement `run` sends, on any connection. */
async function sentTexts(run: () => Promise<unknown>) {
  const texts: string[] = [];
  const original = pg.Client.prototype.query;
  pg.Client.prototype.query = function (this: pg.Client, ...args: unknown[]) {
    const config = args[0];
    texts.push(typeof config === "string" ? config : (config as { text?: string } | undefined)?.text ?? "");
    return (original as (...rest: unknown[]) => unknown).apply(this, args);
  } as typeof original;
  try {
    await run();
  } finally {
    pg.Client.prototype.query = original;
  }
  return texts;
}
const setStock = (keys: string[], stock: number) => schema.pool.query(
  "UPDATE supplier_items SET stock_data=jsonb_build_object('stok',$2::int) WHERE id=ANY($1::uuid[])", [keys.map(key => ids[key]), stock]);
/**
 * Page 1 of the listing (the `fits=vehicle` one unless `fits` is false) read by a fresh process under
 * LISTING_STOCK_SCOPE_MAX_IDS=`max`, and the statements it sent.
 */
const stockListing = (max: string | undefined, query: CatalogQuery, fits = true) => withEnv({ LISTING_STOCK_SCOPE_MAX_IDS: max }, async () => {
  const fresh = await otherProcess();
  let listing: Awaited<ReturnType<Catalog["browseProducts"]>> | undefined;
  const texts = await sentTexts(async () => { listing = await fresh.browseProducts({ ...query, ...(fits ? { fits: "vehicle" as const } : {}) }, { vehicleTypeId: String(GOLF) }); });
  assert.ok(listing);
  return { listed: { ids: idsOf(listing.items), total: listing.total, pages: listing.pages }, texts };
});
/** A statement over the priced view (storefront_catalog), not the lean entries or the availability view. */
const priced = (text: string) => /FROM storefront_catalog WHERE/.test(text);
/** The scoped stock clause (stockClause): a make's own clause is an `ANY(ARRAY(` too, so the guards look for this. */
const scopedMarker = "catalog.id=ANY(ARRAY(WITH scope AS MATERIALIZED";

// A stock filter on the garage vehicle's fits reads those ids' stock only (#1429, stock-filter.ts). Its oracle is the
// whole stock set's clause (LISTING_STOCK_SCOPE_MAX_IDS=0): the same cards, order and totals in every order.
test("a stock filter on the vehicle's fits lists the same cards scoped and over the whole stock set (#1429)", async () => {
  await setStock(["trw2", "febi2"], 0);
  try {
    const inStock = ["bosch2", "mann1", "trw1", "febi1", "bosch1"].map(key => ids[key]), outOfStock = [ids.febi2, ids.trw2];
    const expected = {
      in_stock: { "price-asc": inStock, "price-desc": [...inStock].reverse() },
      out_of_stock: { "price-asc": outOfStock, "price-desc": [...outOfStock].reverse() },
    };
    for (const availability of ["in_stock", "out_of_stock"] as const) {
      for (const sort of [undefined, "price-asc", "price-desc"] as const) {
        const label = `${availability} ${sort ?? "newest"}`;
        const scoped = await stockListing(undefined, { availability, sort }), whole = await stockListing("0", { availability, sort });
        assert.deepEqual(scoped.listed, whole.listed, label);
        if (sort) assert.deepEqual(scoped.listed.ids, expected[availability][sort], label);
        else assert.deepEqual(new Set(scoped.listed.ids), new Set(expected[availability]["price-asc"]), label);
        assert.equal(scoped.listed.total, availability === "in_stock" ? 5 : 2, label);
        // The default reads the fits' stock as one InitPlan array; 0 sends the whole set's clause again.
        assert.ok(scoped.texts.some(text => text.includes(scopedMarker) && text.includes("commerce_item_availability")), label);
        assert.ok(!scoped.texts.some(text => text.includes("commerce_out_of_stock_ids") || text.includes("catalog.id IN (SELECT")), label);
        assert.ok(whole.texts.some(text => text.includes(availability === "in_stock" ? "catalog.id IN (SELECT COALESCE(o.primary_id,a.id)" : "commerce_out_of_stock_ids(")), label);
        assert.ok(!whole.texts.some(text => text.includes("=ANY(ARRAY(")), label);
        // A statement pricing the view never reads the scoped clause: a price order reads the listing's ids first (listedIds).
        assert.ok(!scoped.texts.some(text => priced(text) && text.includes("ANY(ARRAY(")), label);
        if (sort) assert.ok(scoped.texts.some(text => text.includes("array_agg(catalog.id)") && text.includes(scopedMarker)), label);
      }
    }
  } finally {
    await setStock(fittingKeys, 2);
  }
});

// A price-sorted search with a stock filter builds its cached order (searchOrder, #1425): the search hits and the scoped
// stock clause are two id sets, so the order prices the listing's ids read first (listedIds), never the clause (#1429).
test("a price-sorted search with a stock filter never prices the view through the scoped clause (#1429)", async () => {
  await setStock(["trw2", "febi2"], 0);
  try {
    // "fren balatası": five fitting pads and ATE's, which does not fit; TRW's rear pad is sold out.
    const inStock = ["bosch2", "ate1", "trw1", "febi1", "bosch1"].map(key => ids[key]);
    const expected: Record<string, Record<"price-asc" | "price-desc", string[]>> = {
      "in_stock false": { "price-asc": inStock, "price-desc": [...inStock].reverse() },
      "in_stock true": { "price-asc": inStock.filter(id => id !== ids.ate1), "price-desc": inStock.filter(id => id !== ids.ate1).reverse() },
      "out_of_stock false": { "price-asc": [ids.trw2], "price-desc": [ids.trw2] },
      "out_of_stock true": { "price-asc": [ids.trw2], "price-desc": [ids.trw2] },
    };
    for (const fits of [false, true]) {
      for (const availability of ["in_stock", "out_of_stock"] as const) {
        for (const sort of ["price-asc", "price-desc"] as const) {
          const label = `${availability} ${sort} fits=${fits}`, query = { q: "fren balatası", availability, sort };
          const scoped = await stockListing(undefined, query, fits), whole = await stockListing("0", query, fits);
          assert.deepEqual(scoped.listed, whole.listed, label);
          assert.deepEqual(scoped.listed.ids, expected[`${availability} ${fits}`][sort], label);
          // The search order path ran (its build statement), with the scoped clause and the listing's ids read first.
          assert.ok(scoped.texts.some(text => text.includes("SELECT ids::text AS ids FROM ordered")), label);
          assert.ok(scoped.texts.some(text => text.includes("array_agg(catalog.id)") && text.includes(scopedMarker)), label);
          assert.ok(!scoped.texts.some(text => priced(text) && text.includes("ANY(ARRAY(")), label);
          assert.ok(!whole.texts.some(text => text.includes("=ANY(ARRAY(")), label);
        }
      }
    }
  } finally {
    await setStock(fittingKeys, 2);
  }
});

// A make-only or brand listing binds no JS id array: a stock filter reads its listed ids first (the stock scope, cached)
// and then those ids' stock only (#1455). The trap guard: a brand's clause is not an id set, so the scoped clause can be
// the listing's only one, and catalogFilter counts it as two; a price order then reads the listing's ids first
// (listedIds) and never prices the view through the scoped clause (over 120 s at 200k ids).
test("a make-only or brand listing's stock filter reads its scope and never prices the view through it (#1455)", async () => {
  await schema.pool.query("INSERT INTO storefront_make_fits(brand_id,supplier_item_id) SELECT 1,unnest($1::uuid[])", [fittingKeys.map(key => ids[key])]);
  await setStock(["trw2", "febi2"], 0);
  try {
    const inStock = ["bosch2", "mann1", "trw1", "febi1", "bosch1"].map(key => ids[key]);
    const expected: Record<string, Record<"in_stock" | "out_of_stock", string[]>> = {
      "make volkswagen": { in_stock: inStock, out_of_stock: [ids.febi2, ids.trw2] },
      "brand TRW": { in_stock: [ids.trw1], out_of_stock: [ids.trw2] },
      "brands TRW+FEBI": { in_stock: [ids.trw1, ids.febi1], out_of_stock: [ids.febi2, ids.trw2] },
    };
    const queries: Record<string, CatalogQuery> = { "make volkswagen": { make: "volkswagen" }, "brand TRW": { brand: "TRW" }, "brands TRW+FEBI": { brands: '["TRW","FEBI"]' } };
    for (const [name, base] of Object.entries(queries)) {
      for (const availability of ["in_stock", "out_of_stock"] as const) {
        for (const sort of [undefined, "price-asc", "price-desc"] as const) {
          const label = `${name} ${availability} ${sort ?? "newest"}`, query = { ...base, availability, sort };
          const scoped = await stockListing(undefined, query, false), whole = await stockListing("0", query, false);
          assert.deepEqual(scoped.listed, whole.listed, label);
          const cheapestFirst = expected[name][availability];
          if (sort === "price-asc") assert.deepEqual(scoped.listed.ids, cheapestFirst, label);
          else if (sort === "price-desc") assert.deepEqual(scoped.listed.ids, [...cheapestFirst].reverse(), label);
          else assert.deepEqual(new Set(scoped.listed.ids), new Set(cheapestFirst), label);
          // The default reads the scope's ids first and binds them to the scoped clause; 0 sends the whole set's clause.
          assert.ok(scoped.texts.some(text => text.includes("array_agg(id)::text") && text.includes(") scope")), label);
          assert.ok(scoped.texts.some(text => text.includes(scopedMarker)), label);
          assert.ok(!scoped.texts.some(text => text.includes("commerce_out_of_stock_ids(") || text.includes("catalog.id IN (SELECT")), label);
          assert.ok(whole.texts.some(text => text.includes(availability === "in_stock" ? "catalog.id IN (SELECT COALESCE(o.primary_id,a.id)" : "commerce_out_of_stock_ids(")), label);
          assert.ok(!whole.texts.some(text => text.includes("scope AS MATERIALIZED")), label);
          // No statement pricing the view reads the scoped clause; a price order reads the listing's ids first.
          assert.ok(!scoped.texts.some(text => priced(text) && text.includes("scope AS MATERIALIZED")), label);
          if (sort) assert.ok(scoped.texts.some(text => text.includes("array_agg(catalog.id)") && text.includes(scopedMarker)), label);
        }
      }
    }
  } finally {
    await setStock(fittingKeys, 2);
    await schema.pool.query("DELETE FROM storefront_make_fits WHERE brand_id=1");
  }
});

// No stored stock set: a fresh process lists a stock change at once, without a sync or an epoch bump (#1429). A running
// process's listing follows it with its count and page caches (10 minutes), as before.
test("a scoped stock filter reads stock live (#1429)", async () => {
  const listed = async (availability: "in_stock" | "out_of_stock") => (await stockListing(undefined, { availability })).listed;
  try {
    assert.equal((await listed("in_stock")).total, 7);
    await setStock(["mann1"], 0);
    const [inStock, outOfStock] = [await listed("in_stock"), await listed("out_of_stock")];
    assert.equal(inStock.total, 6);
    assert.ok(!inStock.ids.includes(ids.mann1));
    assert.deepEqual(outOfStock.ids, [ids.mann1]);
    await setStock(["mann1"], 3);
    assert.equal((await listed("in_stock")).total, 7);
    assert.equal((await listed("out_of_stock")).total, 0);
  } finally {
    await setStock(fittingKeys, 2);
  }
});
