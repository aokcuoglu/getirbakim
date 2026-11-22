import { sitemapMaxWarmIntervalMs, sitemapWarmIntervalMs } from "./sitemap";

// Keeps the slow sitemap files in the data cache (#778). Their queries take tens of seconds, the data goes stale after
// 6 hours (a stale read returns the old data and revalidates in the background) and is evicted after 12: a request
// after that waits for the whole query. The server asks for the files itself at start and every few hours; the stale
// read of such a request starts the refresh, so crawlers get a cached copy. Plain fetch against the server's own
// address: the route fills Next's data cache, whose keys are internal.
export const warmedSitemapFiles = ["models.xml", "model-categories.xml", "make-categories.xml", "manufacturers.xml"] as const;

export type SitemapWarmResult = { file: string; ok: boolean; ms: number };

/** Requests the warmed files one after the other (sequential when cold: they share the database). Never throws. */
export async function warmSitemaps(origin: string, options: { fetch?: typeof fetch; timeoutMs?: number } = {}) {
  const { fetch: get = fetch, timeoutMs = 150_000 } = options;
  const results: SitemapWarmResult[] = [];
  for (const file of warmedSitemapFiles) {
    const started = Date.now();
    let ok = false;
    try {
      const response = await get(`${origin}/sitemaps/${file}`, {
        headers: { "user-agent": "getirbakim-warmup" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
      });
      await response.arrayBuffer();
      ok = response.ok;
    } catch {}
    const ms = Date.now() - started;
    results.push({ file, ok, ms });
    if (!ok || ms > 10_000) console.log(`Sitemap warm-up: ${file} ${ok ? "ok" : "failed"} in ${Math.round(ms / 100) / 10} s`);
  }
  return results;
}

/** The warm-up interval: the setting (ms) or 3 hours, never beyond what keeps the cache from being evicted. */
export const warmIntervalMs = (setting: string | undefined) => Math.min(Number(setting) || sitemapWarmIntervalMs, sitemapMaxWarmIntervalMs);

/**
 * Warms the sitemap files after a random delay (replicas must not hit the database together), then every interval.
 * A round that is still running is not started again. Returns a function that stops it.
 */
export function startSitemapWarmup(origin: string, options: { intervalMs?: number; random?: () => number; warm?: () => Promise<unknown> } = {}) {
  const { intervalMs = warmIntervalMs(process.env.SITEMAP_WARMUP_INTERVAL_MS), random = Math.random, warm = () => warmSitemaps(origin) } = options;
  let running = false, stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try { await warm(); } catch {} finally { running = false; }
  };
  const first = setTimeout(() => {
    void tick();
    if (stopped) return;
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref();
  }, Math.floor(random() * intervalMs));
  first.unref();
  return () => { stopped = true; clearTimeout(first); if (timer) clearInterval(timer); };
}
