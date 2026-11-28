import "server-only";
import { db } from "@/lib/db";
import { staleCache, weighJson } from "@/lib/stale-cache";
import { listingEpoch } from "./listing-epoch";
import { buildManufacturerDirectory, type ManufacturerDirectory, type ManufacturerRow } from "./manufacturers";

// The manufacturer directory (#660): every master brand with its supplier labels, ~1k rows. Brands and labels change
// with supplier syncs and admin brand decisions; cached per process for 10 minutes like the listing aggregates, and
// reloaded when an admin edit moves the listing epoch.
const cachedDirectory = staleCache<ManufacturerDirectory>(10 * 60 * 1000, 1, {name:"manufacturer-directory", epoch: listingEpoch, weigh: weighJson });

/** Every master brand's supplier labels with their item counts: the rows the directory is built from. */
export async function manufacturerRows(): Promise<ManufacturerRow[]> {
  return (await db.query<ManufacturerRow>(
    "SELECT b.id::text AS id,b.name,sb.label,sb.items FROM brands b JOIN supplier_brands sb ON sb.brand_id=b.id ORDER BY b.id,sb.label")).rows;
}

export function manufacturerDirectory(): Promise<ManufacturerDirectory> {
  return cachedDirectory("all", async () => buildManufacturerDirectory(await manufacturerRows()));
}

export async function findManufacturer(slug: string) {
  return (await manufacturerDirectory()).find(slug);
}

/** The catalog display_brand values of a manufacturer page; empty for an unknown slug or an alias. */
export async function manufacturerLabels(slug: string): Promise<string[]> {
  const match = await findManufacturer(slug);
  return match?.kind === "page" ? match.manufacturer.labels : [];
}

export async function manufacturerPathForLabel(label: string): Promise<string | null> {
  return (await manufacturerDirectory()).pathForLabel(label);
}
