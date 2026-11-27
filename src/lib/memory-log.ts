import { getHeapStatistics, writeHeapSnapshot } from "node:v8";
import { join } from "node:path";
import { totalmem } from "node:os";
import { clearStaleCaches, staleCacheStats } from "@/lib/stale-cache";

const mb = (bytes: number) => `${Math.round(bytes / 1048576)}MB`;

type Stats = ReturnType<typeof staleCacheStats>;
const served = (stats: Stats) => stats.hits + stats.stale;
const lookups = (stats: Stats) => served(stats) + stats.misses + stats.reloads;

/**
 * One log line with the process memory split (RSS vs V8 heap vs external buffers), the stale-cache footprint and, since
 * #1461, what the caches did since `previous` (the last line): `hit` is the share of reads served from memory, `evicted`
 * the entries pushed out. `top` lists the `topN` caches by weight and `topEntries` by entry count, so the log shows
 * which cache grows. scripts/harness/measure-memory.mjs parses the `Memory:` prefix and the `caches=` token.
 */
export function formatMemoryLine(usage: NodeJS.MemoryUsage, stats: Stats, previous: Stats | null = null, topN = 6) {
  const reads = lookups(stats) - (previous ? lookups(previous) : 0);
  const hit = reads > 0 ? Math.round(100 * (served(stats) - (previous ? served(previous) : 0)) / reads) : 0;
  const evicted = stats.evicted - (previous?.evicted ?? 0);
  const top = (key: "weight" | "entries") => [...stats.caches].filter(cache => cache[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, topN);
  const byWeight = top("weight").map(cache => `${cache.name}:${cache.entries}:${cache.weight}`).join(",");
  const byEntries = top("entries").map(cache => `${cache.name}:${cache.entries}`).join(",");
  return `Memory: rss=${mb(usage.rss)} heapUsed=${mb(usage.heapUsed)} heapTotal=${mb(usage.heapTotal)} external=${mb(usage.external)} arrayBuffers=${mb(usage.arrayBuffers)} caches=${stats.entries}/${stats.weight} hit=${hit}% evicted=${evicted} top=${byWeight} topEntries=${byEntries}`;
}

export function memoryLimits() {
  return { heapLimit: getHeapStatistics().heap_size_limit, total: totalmem(), constrained: process.constrainedMemory() };
}

/**
 * Logs the memory limits once and then the memory line every `intervalMs` (#1262), so a container that is killed for
 * memory leaves a trail. The timer is unref'd and does not keep the process alive. `intervalMs <= 0` disables it.
 * Returns a function that stops the timer.
 */
export function startMemoryLog({ intervalMs, log = console.log }: { intervalMs: number; log?: (line: string) => void }) {
  if (!(intervalMs > 0)) return () => {};
  const { heapLimit, total, constrained } = memoryLimits();
  log(`Memory limits: heapLimit=${mb(heapLimit)} total=${mb(total)} constrained=${constrained ? mb(constrained) : "none"}`);
  let previous: Stats | null = null;
  const timer = setInterval(() => {
    const stats = staleCacheStats();
    log(formatMemoryLine(process.memoryUsage(), stats, previous));
    previous = stats;
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}

type Collect = () => void;

/**
 * What emptying each cache frees (#1461): after a full GC, every cache is cleared in turn and the heap measured again.
 * Whatever the caches share (a request context that several values keep alive) is credited to the cache cleared first.
 */
export function probeCaches(collect: Collect, log: (line: string) => void) {
  collect();
  clearStaleCaches((name, entries, weight, clear) => {
    const before = process.memoryUsage().heapUsed;
    clear();
    collect();
    log(`Cache probe: ${name} entries=${entries} weighed=${weight} freed=${((before - process.memoryUsage().heapUsed) / 1048576).toFixed(1)}MB`);
  });
  log(`Cache probe: done heapUsed=${mb(process.memoryUsage().heapUsed)} (freed values are credited to the first cache cleared that held them)`);
}

/**
 * Local measurement only (MEMORY_PROBE=1, never set in production): SIGUSR2 writes a heap snapshot into
 * MEMORY_PROBE_DIR when that is set, and, when the process runs with --expose-gc, empties the caches one by one.
 */
export function startMemoryProbe(log: (line: string) => void = console.log) {
  const collect: Collect = () => (globalThis as { gc?: Collect }).gc?.();
  const hasGc = typeof (globalThis as { gc?: Collect }).gc === "function";
  process.on("SIGUSR2", () => {
    const dir = process.env.MEMORY_PROBE_DIR;
    if (dir) log(`Heap snapshot: ${writeHeapSnapshot(join(dir, `heap-${Date.now()}.heapsnapshot`))}`);
    if (hasGc) probeCaches(collect, log);
    else log("Cache probe: skipped, start node with --expose-gc");
  });
}
