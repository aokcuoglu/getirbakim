export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  // The storefront reads enrichment links from a table that writers mark stale; the server keeps it current (#446).
  const { startEnrichmentLinkSync } = await import("@/modules/store/enrichment-links.server");
  startEnrichmentLinkSync(Number(process.env.ENRICHMENT_LINK_SYNC_INTERVAL_MS || 5_000));
}
