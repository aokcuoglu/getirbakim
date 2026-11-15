// The storefront's one source of public listing addresses (#638). Pure: client components import it too.
//   /katalog                         all products and search
//   /arac-markalari                  vehicle makes
//   /yedek-parca/<make>              a make's parts
//   /kategori/<category>             a category
//   /kategori/<category>/<make>      a category for a make
// Reserved: /yedek-parca/<make>/<model> and /kategori/<category>/<make>/<model> (#639), /marka/<manufacturer> (#660).

/** Public listing routes whose query strings the crawler policy narrows (see crawlers.ts). */
export const listingPaths = ["/katalog", "/yedek-parca/", "/kategori/"] as const;

/** The pre-#638 addresses that src/proxy.ts sends to the new ones (see legacy-redirects.ts). */
export const legacyListingPaths = ["/automakers", "/car-parts/"] as const;

/** Category and make slugs: the pattern parseCatalogQuery accepts. */
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const catalogPath = "/katalog";
export const makesPath = "/arac-markalari";

export const makePath = (slug: string) => `/yedek-parca/${slug}`;
export const categoryPath = (slug: string) => `/kategori/${slug}`;

export function absoluteUrl(site: string, path: string) {
  return `${site}${path}`;
}

/** A listing: the catalog or a vehicle make's page, optionally narrowed to a category. */
export function listingPath({ makeSlug, categorySlug }: { makeSlug?: string; categorySlug?: string } = {}) {
  if (categorySlug) return makeSlug ? `${categoryPath(categorySlug)}/${makeSlug}` : categoryPath(categorySlug);
  return makeSlug ? makePath(makeSlug) : catalogPath;
}

type ListingQuery = { make?: string; category?: string } & Record<string, string | undefined>;

/**
 * A listing's address with its filters: the make and the category go into the path, every other value into the
 * query string. A page number is dropped unless `updates` sets one, so a changed filter starts on page 1.
 */
export function listingUrl(query: ListingQuery, updates: ListingQuery = {}) {
  const { make, category, ...rest } = { ...query, page: undefined, ...updates };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) if (value) search.set(key, value);
  const path = listingPath({ makeSlug: make, categorySlug: category });
  return search.size ? `${path}?${search}` : path;
}

/** The catalog search; `searchBy: "code"` limits it to product and OEM numbers. */
export function searchPath({ q, searchBy }: { q: string; searchBy?: "code" }) {
  return `${catalogPath}?${new URLSearchParams(searchBy ? { q, searchBy } : { q })}`;
}
