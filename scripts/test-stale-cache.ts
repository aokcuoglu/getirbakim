import test from "node:test";
import assert from "node:assert/strict";
import { staleCache, staleCacheStats } from "../src/lib/stale-cache";

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
