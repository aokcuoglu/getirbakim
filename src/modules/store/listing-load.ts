import "server-only";
import type { SearchParams } from "@/lib/search-params";
import { getStoreCategories } from "./categories";
import { getVehicleBrandBySlug } from "./vehicle-catalog.server";
import { getVehicleModelGroup } from "./vehicle-model-groups.server";
import { listingTotal } from "./catalog";
import { resolveListing, type Listing } from "./listing-resolve";

export type LoadedListing = Listing & {
  /** A model page's product count without its filters (#639); undefined on other listings. */
  modelTotal?: number;
};

/**
 * The listing behind /katalog, /kategori/<category>[/<make>] and /yedek-parca/<make>[/<model>]; see resolveListing
 * for the rules. Null is a 404, which includes a model without any product (#639), with or without filters. The route
 * (listing-route.ts) turns null into notFound(); kept apart so scripts/test-vehicle-model-listing.ts can run it.
 */
export async function findListing(input: { category?: string; make?: string; model?: string; search: SearchParams }): Promise<LoadedListing | null> {
  const listing = await resolveListing(input, { categories: getStoreCategories, findMake: getVehicleBrandBySlug, findModel: getVehicleModelGroup });
  if (!listing?.model) return listing;
  const modelTotal = await listingTotal({ make: listing.query.make, model: listing.query.model });
  if (!modelTotal) return null;
  return { ...listing, modelTotal };
}
