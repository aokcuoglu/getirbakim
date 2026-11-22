import { getHeapStatistics } from "node:v8";
import { totalmem } from "node:os";
import { staleCacheStats } from "@/lib/stale-cache";

const mb = (bytes: number) => `${Math.round(bytes / 1048576)}MB`;

/** One log line with the process memory split (RSS vs V8 heap vs external buffers) and the stale-cache footprint. */
export function formatMemoryLine(usage: NodeJS.MemoryUsage, caches: { entries: number; weight: number }) {
  return `Memory: rss=${mb(usage.rss)} heapUsed=${mb(usage.heapUsed)} heapTotal=${mb(usage.heapTotal)} external=${mb(usage.external)} arrayBuffers=${mb(usage.arrayBuffers)} caches=${caches.entries}/${caches.weight}`;
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
  const timer = setInterval(() => log(formatMemoryLine(process.memoryUsage(), staleCacheStats())), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
