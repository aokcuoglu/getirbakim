// Pure helpers of measure-memory.mjs (#1461): listing URL variants and the guard that keeps search URLs away from
// the search statistics table.

/** Matches the user agents catalog-view.tsx treats as crawlers (a copy of src/lib/crawler-user-agent.ts, checked by measure-memory.test.mjs); their searches are not recorded in search_query_stats. */
export const crawlerPattern = /bot|crawl|spider|slurp|preview|headless|lighthouse/i;
export const defaultUserAgent = "getirbakim-memory-bot";

export const isCrawlerAgent = (userAgent) => crawlerPattern.test(userAgent ?? "");

/** Whether the server log shows the cache probe's handler installed in process `pid` (src/lib/memory-log.ts). */
export const probeArmed = (logText, pid) => logText.split("\n").some((line) => line.trim() === `Memory probe: armed pid=${pid}`);

/** A search URL (`?q=`) is only allowed with a crawler user agent, so the visit is not recorded as a search. */
export const searchAllowed = (userAgent) => isCrawlerAgent(userAgent);

const SORTS = ["price-asc", "price-desc", "newest"];

/**
 * Listing variants of one plain listing path (no query): the three sorts, pages 2..`pages` (deep pages build the price
 * order), the in-stock filter, and the brand / attribute filter links found in its HTML (same path, `brand=` /
 * `brands=` / `attributes=` queries). Never returns a `q=` URL.
 */
export function listingVariants(path, html = "", { pages = 4, filterLinks = 3 } = {}) {
  if (path.includes("?") || !path.startsWith("/")) return [];
  const variants = [];
  for (const sort of SORTS) variants.push(`${path}?sort=${sort}`);
  for (let page = 2; page <= pages; page++) variants.push(`${path}?page=${page}`);
  variants.push(`${path}?availability=in_stock`, `${path}?availability=in_stock&sort=price-asc`);
  const found = [...html.matchAll(/href="([^"]*\?[^"]*)"/g)]
    .map((match) => match[1].replaceAll("&amp;", "&"))
    .filter((href) => href.startsWith(`${path}?`) && /[?&](brand|brands|attributes)=/.test(href) && !/[?&]q=/.test(href));
  variants.push(...[...new Set(found)].slice(0, filterLinks));
  return variants;
}

/** Search paths (`/katalog?q=…`) from a file of search terms, one per line; empty without a crawler user agent. */
export function searchPaths(terms, userAgent) {
  if (!searchAllowed(userAgent)) return [];
  return terms.map((term) => term.trim()).filter(Boolean).map((term) => `/katalog?q=${encodeURIComponent(term)}`);
}
