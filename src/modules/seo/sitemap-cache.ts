import "server-only";
import { unstable_cache } from "next/cache";
import { sitemapRevalidateSeconds } from "./sitemap";
import { loadCategorySlugs, loadMakeSlugs, loadProductChunk } from "./sitemap.server";
import { loadManufacturerSlugs } from "./manufacturer-sitemap.server";
import { loadMakeCategoryPaths, loadModelCategoryPaths, loadModelPaths } from "./sitemap-models.server";

// The product key carries a version: the entries hold the address (path), which older cached rows lack.
// Sitemap data goes through Next's data cache, which cache-handler.mjs keeps in Valkey: one copy shared by every app
// task. unstable_cache stores `revalidate` on the entry value and the handler turns it into the Valkey TTL
// (twice the revalidate, 12 hours); after 6 hours the first request still gets the old data and Next refreshes it in the background
// (stale-while-revalidate). The project does not use Cache Components, where unstable_cache is the documented way to
// cache data. Kept apart from sitemap.server.ts so tests load the queries without the Next runtime.
// The model files take tens of seconds to build, so sitemap-warmup.ts refreshes them before the TTL (#778).
const options = { revalidate: sitemapRevalidateSeconds, tags: ["sitemap"] };

export const cachedProductChunk = unstable_cache(loadProductChunk, ["sitemap-products-v2"], options);
export const cachedCategorySlugs = unstable_cache(loadCategorySlugs, ["sitemap-categories-v2"], options);
export const cachedMakeSlugs = unstable_cache(loadMakeSlugs, ["sitemap-makes"], options);
export const cachedManufacturerSlugs = unstable_cache(loadManufacturerSlugs, ["sitemap-manufacturers"], options);
export const cachedModelPaths = unstable_cache(loadModelPaths, ["sitemap-models"], options);
export const cachedModelCategoryPaths = unstable_cache(loadModelCategoryPaths, ["sitemap-model-categories"], options);
export const cachedMakeCategoryPaths = unstable_cache(loadMakeCategoryPaths, ["sitemap-make-categories"], options);
