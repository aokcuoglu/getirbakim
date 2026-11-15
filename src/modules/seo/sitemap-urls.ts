import { siteUrl } from "@/lib/site";

// Public page paths the sitemap lists, written once (#634); they match the pages' canonicals. #638 moves the pages'
// own canonicals onto these helpers.
export const productPagePath = (id: string) => `/urun/${id}`;
export const categoryPagePath = (slug: string) => `/katalog?category=${slug}`;
export const makePagePath = (slug: string) => `/car-parts/${slug}`;
export const absoluteUrl = (path: string) => `${siteUrl}${path}`;
