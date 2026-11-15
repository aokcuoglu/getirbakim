import type { MetadataRoute } from "next";
import { listingPaths } from "./paths";

/** Account, cart, order and admin surfaces plus the API: never useful to a crawler. */
export const privatePaths = ["/yonetim", "/api/", "/sepet", "/giris", "/garaj", "/siparis/", "/siparisler", "/siparis-olustur", "/servisler/basvuru"];

/** Public, unauthenticated media routes: the store's images live under /api, so they need an explicit Allow. */
export const publicMediaPaths = ["/api/product-media/", "/api/category-media/", "/api/vehicle-media/", "/api/manufacturer-logos/"];

/**
 * Listing query parameters that only produce unbounded filter/search combinations. `category`, `brand` and `page` stay
 * open: they are the HTML links that lead crawlers to product pages, and those pages already send noindex,follow.
 * Trade-off: a blocked URL's noindex is never read, so an externally linked one can show up as "blocked by robots.txt".
 * The rules are anchored to listing paths so `/_next/image?url=…&q=75` stays crawlable.
 */
export const blockedListingParams = ["q", "sort", "brands", "attributes", "availability", "fits", "oil"];

export function listingParamRules() {
  return listingPaths.flatMap(path => blockedListingParams.map(param => (path.endsWith("/") ? `${path}*?*${param}=` : `${path}?*${param}=`)));
}

/** Search and AI crawlers addressed by name; verified against publishers' documentation where possible. */
export const aiCrawlers = [
  "GPTBot", "OAI-SearchBot", "ChatGPT-User",
  "ClaudeBot", "Claude-SearchBot", "Claude-User",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot", "Applebot-Extended", "Bingbot",
  "CCBot", "Amazonbot", "meta-externalagent", "DuckAssistBot", "MistralAI-User",
];

export function robotsPolicy({ staging, site }: { staging: boolean; site: string }): MetadataRoute.Robots {
  if (staging) return { rules: { userAgent: "*", disallow: "/" } };
  const body = { allow: ["/", ...publicMediaPaths], disallow: [...privatePaths, ...listingParamRules()] };
  return { rules: [{ userAgent: "*", ...body }, { userAgent: aiCrawlers, ...body }], sitemap: `${site}/sitemap.xml` };
}

export const privatePageRobots = { index: false, follow: false } as const;
