import type { Metadata } from "next";
import { vehicleMakeLabel, vehicleModelCategoryLabels, vehicleModelGroupYears, vehicleModelLabels, withModelYears } from "@/modules/store/vehicle-model-groups";
import { categoryNameInText } from "@/modules/store/category-tree";
import type { LoadedListing } from "@/modules/store/listing-load";
import { listingViewIndexable } from "@/modules/store/manufacturers";
import { listingPath } from "@/modules/seo/paths";
import { pageMetadata } from "@/lib/site";
import { brandedTitle, catalogMetaDescription, categoryDescription, fitDescription, listingTitlePad, searchQueryLabel, searchResultsTitle, vehicleCategoryTexts } from "@/modules/seo/meta-text";
import { catalogDescription } from "./catalog-descriptions";

// Kept apart from listing-route.ts (next/navigation, the database) so the metadata can be tested on its own (#1218).
export function listingMetadata({ query, category, make, model, plainTotal }: LoadedListing): Metadata {
  const path = listingPath({ makeSlug: make && query.make, modelSlug: make && model && query.model, categorySlug: category?.slug });
  // Model and make × category pages need enough products to be indexed (#639, #673); the other listings keep the
  // plain-listing rule (#638).
  const robots = listingViewIndexable(query, { plainTotal }) ? undefined : { index: false, follow: true };
  // A search result's title says what was searched, as its H1 does; the page stays noindex,follow.
  if (query.q) return pageMetadata({ ...brandedTitle(searchResultsTitle(query.q)), path, robots,
    description: fitDescription(`“${searchQueryLabel(query.q)}” için Getirbakim yedek parça kataloğundaki sonuçlar: ürünleri üreticiye göre incele, ürün kodu veya OEM numarasıyla karşılaştır.`) });
  if (make && model) {
    const { name, title } = vehicleModelLabels(make.name, model);
    const count = (plainTotal ?? 0).toLocaleString("tr-TR"), vehicle = withModelYears(name, vehicleModelGroupYears(model));
    if (category) {
      // The category page has no engine-type picker (VehicleModelSummary sits on the model page only): no such advice.
      const parts = categoryNameInText(category.name);
      return pageMetadata({ ...brandedTitle(vehicleModelCategoryLabels(make.name, model, parts).title), path, robots,
        description: vehicleCategoryTexts(vehicle, parts, plainTotal ?? 0, "model").description });
    }
    return pageMetadata({ ...brandedTitle(title), path, robots,
      description: fitDescription(`${vehicle} için ${count} yedek parça: üreticiye ve OEM numarasına göre incele. Motor tipine göre doğrulamak için aracını seç.`) });
  }
  if (make) {
    const name = vehicleMakeLabel(make.name);
    const parts = category ? categoryNameInText(category.name) : "yedek parçaları";
    if (category) return pageMetadata({ ...brandedTitle(listingTitlePad(`${name} ${parts}`)), path, robots,
      description: vehicleCategoryTexts(name, parts, plainTotal ?? 0, "make").description });
    return pageMetadata({ ...brandedTitle(category ? listingTitlePad(`${name} ${parts}`) : `${name} ${parts}`), path, robots,
      description: fitDescription(`${name} araçlara uygun ${parts} incele. Ürün kodu, OEM numarası ve araç bilgileriyle uyumluluğu kontrol et.`) });
  }
  if (!category) return pageMetadata({ ...brandedTitle("Yedek parça kataloğu"), path, robots, description: catalogMetaDescription });
  return pageMetadata({ ...brandedTitle(listingTitlePad(category.name)), path, robots,
    description: fitDescription(catalogDescription(category.slug) ?? categoryDescription(category.name)) });
}
