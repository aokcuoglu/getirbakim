import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { parseSearchQuery, setCustomSynonymGroups } from "../src/modules/search/query";

// Search statistics and admin synonyms (#822) in an isolated copy of the schema.
let schema: Awaited<ReturnType<typeof isolatedSchema>>;
let analytics: typeof import("../src/modules/search/analytics");
let custom: typeof import("../src/modules/search/custom-synonyms");
let epoch: typeof import("../src/modules/store/listing-epoch");
let closeDb: () => Promise<void>;
let adminId = "";

before(async () => {
  schema = await isolatedSchema("search_analytics_test");
  adminId = (await schema.pool.query<{ id: string }>("INSERT INTO accounts(name,email,password_hash,role,approved) VALUES('Test','admin@example.invalid','x','admin',true) RETURNING id::text")).rows[0].id;
  const [{ db }, a, c, e] = await Promise.all([import("../src/lib/db"), import("../src/modules/search/analytics"), import("../src/modules/search/custom-synonyms"), import("../src/modules/store/listing-epoch")]);
  analytics = a; custom = c; epoch = e;
  closeDb = () => db.end();
});
after(async () => { setCustomSynonymGroups([]); await closeDb?.(); await schema?.drop(); });

test("searches are counted per day, mode and normalized query; zero-result queries drop out once they find something", async () => {
  await analytics.recordSearch({ query: "Soğutma Sıvısı", mode: "all", total: 0 });
  await analytics.recordSearch({ query: "soğutma  sıvısı", mode: "all", total: 0 });
  await analytics.recordSearch({ query: "W712", mode: "code", total: 4 });
  await analytics.recordSearch({ query: "x", mode: "all", total: 0 });
  await analytics.recordSearch({ query: "fren balatsı", mode: "all", total: 12, correctedQuery: "fren balatası" });
  const zero = await analytics.loadSearchStats("zero", 30);
  assert.deepEqual(zero.map(row => [row.query, row.searches, row.zero_results]), [["sogutma sivisi", 2, 2]]);
  const top = await analytics.loadSearchStats("top", 30);
  assert.equal(top.length, 3, "a too-short query is not counted");
  assert.equal(top.find(row => row.query === "fren balatsi")?.corrected_query, "fren balatasi");
  await analytics.recordSearch({ query: "soğutma sıvısı", mode: "all", total: 9 });
  assert.equal((await analytics.loadSearchStats("zero", 30)).length, 0);
  assert.deepEqual(await analytics.loadSearchTotals(30), { searches: 5, zero_results: 2, queries: 3 });
});

test("synonym input is normalized and deduplicated", () => {
  assert.deepEqual(analytics.parseSynonymInput("Antifriz, SOĞUTMA sıvısı;antifriz\n a, bir iki üç dört beş"), ["antifriz", "sogutma sivisi", "bir iki uc dort"]);
});

test("an admin group reaches the parser after the edit, and leaves it when deleted", async () => {
  const alternatives = () => parseSearchQuery("zzqfoo").terms[0].alternatives.map(a => a.value);
  await custom.ensureCustomSynonyms();
  assert.ok(!alternatives().includes("zzqbar"));
  await analytics.addCustomSynonymGroup(["zzqfoo", "zzqbar"], adminId);
  await epoch.invalidateListings();
  await custom.ensureCustomSynonyms();
  assert.ok(alternatives().includes("zzqbar"));
  const [group] = await analytics.loadCustomSynonyms();
  assert.equal(group.created_by_name, "Test");
  assert.equal(await analytics.deleteCustomSynonymGroup(group.id), true);
  await epoch.invalidateListings();
  await custom.ensureCustomSynonyms();
  assert.ok(!alternatives().includes("zzqbar"));
  // Built-in groups stay.
  assert.ok(parseSearchQuery("eksoz").terms[0].alternatives.some(a => a.value === "egzoz"));
});
