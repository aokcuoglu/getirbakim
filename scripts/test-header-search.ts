import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addRecentSearch, clearRecentSearches, parseRecentSearches, readRecentSearches, saveRecentSearch } from "../src/components/navigation/recent-searches";
import { shownProductName } from "../src/modules/store/product-name";
import { normalizeSearchText, parseSearchQuery, phraseKey, prefixTsQuery } from "../src/modules/search/query";
import { typeNameExactQueries, typeNamePrefixQuery, typeNameRankBoosts, typeNameTsQueries } from "../src/modules/search/type-names";
import { mergeNameSuggestions } from "../src/modules/store/name-suggestions";
import { searchPath } from "../src/modules/seo/paths";
import { isEnglishTypeName, turkishTypeName, typeNameEntries } from "../src/modules/store/suggestion-names";

test("known English type names get a Turkish name", () => {
  assert.equal(turkishTypeName("BRAKE PAD SET, DISC BRAKE"), "Disk Fren Balata Seti");
  assert.equal(turkishTypeName("FREN DISKI"), undefined);
});

test("single English words translate, unclear ones are dropped as English", () => {
  const pairs: [string, string][] = [["COVER", "Kapak"], ["PIPE", "Boru"], ["MIRROR", "Ayna"], ["HOUSING", "Gövde"], ["NUT", "Somun"], ["SPRING", "Yay"], ["BOLT", "Cıvata"], ["TENSIONER", "Gergi"], ["RADIATOR", "Radyatör"], ["PLUG", "Tapa"]];
  for (const [raw, turkish] of pairs) assert.equal(turkishTypeName(raw), turkish, raw);
  const added: [string, string][] = [["O-RING", "O-Ring Conta"], ["O  RING", "O-Ring Conta"], ["SWITCH", "Şalter"], ["CONTR ARM", "Salıncak"], ["TAIL-LIGHT", "Stop Lambası"], ["BOLT, BRAKE DISC", "Fren Diski Cıvatası"], ["BRACKET", "Braket"]];
  for (const [raw, turkish] of added) assert.equal(turkishTypeName(raw), turkish, raw);
  const corrected: [string, string][] = [["WHEEL", "Jant"], ["FRONT LIGHT", "Far"], ["TIE ROD", "Rot"], ["SIDE MARKER LIGHT", "Yan İşaret Lambası"], ["SHAFT", "Mil"]];
  for (const [raw, turkish] of corrected) assert.equal(turkishTypeName(raw), turkish, raw);
  assert.equal(turkishTypeName("LINK"), undefined);
  assert.equal(isEnglishTypeName("LINK"), true);
});

test("names whose matches are different parts stay untranslated: readable on the store, hidden from name suggestions (#915)", () => {
  for (const raw of ["SEAL", "JOINT", "ROD", "CABLE"]) {
    assert.equal(turkishTypeName(raw), undefined, raw);
    assert.equal(isEnglishTypeName(raw), true, raw);
    assert.equal(shownProductName({ name: raw, name_overridden: false }), raw[0] + raw.slice(1).toLowerCase(), raw);
  }
});

test("Turkish type names add the English supplier name to the search (#953)", () => {
  const queries = (q: string) => typeNameTsQueries(parseSearchQuery(q));
  assert.deepEqual(queries("fren diski"), ["('brake' <-> 'disc')"]);
  assert.deepEqual(queries("Fren Diskleri Bosch"), ["('brake' <-> 'disc') & ('bosch':*)"]);
  assert.deepEqual(queries("hortum"), ["('hose')"]);
  const [arm] = queries("salıncak");
  for (const name of ["'contr' <-> 'arm'", "'control' <-> 'arm'", "'track' <-> 'control' <-> 'arm'"]) assert.ok(arm.includes(name), name);
  assert.deepEqual(queries("kapak"), ["('cover')"]);
  // Ambiguous English words, names English shares with Turkish, words already translated by a synonym, codes.
  for (const q of ["jant", "yay", "tapa", "kol", "sensör", "kayış", "filtre", "5W-40"]) assert.deepEqual(queries(q), [], q);
  const skipped = new Set(["cap", "arm", "spring", "plug", "wheel"]);
  for (const [english, turkish] of typeNameEntries()) {
    const parsed = parseSearchQuery(turkish);
    if (skipped.has(english) || english === normalizeSearchText(turkish)) continue;
    if (parsed.terms.length === 1 && parsed.terms[0].alternatives.some(alternative => alternative.value === english)) continue;
    const phrase = english.split(" ").map(word => `'${word}'`).join(" <-> ");
    assert.ok(typeNameTsQueries(parsed).some(query => query.includes(phrase)), `${turkish} → ${english}`);
  }
  assert.equal(prefixTsQuery(parseSearchQuery("fren diski")), "('fren':* | 'brake':*) & ('diski':* | 'disk':*)");
});

test("ambiguous single-word type names match only the whole supplier name (#963)", () => {
  const exact = (q: string) => typeNameExactQueries(parseSearchQuery(q));
  assert.deepEqual(exact("kapak"), [{ names: ["cap"], query: "('cap')" }]);
  assert.deepEqual(exact("Jant"), [{ names: ["wheel"], query: "('wheel')" }]);
  assert.deepEqual(exact("yay"), [{ names: ["spring"], query: "('spring')" }]);
  assert.deepEqual(exact("tapa"), [{ names: ["plug"], query: "('plug')" }]);
  assert.deepEqual(exact("kol"), [{ names: ["arm"], query: "('arm')" }]);
  assert.deepEqual(exact("kapak bosch"), [{ names: ["cap"], query: "('cap') & ('bosch':*)" }]);
  // Not an ambiguous word, a longer name, or a code.
  for (const q of ["fren diski", "hortum", "salıncak", "5W-40", ""]) assert.deepEqual(exact(q), [], q);
  // The word-level expansion still leaves them out: "kapak" adds COVER only.
  assert.deepEqual(typeNameTsQueries(parseSearchQuery("kapak")), ["('cover')"]);
});

test("suffixed Turkish type names reach the dictionary (#969)", () => {
  const queries = (q: string) => typeNameTsQueries(parseSearchQuery(q));
  assert.deepEqual(queries("kapağı"), ["('cover')"]);
  assert.deepEqual(queries("camı"), ["('glass')"]);
  assert.deepEqual(queries("mili"), ["('shaft')"]);
  assert.deepEqual(queries("farı"), ["('front' <-> 'light')"]);
  assert.deepEqual(queries("motor kapağı"), ["('cover') & ('motor':*)"]);
  assert.deepEqual(queries("kapı camı"), ["('door') & ('cami':*)", "('glass') & ('kapi':*)"]);
  assert.deepEqual(queries("kapak"), ["('cover')"]);
  const exact = (q: string) => typeNameExactQueries(parseSearchQuery(q)).map(match => match.names);
  assert.deepEqual(exact("kolu"), [["arm"]]);
  assert.deepEqual(exact("yayı"), [["spring"]]);
  assert.deepEqual(exact("kapağı"), [["cap"]]);
  // Short roots follow vowel harmony: "kolu" is Kol (arm), "koli" (a parcel) is not.
  for (const q of ["kolu", "camı", "mili", "farı", "rotu", "yayı", "kapağı", "kayışı", "susturucusu", "salıncağı"])
    assert.ok(queries(q).length + exact(q).length > 0, q);
  // Three letters stay of a query word, but no name is "kap".
  for (const q of ["kap", "kabı", "koli"]) {
    assert.deepEqual(queries(q), [], q);
    assert.deepEqual(exact(q), [], q);
  }
});

test("every Turkish name still matches the query words it matched by key (#969)", () => {
  const skipped = new Set(["cap", "arm", "spring", "plug", "wheel"]);
  for (const [name, turkish] of typeNameEntries()) {
    const english = normalizeSearchText(name);
    if (english === normalizeSearchText(turkish)) continue;
    // The stemmed key of each word (what the key-equality lookup compared) as the query.
    const parsed = parseSearchQuery(normalizeSearchText(turkish).split(" ").map(word => phraseKey([word])).join(" "));
    if (skipped.has(english)) {
      assert.ok(typeNameExactQueries(parsed).some(match => match.names.includes(english)), `${turkish} → ${english}`);
      continue;
    }
    if (parsed.terms.length === 1 && parsed.terms[0].alternatives.some(alternative => alternative.value === english)) continue;
    const phrase = english.split(" ").map(word => `'${word}'`).join(" <-> ");
    assert.ok(typeNameTsQueries(parsed).some(query => query.includes(phrase)), `${turkish} → ${english}`);
  }
});

test("rows found by their English name rank as the typed Turkish name (#969)", () => {
  const boosts = (q: string) => typeNameRankBoosts(parseSearchQuery(q));
  assert.deepEqual(boosts("fren diski"), [{ query: "('brake':A <-> 'disc':A)", english: ["brake", "disc"], turkish: "fren diski" }]);
  assert.deepEqual(boosts("kapak"), [
    { query: "('cover':A)", english: ["cover"], turkish: "kapak" },
    { query: "('cap':A)", english: ["cap"], turkish: "kapak", names: ["cap"] },
  ]);
  assert.deepEqual(boosts("fren"), []);
  assert.deepEqual(boosts("5W-40"), []);
});

test("dictionary English keys are plain words, safe inside a quoted tsquery (#953)", () => {
  for (const [english] of typeNameEntries()) assert.match(normalizeSearchText(english), /^[a-z0-9]+( [a-z0-9]+)*$/, english);
});

test("plainly English names are recognised, shared words alone are not", () => {
  assert.equal(isEnglishTypeName("SWITCH"), true);
  assert.equal(isEnglishTypeName("WHEEL"), true);
  for (const name of ["SENSOR MESNEDI", "RULMANLI KIT", "YAG FILTRESI"]) assert.equal(isEnglishTypeName(name), false, name);
});

test("parseRecentSearches drops what is malformed", () => {
  assert.deepEqual(parseRecentSearches(null), []);
  assert.deepEqual(parseRecentSearches("{bozuk"), []);
  assert.deepEqual(parseRecentSearches('{"q":"fren"}'), []);
  assert.deepEqual(parseRecentSearches(JSON.stringify([{ q: "x".repeat(121), mode: "all" }, { q: "a", mode: "all" }, { q: "fren", mode: "x" }, 5, null])), []);
  assert.deepEqual(parseRecentSearches(JSON.stringify([{ q: "fren balata", mode: "all" }])), [{ q: "fren balata", mode: "all" }]);
});

test("addRecentSearch moves repeats first, keeps five, separates modes", () => {
  let list = addRecentSearch([], "Fren", "all");
  list = addRecentSearch(list, "yağ", "all");
  list = addRecentSearch(list, "FREN", "all");
  assert.deepEqual(list.map(item => item.q), ["FREN", "yağ"]);
  list = addRecentSearch(list, "fren", "code");
  assert.equal(list.length, 3);
  for (const q of ["aa1", "bb2", "cc3", "dd4"]) list = addRecentSearch(list, q, "all");
  assert.equal(list.length, 5);
  assert.equal(list[0].q, "dd4");
});

test("storage that throws never throws out", () => {
  const broken = { getItem() { throw new Error("x"); }, setItem() { throw new Error("x"); }, removeItem() { throw new Error("x"); } } as unknown as Storage;
  assert.deepEqual(readRecentSearches(broken), []);
  assert.doesNotThrow(() => saveRecentSearch("fren", "all", broken));
  assert.doesNotThrow(() => clearRecentSearches(broken));
});

test("recent searches round-trip through storage", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } as unknown as Storage;
  saveRecentSearch("fren balata", "all", storage);
  assert.deepEqual(readRecentSearches(storage), [{ q: "fren balata", mode: "all" }]);
  clearRecentSearches(storage);
  assert.deepEqual(readRecentSearches(storage), []);
});

test("the 16px rule is unlayered, last and scoped away from /yonetim", () => {
  const css = readFileSync("src/app/storefront.css", "utf8");
  const rule = css.indexOf("html:not(:has(.admin-app))");
  assert.ok(rule > 0 && css.slice(rule).includes("font-size: 16px"));
  assert.ok(rule > css.lastIndexOf("@layer components"));
  assert.ok(rule > css.indexOf("\n}\n", css.indexOf("@layer components")));
});

test("the type-ahead finds the English names a Turkish prefix begins (#962)", () => {
  const prefix = (q: string) => typeNamePrefixQuery(parseSearchQuery(q));
  const hose = prefix("fren hor");
  assert.ok(hose?.names.includes("brake hose"));
  assert.ok(hose?.query.includes("'brake' <-> 'hose'"));
  assert.ok(prefix("fren ana")?.names.includes("brake master cylinder"));
  assert.ok((prefix("fren")?.names.length ?? 0) > 1 && prefix("fren")!.names.length <= 12);
  assert.equal(typeNamePrefixQuery(parseSearchQuery("fren"), 3)?.names.length, 3);
  assert.ok(prefix("hortumu")?.names.includes("hose"));
  assert.ok(prefix("kapa")?.names.some(name => name === "cap" || name === "cover"));
  assert.equal(prefix("5w-40"), null);
  assert.equal(prefix("zzzqq"), null);
  for (const q of ["fren hor", "fren", "hortumu", "kapa", "disk fren"]) assert.match(prefix(q)?.query ?? "", /^[a-z0-9' |()<>-]*$/, q);
});

test("name suggestions of both spellings add up under the Turkish label (#962)", () => {
  const merged = mergeNameSuggestions([{ name: "BRAKE HOSE", products: 220 }, { name: "FREN HORTUMU", products: 1000 }, { name: "LINK", products: 5000 }], 6);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Fren Hortumu");
  assert.equal(merged[0].detail, `${(1220).toLocaleString("tr-TR")} ürün`);
  assert.equal(merged[0].href, searchPath({ q: "fren hortumu" }));
  assert.equal(mergeNameSuggestions([{ name: "BRAKE HOSE", products: 220 }], 6)[0].href, searchPath({ q: "fren hortumu" }));
});
