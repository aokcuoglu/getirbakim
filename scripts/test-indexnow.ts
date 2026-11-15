import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { isolatedSchema } from "./isolated-schema";
import { batches, diffChunk, indexNowBatchLimit, indexNowConfig, indexNowDisabledReason, indexNowSendable, removalAnomaly, submitUrls, type IndexNowConfig,
  type IndexNowRow } from "../src/modules/seo/indexnow";
import { absoluteUrl } from "../src/modules/seo/paths";
import { productPath } from "../src/modules/seo/product-path";
import { productChunks } from "../src/modules/seo/sitemap";
import { siteUrl } from "../src/lib/site";
import { storefrontCompanies } from "../src/modules/suppliers/storefront-sources";
import { GET } from "../src/app/api/indexnow/[key]/route";

// IndexNow (#645): pure helpers with a mocked network, then whole runs against an isolated copy of the schema. No request
// leaves the process and nothing is written to the shared database's tables.

type Call = { url: string; body: { host: string; key: string; keyLocation: string; urlList: string[] }; contentType: string | null };
// "hang" never answers: only the request's timeout signal ends it.
function fakeFetch(answers: (number | Error | "hang" | { status: number; retryAfter: string })[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)), contentType: new Headers(init?.headers).get("content-type") });
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer === undefined) throw new Error("no answer");
    if (answer instanceof Error) throw answer;
    if (answer === "hang") {
      return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }
    if (typeof answer === "number") return new Response(null, { status: answer });
    return new Response(null, { status: answer.status, headers: { "Retry-After": answer.retryAfter } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
function fakeSleep() {
  const waits: number[] = [];
  return { sleep: async (ms: number) => { waits.push(ms); }, waits };
}

const key = "a1b2c3d4-e5f6a7b8";
const prodEnv = { APP_ENV: "production", INDEXNOW_KEY: key, SITE_URL: siteUrl };
const config: IndexNowConfig = { key, host: "getirbakim.test", keyLocation: "https://getirbakim.test/key.txt", endpoint: "https://api.indexnow.test/indexnow" };
const url = (path: string) => absoluteUrl(siteUrl, path);

describe("IndexNow helpers", () => {
  test("indexNowConfig: no key is off, a malformed key throws, the key file lies at the site root", () => {
    assert.equal(indexNowConfig({}), null);
    assert.equal(indexNowConfig({ INDEXNOW_KEY: "  " }), null);
    assert.throws(() => indexNowConfig({ INDEXNOW_KEY: "short" }), /INDEXNOW_KEY/);
    assert.throws(() => indexNowConfig({ INDEXNOW_KEY: "has space in it" }), /INDEXNOW_KEY/);
    assert.throws(() => indexNowConfig({ INDEXNOW_KEY: "x".repeat(129) }), /INDEXNOW_KEY/);
    const settings = indexNowConfig({ INDEXNOW_KEY: key });
    assert.deepEqual(settings, { key, host: new URL(siteUrl).host, keyLocation: `${siteUrl}/${key}.txt`, endpoint: "https://api.indexnow.org/indexnow" });
  });

  test("indexNowSendable: only production with a key and an explicit SITE_URL", () => {
    assert.equal(indexNowSendable(prodEnv), true);
    assert.equal(indexNowSendable({ APP_ENV: "production", SITE_URL: siteUrl }), false);
    assert.equal(indexNowSendable({ APP_ENV: "staging", INDEXNOW_KEY: key, SITE_URL: siteUrl }), false);
    assert.equal(indexNowSendable({ INDEXNOW_KEY: key, SITE_URL: siteUrl }), false);
    assert.equal(indexNowSendable({ APP_ENV: "production", INDEXNOW_KEY: key }), false);
    assert.equal(indexNowSendable({ APP_ENV: "production", INDEXNOW_KEY: key, SITE_URL: " " }), false);
    assert.equal(indexNowDisabledReason({ APP_ENV: "production", INDEXNOW_KEY: key }), "SITE_URL is not set");
    assert.equal(indexNowDisabledReason({ APP_ENV: "production", SITE_URL: siteUrl }), "INDEXNOW_KEY is empty");
    assert.equal(indexNowDisabledReason({ INDEXNOW_KEY: key, SITE_URL: siteUrl }), "APP_ENV is not production");
    assert.equal(indexNowDisabledReason(prodEnv), null);
  });

  test("batches stop at the protocol's 10,000 URLs", () => {
    assert.equal(indexNowBatchLimit, 10_000);
    assert.deepEqual(batches(Array.from({ length: 25_001 }, (_, index) => index)).map(batch => batch.length), [10_000, 10_000, 5_001]);
    assert.deepEqual(batches([]), []);
  });

  test("diffChunk: new, changed, removed and moved pages", () => {
    const row = (id: string, fingerprint: string, path = `/urun/${id}`): IndexNowRow => ({ id, path, fingerprint });
    const known = [row("a", "1"), row("b", "1"), row("c", "1"), row("d", "1", "/urun/old-d")];
    const current = [row("a", "1"), row("b", "2"), row("d", "1"), row("e", "1")];
    const diff = diffChunk(current, known);
    assert.deepEqual(diff.added.map(item => item.id), ["e"]);
    assert.deepEqual(diff.changed.map(item => item.id), ["b", "d"]);
    assert.deepEqual(diff.removed.map(item => item.id), ["c"]);
    assert.deepEqual(diff.urls.sort(), [url("/urun/b"), url("/urun/c"), url("/urun/d"), url("/urun/e"), url("/urun/old-d")].sort());
    assert.deepEqual(diffChunk(known, known), { added: [], changed: [], removed: [], urls: [] });
  });

  test("removalAnomaly: more than half of a large chunk leaving at once", () => {
    assert.equal(removalAnomaly(100, 100), false);
    assert.equal(removalAnomaly(200, 100), false);
    assert.equal(removalAnomaly(200, 101), true);
    assert.equal(removalAnomaly(0, 0), false);
  });

  test("submitUrls posts the protocol's JSON; 200 and 202 succeed", async () => {
    for (const status of [200, 202]) {
      const network = fakeFetch([status]);
      const result = await submitUrls(config, ["https://getirbakim.test/urun/a"], { fetch: network.fetch, sleep: fakeSleep().sleep });
      assert.deepEqual(result, { ok: true, status, requests: 1 });
      assert.equal(network.calls[0].url, config.endpoint);
      assert.equal(network.calls[0].contentType, "application/json; charset=utf-8");
      assert.deepEqual(network.calls[0].body, { host: config.host, key, keyLocation: config.keyLocation, urlList: ["https://getirbakim.test/urun/a"] });
    }
  });

  test("submitUrls drops the answer's body", async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("ok")); }, cancel() { cancelled = true; } });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as typeof fetch;
    assert.deepEqual(await submitUrls(config, ["u"], { fetch: fetchImpl, sleep: fakeSleep().sleep }), { ok: true, status: 200, requests: 1 });
    assert.equal(cancelled, true);
  });

  test("submitUrls caps Retry-After at 10 minutes", async () => {
    const throttled = fakeFetch([{ status: 429, retryAfter: "3600" }, 202]);
    const clock = fakeSleep();
    assert.deepEqual(await submitUrls(config, ["u"], { fetch: throttled.fetch, sleep: clock.sleep }), { ok: true, status: 202, requests: 2 });
    assert.deepEqual(clock.waits, [600_000]);
  });

  test("submitUrls times a hanging request out and retries it as a network error", async () => {
    const slow = fakeFetch(["hang", 200]);
    const clock = fakeSleep();
    assert.deepEqual(await submitUrls(config, ["u"], { fetch: slow.fetch, sleep: clock.sleep, timeoutMs: 20 }), { ok: true, status: 200, requests: 2 });
    assert.deepEqual(clock.waits, [5000]);
    const dead = fakeFetch(["hang"]);
    const result = await submitUrls(config, ["u"], { fetch: dead.fetch, sleep: fakeSleep().sleep, timeoutMs: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.status, null);
    assert.equal(result.requests, 3);
    assert.match(result.error ?? "", /IndexNow request timed out after 20 ms/);
    assert.equal(dead.calls.length, 3);
  });

  test("submitUrls retries 429 after Retry-After and 5xx after the backoff", async () => {
    const throttled = fakeFetch([{ status: 429, retryAfter: "7" }, 200]);
    const clock = fakeSleep();
    assert.deepEqual(await submitUrls(config, ["u"], { fetch: throttled.fetch, sleep: clock.sleep }), { ok: true, status: 200, requests: 2 });
    assert.deepEqual(clock.waits, [7000]);
    const failing = fakeFetch([503, 502, 202]);
    const backoff = fakeSleep();
    assert.deepEqual(await submitUrls(config, ["u"], { fetch: failing.fetch, sleep: backoff.sleep }), { ok: true, status: 202, requests: 3 });
    assert.deepEqual(backoff.waits, [5000, 30000]);
  });

  test("submitUrls gives up at once on 403 and 422, and after three network errors", async () => {
    for (const status of [400, 403, 422]) {
      const network = fakeFetch([status]);
      const clock = fakeSleep();
      const result = await submitUrls(config, ["u"], { fetch: network.fetch, sleep: clock.sleep });
      assert.deepEqual(result, { ok: false, status, requests: 1, error: `HTTP ${status}` });
      assert.equal(network.calls.length, 1);
      assert.deepEqual(clock.waits, []);
    }
    const offline = fakeFetch([new Error("ECONNRESET")]);
    const result = await submitUrls(config, ["u"], { fetch: offline.fetch, sleep: fakeSleep().sleep });
    assert.deepEqual(result, { ok: false, status: null, requests: 3, error: "ECONNRESET" });
    assert.equal(offline.calls.length, 3);
  });

  test("the key file answers only the configured key", async () => {
    const original = process.env.INDEXNOW_KEY;
    const get = (name: string) => GET(new Request(`https://getirbakim.test/${name}.txt`), { params: Promise.resolve({ key: name }) });
    try {
      process.env.INDEXNOW_KEY = key;
      const found = await get(key);
      assert.equal(found.status, 200);
      assert.equal(found.headers.get("content-type"), "text/plain; charset=utf-8");
      assert.equal(await found.text(), key);
      assert.equal((await get("wrong-key-12345")).status, 404);
      delete process.env.INDEXNOW_KEY;
      assert.equal((await get(key)).status, 404);
      process.env.INDEXNOW_KEY = "bad";
      assert.equal((await get("bad")).status, 404);
    } finally {
      if (original === undefined) delete process.env.INDEXNOW_KEY; else process.env.INDEXNOW_KEY = original;
    }
  });
});

describe("IndexNow runs", () => {
  let schema: Awaited<ReturnType<typeof isolatedSchema>>;
  let indexnow: typeof import("../src/modules/seo/indexnow.server");
  let sitemap: typeof import("../src/modules/seo/sitemap.server");
  let closeDb: () => Promise<void>;
  const ids: Record<string, string> = {};
  const [basbug] = storefrontCompanies();

  // Ids in chosen sitemap chunks (the chunk is the first byte / 4), so the budget test crosses chunks deterministically.
  const idInChunk = (chunk: number, n: number) => `${(chunk * 4).toString(16).padStart(2, "0")}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  async function item(name: string, id: string, { oe = "1K0 129 620" }: { oe?: string } = {}) {
    await schema.pool.query(`INSERT INTO supplier_items(id,supplier,company,list_group,warehouse,code,product_data,price_data,stock_data,
      product_count,price_count,stock_count,conflicting,presence,first_seen_at,last_seen_at,changed_at)
      VALUES($1,'basbug',$2,'G','MRK',$3,$4,'{"nf":100}','{"stok":2}',1,1,1,false,'present',now()-interval '10 days',now()-interval '1 hour',now()-interval '1 hour')`,
    [id, basbug, `MAH ${name}`, { uk: "MAHLE", ac: `${name} PARCA`, ac2: "", dc: "TL", oe }]);
    ids[name] = id;
  }
  const rename = (name: string, value: string) =>
    schema.pool.query(`UPDATE supplier_items SET product_data=jsonb_set(product_data,'{ac}',to_jsonb($2::text)) WHERE id=$1`, [ids[name], value]);
  // The page's address from the catalog view (the page's own source), apart from the sitemap's columns.
  const addressOf = async (id: string) => productPath((await schema.pool.query<{ id: string; name: string; display_brand: string; display_code: string }>(
    "SELECT id::text,name,display_brand,display_code FROM commerce_catalog_entries WHERE id=$1", [id])).rows[0]);
  const pathNow = (key: string) => addressOf(ids[key]);
  const both = (...paths: string[]) => [...new Set(paths)].map(url).sort();
  const known = async () => new Map((await schema.pool.query<{ id: string; fingerprint: string }>(
    "SELECT product_id::text AS id,fingerprint::text AS fingerprint FROM indexnow_urls")).rows.map(row => [row.id, row.fingerprint]));
  const sent = (calls: Call[]) => calls.flatMap(call => call.body.urlList).sort();
  const run = (options: Partial<Parameters<typeof indexnow.runIndexNow>[0]> & { network: ReturnType<typeof fakeFetch> }) =>
    indexnow.runIndexNow({ mode: "send", limit: 0, env: prodEnv, sleep: fakeSleep().sleep, pauseMs: 0, fetch: options.network.fetch, ...options });

  before(async () => {
    schema = await isolatedSchema("indexnow_test");
    await item("alpha", idInChunk(2, 1));
    await item("beta", idInChunk(20, 2));
    await item("gamma", idInChunk(40, 3));
    await item("delta", idInChunk(40, 4));
    // Fingerprint cases: admin overrides, a hidden OEM (mu keeps an enrichment, so it stays indexable), the OEM, an
    // enrichment import, and an import through a link whose brand is not the row's (the page shows no enrichment).
    for (const [name, chunk] of [["omega", 8], ["kappa", 12], ["lambda", 16], ["mu", 24], ["nu", 28], ["enriched", 32], ["staleLink", 36]] as const) {
      await item(name, idInChunk(chunk, 10 + chunk));
    }
    await schema.pool.query(`INSERT INTO product_enrichments(supplier_item_id,supplier_code,supplier_brand,source_url,source_method,manufacturer,manufacturer_part_number,payload)
      VALUES($1,'MAH enriched','MAHLE','https://example.test/p','test','MAHLE','MAH enriched','{"specifications":[],"oemNumbers":{},"crossReferences":{},"vehicles":[]}')`, [ids.enriched]);
    await schema.pool.query(`INSERT INTO product_enrichment_shared_links(supplier_item_id,supplier_code,supplier_brand,donor_item_id,donor_oem,status,imported_at)
      VALUES($1,'MAH enriched','MAHLE',$1,'','complete',now()-interval '1 day'),($2,'MAH mu','MAHLE',$1,'','complete',now()-interval '1 day'),
      ($3,'MAH staleLink','MAHLE FILTRE',$1,'','complete',now()-interval '1 day')`, [ids.enriched, ids.mu, ids.staleLink]);
    // No minimum content: never reported.
    await item("bare", idInChunk(50, 5), { oe: "" });
    ids.store = (await schema.pool.query<{ id: string }>(`INSERT INTO store_products(id,supplier,code,name,brand,price_kurus,stock)
      VALUES($1,'basbug','STORE 1','MAGAZA PARCA','BOSCH',1000,3) RETURNING id::text`, [idInChunk(60, 6)])).rows[0].id;
    const [{ db }, indexnowModule, sitemapModule] = await Promise.all([import("../src/lib/db"), import("../src/modules/seo/indexnow.server"),
      import("../src/modules/seo/sitemap.server")]);
    indexnow = indexnowModule;
    sitemap = sitemapModule;
    closeDb = () => db.end();
  });
  after(async () => { await closeDb?.(); await schema?.drop(); });

  test("loadIndexNowChunk lists the sitemap's products", async () => {
    for (let index = 0; index < productChunks; index++) {
      const pages = await indexnow.loadIndexNowChunk(index);
      assert.deepEqual(pages.map(page => page.id), (await sitemap.loadProductChunk(index)).map(row => row.id), `chunk ${index}`);
      for (const page of pages) {
        assert.equal(page.path, await addressOf(page.id));
        assert.match(page.fingerprint, /^[0-9a-f-]{36}$/);
      }
    }
  });

  test("without a key or outside production nothing is sent or written; a dry run neither", async () => {
    const network = fakeFetch([200]);
    for (const env of [{ APP_ENV: "production", SITE_URL: siteUrl }, { APP_ENV: "development", INDEXNOW_KEY: key, SITE_URL: siteUrl },
      { APP_ENV: "production", INDEXNOW_KEY: key }, {}]) {
      const result = await run({ network, env });
      assert.equal(result.status, "disabled");
    }
    const dry = await run({ network, dryRun: true });
    assert.equal(dry.status, "completed");
    assert.equal(dry.added, 12);
    assert.equal(dry.urls, 12);
    assert.equal(dry.submitted, 0);
    assert.equal(network.calls.length, 0);
    assert.equal((await known()).size, 0);
    assert.equal((await schema.pool.query("SELECT 1 FROM indexnow_runs")).rowCount, 0);
  });

  test("--seed records the current state without a request", async () => {
    const network = fakeFetch([200]);
    const result = await run({ network, mode: "seed" });
    assert.equal(result.status, "completed");
    assert.equal(result.chunks, productChunks);
    assert.equal(network.calls.length, 0);
    assert.deepEqual([...(await known()).keys()].sort(), [ids.alpha, ids.beta, ids.gamma, ids.delta, ids.store, ids.omega, ids.kappa, ids.lambda,
      ids.mu, ids.nu, ids.enriched, ids.staleLink].sort());
    const runs = (await schema.pool.query<{ mode: string; status: string; added: number; finished: boolean }>(
      "SELECT mode,status,added,finished_at IS NOT NULL AS finished FROM indexnow_runs")).rows;
    assert.deepEqual(runs, [{ mode: "seed", status: "completed", added: 12, finished: true }]);
  });

  test("a renamed product sends its old and new address", async () => {
    const before = await known();
    const oldPath = await pathNow("alpha");
    await rename("alpha", "YENI ALPHA");
    const network = fakeFetch([202]);
    const result = await run({ network });
    assert.equal(result.status, "completed");
    assert.equal(network.calls.length, 1);
    assert.deepEqual({ ...network.calls[0].body, urlList: [...network.calls[0].body.urlList].sort() },
      { host: new URL(siteUrl).host, key, keyLocation: `${siteUrl}/${key}.txt`, urlList: both(oldPath, await pathNow("alpha")) });
    assert.notEqual(oldPath, await pathNow("alpha"));
    assert.equal(result.changed, 1);
    const after = await known();
    assert.notEqual(after.get(ids.alpha), before.get(ids.alpha));
    assert.equal(after.get(ids.beta), before.get(ids.beta));
  });

  test("price, stock and changed_at changes send nothing", async () => {
    await schema.pool.query(`UPDATE supplier_items SET price_data='{"nf":250}',stock_data='{"stok":0}',changed_at=now()`);
    await schema.pool.query("UPDATE store_products SET price_kurus=2500,stock=0,updated_at=now()");
    const network = fakeFetch([200]);
    const result = await run({ network });
    assert.equal(result.status, "completed");
    assert.equal(result.urls, 0);
    assert.equal(network.calls.length, 0);
  });

  test("overrides, the shown OEM and an enrichment import each send only their page", async () => {
    const steps: [string, string, unknown[]][] = [
      ["omega", "INSERT INTO commerce_item_overrides(supplier_item_id,product_id,brand) VALUES($1,$1,'YENI MARKA')", [ids.omega]],
      ["kappa", "INSERT INTO commerce_item_overrides(supplier_item_id,product_id,part_number) VALUES($1,$1,'KAPPA-2')", [ids.kappa]],
      ["lambda", "INSERT INTO commerce_item_overrides(supplier_item_id,product_id,description) VALUES($1,$1,'Yeni açıklama')", [ids.lambda]],
      ["mu", "INSERT INTO commerce_item_overrides(supplier_item_id,product_id,hide_oem) VALUES($1,$1,true)", [ids.mu]],
      ["nu", "UPDATE supplier_items SET product_data=jsonb_set(product_data,'{oe}','\"7M0 129 620\"') WHERE id=$1", [ids.nu]],
      ["enriched", "UPDATE product_enrichment_shared_links SET imported_at=now() WHERE supplier_item_id=$1", [ids.enriched]],
    ];
    for (const [name, sql, values] of steps) {
      const oldPath = await pathNow(name);
      await schema.pool.query(sql, values);
      const network = fakeFetch([200]);
      const result = await run({ network });
      assert.equal(result.status, "completed", name);
      assert.equal(result.changed, 1, name);
      assert.equal(result.removed, 0, name);
      // A new brand or part number moves the address (old one reported too); the rest changes the content only.
      assert.deepEqual(sent(network.calls), both(oldPath, await pathNow(name)), name);
      assert.equal(oldPath !== await pathNow(name), name === "omega" || name === "kappa", name);
    }
    await schema.pool.query("UPDATE product_enrichment_shared_links SET imported_at=now() WHERE supplier_item_id=$1", [ids.staleLink]);
    const network = fakeFetch([200]);
    assert.equal((await run({ network })).urls, 0);
    assert.equal(network.calls.length, 0);
  });

  test("a second run while the lock is held is skipped", async () => {
    const holder = await schema.pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(20261115,1)");
      const network = fakeFetch([200]);
      const result = await run({ network });
      assert.equal(result.status, "skipped");
      assert.equal(network.calls.length, 0);
    } finally {
      await holder.query("SELECT pg_advisory_unlock(20261115,1)");
      holder.release();
    }
  });

  test("an inactive product reports its old URL and leaves the state", async () => {
    const betaPath = await pathNow("beta");
    await schema.pool.query("UPDATE supplier_items SET presence='inactive' WHERE id=$1", [ids.beta]);
    const network = fakeFetch([200]);
    const result = await run({ network });
    assert.equal(result.removed, 1);
    assert.deepEqual(sent(network.calls), [url(betaPath)]);
    assert.equal((await known()).has(ids.beta), false);
  });

  test("a mass removal fails the run without a request or a state change; --seed accepts it", async () => {
    for (let n = 0; n < 102; n++) await item(`bulk${n}`, idInChunk(44, 100 + n));
    const first = fakeFetch([200]);
    assert.equal((await run({ network: first })).added, 102);
    await schema.pool.query("UPDATE supplier_items SET presence='inactive' WHERE id BETWEEN $1 AND $2", [idInChunk(44, 100), idInChunk(44, 160)]);
    const before = await known();
    const network = fakeFetch([200]);
    const result = await run({ network });
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /Chunk 44: 61 of 102 reported pages would leave the index/);
    assert.equal(result.nextChunk, 44);
    assert.equal(network.calls.length, 0);
    assert.deepEqual(await known(), before);
    const seeded = await run({ network, mode: "seed" });
    assert.equal(seeded.status, "completed");
    assert.equal(seeded.removed, 61);
    assert.equal(network.calls.length, 0);
  });

  test("a failed request keeps the state; the next run sends again", async () => {
    const before = await known();
    const gammaPath = await pathNow("gamma");
    await rename("gamma", "YENI GAMMA");
    const rejected = fakeFetch([403]);
    const failed = await run({ network: rejected });
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /HTTP 403/);
    assert.equal(failed.lastHttpStatus, 403);
    assert.equal((await known()).get(ids.gamma), before.get(ids.gamma));
    const retry = fakeFetch([200]);
    const result = await run({ network: retry });
    assert.equal(result.status, "completed");
    assert.equal(result.startChunk, 40);
    assert.deepEqual(sent(retry.calls), both(gammaPath, await pathNow("gamma")));
    assert.notEqual((await known()).get(ids.gamma), before.get(ids.gamma));
  });

  test("the URL budget stops a run as partial; the next run continues there", async () => {
    const [alphaPath, deltaPath, storePath] = [await pathNow("alpha"), await pathNow("delta"), await pathNow("store")];
    await rename("alpha", "UCUNCU ALPHA");
    await rename("delta", "YENI DELTA");
    await schema.pool.query("UPDATE store_products SET name='YENI MAGAZA PARCA'");
    const first = fakeFetch([200]);
    // The last run completed from chunk 40: chunk 40 (delta: old and new address) comes first, then 60 (store) would exceed the budget.
    const partial = await run({ network: first, limit: 2 });
    assert.equal(partial.status, "partial");
    assert.equal(partial.startChunk, 40);
    assert.equal(partial.nextChunk, 60);
    assert.deepEqual(sent(first.calls), both(deltaPath, await pathNow("delta")));
    const recorded = (await schema.pool.query<{ status: string; next_chunk: number }>(
      "SELECT status,next_chunk FROM indexnow_runs ORDER BY id DESC LIMIT 1")).rows[0];
    assert.deepEqual(recorded, { status: "partial", next_chunk: 60 });
    const second = fakeFetch([200]);
    const rest = await run({ network: second, limit: 1 });
    assert.equal(rest.startChunk, 60);
    assert.equal(rest.status, "partial");
    assert.deepEqual(sent(second.calls), both(storePath, await pathNow("store")));
    const third = fakeFetch([200]);
    const done = await run({ network: third });
    assert.equal(done.status, "completed");
    assert.deepEqual(sent(third.calls), both(alphaPath, await pathNow("alpha")));
  });

  test("the slug release moves every address: old and new are reported, --seed records them silently", async () => {
    // The state of the release before #640: every page known under its bare id address.
    await schema.pool.query("UPDATE indexnow_urls SET path='/urun/'||product_id::text");
    const total = (await known()).size;
    const dry = await run({ network: fakeFetch([200]), dryRun: true });
    assert.equal(dry.status, "completed");
    assert.equal(dry.changed, total);
    assert.equal(dry.removed, 0);
    assert.equal(dry.urls, total * 2);
    // Moved pages are no mass removal: only the daily budget slows the report (see docs/indexnow.md).
    const network = fakeFetch([200]);
    const seeded = await run({ network, mode: "seed" });
    assert.equal(seeded.status, "completed");
    assert.equal(seeded.changed, total);
    assert.equal(network.calls.length, 0);
    assert.equal((await schema.pool.query("SELECT 1 FROM indexnow_urls WHERE path NOT LIKE '/urun/%-%'")).rowCount, 0);
    const after = fakeFetch([200]);
    const quiet = await run({ network: after });
    assert.equal(quiet.urls, 0);
    assert.equal(after.calls.length, 0);
  });
});
