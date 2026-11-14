export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  // The storefront reads enrichment links from a table that writers mark stale; the server keeps it current (#446).
  const { startEnrichmentLinkSync } = await import("@/modules/store/enrichment-links.server");
  startEnrichmentLinkSync(Number(process.env.ENRICHMENT_LINK_SYNC_INTERVAL_MS || 5_000));
  // Fill the per-process catalog caches before visitors do (#448). Production servers only; not awaited.
  if (process.env.NODE_ENV === "production" && process.env.STOREFRONT_WARMUP !== "0") {
    const { warmStorefront } = await import("@/modules/store/warmup.server");
    // The standalone server listens on HOSTNAME. ECS replaces the image's 0.0.0.0 with the task's own name
    // (ip-…compute.internal), and then nothing answers on 127.0.0.1.
    const host = process.env.HOSTNAME && !["0.0.0.0", "::"].includes(process.env.HOSTNAME) ? process.env.HOSTNAME : "127.0.0.1";
    void warmStorefront(`http://${host}:${process.env.PORT || 3000}`)
      .catch(error => console.error("Storefront warm-up failed", error instanceof Error ? error.message : error));
  }
}
