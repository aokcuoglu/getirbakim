import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isIndexableListing, parseCatalogQuery, type CatalogQuery } from "@/modules/store/catalog-query";
import type { SearchParams } from "@/lib/search-params";
import { getStoreCategories } from "@/modules/store/categories";
import type { StoreCategory } from "@/modules/store/category-tree";
import { getVehicleBrandBySlug } from "@/modules/store/vehicle-catalog.server";
import type { VehicleBrand } from "@/modules/store/vehicle-catalog";
import { listingPath } from "@/modules/seo/paths";
import { pageMetadata } from "@/lib/site";
import { catalogDescription } from "./catalog-view";

export type Listing = { query: CatalogQuery; category?: StoreCategory; make?: VehicleBrand };

/**
 * The listing behind /katalog, /kategori/<category>[/<make>] and /yedek-parca/<make> (#638). The path segments win
 * over query parameters of the same name; an unknown category or make is a 404, not an unfiltered catalog.
 */
export async function loadListing({ category, make, search }: { category?: string; make?: string; search: SearchParams }): Promise<Listing> {
  const query = parseCatalogQuery({ ...search, category, make });
  const found = category === undefined ? undefined : (await getStoreCategories()).find(node => node.slug === category);
  if (category !== undefined && (query.category !== category || !found)) notFound();
  const brand = make === undefined ? undefined : query.make === make ? await getVehicleBrandBySlug(make) : undefined;
  if (make !== undefined && !brand) notFound();
  return { query, category: found, make: brand };
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
