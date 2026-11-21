import { notFound } from "next/navigation";
import type { SearchParams } from "@/lib/search-params";
import { findListing, type LoadedListing } from "@/modules/store/listing-load";

export type { LoadedListing };
export { listingMetadata } from "./listing-metadata";

export async function loadListing(input: { category?: string; make?: string; model?: string; search: SearchParams }): Promise<LoadedListing> {
  return await findListing(input) ?? notFound();
}
