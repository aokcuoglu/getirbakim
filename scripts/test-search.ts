import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/lib/db";
import { compactSearchCode, exactTsQuery, normalizeSearchText, parseSearchQuery, prefixTsQuery } from "../src/modules/search/query";
import { binder, storedRank, supplierItemMatch } from "../src/modules/search/sql";
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
  assert.equal(prefixTsQuery(golf), "('vw':* | 'volkswagen':*) & ('golf':*) & ('7' | 'vii') & ('dizel':* | 'diesel':* | 'mazot':* | 'motorin':*)");
  assert.equal(parseSearchQuery("golf 2015").terms.at(-1)?.text, "2015");
  const tesla = parseSearchQuery("tesla model y");
  assert.equal(prefixTsQuery(tesla), "('tesla':*) & ('y':*)");
  assert.equal(exactTsQuery(tesla), "'tesla' | 'model' | 'y'");
  assert.equal(prefixTsQuery(parseSearchQuery("model")), "('model':*)");
  assert.deepEqual(parseSearchQuery("balatası").terms[0].alternatives.filter(a => !a.synonym).map(a => a.value), ["balatasi", "balata"]);
  assert.ok(parseSearchQuery("balatası").terms[0].alternatives.some(a => a.value === "pad"), "a suffixed word keeps its synonyms");
  assert.deepEqual(parseSearchQuery("kapağı").terms[0].alternatives.map(a => a.value), ["kapagi", "kapag", "kapak"]);
  assert.equal(parseSearchQuery("%_\\").terms.length, 0);
});

test("parser: codes match joined, spaced or hyphenated (5W40 = 5W-40 = 5w 40)", () => {
  const joined = prefixTsQuery(parseSearchQuery("5W40"));
  assert.equal(joined, "('5w40':* | '5' <-> 'w40':* | '5w' <-> '40':* | '5' <-> 'w' <-> '40':*)");
  for (const typed of ["5W-40", "5w 40", "5W/40", "5W40"]) {
    const parsed = parseSearchQuery(`motul ${typed}`);
    assert.equal(parsed.terms.length, 2, typed);
    assert.deepEqual(new Set(parsed.terms[1].alternatives.map(a => a.value)), new Set(["5w40", "5 w40", "5w 40", "5 w 40"]), typed);
  }
  assert.deepEqual(parseSearchQuery("C-200").terms[0].alternatives.map(a => a.value), ["c 200", "c200"]);
  assert.deepEqual(parseSearchQuery("320d").terms[0].alternatives.map(a => a.value), ["320d", "320 d"]);
  // Plain words and decimals keep their own terms.
  assert.equal(parseSearchQuery("ön-arka").terms.length, 2);
  assert.equal(parseSearchQuery("golf 7 2015").terms.length, 3);
  assert.equal(parseSearchQuery("1,6 16v").terms[0].text, "1.6");
});

test("product search: viscosity grades match with any separator", async () => {
  const counts = await Promise.all(["5W40", "5W-40", "5w 40"].map(async q => {
    const values: unknown[] = [];
    const sql = `SELECT count(*)::int AS n FROM supplier_items s WHERE ${supplierItemMatch("s", parseSearchQuery(q), binder(values))}`;
    return (await db.query<{ n: number }>(sql, values)).rows[0].n;
  }));
  assert.equal(new Set(counts).size, 1, `5W40/5W-40/5w 40 differ: ${counts}`);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM supplier_items
    WHERE product_data->>'ac' ~* '\\m5 ?W[- /]?40'`);
  assert.ok(counts[0] >= rows[0].n, `${counts[0]} < ${rows[0].n} rows naming 5W-40`);
  // "5w40" inside a "15W40" code is another grade: it must not outrank the 5W-40 oils.
  const top = (await browseProducts({ q: "5W-40" })).items.slice(0, 10);
  assert.ok(top.every(p => !/15 ?w[- ]?40/i.test(`${p.code} ${p.name}`)), top.map(p => p.code).join(", "));
});

test("parser: synonym phrases read as one term, both ways", () => {
  assert.equal(prefixTsQuery(parseSearchQuery("soğutma sıvısı")), "(('sogutma':* & 'sivi':*) | 'antifriz':*)");
  assert.equal(prefixTsQuery(parseSearchQuery("antifriz")), "('antifriz':* | ('sogutma':* & 'sivi':*))");
  assert.equal(parseSearchQuery("motul soğutma sıvısı 5 lt").terms.length, 4);
  // A word in two groups gets both: "yakıt filtresi" covers diesel and petrol filters, "benzin filtresi" not diesel ones.
  const fuel = prefixTsQuery(parseSearchQuery("yakıt filtresi"))!;
  assert.ok(fuel.includes("'mazot':*") && fuel.includes("'benzin':*"), fuel);
  assert.ok(!prefixTsQuery(parseSearchQuery("benzin filtresi"))!.includes("mazot"));
  assert.ok(prefixTsQuery(parseSearchQuery("eksoz"))!.includes("'egzoz':*"));
  // Words outside a known phrase stay separate terms.
  assert.equal(parseSearchQuery("soğutma fanı").terms.length, 2);
});

test("parser: a final k/p/t also finds its softened suffixed forms", () => {
  for (const [word, softened] of [["kasnak", "kasnag"], ["mesnet", "mesned"], ["destek", "desteg"], ["plastik", "plastig"]])
    assert.ok(parseSearchQuery(word).terms[0].alternatives.some(a => a.value === softened && a.prefix), word);
  // Short words and consonant pairs keep their spelling ("stop", "egzost").
  for (const word of ["stop", "egzost", "kit"]) assert.equal(parseSearchQuery(word).terms[0].alternatives.filter(a => !a.synonym).length, 1, word);
  // Reviewed AI groups (#846).
  assert.ok(prefixTsQuery(parseSearchQuery("orjinal"))!.includes("'orijinal':*"));
  assert.ok(prefixTsQuery(parseSearchQuery("egzost"))!.includes("'egzoz':*"));
});

test("product search: synonyms widen the hits to every spelling", async () => {
  const count = async (q: string) => {
    const values: unknown[] = [];
    return (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM supplier_items s WHERE ${supplierItemMatch("s", parseSearchQuery(q), binder(values))}`, values)).rows[0].n;
  };
  const [eksoz, egzoz, egsoz] = await Promise.all(["eksoz", "egzoz", "egsoz"].map(count));
  assert.ok(eksoz > 0 && eksoz === egzoz && egzoz === egsoz, `${eksoz}/${egzoz}/${egsoz}`);
  assert.equal(await count("soğutma sıvısı"), await count("antifriz"));
  // "kasnak" finds the "KASNAĞI" names too.
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM supplier_items WHERE product_data->>'ac' ~* '\\mKASNA(Ğ|G)I'");
  if (rows[0].n) assert.ok(await count("kasnak") >= rows[0].n);
});

test("product search: Turkish type names also find the English supplier names (#953)", async () => {
  const text = "to_tsvector('simple', supplier_item_search_text(s.code, s.product_data)) @@ to_tsquery('simple', $1)";
  const count = async (where: string, values: unknown[]) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM supplier_items s WHERE ${where}`, values)).rows[0].n;
  for (const [q, english] of [["fren diski", "'brake' <-> 'disc'"], ["fren hortumu", "'brake' <-> 'hose'"]]) {
    const parsed = parseSearchQuery(q);
    const englishRows = await count(text, [english]);
    if (!englishRows) continue;
    const values: unknown[] = [];
    const expanded = await count(supplierItemMatch("s", parsed, binder(values)), values);
    // Without the expansion: the part number or every word as typed (with its synonyms).
    const before: unknown[] = [prefixTsQuery(parsed)];
    const withoutExpansion = await count(`(${text} OR ${supplierItemMatch("s", parsed, binder(before), "code")})`, before);
    const either: unknown[] = [prefixTsQuery(parsed), `(${english})`];
    const union = await count(`(${text} OR ${text.replace("$1", "$2")} OR ${supplierItemMatch("s", parsed, binder(either), "code")})`, either);
    assert.ok(expanded >= withoutExpansion && expanded >= englishRows, `${q}: ${expanded} vs ${withoutExpansion} + ${englishRows}`);
    assert.equal(expanded, union, q);
  }
  assert.ok(!supplierItemMatch("s", parseSearchQuery("fren diski"), binder([]), "code").includes("<->"));
});

test("product search: ambiguous Turkish type names add only the exact English names (#963)", async () => {
  const name = "search_normalize(s.product_data->>'ac')";
  const text = "to_tsvector('simple', supplier_item_search_text(s.code, s.product_data))";
  for (const [q, english] of [["kapak", "cap"], ["jant", "wheel"], ["yay", "spring"], ["tapa", "plug"], ["kol", "arm"]]) {
    const values: unknown[] = [];
    const match = supplierItemMatch("s", parseSearchQuery(q), binder(values));
    // The exact clause comes last, so the match without it reads only the leading parameters.
    const withoutExact = match.replace(/ OR s\.id = ANY\(ARRAY\([^]*\)\)\)\)$/, ")");
    assert.notEqual(withoutExact, match, q);
    const added = await db.query<{ name: string }>(`SELECT DISTINCT ${name} AS name FROM supplier_items s WHERE ${match} AND NOT ${withoutExact}`, values);
    // Every added row is named exactly the word: no ÇAP, CAP 276, ARM engine code, R9 SPRING, PLUG-IN or WHEEL BRAKE CYLINDER.
    for (const row of added.rows) assert.equal(row.name, english, `${q}: ${row.name}`);
    const named = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM supplier_items s
      WHERE ${text} @@ to_tsquery('simple', $1) AND ${name} = $1`, [english]);
    const found = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM supplier_items s WHERE ${match} AND ${name} = $${values.length + 1}`,
      [...values, english]);
    assert.equal(found.rows[0].n, named.rows[0].n, q);
  }
  assert.ok(!supplierItemMatch("s", parseSearchQuery("kapak"), binder([]), "code").includes("ARRAY"));
});

test("product search: suffixed Turkish type names find the English supplier names too (#969)", async () => {
  const text = "to_tsvector('simple', supplier_item_search_text(s.code, s.product_data))";
  const count = async (where: string, values: unknown[]) =>
    (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM supplier_items s WHERE ${where}`, values)).rows[0].n;
  const matches = (q: string) => { const values: unknown[] = []; return count(supplierItemMatch("s", parseSearchQuery(q), binder(values)), values); };
  assert.ok(await matches("kapağı") >= await matches("kapak"), "kapağı ⊇ kapak");
  assert.ok(await matches("camı") >= await count(`${text} @@ to_tsquery('simple', $1)`, ["glass"]), "camı finds GLASS");
  for (const q of ["motor kapağı", "kapı camı"]) {
    const prefixOnly = await count(`${text} @@ to_tsquery('simple', $1)`, [prefixTsQuery(parseSearchQuery(q))]);
    assert.ok(await matches(q) >= prefixOnly, q);
  }
});

test("product search: rows named in English rank like the same row named in Turkish (#969)", async () => {
  for (const [q, english, turkish] of [["fren diski", "brake disc", "FREN DISKI"], ["fren hortumu", "brake hose", "FREN HORTUMU"]]) {
    const parsed = parseSearchQuery(q);
    const values: unknown[] = [english, turkish];
    const bind = binder(values);
    const queries = `to_tsquery('simple', ${bind(prefixTsQuery(parsed))}::text), to_tsquery('simple', ${bind(exactTsQuery(parsed))}::text), ${bind(parsed.compact)}::text`;
    const { rows } = await db.query<{ base: number; swapped: number; named: number }>(`SELECT
        catalog_search_rank_doc(s.search_doc, s.search_code, s.search_oem, ${queries}) AS base,
        ${storedRank("s", parsed, bind, queries)} AS swapped,
        catalog_search_rank_doc(catalog_search_doc($2, COALESCE(NULLIF(s.product_data->>'uk', ''), 'Belirtilmemiş'), s.code,
          COALESCE(s.product_data->>'oe', ''), COALESCE(s.product_data->>'ac2', '')), s.search_code, s.search_oem, ${queries}) AS named
      FROM supplier_items s WHERE to_tsvector('simple', supplier_item_search_text(s.code, s.product_data)) @@ phraseto_tsquery('simple', $1)
        AND s.search_doc IS NOT NULL AND search_normalize(s.product_data->>'ac') = $1 LIMIT 200`, values);
    assert.ok(rows.length, q);
    for (const row of rows) {
      assert.ok(row.swapped >= row.base, `${q}: ${row.swapped} < ${row.base}`);
      assert.ok(row.swapped >= row.named - 1e-6, `${q}: ${row.swapped} < ${row.named}`);
    }
  }
  // Without a Turkish type name the rank stays the stored one.
  assert.equal(storedRank("s", parseSearchQuery("bosch"), binder([]), "q"), "catalog_search_rank_doc(s.search_doc, s.search_code, s.search_oem, q)");
});

test("product search: two type-name windows find and rank the row named after both (#989)", async () => {
  // A made-up row, so the test does not depend on a supplier listing DOOR GLASS.
  const row = `(SELECT gen_random_uuid() AS id, 'X989'::text AS code, '{"ac":"DOOR GLASS","uk":"TEST"}'::jsonb AS product_data,
    catalog_search_doc($1, 'TEST', 'X989', '', '') AS search_doc, search_compact('X989') AS search_code, ''::text AS search_oem) s`;
  const parsed = parseSearchQuery("kapı camı");
  const found: unknown[] = ["DOOR GLASS"];
  const { rows: [{ n }] } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${row} WHERE ${supplierItemMatch("s", parsed, binder(found))}`, found);
  assert.equal(n, 1);
  const values: unknown[] = ["DOOR GLASS"];
  const bind = binder(values);
  const queries = `to_tsquery('simple', ${bind(prefixTsQuery(parsed))}::text), to_tsquery('simple', ${bind(exactTsQuery(parsed))}::text), ${bind(parsed.compact)}::text`;
  const { rows: [rank] } = await db.query<{ base: number; swapped: number; named: number }>(`SELECT
      catalog_search_rank_doc(s.search_doc, s.search_code, s.search_oem, ${queries}) AS base,
      ${storedRank("s", parsed, bind, queries)} AS swapped,
      catalog_search_rank_doc(catalog_search_doc('KAPI CAMI', 'TEST', 'X989', '', ''), s.search_code, s.search_oem, ${queries}) AS named
    FROM ${row}`, values);
  assert.ok(rank.swapped >= rank.base, `${rank.swapped} < ${rank.base}`);
  assert.ok(rank.swapped >= rank.named - 1e-6, `${rank.swapped} < ${rank.named}`);
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
  // Broad: product names, most shared first.
  const oil = await suggestProducts("yag", "all");
  assert.ok(oil.products.length > 0 && oil.products.length <= 12 && oil.products.every(p => p.kind === "name"));
  assert.ok(oil.products.every(p => normalizeSearchText(p.name).split(" ").some(word => word.startsWith("yag") || word.startsWith("oil"))));
  const shared = oil.products.map(p => p.kind === "name" ? p.products : 0);
  assert.deepEqual(shared, [...shared].sort((a, b) => b - a));
  // Narrow: distinct products, a code containing YAG does not outrank names.
  const pump = await suggestProducts("yag pompa zincir seti", "all");
  assert.ok(pump.products.length > 0 && pump.products.every(p => p.kind === "product" && normalizeSearchText(p.name).includes("yag")));
  assert.equal(new Set(pump.products.map(p => p.kind === "product" ? `${p.name}|${p.brand}` : p.name)).size, pump.products.length);
  assert.equal((await suggestProducts("a", "all")).products.length, 0);
  assert.equal((await suggestProducts("fren balatası passat", "all")).vehicleScope?.vehicleText, "passat");
});

test("type-ahead suggests the Turkish name of English-named products (#962)", async () => {
  const hose = await suggestProducts("fren hor", "all");
  assert.ok(hose.products.some(p => p.kind === "name" && p.name === "BRAKE HOSE"));
  // Even when the Turkish words rank nothing, the English names are still suggested.
  const master = await suggestProducts("fren ana", "all");
  assert.ok(master.products.some(p => p.kind === "name" && p.name.startsWith("BRAKE MASTER CYLINDER")));
  // Code mode searches codes: no type names are suggested.
  assert.ok((await suggestProducts("fren", "code")).products.every(p => p.kind !== "name"));
});
