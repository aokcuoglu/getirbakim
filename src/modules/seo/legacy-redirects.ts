// The pre-#638 listing addresses and where they moved (src/proxy.ts answers with a 301). Pure, one step: every
// target is a current address, which this function itself leaves alone.
// /katalog?brand=<label> without a category is a manufacturer's listing: it moves to /marka/<slug> (#660). The slug
// is the label's own (no database here); a label spelled unlike its master brand ("BLUE PRINT") then lands on an alias
// that the page redirects once more (308). With a category the brand stays a filter of the category page.
import { manufacturerSlug } from "./manufacturer-path";
import { categoryPath, listingPath, makesPath, manufacturerPath, slugPattern } from "./paths";

function withQuery(path: string, search: URLSearchParams, drop: string[] = []) {
  const rest = new URLSearchParams(search);
  for (const key of drop) rest.delete(key);
  // The category moves into the path; a make was only ever read from the path, so a query one is dead weight.
  rest.delete("category");
  rest.delete("make");
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
  const brand = pathname === "/katalog" ? manufacturerSlug(search.get("brand") ?? "") : "";
  if (brand) return withQuery(manufacturerPath(brand), search, ["brand"]);
  return null;
}
