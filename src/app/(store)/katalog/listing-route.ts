import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isIndexableListing } from "@/modules/store/catalog-query";
import type { SearchParams } from "@/lib/search-params";
import { getStoreCategories } from "@/modules/store/categories";
import { getVehicleBrandBySlug } from "@/modules/store/vehicle-catalog.server";
import { resolveListing, type Listing } from "@/modules/store/listing-resolve";
import { listingPath } from "@/modules/seo/paths";
import { pageMetadata } from "@/lib/site";
import { catalogDescription } from "./catalog-view";

/** The listing behind /katalog, /kategori/<category>[/<make>] and /yedek-parca/<make>; see resolveListing for the rules. */
export async function loadListing(input: { category?: string; make?: string; search: SearchParams }): Promise<Listing> {
  return await resolveListing(input, { categories: getStoreCategories, findMake: getVehicleBrandBySlug }) ?? notFound();
}

export function listingMetadata({ query, category, make }: Listing): Metadata {
  const path = listingPath({ makeSlug: make && query.make, categorySlug: category?.slug });
  const robots = isIndexableListing(query) ? undefined : { index: false, follow: true };
  if (make) {
    const name = make.name === "VOLKSWAGEN" ? "VW" : make.name;
    const parts = category?.name.toLocaleLowerCase("tr") ?? "yedek parçaları";
    return pageMetadata({ title: `${name} ${parts}`, path, robots,
      description: `${name} araçlara uygun ${parts} incele. Ürün kodu, OEM numarası ve araç bilgileriyle uyumluluğu kontrol et.`.slice(0, 180) });
  }
  return pageMetadata({ title: category?.name ?? "Yedek parça kataloğu", path, robots,
    description: (catalogDescription(category?.slug ?? "yedek-parca") ?? `${category?.name} ürünlerini incele. Ürün kodu ve OEM numarasıyla uyumluluğu kontrol et.`).slice(0, 180) });
}
