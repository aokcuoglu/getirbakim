import test from "node:test";
import assert from "node:assert/strict";
import { staleCache, staleCacheStats } from "../src/lib/stale-cache";

// Caches register for staleCacheStats only in production; staleCache() reads NODE_ENV when a cache is created.
(process.env as Record<string, string>).NODE_ENV = "production";

const ids = (count: number) => Array.from({ length: count }, (_, index) => String(index));
const weighed = { weigh: (value: string[]) => value.length };
const before = () => staleCacheStats();

test("the weight bound evicts the oldest entries and keeps the newest one", async () => {
  const start = before();
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 10 });
  await cache("a", async () => ids(4));
  await cache("b", async () => ids(4));
  assert.equal(staleCacheStats().weight - start.weight, 8);
  await cache("c", async () => ids(4));
  assert.equal(staleCacheStats().weight - start.weight, 8, "a was evicted");
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
  assert.equal(stats.weight - start.weight, 50);
  let loads = 0;
  await cache("big", async () => { loads++; return []; });
  assert.equal(loads, 0);
});

test("a refresh that changes the size adjusts the total", async () => {
  const start = before();
  const cache = staleCache<string[]>(1, 100, { ...weighed, maxWeight: 1000 });
  await cache("k", async () => ids(10));
  assert.equal(staleCacheStats().weight - start.weight, 10);
  await new Promise(done => setTimeout(done, 10));
  await cache("k", async () => ids(3));
  await new Promise(done => setTimeout(done, 10));
  assert.equal(staleCacheStats().weight - start.weight, 3);
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
  assert.equal(stats.weight - start.weight, 7);
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
  assert.equal(stats.weight - start.weight, 0);
});

test("staleCacheStats sums over instances", async () => {
  const start = before();
  const one = staleCache<string[]>(60_000, 10, weighed);
  const two = staleCache<string[]>(60_000, 10, weighed);
  await one("a", async () => ids(3));
  await two("a", async () => ids(4));
  const stats = staleCacheStats();
  assert.equal(stats.entries - start.entries, 2);
  assert.equal(stats.weight - start.weight, 7);
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
  assert.equal(stats.weight - start.weight, 10, "the total equals the entry's final weight, not the sum of both loads");
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
  const cache = staleCache<string[]>(60_000, 100, { ...weighed, maxWeight: 10, epoch: async () => epoch });
  await cache("a", async () => ids(6));
  await cache("b", async () => ids(4));
  epoch = 2;
  const original = console.error;
  console.error = () => {};
  try { await cache("a", async () => { throw new Error("boom"); }); } finally { console.error = original; }
  assert.ok(staleCacheStats().weight - start.weight <= 10);
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
  assert.equal(staleCacheStats().weight - start.weight, 4, "the pending reload weighs nothing yet");
  reload.resolve(ids(3));
  await pause(0);
  assert.equal(staleCacheStats().weight - start.weight, 7);
  const failing = deferred<string[]>();
  assert.equal((await cache("b", () => failing.promise)).length, 4);
  await quietErrors(async () => { failing.reject(new Error("boom")); await pause(5); });
  const stats = staleCacheStats();
  assert.equal(stats.weight - start.weight, 7, "the restored entry is counted once");
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
