import "server-only";
import { unstable_cache } from "next/cache";
import { loadCategorySlugs, loadMakeSlugs, loadProductChunk } from "./sitemap.server";

// Sitemap data goes through Next's data cache, which cache-handler.mjs keeps in Valkey: one copy shared by every app
// task. unstable_cache does not pass `revalidate` to the handler, so the Valkey entry lives for the handler's default
// TTL (7 days); after 6 hours the first request still gets the old data and Next refreshes it in the background
// (stale-while-revalidate). The project does not use Cache Components, where unstable_cache is the documented way to
// cache data. Kept apart from sitemap.server.ts so tests load the queries without the Next runtime.
const options = { revalidate: 21_600, tags: ["sitemap"] };

export const cachedProductChunk = unstable_cache(loadProductChunk, ["sitemap-products"], options);
export const cachedCategorySlugs = unstable_cache(loadCategorySlugs, ["sitemap-categories"], options);
export const cachedMakeSlugs = unstable_cache(loadMakeSlugs, ["sitemap-makes"], options);
