import type { Metadata } from "next";
import { vehicleMakeLabel, vehicleModelCategoryLabels, vehicleModelGroupYears, vehicleModelLabels, withModelYears } from "@/modules/store/vehicle-model-groups";
import { categoryNameInText } from "@/modules/store/category-tree";
import { notFound } from "next/navigation";
import type { SearchParams } from "@/lib/search-params";
import { findListing, type LoadedListing } from "@/modules/store/listing-load";
import { listingIndexable } from "@/modules/seo/indexing";
import { listingPath } from "@/modules/seo/paths";
import { pageMetadata } from "@/lib/site";
import { brandedTitle, catalogMetaDescription, categoryDescription, fitDescription, listingTitlePad } from "@/modules/seo/meta-text";
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
  // A search result's title says what was searched, as its H1 does; the page stays noindex,follow.
  if (query.q) return pageMetadata({ ...brandedTitle(`“${query.q.slice(0, 40)}” için arama sonuçları`), path, robots,
    description: fitDescription(`“${query.q.slice(0, 60)}” için Getirbakim yedek parça kataloğundaki sonuçlar: ürünleri üreticiye göre incele, ürün kodu veya OEM numarasıyla karşılaştır.`) });
  if (make && model) {
    const { name, title } = vehicleModelLabels(make.name, model);
    const count = (plainTotal ?? 0).toLocaleString("tr-TR"), vehicle = withModelYears(name, vehicleModelGroupYears(model));
    if (category) {
      // The category page has no engine-type picker (VehicleModelSummary sits on the model page only): no such advice.
      const parts = categoryNameInText(category.name);
      return pageMetadata({ ...brandedTitle(vehicleModelCategoryLabels(make.name, model, parts).title), path, robots,
        description: fitDescription(`${vehicle} için ${parts} kategorisinde ${count} ürün: üreticiye ve OEM numarasına göre incele.`) });
    }
    return pageMetadata({ ...brandedTitle(title), path, robots,
      description: fitDescription(`${vehicle} için ${count} yedek parça: üreticiye ve OEM numarasına göre incele. Motor tipine göre doğrulamak için aracını seç.`) });
  }
  if (make) {
    const name = vehicleMakeLabel(make.name);
    const parts = category ? categoryNameInText(category.name) : "yedek parçaları";
    return pageMetadata({ ...brandedTitle(category ? listingTitlePad(`${name} ${parts}`) : `${name} ${parts}`), path, robots,
      description: fitDescription(`${name} araçlara uygun ${parts} incele. Ürün kodu, OEM numarası ve araç bilgileriyle uyumluluğu kontrol et.`) });
  }
  if (!category) return pageMetadata({ ...brandedTitle("Yedek parça kataloğu"), path, robots, description: catalogMetaDescription });
  return pageMetadata({ ...brandedTitle(listingTitlePad(category.name)), path, robots,
    description: fitDescription(catalogDescription(category.slug) ?? categoryDescription(category.name)) });
}
