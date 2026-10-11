import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/lib/db";
import { compactSearchCode, exactTsQuery, normalizeSearchText, parseSearchQuery, prefixTsQuery } from "../src/modules/search/query";
import { searchVehicleCatalog } from "../src/modules/store/vehicle-catalog.server";
import { browseProducts, suggestProducts } from "../src/modules/store/catalog";

after(async () => { await db.end(); });

test("query normalisation matches the SQL side", async () => {
  for (const value of ["CİTROËN Fren Balatası", "1,6 TDI 275/45R20", "(5YJY) a.b 0 986.494-104", "ŞÇĞÜÖI ığüşöç", "  %_\\' OR TRUE -- ", "amortiso\u0308r"]) {
    const { rows } = await db.query<{ normalized: string; compact: string }>("SELECT search_normalize($1) AS normalized, search_compact($1) AS compact", [value]);
    assert.equal(normalizeSearchText(value), rows[0].normalized, value);
    assert.equal(compactSearchCode(value), rows[0].compact, value);
  }
});

test("parser: Turkish suffixes, synonyms, roman numerals, filler words and years", () => {
  const golf = parseSearchQuery("VW Golf 7 dizel 2015", { years: true });
  assert.deepEqual(golf.years, [2015]);
  assert.equal(prefixTsQuery(golf), "('vw':* | 'volkswagen':*) & ('golf':*) & ('7' | 'vii') & ('dizel':* | 'diesel':*)");
  assert.equal(parseSearchQuery("golf 2015").terms.at(-1)?.text, "2015");
  const tesla = parseSearchQuery("tesla model y");
  assert.equal(prefixTsQuery(tesla), "('tesla':*) & ('y':*)");
  assert.equal(exactTsQuery(tesla), "'tesla' | 'model' | 'y'");
  assert.equal(prefixTsQuery(parseSearchQuery("model")), "('model':*)");
  assert.deepEqual(parseSearchQuery("balatası").terms[0].alternatives.map(a => a.value), ["balatasi", "balata"]);
  assert.deepEqual(parseSearchQuery("kapağı").terms[0].alternatives.map(a => a.value), ["kapagi", "kapag", "kapak"]);
  assert.equal(parseSearchQuery("%_\\").terms.length, 0);
});

test("vehicle search matches words, not letters inside codes", async () => {
  const tesla = await searchVehicleCatalog("tesla model y");
  assert.ok(tesla.total > 0);
  assert.ok(tesla.vehicles.every(v => v.make === "TESLA" && v.model.startsWith("MODEL Y")), "Model S/X leaked in via (5YJS)/(5YJX)");
  const golf = await searchVehicleCatalog("vw golf 7 dizel");
  assert.match(golf.vehicles[0].model, /^GOLF VII \(/);
  assert.ok(golf.vehicles.every(v => v.model.includes("VII") && v.fuel.includes("Dizel")));
  const year = await searchVehicleCatalog("passat 2015");
  assert.ok(year.total > 0 && year.vehicles.every(v => v.from <= 2015 && v.to >= 2015 && v.model.startsWith("PASSAT")));
  assert.ok((await searchVehicleCatalog("fiat egea")).vehicles.every(v => v.model.startsWith("TIPO")));
});

test("vehicle search corrects typos only when nothing matched", async () => {
  const typo = await searchVehicleCatalog("volksvagen pasat");
  assert.equal(typo.correctedQuery, "volkswagen passat");
  assert.ok(typo.total > 0 && typo.vehicles.every(v => v.make === "VOLKSWAGEN" && v.model.startsWith("PASSAT")));
  assert.equal((await searchVehicleCatalog("volkswagen passat")).correctedQuery, undefined);
  assert.equal((await searchVehicleCatalog("qqqzzzxxx")).total, 0);
});

test("product search: Turkish letters, several words, part numbers with any spacing", async () => {
  const oil = await browseProducts({ q: "yağ filtresi" });
  assert.ok(oil.total > 0);
  assert.ok(oil.items.slice(0, 10).every(p => normalizeSearchText(p.name).includes("yag filtre")));
  const sample = (await db.query<{ code: string }>(`SELECT code FROM commerce_supplier_items
    WHERE code ~ '^[A-Z]+ [0-9]{6,}$' ORDER BY code LIMIT 1`)).rows[0];
  if (sample) {
    const digits = sample.code.split(" ")[1];
    const spaced = `${digits.slice(0, 2)} ${digits.slice(2, 4)}-${digits.slice(4)}`;
    const byCode = await browseProducts({ q: spaced, searchBy: "code" });
    assert.equal(byCode.items[0]?.code, sample.code, `exact part number ranks first for "${spaced}"`);
  }
});

test("product search names a part and a vehicle: parts linked to the vehicle, else every part", async () => {
  const sample = (await db.query<{ id: string; name: string; model: string }>(`SELECT f.supplier_item_id::text AS id,
    i.product_data->>'ac' AS name, split_part(m.name, ' ', 1) AS model FROM product_vehicle_fitments f
    JOIN supplier_items i ON i.id=f.supplier_item_id JOIN vehicle_types v ON v.id=f.vehicle_type_id JOIN vehicle_models m ON m.id=v.model_id
    WHERE i.product_data->>'ac' ~ '^[A-Z]+ [A-Z]+$' AND split_part(m.name, ' ', 1) ~ '^[A-Z]{4,}$' ORDER BY 1 LIMIT 1`)).rows[0];
  if (sample) {
    const linked = await browseProducts({ q: `${sample.name} ${sample.model}` });
    assert.equal(linked.vehicleScope?.fitted, true, `${sample.name} ${sample.model}`);
    assert.ok(linked.items.some(item => item.id === sample.id));
    const reversed = await browseProducts({ q: `${sample.model} ${sample.name}` });
    assert.deepEqual(reversed.items.map(i => i.id).sort(), linked.items.map(i => i.id).sort());
  }
  const unlinked = await browseProducts({ q: "yağ filtresi qqzzvehicle" });
  assert.equal(unlinked.vehicleScope, undefined);
  // "hava" only starts a make (HAVAL): the typo is corrected instead of read as a vehicle.
  const typo = await browseProducts({ q: "hava fiiltresi" });
  assert.equal(typo.vehicleScope, undefined);
  assert.equal(typo.correctedQuery, "hava filtresi");
  assert.equal((await browseProducts({ q: "yağ filtresi" })).vehicleScope, undefined);
});

test("searches need at least two letters or digits", async () => {
  assert.equal((await searchVehicleCatalog("y")).total, 0);
  assert.ok((await searchVehicleCatalog("x5")).total > 0);
  const single = await browseProducts({ q: "a" });
  assert.equal(single.searchTooShort, true);
  assert.equal(single.total, 0);
  assert.equal((await browseProducts({ q: "yağ" })).searchTooShort, undefined);
});

test("type-ahead suggests the best distinct products, words before code fragments", async () => {
  const oil = await suggestProducts("yag", "all");
  assert.ok(oil.products.length > 0 && oil.products.length <= 6);
  assert.ok(oil.products.every(p => normalizeSearchText(p.name).split(" ").some(word => word.startsWith("yag") || word.startsWith("oil"))), "a code containing YAG outranked names");
  assert.equal(new Set(oil.products.map(p => `${p.name}|${p.brand}`)).size, oil.products.length);
  assert.equal((await suggestProducts("a", "all")).products.length, 0);
  assert.equal((await suggestProducts("fren balatası passat", "all")).vehicleScope?.vehicleText, "passat");
});
