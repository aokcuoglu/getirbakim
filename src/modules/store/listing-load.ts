import "server-only";
import type { SearchParams } from "@/lib/search-params";
import { getStoreCategories } from "./categories";
import { getVehicleBrandBySlug } from "./vehicle-catalog.server";
import { getVehicleModelGroup } from "./vehicle-model-groups.server";
import { listingTotal } from "./catalog";
import { isGatedListing } from "@/modules/seo/indexing";
import { resolveListing, type Listing } from "./listing-resolve";

export type LoadedListing = Listing & {
  /**
   * A gated listing's product count without its filters (model, model × category and make × category pages; #639,
   * #673); undefined on other listings.
   */
  plainTotal?: number;
};

/**
 * The listing behind /katalog, /kategori/<category>[/<make>[/<model>]] and /yedek-parca/<make>[/<model>]; see
 * resolveListing for the rules. Null is a 404, which includes a gated listing (isGatedListing) without any product
 * (#639, #673), with or without filters: the count reads the path's scope only. The route (listing-route.ts) turns
 * null into notFound(); kept apart so scripts/test-vehicle-model-listing.ts can run it.
 */
export async function findListing(input: { category?: string; make?: string; model?: string; search: SearchParams }): Promise<LoadedListing | null> {
  const listing = await resolveListing(input, { categories: getStoreCategories, findMake: getVehicleBrandBySlug, findModel: getVehicleModelGroup });
  if (!listing || !isGatedListing(listing.query)) return listing;
  const { category, make, model } = listing.query;
  const plainTotal = await listingTotal({ category, make, model });
  if (!plainTotal) return null;
  return { ...listing, plainTotal };
}
