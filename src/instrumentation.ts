export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  // The storefront reads enrichment links from a table that writers mark stale; the server keeps it current (#446).
  const { startEnrichmentLinkSync } = await import("@/modules/store/enrichment-links.server");
  startEnrichmentLinkSync(Number(process.env.ENRICHMENT_LINK_SYNC_INTERVAL_MS || 5_000));
  // A trail for container memory kills (#1262): RSS vs heap vs external every MEMORY_LOG_INTERVAL_MS (0 turns it off).
  if (process.env.NODE_ENV === "production") {
    const { startMemoryLog } = await import("@/lib/memory-log");
    startMemoryLog({ intervalMs: Number(process.env.MEMORY_LOG_INTERVAL_MS ?? 300_000) });
    // Local measurement only (#1461): SIGUSR2 takes a heap snapshot and empties the caches one by one.
    if (process.env.MEMORY_PROBE === "1") (await import("@/lib/memory-log")).startMemoryProbe();
  }
  // Fill the per-process catalog caches before visitors do (#448). Production servers only; not awaited.
  if (process.env.NODE_ENV === "production" && process.env.STOREFRONT_WARMUP !== "0") {
    const { warmStorefront } = await import("@/modules/store/warmup.server");
    // The standalone server listens on HOSTNAME. ECS replaces the image's 0.0.0.0 with the task's own name
    // (ip-…compute.internal), and then nothing answers on 127.0.0.1.
    const host = process.env.HOSTNAME && !["0.0.0.0", "::"].includes(process.env.HOSTNAME) ? process.env.HOSTNAME : "127.0.0.1";
    const origin = `http://${host}:${process.env.PORT || 3000}`;
    const { sitemapEnabled } = await import("@/modules/seo/sitemap");
    const { startSitemapWarmup, warmSitemaps } = await import("@/modules/seo/sitemap-warmup");
    // The model sitemap files take tens of seconds to build; a visitor or crawler must not be the one who waits (#778).
    void warmStorefront(origin)
      .catch(error => console.error("Storefront warm-up failed", error instanceof Error ? error.message : error))
      // Random 0-60 s: the tasks of a new release must not run the heavy queries at the same moment.
      .then(() => new Promise(resolve => setTimeout(resolve, Math.random() * 60_000)))
      .then(() => sitemapEnabled() ? warmSitemaps(origin) : undefined);
    if (sitemapEnabled()) startSitemapWarmup(origin);
  }
}
