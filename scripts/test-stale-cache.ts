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
