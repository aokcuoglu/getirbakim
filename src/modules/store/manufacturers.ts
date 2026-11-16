// Manufacturer pages (/marka/<slug>, #660): a manufacturer is a master brand (brands); the store shows the suppliers'
// labels (supplier_brands.label, the catalog's display_brand), each placed under one master brand. Pure: the server
// loader (manufacturers.server.ts) feeds it the rows, scripts/test-manufacturers.ts checks the rules.
import { isIndexableListing, type CatalogQuery } from "./catalog-query";
import { minIndexableListingProducts } from "@/modules/seo/indexing";
import { manufacturerSlug } from "@/modules/seo/manufacturer-path";
import { catalogPath, manufacturerPath } from "@/modules/seo/paths";
import type { Crumb } from "@/modules/seo/structured-data";

export type Manufacturer = { id: string; name: string; slug: string; labels: string[] };
/** One supplier label of a master brand and its item count (a brand without labels lists nothing and has no page). */
export type ManufacturerRow = { id: string; name: string; label: string; items: number };
export type ManufacturerMatch = { kind: "page"; manufacturer: Manufacturer } | { kind: "alias"; slug: string };
export type ManufacturerDirectory = {
  find(slug: string): ManufacturerMatch | null;
  /** The manufacturer page of a catalog display_brand, null when its brand has no page. */
  pathForLabel(label: string): string | null;
  all: Manufacturer[];
};

/**
 * Groups that are no manufacturer: genuine parts of many vehicle makers (ORIJINAL, with the "BMW ORIJINAL", "OE-PSA"…
 * labels), countries of origin (TAIWAN; KOREA and KORE: unbranded Korean parts) and the catalog's "Belirtilmemiş".
 * Their pages open (noindex,follow) but stay out of the sitemap. Chosen from the brands by item count (2026-11-16).
 */
export const unindexedManufacturerSlugs: readonly string[] = ["orijinal", "taiwan", "korea", "kore", "belirtilmemis"];

type Brand = { id: string; name: string; slug: string; items: number; labels: Set<string> };
/** The larger brand by item count wins a contested label or slug; on a tie the older (smaller id). */
const wins = (a: Brand, b: Brand) => a.items !== b.items ? a.items > b.items : BigInt(a.id) < BigInt(b.id);

/**
 * Rules: a brand's labels are its supplier labels plus its own name unless that name is another brand's label (an
 * admin's store brand may be written as the master name). A brand whose name leaves no slug has no page; brands sharing
 * a slug: the larger one gets it. A label whose slug differs from its brand's (BLUE PRINT → blueprint) is an alias
 * the page redirects from, unless a page has that slug.
 */
export function buildManufacturerDirectory(rows: ManufacturerRow[]): ManufacturerDirectory {
  const brands = new Map<string, Brand>();
  const labelItems = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const brand = brands.get(row.id) ?? { id: row.id, name: row.name, slug: manufacturerSlug(row.name), items: 0, labels: new Set<string>() };
    brand.items += row.items;
    brands.set(row.id, brand);
    const owners = labelItems.get(row.label) ?? new Map<string, number>();
    owners.set(row.id, (owners.get(row.id) ?? 0) + row.items);
    labelItems.set(row.label, owners);
  }
  // A label listed under several brands (different suppliers) belongs to the one with more of its items.
  const labelOwner = new Map<string, Brand>();
  for (const [label, owners] of labelItems) {
    let owner: { brand: Brand; items: number } | undefined;
    for (const [id, items] of owners) {
      const brand = brands.get(id)!;
      if (!owner || items > owner.items || (items === owner.items && BigInt(id) < BigInt(owner.brand.id))) owner = { brand, items };
    }
    labelOwner.set(label, owner!.brand);
    owner!.brand.labels.add(label);
  }
  for (const brand of brands.values()) if (!labelOwner.has(brand.name)) { brand.labels.add(brand.name); labelOwner.set(brand.name, brand); }

  const pages = new Map<string, Brand>();
  for (const brand of brands.values()) {
    if (!brand.slug) continue;
    const taken = pages.get(brand.slug);
    if (!taken || wins(brand, taken)) pages.set(brand.slug, brand);
  }
  const aliases = new Map<string, Brand>();
  for (const brand of pages.values()) for (const label of brand.labels) {
    const slug = manufacturerSlug(label);
    if (!slug || slug === brand.slug || pages.has(slug)) continue;
    const taken = aliases.get(slug);
    if (!taken || wins(brand, taken)) aliases.set(slug, brand);
  }
  const manufacturer = (brand: Brand): Manufacturer => ({ id: brand.id, name: brand.name, slug: brand.slug, labels: [...brand.labels].sort() });
  const all = [...pages.values()].map(manufacturer).sort((a, b) => a.slug.localeCompare(b.slug));
  const bySlug = new Map(all.map(entry => [entry.slug, entry]));
  return {
    all,
    find(slug) {
      const page = bySlug.get(slug);
      if (page) return { kind: "page", manufacturer: page };
      const alias = aliases.get(slug);
      return alias ? { kind: "alias", slug: alias.slug } : null;
    },
    pathForLabel(label) {
      const brand = labelOwner.get(label);
      return brand && pages.get(brand.slug) === brand ? manufacturerPath(brand.slug) : null;
    },
  };
}

/**
 * A manufacturer page is indexed as a plain listing (no search, filter, sort or page) with at least
 * `minIndexableListingProducts` listed products, unless it is one of the groups that are no manufacturer.
 */
export function manufacturerIndexable(slug: string, query: CatalogQuery, total: number): boolean {
  return isIndexableListing(query) && total >= minIndexableListingProducts && !unindexedManufacturerSlugs.includes(slug);
}

export function manufacturerTrail(manufacturer: { name: string; slug: string }): Crumb[] {
  return [{ name: "Ana sayfa", path: "/" }, { name: "Katalog", path: catalogPath }, { name: manufacturer.name, path: manufacturerPath(manufacturer.slug) }];
}

/** The page's title (also its H1), section heading, intro paragraph and meta description (at most 180 characters). */
export function manufacturerTexts(name: string, total: number) {
  const count = total.toLocaleString("tr-TR");
  return {
    title: `${name} yedek parçaları`,
    heading: `${name} ürünlerini keşfet`,
    intro: `${name} markasının ${count} yedek parça ve bakım ürünü listeleniyor. Ürünleri kategori ve teknik özelliklerine göre süz, ürün kodu veya OEM numarasıyla ara. Siparişten önce ürün sayfasındaki araç uyumluluğunu ve OEM numarasını kontrol et.`,
    description: `${name} marka ${count} yedek parça ve bakım ürünü: ürün kodu veya OEM numarasıyla ara, fiyat ve stok bilgisini gör. Siparişten önce araç uyumluluğunu kontrol et.`.slice(0, 180),
  };
}
