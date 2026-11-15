// The storefront's one source of public listing addresses (#638). Pure: client components import it too.
//   /katalog                         all products and search
//   /arac-markalari                  vehicle makes
//   /yedek-parca/<make>              a make's parts
//   /yedek-parca/<make>/<model>      a vehicle model's parts (#639; model slugs: vehicle-model-groups.ts)
//   /kategori/<category>             a category
//   /kategori/<category>/<make>      a category for a make
// Reserved: /kategori/<category>/<make>/<model> (#639, next slice), /marka/<manufacturer> (#660).
// The crawler rule `/yedek-parca/*?*<param>=` (crawlers.ts) already covers the model pages' query strings.

/** Public listing routes whose query strings the crawler policy narrows (see crawlers.ts). */
export const listingPaths = ["/katalog", "/yedek-parca/", "/kategori/"] as const;

/** The pre-#638 addresses that src/proxy.ts sends to the new ones (see legacy-redirects.ts). */
export const legacyListingPaths = ["/automakers", "/car-parts/"] as const;

/** Category, make and model slugs: the pattern parseCatalogQuery accepts. */
export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const catalogPath = "/katalog";
export const makesPath = "/arac-markalari";

export const makePath = (slug: string) => `/yedek-parca/${slug}`;
export const modelPath = (makeSlug: string, modelSlug: string) => `${makePath(makeSlug)}/${modelSlug}`;
export const categoryPath = (slug: string) => `/kategori/${slug}`;

export function absoluteUrl(site: string, path: string) {
  return `${site}${path}`;
}

/**
 * A listing: the catalog, a vehicle make's or model's page, optionally narrowed to a category. A model counts only
 * with its make.
 */
export function listingPath({ makeSlug, modelSlug, categorySlug }: { makeSlug?: string; modelSlug?: string; categorySlug?: string } = {}) {
  const vehicle = makeSlug ? (modelSlug ? `${makeSlug}/${modelSlug}` : makeSlug) : undefined;
  if (categorySlug) return vehicle ? `${categoryPath(categorySlug)}/${vehicle}` : categoryPath(categorySlug);
  return vehicle ? makePath(vehicle) : catalogPath;
}

type ListingQuery = { make?: string; model?: string; category?: string } & Record<string, string | undefined>;

/**
 * A listing's address with its filters: the make, model and category go into the path, every other value into the
 * query string. A page number is dropped unless `updates` sets one, so a changed filter starts on page 1.
 */
export function listingUrl(query: ListingQuery, updates: ListingQuery = {}) {
  const { make, model, category, ...rest } = { ...query, page: undefined, ...updates };
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(rest)) if (value) search.set(key, value);
  const path = listingPath({ makeSlug: make, modelSlug: model, categorySlug: category });
  return search.size ? `${path}?${search}` : path;
}

/** The catalog search; `searchBy: "code"` limits it to product and OEM numbers. */
export function searchPath({ q, searchBy }: { q: string; searchBy?: "code" }) {
  return `${catalogPath}?${new URLSearchParams(searchBy ? { q, searchBy } : { q })}`;
}
