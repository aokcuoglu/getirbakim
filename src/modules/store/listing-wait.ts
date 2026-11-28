import "server-only";

// The bounded wait of the listing caches (#771, catalog.ts). On globalThis, not in this module: Next bundles
// instrumentation.ts (which runs the warm-up) apart from the route handlers (which read the caches), and each bundle has
// its own copy of this module in the one server process.
const state = globalThis as typeof globalThis & { __storefrontWarmups?: number };
const defaultWaitMs = 250;

/**
 * How long the listing counts, page ids and facets, and the search caches (plain, ranked, ranked fits, suggest, #1394), wait for a reload before serving the earlier value:
 * LISTING_EPOCH_WAIT_MS (blank or invalid: 250 ms). Unbounded (Infinity) while the storefront warm-up runs: its
 * requests must wait for their loads, or each returns after the bound and the warm-up starts the next page's scans while
 * the last ones still run, past the database pool (15 connections, shared with visitors and /api/health).
 */
export function listingWaitMs(): number {
  if (state.__storefrontWarmups) return Infinity;
  const setting = process.env.LISTING_EPOCH_WAIT_MS?.trim();
  const value = setting ? Number(setting) : defaultWaitMs;
  return Number.isFinite(value) && value >= 0 ? value : defaultWaitMs;
}

const defaultStockMaxServeMs = 60 * 60 * 1000;
/**
 * The oldest value a stock-filtered listing or search order cache may serve (#1453): LISTING_STOCK_MAX_SERVE_MS (blank or
 * invalid: 3,600,000, two stock-sync cycles); 0 turns the bound off (undefined). Read per call. Stock syncs do not move the
 * listing epoch, so without it an idle key serves its order and total once however old, a sold-out card inside an in-stock
 * listing; with it that visitor waits for the reload, as for a cold key.
 */
export function stockMaxServeMs(availability: string | undefined): number | undefined {
  if (availability !== "in_stock" && availability !== "out_of_stock") return undefined;
  const setting = process.env.LISTING_STOCK_MAX_SERVE_MS?.trim();
  const value = setting ? Number(setting) : defaultStockMaxServeMs;
  const ms = Number.isFinite(value) && value >= 0 ? value : defaultStockMaxServeMs;
  return ms > 0 ? ms : undefined;
}

/** Runs the storefront warm-up with the listing waits unbounded (listingWaitMs), whatever it throws. */
export async function whileWarming<T>(run: () => Promise<T>): Promise<T> {
  state.__storefrontWarmups = (state.__storefrontWarmups ?? 0) + 1;
  try {
    return await run();
  } finally {
    state.__storefrontWarmups -= 1;
  }
}
