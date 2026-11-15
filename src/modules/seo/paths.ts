/** Public listing routes whose query strings the crawler policy narrows (see crawlers.ts). */
export const listingPaths = ["/katalog", "/car-parts/"] as const;

export const catalogPath = "/katalog";
export const makesPath = "/automakers";

export function categoryPath(slug: string) {
  return `${catalogPath}?category=${slug}`;
}

export function absoluteUrl(site: string, path: string) {
  return `${site}${path}`;
}

export const productPath = (id: string) => `/urun/${id}`;
export const makePath = (slug: string) => `/car-parts/${slug}`;

/** A listing: the catalog or a vehicle make's page, optionally narrowed to a category. */
export function listingPath({ makeSlug, categorySlug }: { makeSlug?: string; categorySlug?: string } = {}) {
  const base = makeSlug ? makePath(makeSlug) : catalogPath;
  return categorySlug ? `${base}?category=${categorySlug}` : base;
}
