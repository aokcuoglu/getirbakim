// The id inside a product address (/urun/<slug>-<id>, #640). Kept apart from paths.ts: client components read it
// without the name dictionary that building an address needs.
const segmentPattern = /^(?:.*-)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** The bare address of an id: /yonetim links and redirect targets whose row is not at hand; the product page forwards it to productPath. */
export const productIdPath = (id: string) => `/urun/${id}`;

/** The id at the end of a product address segment (any slug before it, any letter case); null for anything else. */
export function productIdFromSegment(segment: string): string | null {
  return segmentPattern.exec(segment)?.[1].toLowerCase() ?? null;
}

/** The id of a product link ("/urun/<slug>-<id>", with a query or hash); null for any other href. */
export function productIdFromHref(href: string): string | null {
  const match = /^\/urun\/([^/?#]+)(?:[?#].*)?$/.exec(href);
  return match ? productIdFromSegment(match[1]) : null;
}
