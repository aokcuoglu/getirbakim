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
