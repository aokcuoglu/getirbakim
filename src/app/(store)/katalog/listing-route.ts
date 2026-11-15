import type { Metadata } from "next";
import { vehicleModelGroupYears } from "@/modules/store/vehicle-model-groups";
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

const makeLabel = (name: string) => name === "VOLKSWAGEN" ? "VW" : name;

export function listingMetadata({ query, category, make, model, modelTotal }: LoadedListing): Metadata {
  const path = listingPath({ makeSlug: make && query.make, modelSlug: make && model && query.model, categorySlug: category?.slug });
  // A model page needs enough products to be indexed; the other listings keep the plain-listing rule (#638).
  const robots = listingIndexable(query, modelTotal ?? 0) ? undefined : { index: false, follow: true };
  if (make && model) {
    const name = `${makeLabel(make.name)} ${model.name}`, years = vehicleModelGroupYears(model);
    return pageMetadata({ title: `${name} yedek parçaları`, path, robots,
      description: `${name}${years ? ` (${years})` : ""} için ${(modelTotal ?? 0).toLocaleString("tr-TR")} yedek parça: üreticiye ve OEM numarasına göre incele. Motor tipine göre doğrulamak için aracını seç.`.slice(0, 180) });
  }
  if (make) {
    const name = makeLabel(make.name);
    const parts = category?.name.toLocaleLowerCase("tr") ?? "yedek parçaları";
    return pageMetadata({ title: `${name} ${parts}`, path, robots,
      description: `${name} araçlara uygun ${parts} incele. Ürün kodu, OEM numarası ve araç bilgileriyle uyumluluğu kontrol et.`.slice(0, 180) });
  }
  return pageMetadata({ title: category?.name ?? "Yedek parça kataloğu", path, robots,
    description: (catalogDescription(category?.slug ?? "yedek-parca") ?? `${category?.name} ürünlerini incele. Ürün kodu ve OEM numarasıyla uyumluluğu kontrol et.`).slice(0, 180) });
}
