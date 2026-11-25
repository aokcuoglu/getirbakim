import "server-only";
import { buildManufacturerDirectory, manufacturerWarmSlugs } from "./manufacturers";
import { manufacturerRows } from "./manufacturers.server";
import { popularVehicleMakes, vehicleBrandSlug } from "./vehicle-catalog";
import { catalogPath, makePath, makesPath, manufacturerPath } from "@/modules/seo/paths";

/**
 * Requests the most visited storefront pages once when a server starts (#448). Make lists, category ids,
 * counts and the home picks live in per-process caches (staleCache); without this the first visitors of a
 * new container computed them: 4-5 s for a catalog or make page, up to 20 s for Volkswagen. The plain listings'
 * counts, page ids and facets now come from the shared storefront_listing_cache table when another process stored them
 * (#957), so the warm-up mostly loads what that level does not keep. A visitor who arrives during the warm-up shares the
 * pending cache entry instead of starting the same query again. The largest manufacturer pages come last (#771): each
 * scans every row of its brand, and once loaded an epoch bump serves their earlier value while they reload.
 * The health check does not wait for it: the load balancer would mark a slow-starting task unhealthy.
 */
export async function warmStorefront(origin: string, options: { concurrency?: number; timeoutMs?: number } = {}) {
  const { concurrency = 2, timeoutMs = 60_000 } = options;
  const started = Date.now();
  const get = (path: string) => fetch(origin + path, {
    headers: { "user-agent": "getirbakim-warmup" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store",
  });
  if (!(await serverReady(get))) {
    console.error("Storefront warm-up skipped: the server did not answer /api/health");
    return;
  }
  // The catalog page lists the main categories; a failed read leaves only the fixed pages.
  const catalog = await get(catalogPath).then(response => response.ok ? response.text() : "").catch(() => "");
  const categories = [...new Set([...catalog.matchAll(/href="(\/kategori\/[^"?/]+)"/g)].map(match => match[1]))];
  // The largest manufacturers by the directory's own rows; a failed read leaves the pages above.
  const manufacturers = await manufacturerRows()
    .then(rows => manufacturerWarmSlugs(rows, buildManufacturerDirectory(rows)).map(manufacturerPath))
    .catch(() => [] as string[]);
  const paths = ["/", makesPath, ...popularVehicleMakes.map(name => makePath(vehicleBrandSlug(name))), ...categories, ...manufacturers];
  let next = 0, failed = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++];
      try {
        const response = await get(path);
        await response.arrayBuffer();
        if (!response.ok) failed++;
      } catch { failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  console.log(`Storefront warm-up: ${paths.length + 1} pages in ${Math.round((Date.now() - started) / 1000)} s, ${failed} failed`);
}

/** Waits until the server answers its health check (register() runs before it listens). */
async function serverReady(get: (path: string) => Promise<Response>, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { if ((await get("/api/health")).ok) return true; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  return false;
}
