import type { Metadata } from "next";
import { vehicleMakeLabel, vehicleModelCategoryLabels, vehicleModelGroupYears, vehicleModelLabels, withModelYears } from "@/modules/store/vehicle-model-groups";
import { categoryNameInText } from "@/modules/store/category-tree";
import { notFound } from "next/navigation";
import type { SearchParams } from "@/lib/search-params";
import { findListing, type LoadedListing } from "@/modules/store/listing-load";
import { listingIndexable } from "@/modules/seo/indexing";
import { listingPath } from "@/modules/seo/paths";
import { pageMetadata } from "@/lib/site";
import { catalogDescription } from "./catalog-view";

export type { LoadedListing };

/** A meta description: at most `max` characters, cut after a whole word with "…". */
function clipDescription(text: string, max = 180) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1), space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.:;]+$/, "")}…`;
}

export async function loadListing(input: { category?: string; make?: string; model?: string; search: SearchParams }): Promise<LoadedListing> {
  return await findListing(input) ?? notFound();
}

export function listingMetadata({ query, category, make, model, plainTotal }: LoadedListing): Metadata {
  const path = listingPath({ makeSlug: make && query.make, modelSlug: make && model && query.model, categorySlug: category?.slug });
  // Model and make × category pages need enough products to be indexed (#639, #673); the other listings keep the
  // plain-listing rule (#638).
  const robots = listingIndexable(query, plainTotal ?? 0) ? undefined : { index: false, follow: true };
  if (make && model) {
    const { name, title } = vehicleModelLabels(make.name, model);
    const count = (plainTotal ?? 0).toLocaleString("tr-TR"), vehicle = withModelYears(name, vehicleModelGroupYears(model));
    if (category) {
      // The category page has no engine-type picker (VehicleModelSummary sits on the model page only): no such advice.
      const parts = categoryNameInText(category.name);
      return pageMetadata({ title: vehicleModelCategoryLabels(make.name, model, parts).title, path, robots,
        description: clipDescription(`${vehicle} için ${parts} kategorisinde ${count} ürün: üreticiye ve OEM numarasına göre incele.`) });
    }
    return pageMetadata({ title, path, robots,
      description: clipDescription(`${vehicle} için ${count} yedek parça: üreticiye ve OEM numarasına göre incele. Motor tipine göre doğrulamak için aracını seç.`) });
  }
  if (make) {
    const name = vehicleMakeLabel(make.name);
    const parts = category ? categoryNameInText(category.name) : "yedek parçaları";
    return pageMetadata({ title: `${name} ${parts}`, path, robots,
      description: clipDescription(`${name} araçlara uygun ${parts} incele. Ürün kodu, OEM numarası ve araç bilgileriyle uyumluluğu kontrol et.`) });
  }
  return pageMetadata({ title: category?.name ?? "Yedek parça kataloğu", path, robots,
    description: (catalogDescription(category?.slug ?? "yedek-parca") ?? `${category?.name} ürünlerini incele. Ürün kodu ve OEM numarasıyla uyumluluğu kontrol et.`).slice(0, 180) });
}
