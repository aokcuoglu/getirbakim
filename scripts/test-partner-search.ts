import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { syncSharedLinks } from "./test-helpers/shared-links";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { parseSearchQuery, prefixTsQuery, wholeWords } from "../src/modules/search/query";

// The partner product search (#1093) in an isolated copy of the schema: limit past one storefront page, the vehicle's
// fits first (engine type, then model), nothing dropped, the short answer cache, and a search's vehicle reading from
// whole models and single types (#1395). Nothing is written to the shared database's tables. The ordering and filter
// rules themselves are unit-tested in scripts/test-partner.ts.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let partner: typeof import("../src/modules/partner/catalog");
let catalog: typeof import("../src/modules/store/catalog");
let epoch: typeof import("../src/modules/store/listing-epoch");
let closeDb: () => Promise<void>;
const ids: string[] = [];
const [basbug, , dinamik] = storefrontCompanies();
const groupIds: Record<string, string> = {};
const vehicleTypeId = 100;
// ATE brake discs and the SKODA types their enrichments name (#1395): `fits` are matched fitments (agreeing with the
// payload), `stale` ones disagree with it, `remove`/`add` are an admin's decisions, `name` names a model as Dinamik's
// names do (default "ATE FREN DISKI"). Types: 200 OCTAVIA III 1.6 TDI,
// 201 OCTAVIA III 1.4 TSI (model 20), 210 SUPERB II 2.0 TDI, 211 SUPERB II 1.8 TSI (model 21), 110 PASSAT 2.0 TDI (model 11, its only type).
const ateDiscs: Record<string, { fits?: number[]; stale?: number[]; remove?: number[]; add?: number[]; name?: string }> = {
  octaviaTdi: { fits: [200] }, octaviaTsi: { fits: [201] }, superbTdi: { fits: [210] }, superbTsi: { fits: [211] },
  bothTdiRemoved: { fits: [200, 210], remove: [210] }, octaviaRemoved: { fits: [201], remove: [201] },
  superbAdded: { add: [210] }, octaviaAdded: { add: [201] }, octaviaStale: { stale: [200] }, passat: { fits: [110] },
  superbInName: { fits: [200], name: "ATE FREN DISKI SUPERB" },
};
const ate: Record<string, string> = {};
const typeNames: Record<number, [string, string]> = { 200: ["OCTAVIA III", "1.6 TDI"], 201: ["OCTAVIA III", "1.4 TSI"], 210: ["SUPERB II", "2.0 TDI"],
  211: ["SUPERB II", "1.8 TSI"], 110: ["PASSAT", "2.0 TDI"] };

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
  // One brake disc sold by Başbuğ and, cheaper, by Dinamik (one listing, two offers); another the admin hid.
  for (const [key, supplier, code, cost] of [["basbug", "basbug", "TEX 92000", 100], ["dinamik", "dinamik", "TEXTAR 92000", 60],
    ["hidden", "basbug", "TEX 93000", 10]] as const) {
    const name = "TEXTAR FREN DISKI";
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES($1,$2,'G',$3,$4,$5,$6,'{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
    [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code,
      { uk: "TEXTAR", ac: name, ac2: "", dc: "TL", ...(supplier === "dinamik" ? { marka: "TEXTAR", stokAdi: name } : {}) }, { nf: cost }]);
    groupIds[key] = rows[0].id;
  }
  // 300 oil filters (#1119): a broad search, deeper than rankedSearchDepth (200). The oldest ranks last among equals.
  await schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
    product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
    SELECT 'basbug',$1,'G','MRK','MAN W'||n,'{"uk":"MANN","ac":"MANN YAG FILTRESI","ac2":"","dc":"TL"}','{"nf":100}','{"stok":2}',1,1,1,false,'present',
     now()-interval '30 days',now()-interval '1 hour',now()-make_interval(mins=>n) FROM generate_series(1,300) n`, [basbug]);
  // One more oil filter sold by Başbuğ and Dinamik, ranked last (older than every other): only the Dinamik row's own
  // enrichment links it to a vehicle type.
  for (const [key, supplier, code] of [["deepBasbug", "basbug", "MAN HU900"], ["deepDinamik", "dinamik", "MANN HU900"]] as const) {
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES($1,$2,'G',$3,$4,$5,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '30 days',now()-interval '1 hour',now()-interval '3 days') RETURNING id::text`,
    [supplier, supplier === "basbug" ? basbug : dinamik, supplier === "basbug" ? "MRK" : "ALL", code,
      { uk: "MANN", ac: "MANN YAG FILTRESI", ac2: "", dc: "TL", ...(supplier === "dinamik" ? { marka: "MANN", stokAdi: "MANN YAG FILTRESI" } : {}) }]);
    groupIds[key] = rows[0].id;
  }
  for (const [index, [key, disc]] of Object.entries(ateDiscs).entries()) {
    const { rows } = await schema.pool.query<{ id: string }>(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES('basbug',$1,'G','MRK',$2,$3,'{"nf":100}','{"stok":2}',1,1,1,false,'present',
       now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour') RETURNING id::text`,
    [basbug, `ATE 2401${500 + index}`, { uk: "ATE", ac: disc.name ?? "ATE FREN DISKI", ac2: "", dc: "TL" }]);
    ate[key] = rows[0].id;
  }
  await schema.pool.query("SELECT refresh_product_matches()");
  await schema.pool.query("INSERT INTO product_overrides(product_id,hidden) SELECT product_id,true FROM product_sources WHERE supplier_item_id=$1", [groupIds.hidden]);
  await schema.pool.query("SELECT product_overrides_project(ARRAY(SELECT product_id FROM product_sources WHERE supplier_item_id=$1))", [groupIds.hidden]);
  await schema.pool.query(`INSERT INTO vehicle_brands(id,name,display_name) VALUES(1,'VW','VOLKSWAGEN');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(10,1,'GOLF VII'),(11,1,'PASSAT');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text) VALUES
     (100,10,'1.6 TDI',1598,'Diesel','Dizel',110,81,'2013-01-01','2020-12-01','1.6 TDI'),
     (101,10,'1.4 TSI',1395,'Petrol','Benzin',125,92,'2013-01-01','2020-12-01','1.4 TSI'),
     (102,10,'2.0 TDI',1968,'Diesel','Dizel',150,110,'2013-01-01','2020-12-01','2.0 TDI'),
     (103,10,'1.2 TSI',1197,'Petrol','Benzin',105,77,'2013-01-01','2020-12-01','1.2 TSI'),
     (110,11,'2.0 TDI',1968,'Diesel','Dizel',150,110,'2015-01-01','2020-12-01','2.0 TDI');
    INSERT INTO vehicle_brands(id,name,display_name) VALUES(2,'SKODA','SKODA');
    INSERT INTO vehicle_models(id,brand_id,name) VALUES(20,2,'OCTAVIA III'),(21,2,'SUPERB II');
    INSERT INTO vehicle_types(id,model_id,name,cc,fuel_type,fuel_name,hp,kwt,year_of_constr_from,year_of_constr_to,search_text) VALUES
     (200,20,'1.6 TDI',1598,'Diesel','Dizel',110,81,'2013-01-01','2020-12-01','SKODA OCTAVIA III 1.6 TDI'),
     (201,20,'1.4 TSI',1395,'Petrol','Benzin',150,110,'2013-01-01','2020-12-01','SKODA OCTAVIA III 1.4 TSI'),
     (210,21,'2.0 TDI',1968,'Diesel','Dizel',150,110,'2015-01-01','2020-12-01','SKODA SUPERB II 2.0 TDI'),
     (211,21,'1.8 TSI',1798,'Petrol','Benzin',160,118,'2015-01-01','2020-12-01','SKODA SUPERB II 1.8 TSI');`);
  await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status)
    SELECT id,code,product_data->>'uk','complete' FROM supplier_items WHERE id=$1`, [groupIds.deepDinamik]);
  await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,match_basis)
    SELECT id,code,product_data->>'uk','https://www.trodo.com/x','test','MANN','HU900',$2,'{"type":"exact_part"}' FROM supplier_items WHERE id=$1`,
  [groupIds.deepDinamik, JSON.stringify({ vehicles: [{ model: "GOLF VII" }], specifications: [], oemNumbers: {} })]);
  await schema.pool.query(`INSERT INTO product_vehicle_fitments(supplier_item_id,source_index,source_vehicle,vehicle_type_id,match_status,matcher_version)
    VALUES($1,0,'{"model":"GOLF VII"}',103,'matched','t')`, [groupIds.deepDinamik]);
  for (const [key, disc] of Object.entries(ateDiscs)) {
    const fitted = [...disc.fits ?? [], ...disc.stale ?? []];
    if (fitted.length) {
      // A stale fitment names the type's engine while the payload now holds another one at the same index.
      const vehicles = fitted.map(typeId => ({ model: typeNames[typeId][0], engine: disc.stale?.includes(typeId) ? "2.0 TFSI" : typeNames[typeId][1] }));
      await schema.pool.query(`INSERT INTO product_enrichment_jobs(supplier_item_id,supplier_code,supplier_brand,status)
        SELECT id,code,product_data->>'uk','complete' FROM supplier_items WHERE id=$1`, [ate[key]]);
      await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload,match_basis)
        SELECT id,code,product_data->>'uk','https://www.trodo.com/x','test','ATE',code,$2,'{"type":"exact_part"}' FROM supplier_items WHERE id=$1`,
      [ate[key], JSON.stringify({ vehicles, specifications: [], oemNumbers: {} })]);
      for (const [index, typeId] of fitted.entries())
        await schema.pool.query(`INSERT INTO product_vehicle_fitments(supplier_item_id,source_index,source_vehicle,vehicle_type_id,match_status,matcher_version)
          VALUES($1,$2,$3,$4,'matched','t')`, [ate[key], index, { model: typeNames[typeId][0], engine: typeNames[typeId][1] }, typeId]);
    }
    for (const [mode, typeIds] of [["remove", disc.remove ?? []], ["add", disc.add ?? []]] as const)
      for (const typeId of typeIds)
        await schema.pool.query(`INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode)
          SELECT product_id,$2,$3 FROM product_sources WHERE supplier_item_id=$1`, [ate[key], typeId, mode]);
  }
  await syncSharedLinks(schema.pool);
  // The refresh shares the enrichment with the Başbuğ row of the same product; without that link (an enrichment the
  // Başbuğ row does not get), only the secondary offer fits.
  await schema.pool.query("DELETE FROM product_enrichment_shared_links WHERE supplier_item_id=$1", [groupIds.deepBasbug]);
  const [{ db }, partnerModule, catalogModule] = await Promise.all([
    import("../src/lib/db"), import("../src/modules/partner/catalog"), import("../src/modules/store/catalog")]);
  epoch = await import("../src/modules/store/listing-epoch");
  partner = partnerModule;
  catalog = catalogModule;
  closeDb = () => db.end();
});
after(async () => { await closeDb?.(); await schema?.drop(); });

const search = (q: string, input: { limit?: number; vehicleTypeId?: number | null; partNo?: string; discountBps?: number } = {}) =>
  partner.searchPartnerProducts({ q, partNo: input.partNo, limit: input.limit ?? 30, vehicleTypeId: input.vehicleTypeId ?? null, discountBps: input.discountBps ?? 0 });

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
  // The admin removed the type from a product that fits another type of the model: a storefront mismatch, so not
  // likely and not put first.
  await schema.pool.query("INSERT INTO storefront_model_fits(model_id,supplier_item_id) VALUES(10,$1)", [ranked[33]]);
  await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,$2,'remove')", [await product(ranked[33]), vehicleTypeId]);
  const removed = await search("textar balata", { vehicleTypeId, limit: 29 });
  assert.deepEqual(removed.products.slice(0, 3).map(item => item.id), [ranked[35], ranked[25], ranked[30]]);
  assert.ok(!removed.products.slice(0, 3).some(item => item.id === ranked[33]));
  const all = await search("textar balata", { vehicleTypeId: 101 });
  // Type 101 (same model, not removed) still counts it as likely.
  assert.equal(all.products.find(item => item.id === ranked[33])?.fitmentLevel, "likely");
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

test("a changed partner discount (#1130) is not answered from the cached prices", async () => {
  const before = await search("tex balata", { limit: 5 });
  const discounted = await search("tex balata", { limit: 5, discountBps: 1000 });
  assert.notEqual(discounted.products, before.products);
  assert.deepEqual(discounted.products.map(item => item.id), before.products.map(item => item.id));
  for (const [index, product] of discounted.products.entries()) {
    const list = before.products[index];
    assert.equal(list.discountBps, 0);
    assert.equal(product.listPriceKurus, list.listPriceKurus);
    assert.equal(product.discountBps, 1000);
    assert.equal(product.b2bPriceKurus, Math.round((list.listPriceKurus ?? 0) * 0.9));
  }
});

test("a product sold by two suppliers is one result with both offers, priced by the cheaper; a hidden product is not listed", async () => {
  const offers = (await schema.pool.query<{ item_id: string; primary_id: string }>("SELECT item_id::text,primary_id::text FROM product_offers WHERE primary_id=$1", [groupIds.basbug])).rows;
  assert.deepEqual(offers.map(row => row.item_id).sort(), [groupIds.basbug, groupIds.dinamik].sort());
  const { products } = await search("textar fren diski");
  assert.deepEqual(products.map(item => item.id), [groupIds.basbug]);
  const [disc] = products;
  assert.deepEqual(disc.offers.map(offer => offer.supplierDisplayName), ["Başbuğ", "Dinamik"]);
  const [basbugOffer, dinamikOffer] = disc.offers.map(offer => offer.informationalPriceKurus!);
  assert.ok(dinamikOffer < basbugOffer, "Dinamik is cheaper");
  assert.deepEqual([disc.listPriceKurus, disc.b2bPriceKurus], [dinamikOffer, dinamikOffer]);
  assert.equal(disc.partNo, "TEX 92000");
  // The hidden disc is a real match the storefront drops: found by its own number only while not hidden.
  assert.equal((await schema.pool.query("SELECT hidden FROM commerce_item_overrides WHERE supplier_item_id=$1", [groupIds.hidden])).rows[0]?.hidden, true);
  assert.equal((await search("", { partNo: "TEX 93000" })).products.length, 0);
  assert.equal((await search("", { partNo: "TEX 92000" })).products.length, 1);
});

test("with a vehicle, a part linked to its type is found in the whole match set, below the ranked depth (#1119)", async () => {
  const ranked = await catalog.rankedSearchIds("mann yag filtresi", "all");
  assert.equal(ranked.length, 200);
  // MAN W250 ranks 250th of 300 (changed 250 minutes ago, newest first among equal matches): outside the ranked depth.
  const deep = (await schema.pool.query<{ id: string; product_id: string }>(`SELECT s.id::text,ps.product_id::text FROM supplier_items s
    JOIN product_sources ps ON ps.supplier_item_id=s.id WHERE s.code='MAN W250'`)).rows[0];
  assert.ok(!ranked.includes(deep.id));
  await schema.pool.query("INSERT INTO product_override_fitments(product_id,vehicle_type_id,mode) VALUES($1,102,'add')", [deep.product_id]);
  const { products } = await search("mann yag filtresi", { vehicleTypeId: 102 });
  assert.equal(products.length, 30);
  assert.deepEqual([products[0].partNo, products[0].fitmentLevel, products[0].exactFitment.status], ["MAN W250", "guaranteed", "CONFIRMED"]);
  // The rest are the search's top matches, none dropped.
  assert.deepEqual(products.slice(1).map(item => item.id), ranked.slice(0, 29));
  assert.ok(products.slice(1).every(item => item.fitmentLevel === "unknown"));
  // Without the vehicle it stays out of the first page.
  assert.ok(!(await search("mann yag filtresi")).products.some(item => item.id === deep.id));
});

test("a fit of the secondary offer alone lists the product, ranked below the depth, first as guaranteed (#1119)", async () => {
  const offers = (await schema.pool.query<{ item_id: string }>("SELECT item_id::text FROM product_offers WHERE primary_id=$1", [groupIds.deepBasbug])).rows;
  assert.deepEqual(offers.map(row => row.item_id).sort(), [groupIds.deepBasbug, groupIds.deepDinamik].sort());
  // Only the Dinamik row is linked to the type; the Başbuğ primary, which the search lists, is not, and ranks below 200.
  const fitted = await catalog.typeFittedIds(103);
  assert.ok(fitted.includes(groupIds.deepDinamik) && !fitted.includes(groupIds.deepBasbug));
  assert.ok(!(await catalog.rankedSearchIds("mann yag filtresi", "all")).includes(groupIds.deepBasbug));
  const { products } = await search("mann yag filtresi", { vehicleTypeId: 103 });
  assert.equal(products.length, 30);
  assert.deepEqual([products[0].id, products[0].fitmentLevel, products[0].offers.length], [groupIds.deepBasbug, "guaranteed", 2]);
  assert.ok(products.slice(1).every(item => item.fitmentLevel !== "guaranteed"));
});

/** The rows fittedProductIds read before #1395, live over every type the vehicle words match: the reference. */
async function fittedBefore(words: string) {
  return new Set((await schema.pool.query<{ id: string }>(`WITH types AS MATERIALIZED (SELECT v.id FROM vehicle_types v
     WHERE to_tsvector('simple', search_normalize(v.search_text)) @@ to_tsquery('simple', $1)),
    fits AS MATERIALIZED (SELECT f.supplier_item_id,f.source_index,f.source_vehicle,f.vehicle_type_id FROM types JOIN product_vehicle_fitments f ON f.vehicle_type_id=types.id),
    trusted AS MATERIALIZED (SELECT e.supplier_item_id,e.donor_item_id,e.payload->'vehicles' AS vehicles FROM storefront_enrichments e
     JOIN supplier_items s ON s.id=e.supplier_item_id AND s.code=e.supplier_code AND s.product_data->>'uk'=e.supplier_brand
     AND (e.match_basis->>'type'='exact_part' OR e.match_basis->>'supplierOem'=e.donor_oem)
     WHERE e.donor_item_id IN (SELECT supplier_item_id FROM fits)),
    decided AS MATERIALIZED (SELECT ps.supplier_item_id,o.vehicle_type_id,o.mode FROM types
     JOIN product_override_fitments o ON o.vehicle_type_id=types.id JOIN product_sources ps ON ps.product_id=o.product_id)
    SELECT id::text FROM (SELECT t.supplier_item_id AS id FROM fits f JOIN trusted t ON t.donor_item_id=f.supplier_item_id AND f.source_vehicle=t.vehicles->f.source_index
     WHERE (t.supplier_item_id,f.vehicle_type_id) NOT IN (SELECT supplier_item_id,vehicle_type_id FROM decided WHERE mode='remove')
    UNION SELECT supplier_item_id FROM decided WHERE mode='add') fitted`, [prefixTsQuery(vehicleWords(words))])).rows.map(row => row.id));
}
const vehicleWords = (words: string) => wholeWords(parseSearchQuery(words, { years: true }));
/** vehicleFittedIds for words within the live-type limit. */
async function fittedOf(words: string) {
  const fitted = await catalog.vehicleFittedIds(vehicleWords(words));
  assert.ok(fitted, `"${words}" is read`);
  return fitted;
}
const discsOf = (rowIds: Iterable<string>) => Object.keys(ate).filter(key => new Set(rowIds).has(ate[key])).sort();

test("a search's vehicle reading (#1395): whole models from the model fits, other types live, the rows the live read gave before", async () => {
  // Whole: both OCTAVIA III types. Partial: one of SUPERB II's two types. Mixed: "tdi" is PASSAT's only type (a whole
  // model) and one or two types of GOLF VII, OCTAVIA III and SUPERB II.
  const cases: [string, string[]][] = [
    ["octavia", ["bothTdiRemoved", "octaviaAdded", "octaviaTdi", "octaviaTsi", "superbInName"]],
    ["superb tdi", ["superbAdded", "superbTdi"]],
    ["tdi", ["bothTdiRemoved", "octaviaTdi", "passat", "superbAdded", "superbInName", "superbTdi"]],
  ];
  for (const [words, discs] of cases) {
    const fitted = await fittedOf(words);
    assert.equal(new Set(fitted).size, fitted.length, words);
    // A removed type drops its fitment only (bothTdiRemoved still fits 200), a stale one never counts, an added type lists the row.
    assert.deepEqual(discsOf(fitted), discs, words);
    assert.deepEqual(new Set(fitted), await fittedBefore(words), words);
  }
  // The whole model is not read live: the model fits alone decide it, so a row the refresh has not written yet is missing.
  await schema.pool.query("DELETE FROM storefront_model_fits WHERE model_id=20 AND supplier_item_id=$1", [ate.octaviaTsi]);
  assert.deepEqual(discsOf(await fittedOf("octavia")), ["bothTdiRemoved", "octaviaAdded", "octaviaTdi", "superbInName"]);
  await schema.pool.query("SELECT storefront_make_fits_refresh($1::uuid[])", [[ate.octaviaTsi]]);
  assert.deepEqual(discsOf(await fittedOf("octavia")), ["bothTdiRemoved", "octaviaAdded", "octaviaTdi", "octaviaTsi", "superbInName"]);
});

test("part + vehicle searches list the fitted discs (#1395): a whole model, a single type and a mixed reading", async () => {
  for (const [q, discs] of [
    ["ate fren diski octavia", ["bothTdiRemoved", "octaviaAdded", "octaviaTdi", "octaviaTsi", "superbInName"]],
    // The first split that finds fitted parts wins: "tdi" after "ate fren diski superb" (a name match), before "superb tdi".
    ["ate fren diski superb tdi", ["superbInName"]],
    ["ate fren diski tdi", ["bothTdiRemoved", "octaviaTdi", "passat", "superbAdded", "superbInName", "superbTdi"]],
  ] as const) {
    assert.deepEqual(discsOf(await catalog.rankedSearchIds(q, "all")), discs, q);
    const { products } = await search(q);
    assert.deepEqual(discsOf(products.map(product => product.id)), discs, q);
    assert.equal(products.length, discs.length, q);
  }
});

test("a vehicle reading past VEHICLE_SEARCH_MAX_LIVE_TYPES live types is skipped for the next split; whole models are not capped (#1395)", async () => {
  const saved = process.env.VEHICLE_SEARCH_MAX_LIVE_TYPES;
  const withLimit = async <T>(limit: string, run: () => Promise<T>) => {
    process.env.VEHICLE_SEARCH_MAX_LIVE_TYPES = limit;
    try { return await run(); }
    finally { if (saved === undefined) delete process.env.VEHICLE_SEARCH_MAX_LIVE_TYPES; else process.env.VEHICLE_SEARCH_MAX_LIVE_TYPES = saved; }
  };
  const reading = (words: string) => catalog.vehicleFittedIds(vehicleWords(words));
  const tdi = ["bothTdiRemoved", "octaviaTdi", "passat", "superbAdded", "superbInName", "superbTdi"];
  // "tdi": four types of partly matched models (GOLF VII 100 and 102, OCTAVIA III 200, SUPERB II 210) and PASSAT, whole.
  assert.equal(await withLimit("3", () => reading("tdi")), null);
  assert.deepEqual(discsOf(await withLimit("4", () => reading("tdi")) ?? []), tdi);
  // Blank or invalid: 500.
  for (const setting of ["", " ", "abc", "-1", "2.5"]) assert.deepEqual(discsOf(await withLimit(setting, () => reading("tdi")) ?? []), tdi, setting);
  // 0 reads no partly matched model live; a whole model is read from its model fits whatever the limit.
  assert.equal(await withLimit("0", () => reading("superb tdi")), null);
  assert.deepEqual(discsOf(await withLimit("0", () => reading("octavia")) ?? []), ["bothTdiRemoved", "octaviaAdded", "octaviaTdi", "octaviaTsi", "superbInName"]);
  // A search reloads (an edit's bump) under the limit: the capped "tdi" split is no vehicle reading, so "superb tdi" is
  // read instead; with "tdi" its only vehicle reading, nothing fits and nothing names "tdi".
  await epoch.invalidateListings();
  assert.deepEqual(discsOf(await withLimit("3", () => catalog.rankedSearchIds("ate fren diski superb tdi", "all"))), ["superbAdded", "superbTdi"]);
  assert.deepEqual(await withLimit("3", () => catalog.rankedSearchIds("ate fren diski tdi", "all")), []);
});
