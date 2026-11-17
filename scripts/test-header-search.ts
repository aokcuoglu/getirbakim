import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { addRecentSearch, clearRecentSearches, parseRecentSearches, readRecentSearches, saveRecentSearch } from "../src/components/navigation/recent-searches";
import { isEnglishTypeName, turkishTypeName } from "../src/modules/store/suggestion-names";

test("known English type names get a Turkish name", () => {
  assert.equal(turkishTypeName("BRAKE PAD SET, DISC BRAKE"), "Disk Fren Balata Seti");
  assert.equal(turkishTypeName("FREN DISKI"), undefined);
});

test("single English words translate, unclear ones are dropped as English", () => {
  const pairs: [string, string][] = [["COVER", "Kapak"], ["PIPE", "Boru"], ["SEAL", "Keçe"], ["MIRROR", "Ayna"], ["HOUSING", "Gövde"], ["NUT", "Somun"], ["SPRING", "Yay"], ["BOLT", "Cıvata"], ["TENSIONER", "Gergi"], ["RADIATOR", "Radyatör"], ["JOINT", "Mafsal"], ["PLUG", "Tapa"]];
  for (const [raw, turkish] of pairs) assert.equal(turkishTypeName(raw), turkish, raw);
  assert.equal(turkishTypeName("LINK"), undefined);
  assert.equal(isEnglishTypeName("LINK"), true);
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
