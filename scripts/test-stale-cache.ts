import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { staleCache, staleCacheStats, weighBuffer, weighIds, weighJson, weighStrings } from "../src/lib/stale-cache";

// Caches register for staleCacheStats only in production; staleCache() reads NODE_ENV when a cache is created.
(process.env as Record<string, string>).NODE_ENV = "production";

const ids = (count: number) => Array.from({ length: count }, (_, index) => String(index));
// A cached entry weighs its value's size plus its key's length (#1461); the keys below are short.
const weighed = { weigh: (value: string[]) => value.length };
const before = () => staleCacheStats();

test("the weight bound evicts the oldest entries and keeps the newest one", async () => {
  const start = before();
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 10 });
  await cache("a", async () => ids(4));
  await cache("b", async () => ids(4));
  assert.equal(staleCacheStats().weight - start.weight, 10);
  await cache("c", async () => ids(4));
  assert.equal(staleCacheStats().weight - start.weight, 10, "a was evicted");
  let reloaded = 0;
  await cache("a", async () => { reloaded++; return ids(1); });
  assert.equal(reloaded, 1, "the evicted key loads again");
  let hit = 0;
  await cache("c", async () => { hit++; return ids(1); });
  assert.equal(hit, 0, "a recent key stays cached");
});

test("the entry just loaded stays even when it alone exceeds the bound", async () => {
  const start = before();
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 5 });
  await cache("small", async () => ids(2));
  await cache("big", async () => ids(50));
  const stats = staleCacheStats();
  assert.equal(stats.entries - start.entries, 1);
  assert.equal(stats.weight - start.weight, 53);
  let loads = 0;
  await cache("big", async () => { loads++; return []; });
  assert.equal(loads, 0);
});

test("a refresh that changes the size adjusts the total", async () => {
  const start = before();
  const cache = staleCache<string[]>(1, 100, { ...weighed, maxWeight: 1000 });
  await cache("k", async () => ids(10));
  assert.equal(staleCacheStats().weight - start.weight, 11);
  await new Promise(done => setTimeout(done, 10));
  await cache("k", async () => ids(3));
  await new Promise(done => setTimeout(done, 10));
  assert.equal(staleCacheStats().weight - start.weight, 4);
});

test("a failed first load leaves the total unchanged", async () => {
  const start = before();
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 100 });
  await assert.rejects(cache("k", async () => { throw new Error("boom"); }));
  await new Promise(done => setTimeout(done, 5));
  const stats = staleCacheStats();
  assert.equal(stats.weight - start.weight, 0);
  assert.equal(stats.entries - start.entries, 0);
});

test("a failed epoch reload restores the previous entry with its weight", async () => {
  const start = before();
  let epoch = 1;
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 100, epoch: async () => epoch });
  await cache("k", async () => ids(7));
  epoch = 2;
  const original = console.error;
  console.error = () => {};
  try {
    const value = await cache("k", async () => { throw new Error("boom"); });
    assert.equal(value.length, 7);
  } finally { console.error = original; }
  const stats = staleCacheStats();
  assert.equal(stats.weight - start.weight, 8);
  assert.equal(stats.entries - start.entries, 1);
});

test("without weigh the entry-count LRU is unchanged", async () => {
  const start = before();
  const cache = staleCache<string[]>(60_000, 2);
  await cache("a", async () => ids(1000));
  await cache("b", async () => ids(1000));
  await cache("c", async () => ids(1000));
  const stats = staleCacheStats();
  assert.equal(stats.entries - start.entries, 2);
  assert.equal(stats.weight - start.weight, 2 * (128 + 1), "an entry without weigh weighs 128 bytes plus its key");
});

test("staleCacheStats sums over instances", async () => {
  const start = before();
  const one = staleCache<string[]>(60_000, 10, weighed);
  const two = staleCache<string[]>(60_000, 10, weighed);
  await one("a", async () => ids(3));
  await two("a", async () => ids(4));
  const stats = staleCacheStats();
  assert.equal(stats.entries - start.entries, 2);
  assert.equal(stats.weight - start.weight, 9);
});

const pause = (ms: number) => new Promise(done => setTimeout(done, ms));

test("a refresh that finishes before a slow first load leaves the total at the final weight", async () => {
  const start = before();
  const cache = staleCache<string[]>(5, 100, { ...weighed, maxWeight: 1000 });
  const first = cache("k", async () => { await pause(40); return ids(10); });
  await pause(10);
  await cache("k", async () => ids(7));
  await first;
  await pause(10);
  const stats = staleCacheStats();
  assert.equal(stats.entries - start.entries, 1);
  assert.equal(stats.weight - start.weight, 11, "the total equals the entry's final weight, not the sum of both loads");
});

test("a pending entry is not evicted by the weight bound", async () => {
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 5 });
  let release = () => {};
  let slowLoads = 0;
  const slow = () => { slowLoads++; return new Promise<string[]>(done => { release = () => done(ids(1)); }); };
  const pending = cache("slow", slow);
  await cache("a", async () => ids(4));
  await cache("b", async () => ids(4));
  void cache("slow", slow);
  assert.equal(slowLoads, 1, "the pending key is still shared, not loaded again");
  release();
  await pending;
});

test("a restored entry after a failed epoch reload respects the bound", async () => {
  const start = before();
  let epoch = 1;
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 12, epoch: async () => epoch });
  await cache("a", async () => ids(6));
  await cache("b", async () => ids(4));
  epoch = 2;
  const original = console.error;
  console.error = () => {};
  try { await cache("a", async () => { throw new Error("boom"); }); } finally { console.error = original; }
  assert.ok(staleCacheStats().weight - start.weight <= 12);
});

// maxWaitMs (#771): a caller waits at most that long for a reload when an earlier value exists.
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}, reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const quietErrors = async <T>(run: () => Promise<T>) => {
  const original = console.error;
  console.error = () => {};
  try { return await run(); } finally { console.error = original; }
};

test("maxWaitMs: a slow epoch reload serves the previous value after the wait, the next call the new one", async () => {
  let epoch = 1, loads = 0;
  const cache = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: () => 60 });
  assert.equal(await cache("k", async () => "old"), "old");
  epoch = 2;
  const reload = deferred<string>();
  const slow = () => { loads++; return reload.promise; };
  const started = Date.now();
  assert.equal(await cache("k", slow), "old");
  assert.ok(Date.now() - started >= 55, "the caller waited for the bound first");
  const again = Date.now();
  assert.equal(await cache("k", slow), "old", "still pending: the previous value again");
  assert.ok(Date.now() - again < 30, "the bound counts from the reload's start, not from each call");
  reload.resolve("new");
  await pause(0);
  assert.equal(await cache("k", slow), "new");
  assert.equal(loads, 1);
});

test("maxWaitMs: a fast reload returns the new value; a first load without an earlier value is waited for", async () => {
  let epoch = 1;
  const cache = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: 50 });
  const first = deferred<string>();
  setTimeout(() => first.resolve("first"), 80);
  assert.equal(await cache("k", () => first.promise), "first", "nothing earlier: the caller waits past the bound");
  epoch = 2;
  assert.equal(await cache("k", async () => "new"), "new");
});

test("maxWaitMs: concurrent callers share one reload", async () => {
  let epoch = 1, loads = 0;
  const cache = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: 40 });
  await cache("k", async () => "old");
  epoch = 2;
  const reload = deferred<string>();
  const slow = () => { loads++; return reload.promise; };
  setTimeout(() => reload.resolve("new"), 10);
  assert.deepEqual(await Promise.all([cache("k", slow), cache("k", slow), cache("k", slow)]), ["new", "new", "new"],
    "within the bound every caller gets the reload's result");
  epoch = 3;
  const late = deferred<string>();
  const slower = () => { loads++; return late.promise; };
  assert.deepEqual(await Promise.all([cache("k", slower), cache("k", slower), cache("k", slower)]), ["new", "new", "new"],
    "past the bound every caller gets the previous value");
  late.resolve("newer");
  await pause(0);
  assert.deepEqual(await Promise.all([cache("k", slower), cache("k", slower)]), ["newer", "newer"]);
  assert.equal(loads, 2);
});

test("maxWaitMs: a failed reload serves the previous value and the next call retries, without unhandled rejections", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", record);
  try {
    let epoch = 1, loads = 0;
    const cache = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: 10 });
    await cache("k", async () => "old");
    epoch = 2;
    // Fails at once: the caller gets the previous value.
    assert.equal(await quietErrors(() => cache("k", async () => { loads++; throw new Error("database down"); })), "old");
    // Fails after the wait: the fallback was served first, the late failure is handled.
    const reload = deferred<string>();
    assert.equal(await cache("k", () => { loads++; return reload.promise; }), "old");
    await quietErrors(async () => { reload.reject(new Error("database down")); await pause(5); });
    assert.equal(await cache("k", async () => { loads++; return "new"; }), "new", "the next call retries");
    assert.equal(loads, 3);
    await pause(5);
    assert.deepEqual(unhandled, []);
  } finally { process.off("unhandledRejection", record); }
});

test("maxWaitMs: the weight total stays right while and after a fallback is served", async () => {
  const start = before();
  let epoch = 1;
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 100, epoch: async () => epoch, maxWaitMs: 5 });
  await cache("a", async () => ids(5));
  await cache("b", async () => ids(4));
  epoch = 2;
  const reload = deferred<string[]>();
  assert.equal((await cache("a", () => reload.promise)).length, 5, "the previous value is served");
  assert.equal(staleCacheStats().weight - start.weight, 5, "the pending reload weighs nothing yet");
  reload.resolve(ids(3));
  await pause(0);
  assert.equal(staleCacheStats().weight - start.weight, 9);
  const failing = deferred<string[]>();
  assert.equal((await cache("b", () => failing.promise)).length, 4);
  await quietErrors(async () => { failing.reject(new Error("boom")); await pause(5); });
  const stats = staleCacheStats();
  assert.equal(stats.weight - start.weight, 9, "the restored entry is counted once");
  assert.equal(stats.entries - start.entries, 2);
});

test("maxWaitMs: 0 serves the previous value at once; the reload's result follows", async () => {
  let epoch = 1;
  const cache = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: 0 });
  await cache("k", async () => "old");
  epoch = 2;
  const reload = deferred<string>();
  const started = Date.now();
  assert.equal(await cache("k", () => reload.promise), "old");
  assert.ok(Date.now() - started < 20, "no wait");
  reload.resolve("new");
  await pause(0);
  assert.equal(await cache("k", () => reload.promise), "new");
});

test("maxWaitMs: a second bump during a reload serves that reload's value once it settled, before then the one before", async () => {
  let epoch = 1, loads = 0;
  const cache = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: 0 });
  await cache("k", async () => "v1");
  epoch = 2;
  const second = deferred<string>();
  assert.equal(await cache("k", () => { loads++; return second.promise; }), "v1");
  epoch = 3;
  const third = deferred<string>();
  const load3 = () => { loads++; return third.promise; };
  assert.equal(await cache("k", load3), "v1", "the replaced reload is still pending: its own earlier value");
  second.resolve("v2");
  await pause(0);
  assert.equal(await cache("k", load3), "v2", "the replaced reload settled: one reload behind");
  third.resolve("v3");
  await pause(0);
  assert.equal(await cache("k", load3), "v3");
  assert.equal(loads, 2);
});

test("maxWaitMs: an earlier value fallbackWhen refuses, or an unbounded wait, makes callers wait for the reload", async () => {
  let epoch = 1;
  const counts = staleCache<number>(60_000, 100, { epoch: async () => epoch, maxWaitMs: 0, fallbackWhen: count => count > 0 });
  await counts("empty", async () => 0);
  await counts("full", async () => 5);
  epoch = 2;
  const slow = (value: number) => async () => { await pause(30); return value; };
  assert.equal(await counts("empty", slow(3)), 3, "a 0 count is not served");
  assert.equal(await counts("full", slow(6)), 5, "a count above 0 is");
  let wait = 0;
  const unbounded = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: () => wait });
  await unbounded("k", async () => "old");
  epoch = 3;
  wait = Infinity;
  assert.equal(await unbounded("k", async () => { await pause(30); return "new"; }), "new", "Infinity: no bound for that load");
});

// The load's `at` (#1368): the epoch value the entry is loaded under, the one its stored value is written with.
test("the load gets the epoch value it runs under: first load, epoch reload and TTL refresh; 0 without an epoch", async () => {
  let epoch = 4;
  const seen: number[] = [];
  const cache = staleCache<number>(20, 100, { epoch: async () => epoch });
  const load = async (at: number) => { seen.push(at); return at; };
  assert.equal(await cache("k", load), 4);
  epoch = 6;
  assert.equal(await cache("k", load), 6, "an epoch reload");
  await pause(30);
  assert.equal(await cache("k", load), 6, "past the TTL: the old value while the refresh runs");
  await pause(5);
  assert.deepEqual(seen, [4, 6, 6]);
  const plain = staleCache<number>(60_000, 100);
  assert.equal(await plain("k", async at => at), 0, "no epoch: 0");
  assert.equal(await plain("zero-argument", async () => 9), 9, "a load without the argument still fits");
});

test("a call's own epoch replaces the instance's for that call; the stored value carries the value the load saw", async () => {
  let listing = 2, fits = 10;
  const written: { key: string; epoch: number }[] = [];
  const store = { read: async () => null, write: async (key: string, _value: number, epoch: number) => { written.push({ key, epoch }); } };
  const cache = staleCache<number>(60_000, 100, { epoch: async () => listing, store });
  const own = { epoch: async () => fits };
  let loads = 0;
  const load = async (at: number) => { loads++; return at; };
  assert.equal(await cache("plain", load), 2);
  assert.equal(await cache("fitted", load, own), 10);
  fits = 11;
  assert.equal(await cache("plain", load), 2, "the instance's counter did not move: a hit");
  assert.equal(await cache("fitted", load, own), 11, "the call's counter moved: reloaded");
  listing = 3;
  assert.equal(await cache("fitted", load, own), 11, "the instance's counter does not reach a key read with its own");
  assert.equal(await cache("plain", load), 3);
  assert.equal(loads, 4);
  await pause(5);
  assert.deepEqual(written, [{ key: "plain", epoch: 2 }, { key: "fitted", epoch: 10 }, { key: "fitted", epoch: 11 }, { key: "plain", epoch: 3 }]);
});

test("listingWaitMs: the setting, 250 ms when blank or invalid, unbounded while warming", async () => {
  const { listingWaitMs, whileWarming } = await import("../src/modules/store/listing-wait");
  const original = process.env.LISTING_EPOCH_WAIT_MS;
  try {
    for (const [setting, expected] of [[undefined, 250], ["", 250], ["  ", 250], ["abc", 250], ["-5", 250], ["0", 0], ["1000", 1000]] as const) {
      if (setting === undefined) delete process.env.LISTING_EPOCH_WAIT_MS;
      else process.env.LISTING_EPOCH_WAIT_MS = setting;
      assert.equal(listingWaitMs(), expected, JSON.stringify(setting));
    }
    assert.equal(await whileWarming(async () => listingWaitMs()), Infinity);
    await assert.rejects(whileWarming(async () => { throw new Error("warm-up failed"); }));
    assert.equal(listingWaitMs(), 1000, "the flag is reset after the warm-up, also after a failure");
  } finally {
    if (original === undefined) delete process.env.LISTING_EPOCH_WAIT_MS;
    else process.env.LISTING_EPOCH_WAIT_MS = original;
  }
});

test("listingStatementTimeoutMs: the setting's whole milliseconds, 55 s when blank or invalid, 0 turns the limit off", async () => {
  const { listingStatementTimeoutMs } = await import("../src/modules/store/listing-timeout");
  const original = process.env.LISTING_STATEMENT_TIMEOUT_MS;
  try {
    for (const [setting, expected] of [[undefined, 55_000], ["", 55_000], ["  ", 55_000], ["abc", 55_000], ["-5", 55_000], ["0.5", 55_000],
      ["Infinity", 55_000], ["0", 0], [" 0 ", 0], ["200", 200], ["1500.7", 1500], ["30000", 30_000]] as const) {
      if (setting === undefined) delete process.env.LISTING_STATEMENT_TIMEOUT_MS;
      else process.env.LISTING_STATEMENT_TIMEOUT_MS = setting;
      assert.equal(listingStatementTimeoutMs(), expected, JSON.stringify(setting));
    }
  } finally {
    if (original === undefined) delete process.env.LISTING_STATEMENT_TIMEOUT_MS;
    else process.env.LISTING_STATEMENT_TIMEOUT_MS = original;
  }
});

test("suggestStatementTimeoutMs: the setting's whole milliseconds, 5 s when blank or invalid, 0 the listing limit (#1398)", async () => {
  const { suggestStatementTimeoutMs } = await import("../src/modules/store/listing-timeout");
  const saved = { suggest: process.env.SUGGEST_STATEMENT_TIMEOUT_MS, listing: process.env.LISTING_STATEMENT_TIMEOUT_MS };
  const set = (key: string, value: string | undefined) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  try {
    set("LISTING_STATEMENT_TIMEOUT_MS", undefined);
    for (const [setting, expected] of [[undefined, 5_000], ["", 5_000], ["  ", 5_000], ["abc", 5_000], ["-5", 5_000], ["0.5", 5_000],
      ["Infinity", 5_000], ["0", 55_000], [" 0 ", 55_000], ["200", 200], ["1500.7", 1500], ["10000", 10_000]] as const) {
      set("SUGGEST_STATEMENT_TIMEOUT_MS", setting);
      assert.equal(suggestStatementTimeoutMs(), expected, JSON.stringify(setting));
    }
    set("SUGGEST_STATEMENT_TIMEOUT_MS", "0");
    set("LISTING_STATEMENT_TIMEOUT_MS", "20000");
    assert.equal(suggestStatementTimeoutMs(), 20_000, "the listing's own setting");
    set("LISTING_STATEMENT_TIMEOUT_MS", "0");
    assert.equal(suggestStatementTimeoutMs(), 0, "both off");
  } finally {
    set("SUGGEST_STATEMENT_TIMEOUT_MS", saved.suggest);
    set("LISTING_STATEMENT_TIMEOUT_MS", saved.listing);
  }
});

test("db: two copies of the module (instrumentation and route bundles) share one pool in production", async () => {
  const globals = globalThis as { getirbakimPool?: unknown };
  const previous = globals.getirbakimPool;
  delete globals.getirbakimPool;
  try {
    // A query string makes the loader evaluate the file again, as a second webpack bundle does.
    const load = (copy: string): Promise<typeof import("../src/lib/db")> => import(`../src/lib/db?bundle=${copy}`);
    const first = await load("a");
    const second = await load("b");
    assert.notEqual(first, second, "two separate module copies");
    assert.equal(first.db, second.db, "one Pool per process");
    assert.equal(globals.getirbakimPool, first.db);
    assert.equal(first.db.listenerCount("error"), 1, "the idle-client error listener is registered once");
    await first.db.end();
  } finally {
    if (previous === undefined) delete globals.getirbakimPool;
    else globals.getirbakimPool = previous;
  }
});

// maxServeMs (#1453). A mocked clock moves loadedAt, so ages are exact.
const serveAge = async (t: import("node:test").TestContext, options: { maxWaitMs?: number } = {}) => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const cache = staleCache<string>(1000, 100, options);
  let loads = 0, current = "v1";
  const load = async () => { loads++; return current; };
  return { cache, load, loads: () => loads, set: (value: string) => { current = value; } };
};
const settle = () => new Promise(done => setImmediate(done));

test("maxServeMs: an entry past it is reloaded before it is served; a younger one is served stale while one refresh runs", async t => {
  const { cache, load, loads, set } = await serveAge(t);
  assert.equal(await cache("k", load, { maxServeMs: 5000 }), "v1");
  set("v2");
  t.mock.timers.tick(2000);
  assert.equal(await cache("k", load, { maxServeMs: 5000 }), "v1", "past the TTL, within the bound: stale once");
  await settle();
  assert.equal(loads(), 2, "one background refresh");
  set("v3");
  t.mock.timers.tick(5001);
  assert.equal(await cache("k", load, { maxServeMs: 5000 }), "v3", "past the bound: the caller gets the reload");
  assert.equal(loads(), 3);
});

test("maxServeMs: concurrent callers past the bound share one reload", async t => {
  const { cache } = await serveAge(t);
  await cache("k", async () => "v1", { maxServeMs: 5000 });
  t.mock.timers.tick(6000);
  let release!: () => void, calls = 0;
  const gate = new Promise<void>(done => { release = done; });
  const slow = async () => { calls++; await gate; return "v2"; };
  const readers = [1, 2, 3].map(() => cache("k", slow, { maxServeMs: 5000 }));
  await settle();
  release();
  assert.deepEqual(await Promise.all(readers), ["v2", "v2", "v2"]);
  assert.equal(calls, 1);
});

test("maxServeMs: a failed reload of an over-age entry serves the old value, logs, and the next request tries again; a cold key rejects", async t => {
  const { cache, load } = await serveAge(t);
  const logged = t.mock.method(console, "error", () => {});
  await cache("k", load, { maxServeMs: 5000 });
  t.mock.timers.tick(6000);
  assert.equal(await cache("k", async () => { throw new Error("boom"); }, { maxServeMs: 5000 }), "v1");
  assert.equal(logged.mock.callCount(), 1);
  assert.equal(await cache("k", async () => "v2", { maxServeMs: 5000 }), "v2", "the over-age entry was put back, so the next request reloads");
  await assert.rejects(cache("cold", async () => { throw new Error("boom"); }, { maxServeMs: 5000 }), /boom/);
});

test("maxServeMs: a bounded wait never serves the over-age entry as an earlier value", async t => {
  const { cache } = await serveAge(t, { maxWaitMs: 0 });
  await cache("k", async () => "v1", { maxServeMs: 5000 });
  t.mock.timers.tick(6000);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const read = cache("k", async () => { await gate; return "v2"; }, { maxServeMs: 5000 });
  let done = false;
  void read.then(() => { done = true; });
  await settle();
  assert.equal(done, false, "waits for the load");
  release();
  assert.equal(await read, "v2");
});

test("without maxServeMs (or with 0) an idle entry of any age is served stale once, as before", async t => {
  for (const options of [undefined, { maxServeMs: 0 }]) {
    const { cache, load, loads, set } = await serveAge(t);
    await cache("k", load, options);
    set("v2");
    t.mock.timers.tick(10 * 60 * 60 * 1000);
    assert.equal(await cache("k", load, options), "v1");
    await settle();
    assert.equal(loads(), 2);
    assert.equal(await cache("k", load, options), "v2");
  }
});

test("maxServeMs bounds what a memory miss adopts from the store", async t => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const row = { value: "stored", ageMs: 30_000, epoch: 0 };
  const store = { read: async () => row, write: async () => {} };
  const cache = staleCache<string>(1000, 100, { store, maxStaleMs: 60_000 });
  assert.equal(await cache("old", async () => "fresh", { maxServeMs: 10_000 }), "fresh", "a row past the bound is not adopted");
  assert.equal(await cache("ok", async () => "fresh", { maxServeMs: 40_000 }), "stored", "a younger row is");
  assert.equal(await cache("unbounded", async () => "fresh"), "stored");
});

test("maxServeMs: after an epoch bump a bounded wait serves the replaced entry only within the limit", async t => {
  for (const [idleMs, serves] of [[1000, true], [6000, false]] as const) {
    t.mock.timers.reset();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    let epoch = 1;
    const cache = staleCache<string>(60_000, 100, { epoch: async () => epoch, maxWaitMs: 0 });
    await cache("k", async () => "v1", { maxServeMs: 5000 });
    t.mock.timers.tick(idleMs);
    epoch = 2;
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const read = cache("k", async () => { await gate; return "v2"; }, { maxServeMs: 5000 });
    let first: string | undefined;
    void read.then(value => { first = value; });
    await settle();
    assert.equal(first, serves ? "v1" : undefined, serves ? "within the limit the earlier value is served at once" : "past the limit the caller waits");
    release();
    assert.equal(await read, serves ? "v1" : "v2");
    await settle();
  }
});

test("maxServeMs: a stored row past the limit is not an earlier value for a bounded wait; the caller waits, and a failed load rejects", async t => {
  t.mock.timers.reset();
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const row = { value: "stored", ageMs: 30_000, epoch: 0 };
  const store = { read: async () => row, write: async () => {} };
  const make = () => staleCache<string>(1000, 100, { store, maxStaleMs: 10, maxWaitMs: 0 });
  const gate = () => { let release!: () => void; const wait = new Promise<void>(done => { release = done; }); return { release, wait }; };
  const unbounded = gate();
  const first = make()("k", async () => { await unbounded.wait; return "fresh"; });
  let seen: string | undefined;
  void first.then(value => { seen = value; });
  await settle();
  assert.equal(seen, "stored", "without the limit the stored row is the earlier value");
  unbounded.release();
  await first;
  const bounded = gate();
  const read = make()("k", async () => { await bounded.wait; return "fresh"; }, { maxServeMs: 10_000 });
  let waiting = true;
  void read.then(() => { waiting = false; }, () => { waiting = false; });
  await settle();
  assert.equal(waiting, true, "past the limit the caller waits for the load");
  bounded.release();
  assert.equal(await read, "fresh");
  await assert.rejects(make()("k", async () => { throw new Error("boom"); }, { maxServeMs: 10_000 }), /boom/);
});

test("per-cache stats carry the name and count hits, stale reads, misses, adoptions and evictions (#1461)", async () => {
  const named = () => staleCacheStats().caches.find(cache => cache.name === "stats-probe")!;
  const cache = staleCache<string[]>(60_000, 2, { name: "stats-probe" });
  await cache("a", async () => ["x"]);
  await cache("a", async () => ["y"]);
  await cache("b", async () => ["x"]);
  await cache("c", async () => ["x"]);
  assert.deepEqual({ ...named() }, { name: "stats-probe", entries: 2, weight: 258, hits: 1, stale: 0, misses: 3, reloads: 0, adopted: 0, evicted: 1 });
  const unnamed = staleCache<number>(60_000);
  await unnamed("k", async () => 1);
  assert.ok(staleCacheStats().caches.some(item => /^cache#\d+$/.test(item.name)), "a cache without a name gets cache#<n>");
});

test("a read of an entry past its TTL counts as stale and starts one refresh", async () => {
  const cache = staleCache<number>(1, 5, { name: "stale-probe" });
  await cache("k", async () => 1);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await cache("k", async () => 2), 1);
  assert.equal(staleCacheStats().caches.find(item => item.name === "stale-probe")!.stale, 1);
});

test("a settled entry holds no Promise, so it does not keep the request that loaded it alive (#1461)", () => {
  // Node 22's AsyncLocalStorage keeps a request's stores reachable from every Promise created inside it; Node 24 does so
  // with --no-async-context-frame (a flag Node 22 does not know, and does not need).
  const flags = process.allowedNodeEnvironmentFlags.has("--no-async-context-frame") ? ["--no-async-context-frame"] : [];
  const result = spawnSync(process.execPath, [...flags, "--expose-gc", "--conditions=react-server", "--import", "tsx", "scripts/test-stale-cache-retain.ts"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /retained=0 of \d+\b/, result.stdout);
  assert.match(result.stdout, / of 120\b/, "the epoch reload and TTL refresh requests are counted too");
});

test("weight helpers estimate bytes", () => {
  assert.equal(weighIds(ids(10)), 640);
  assert.equal(weighStrings(["ab", "cde"]), 24 + 2 + 8 + 3 + 8);
  assert.equal(weighJson({ a: 1 }), 2 * '{"a":1}'.length);
  assert.equal(weighBuffer(Buffer.alloc(300)), 300);
});

// The process-wide budget (#1461): STALE_CACHE_MAX_MB, in mebibytes, evicts the globally least recently used settled
// entry of 4 KB or more after a load; 0 turns it off.
const withBudget = async (mb: string, run: () => Promise<void>) => {
  const saved = process.env.STALE_CACHE_MAX_MB;
  process.env.STALE_CACHE_MAX_MB = mb;
  try { await run(); } finally { if (saved === undefined) delete process.env.STALE_CACHE_MAX_MB; else process.env.STALE_CACHE_MAX_MB = saved; }
};
const KB = 1024;
const sized = () => ({ weigh: (value: { bytes: number }) => value.bytes });
const own = (names: string[]) => staleCacheStats().caches.filter(cache => names.includes(cache.name));
const entriesOf = (name: string) => own([name])[0].entries;

test("the budget evicts the least recently used large entry across caches", async () => {
  const one = staleCache<{ bytes: number }>(60_000, 100, { name: "budget-one", ...sized() });
  const two = staleCache<{ bytes: number }>(60_000, 100, { name: "budget-two", ...sized() });
  const others = staleCacheStats().weight;
  await withBudget(String((others + 300 * KB) / 1048576), async () => {
    await one("a", async () => ({ bytes: 100 * KB }));
    await two("b", async () => ({ bytes: 100 * KB }));
    await one("a", async () => ({ bytes: 1 }));
    assert.deepEqual([entriesOf("budget-one"), entriesOf("budget-two")], [1, 1]);
    await two("c", async () => ({ bytes: 150 * KB }));
    // b was read least recently (a was read after it), so b goes, from the other cache than the one loading.
    assert.deepEqual([entriesOf("budget-one"), entriesOf("budget-two")], [1, 1], "b was evicted, c stays");
    let reloaded = 0;
    await two("b", async () => { reloaded++; return { bytes: 1 }; });
    assert.equal(reloaded, 1, "b loads again");
    assert.ok(own(["budget-one", "budget-two"]).reduce((sum, cache) => sum + cache.evicted, 0) >= 1);
  });
});

test("the budget never evicts pending entries, small entries or the entry just loaded", async () => {
  const small = staleCache<{ bytes: number }>(60_000, 100, { name: "budget-small", ...sized() });
  const big = staleCache<{ bytes: number }>(60_000, 100, { name: "budget-big", ...sized() });
  const others = staleCacheStats().weight;
  await withBudget(String((others + 8 * KB) / 1048576), async () => {
    let release = () => {};
    const pending = small("slow", () => new Promise<{ bytes: number }>(done => { release = () => done({ bytes: 100 }); }));
    await small("tiny", async () => ({ bytes: 1 * KB }));
    await big("huge", async () => ({ bytes: 500 * KB }));
    assert.equal(entriesOf("budget-big"), 1, "the entry just loaded stays although it alone exceeds the budget");
    assert.equal(entriesOf("budget-small"), 2, "the pending entry and the 1 KB entry stay");
    release();
    await pending;
    await big("huge2", async () => ({ bytes: 500 * KB }));
    assert.equal(entriesOf("budget-big"), 1, "huge went, huge2 stays");
  });
});

test("STALE_CACHE_MAX_MB=0 turns the budget off", async () => {
  const cache = staleCache<{ bytes: number }>(60_000, 100, { name: "budget-off", ...sized() });
  await withBudget("0", async () => {
    await cache("a", async () => ({ bytes: 400 * 1024 * 1024 }));
    await cache("b", async () => ({ bytes: 400 * 1024 * 1024 }));
    assert.equal(entriesOf("budget-off"), 2);
  });
});

test("a failed epoch reload re-measures the entry it restores, even when that entry settled while out of the map", async () => {
  await withBudget("0", async () => {
  const start = before();
  let epoch = 1;
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 1000, epoch: async () => epoch });
  const first = deferred<string[]>();
  const firstRead = cache("k", () => first.promise);
  await pause(0);
  epoch = 2;
  const reload = deferred<string[]>();
  const reloadRead = cache("k", () => reload.promise);
  await pause(0);
  first.resolve(ids(50));
  assert.equal((await firstRead).length, 50);
  await pause(0);
  await quietErrors(async () => { reload.reject(new Error("boom")); assert.equal((await reloadRead).length, 50); });
  assert.equal(staleCacheStats().weight - start.weight, 51, "the restored entry weighs its value, not 0");
  });
});

test("a weigh that throws or answers a bad number counts as the base weight", async () => {
  await withBudget("0", async () => {
  const start = before();
  const answers: Record<string, () => number> = { throws: () => { throw new Error("bad"); }, nan: () => NaN, infinite: () => Infinity, negative: () => -5 };
  const cache = staleCache<string>(60_000, 100, { weigh: key => answers[key]() });
  for (const key of Object.keys(answers)) assert.equal(await cache(key, async () => key), key);
  const stats = staleCacheStats();
  assert.equal(stats.entries - start.entries, 4);
  assert.equal(stats.weight - start.weight, 4 * 128 + "throwsnaninfinitenegative".length);
  assert.ok(Number.isFinite(stats.weight));
  });
});
