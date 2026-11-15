// The pre-#638 listing addresses and where they moved (src/proxy.ts answers with a 301). Pure, one step: every
// target is a current address, which this function itself leaves alone.
import { categoryPath, listingPath, makesPath, slugPattern } from "./paths";

function withQuery(path: string, search: URLSearchParams) {
  const rest = new URLSearchParams(search);
  rest.delete("category");
  rest.delete("_rsc");
  return rest.size ? `${path}?${rest}` : path;
}

/** The current address for an old one, or null when the request is not an old address. */
export function legacyRedirect(pathname: string, search: URLSearchParams): string | null {
  const category = search.get("category");
  const categorySlug = category && slugPattern.test(category) ? category : undefined;
  if (pathname === "/automakers") return withQuery(makesPath, search);
  const make = /^\/car-parts\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (make !== undefined) return slugPattern.test(make) ? withQuery(listingPath({ makeSlug: make, categorySlug }), search) : null;
  if (pathname === "/katalog" && categorySlug) return withQuery(categoryPath(categorySlug), search);
  return null;
}
