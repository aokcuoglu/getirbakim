/**
 * User agents treated as crawlers: their searches are not recorded in search_query_stats (catalog-view.tsx). The memory
 * harness (scripts/harness/memory-urls.mjs) keeps a copy; scripts/harness/measure-memory.test.mjs fails when they differ.
 */
export const crawlerUserAgent = /bot|crawl|spider|slurp|preview|headless|lighthouse/i;
export const isCrawlerUserAgent = (userAgent: string | null | undefined) => crawlerUserAgent.test(userAgent ?? "");
