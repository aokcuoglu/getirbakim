import type { Metadata } from "next";
import { vehicleMakeLabel, vehicleModelGroupYears, vehicleModelLabels } from "@/modules/store/vehicle-model-groups";
import { notFound } from "next/navigation";
import type { SearchParams } from "@/lib/search-params";
import { findListing, type LoadedListing } from "@/modules/store/listing-load";
import { listingIndexable } from "@/modules/seo/indexing";
import { listingPath } from "@/modules/seo/paths";
import { pageMetadata } from "@/lib/site";
import { catalogDescription } from "./catalog-view";

export type { LoadedListing };

export async function loadListing(input: { category?: string; make?: string; model?: string; search: SearchParams }): Promise<LoadedListing> {
  return await findListing(input) ?? notFound();
}

export function listingMetadata({ query, category, make, model, plainTotal }: LoadedListing): Metadata {
  const path = listingPath({ makeSlug: make && query.make, modelSlug: make && model && query.model, categorySlug: category?.slug });
  // Model and make × category pages need enough products to be indexed (#639, #673); the other listings keep the
  // plain-listing rule (#638).
  const robots = listingIndexable(query, plainTotal ?? 0) ? undefined : { index: false, follow: true };
  if (make && model) {
    const { name, title } = vehicleModelLabels(make.name, model), years = vehicleModelGroupYears(model);
    const count = (plainTotal ?? 0).toLocaleString("tr-TR"), vehicle = `${name}${years ? ` (${years})` : ""}`;
    if (category) {
      const parts = category.name.toLocaleLowerCase("tr");
      return pageMetadata({ title: `${name} ${parts}`, path, robots,
        description: `${vehicle} için ${count} ${parts} ürünü: üreticiye ve OEM numarasına göre incele. Motor tipine göre doğrulamak için aracını seç.`.slice(0, 180) });
    }
    return pageMetadata({ title, path, robots,
      description: `${vehicle} için ${count} yedek parça: üreticiye ve OEM numarasına göre incele. Motor tipine göre doğrulamak için aracını seç.`.slice(0, 180) });
  }
  if (make) {
    const name = vehicleMakeLabel(make.name);
    const parts = category?.name.toLocaleLowerCase("tr") ?? "yedek parçaları";
    return pageMetadata({ title: `${name} ${parts}`, path, robots,
      description: `${name} araçlara uygun ${parts} incele. Ürün kodu, OEM numarası ve araç bilgileriyle uyumluluğu kontrol et.`.slice(0, 180) });
  }
  return pageMetadata({ title: category?.name ?? "Yedek parça kataloğu", path, robots,
    description: (catalogDescription(category?.slug ?? "yedek-parca") ?? `${category?.name} ürünlerini incele. Ürün kodu ve OEM numarasıyla uyumluluğu kontrol et.`).slice(0, 180) });
}
