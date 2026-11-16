import "server-only";
import { boundedQuery } from "@/lib/db";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import { catalogEntriesSql, listedOnly } from "@/modules/store/catalog";
import { manufacturerIndexable } from "@/modules/store/manufacturers";
import { manufacturerDirectory } from "@/modules/store/manufacturers.server";

/**
 * The manufacturer pages of the sitemap (#660): the pages manufacturerIndexable lets in, counted like the page does
 * (listingTotal({ manufacturer }): listed rows whose display_brand is one of the manufacturer's labels), in one pass
 * over the listing grouped by label.
 */
export async function loadManufacturerSlugs(): Promise<string[]> {
  const [directory, { rows }] = await Promise.all([manufacturerDirectory(),
    boundedQuery<{ label: string; n: number }>(`SELECT display_brand AS label,count(*)::int AS n FROM (${catalogEntriesSql}) catalog WHERE ${listedOnly} GROUP BY 1`, [storefrontCompanies()])]);
  const counts = new Map(rows.map(row => [row.label, row.n]));
  return directory.all
    .filter(manufacturer => manufacturerIndexable(manufacturer.slug, {}, manufacturer.labels.reduce((sum, label) => sum + (counts.get(label) ?? 0), 0)))
    .map(manufacturer => manufacturer.slug);
}
