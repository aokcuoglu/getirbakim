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

test("a pair the parser already matches both ways is not worth a suggestion", async () => {
  const { alreadyEquivalent } = await import("../src/modules/search/synonym-suggestions");
  for (const [a, b] of [["traversi", "travers"], ["klips", "klipsi"], ["eksoz", "egzoz"], ["balatasi", "balata"]]) assert.ok(alreadyEquivalent(a, b), `${a}/${b}`);
  for (const [a, b] of [["zzqab", "zzqabcd"], ["kaportaa", "kaporta"]]) assert.ok(!alreadyEquivalent(a, b), `${a}/${b}`);
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

// AI suggestions (#834) against a local stub of both providers: no request leaves the machine.
test("AI suggestions are grounded in the catalog, wait for approval and are never suggested twice", async () => {
  const { createServer } = await import("node:http");
  const requests: { path: string; body: string }[] = [];
  const answer = (body: string) => body.includes("pairs")
    ? { results: [{ a: "kaporta", b: "kaportaa", same: true, reason: "yazım hatası" }] }
    : { results: [{ query: "enjktor", spellings: ["Enjektör", "uydurmakelime parca"], reason: "yazım hatası" }] };
  const server = createServer((request, response) => {
    let body = ""; request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      requests.push({ path: request.url ?? "", body });
      const json = JSON.stringify(answer(body));
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.url?.endsWith("/chat/completions")
        ? { choices: [{ message: { content: json } }] }
        : { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: json }],
          stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const env = { ...process.env };
  try {
    const insert = (name: string, count: number) => schema.pool.query(`INSERT INTO supplier_items(supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,presence,first_seen_at,last_seen_at,changed_at)
      SELECT 'basbug','test','G1','MRK',$1 || n,jsonb_build_object('uk','TEST','ac',$1::text),'{"nf":100}','{"stok":1}',1,1,1,'present',now(),now(),now()
      FROM generate_series(1,$2) n`, [name, count]);
    await insert("ENJEKTOR MEMESI", 3);
    await insert("KAPORTA SACI", 25);
    await insert("KAPORTAA SACI", 21);
    await schema.pool.query("SELECT refresh_search_vocabulary()");
    await analytics.recordSearch({ query: "enjktor", mode: "all", total: 0 });
    await analytics.recordSearch({ query: "ara 05321234567", mode: "all", total: 0 });
    const suggestions = await import("../src/modules/search/synonym-suggestions");
    assert.equal(suggestions.sendableQuery("ara 05321234567"), false);

    for (const provider of ["anthropic", "openai"] as const) {
      delete process.env.ANTHROPIC_API_KEY; delete process.env.OPENAI_API_KEY; delete process.env.SEARCH_SUGGESTION_MODEL;
      if (provider === "anthropic") Object.assign(process.env, { ANTHROPIC_API_KEY: "test-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}` });
      else Object.assign(process.env, { OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` });
      await schema.pool.query("TRUNCATE search_synonym_suggestions, search_suggestion_checks");
      requests.length = 0;
      assert.deepEqual(await suggestions.suggestForZeroResults(), { sent: 1, added: 1 }, provider);
      assert.deepEqual(await suggestions.suggestForVocabulary(), { sent: 1, added: 1 }, provider);
      assert.ok(requests.every(r => r.path.endsWith(provider === "anthropic" ? "/v1/messages" : "/chat/completions")), provider);
      assert.ok(requests.every(r => !r.body.includes("05321234567")), "a phone-like query is never sent");
      const pending = await suggestions.loadPendingSuggestions();
      assert.deepEqual(pending.map(s => s.words).sort(), [["enjktor", "enjektor"], ["kaportaa", "kaporta"]], "the made-up spelling is dropped");
      assert.equal(pending.find(s => s.source === "zero_result")?.hits, 3);
      // Nothing is sent again: queries and pairs already asked are remembered.
      requests.length = 0;
      assert.deepEqual(await suggestions.suggestForZeroResults(), { sent: 0, added: 0 });
      assert.deepEqual(await suggestions.suggestForVocabulary(), { sent: 0, added: 0 });
      assert.equal(requests.length, 0);
    }

    const pending = await suggestions.loadPendingSuggestions();
    const typo = pending.find(s => s.source === "zero_result")!, pair = pending.find(s => s.source === "vocabulary")!;
    assert.equal(await suggestions.decideSuggestion(typo.id, true, adminId), true);
    assert.equal(await suggestions.decideSuggestion(typo.id, true, adminId), false, "a decided suggestion stays decided");
    assert.equal(await suggestions.decideSuggestion(pair.id, false, adminId), true);
    assert.ok(!parseSearchQuery("kaportaa").terms[0].alternatives.some(a => a.value === "kaporta"), "a rejected group stays out");
    assert.ok(parseSearchQuery("enjktor").terms[0].alternatives.some(a => a.value === "enjektor"), "an approved group reaches the parser");
    assert.equal(await suggestions.pendingSuggestionCount(), 0);
    // A rejected group is not suggested again even after its input is asked anew.
    await schema.pool.query("TRUNCATE search_suggestion_checks");
    assert.deepEqual(await suggestions.suggestForVocabulary(), { sent: 1, added: 0 });
  } finally {
    for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL"]) {
      if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    }
    await new Promise(resolve => server.close(resolve));
  }
});
