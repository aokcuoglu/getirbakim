import test from "node:test";
import assert from "node:assert/strict";
import { formatMemoryLine, startMemoryLog } from "../src/lib/memory-log";

const usage = { rss: 512 * 1048576, heapTotal: 200 * 1048576, heapUsed: 150 * 1048576, external: 20 * 1048576, arrayBuffers: 5 * 1048576 };

const counters = { hits: 0, stale: 0, misses: 0, reloads: 0, adopted: 0, evicted: 0 };
const stats = (caches: { name: string; entries: number; weight: number }[], totals: Partial<typeof counters> = {}) => ({
  entries: caches.reduce((sum, cache) => sum + cache.entries, 0), weight: caches.reduce((sum, cache) => sum + cache.weight, 0),
  ...counters, ...totals, caches: caches.map(cache => ({ ...cache, ...counters })),
});

test("formatMemoryLine prints one line with megabytes and cache stats", () => {
  const line = formatMemoryLine(usage, stats([{ name: "a", entries: 12, weight: 3 * 1048576 }]));
  assert.equal(line, "Memory: rss=512MB heapUsed=150MB heapTotal=200MB external=20MB arrayBuffers=5MB caches=12/3MB hit=0% evicted=0 top=a:12:3.0MB topEntries=a:12");
});

test("the line names the top caches by weight and by entries, and counts hits and evictions since the last line", () => {
  const caches = [{ name: "small", entries: 400, weight: 1048576 }, { name: "heavy", entries: 20, weight: 90 * 1048576 }, { name: "mid", entries: 100, weight: 5.5 * 1048576 }, { name: "empty", entries: 0, weight: 0 }];
  const first = stats(caches, { hits: 10, misses: 10, evicted: 3 });
  const second = stats(caches, { hits: 40, stale: 10, misses: 20, reloads: 0, evicted: 8 });
  const line = formatMemoryLine(usage, second, first, 2);
  assert.match(line, / hit=80% evicted=5 /, "30 hits + 10 stale of 50 reads since the previous line");
  assert.match(line, /top=heavy:20:90.0MB,mid:100:5.5MB topEntries=small:400,mid:100$/);
  assert.match(formatMemoryLine(usage, first), / hit=50% evicted=3 /, "without a previous line the totals count");
});

test("startMemoryLog logs the limits once and then the line every interval", (context) => {
  context.mock.timers.enable({ apis: ["setInterval"] });
  const lines: string[] = [];
  const stop = startMemoryLog({ intervalMs: 1000, log: line => lines.push(line) });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Memory limits: heapLimit=\d+MB total=\d+MB constrained=/);
  context.mock.timers.tick(3000);
  assert.equal(lines.length, 4);
  assert.match(lines[3], /^Memory: rss=\d+MB .* caches=\d+\/\d+MB hit=\d+% evicted=\d+ top= topEntries=$/);
  stop();
  context.mock.timers.tick(3000);
  assert.equal(lines.length, 4);
});

test("an interval of 0 or less disables the log", () => {
  const lines: string[] = [];
  startMemoryLog({ intervalMs: 0, log: line => lines.push(line) })();
  startMemoryLog({ intervalMs: -5, log: line => lines.push(line) })();
  assert.deepEqual(lines, []);
});
