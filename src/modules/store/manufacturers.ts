// Manufacturer pages (/marka/<slug>, #660): a manufacturer is a master brand (brands). The store shows a product under its
// master brand name (the catalog's display_brand, #811), or under an admin's store brand, which may be written as a
// supplier label (supplier_brands.label). Pure: the server loader (manufacturers.server.ts) feeds it the rows,
// scripts/test-manufacturers.ts checks the rules.
import { isIndexableListing, type CatalogQuery } from "./catalog-query";
import { listingIndexable, minIndexableListingProducts } from "@/modules/seo/indexing";
import { manufacturerSlug } from "@/modules/seo/manufacturer-path";
import { descriptionMax, fitDescription } from "@/modules/seo/meta-text";
import { catalogPath, manufacturerPath } from "@/modules/seo/paths";
import type { Crumb } from "@/modules/seo/structured-data";

export type Manufacturer = { id: string; name: string; slug: string; labels: string[] };
/** One supplier label of a master brand and its item count (a brand without labels lists nothing and has no page). */
export type ManufacturerRow = { id: string; name: string; label: string; items: number };
export type ManufacturerMatch = { kind: "page"; manufacturer: Manufacturer } | { kind: "alias"; slug: string };
export type ManufacturerDirectory = {
  find(slug: string): ManufacturerMatch | null;
  /** The manufacturer page of a catalog display_brand (a master brand name or a label), null when its brand has no page. */
  pathForLabel(label: string): string | null;
  /** The manufacturer page of a display_brand value, null when its brand has no page. */
  manufacturerFor(label: string): Manufacturer | null;
  /** Every label of the brand a display_brand value belongs to (its name included), empty for an unknown value. */
  labelsOf(label: string): string[];
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
 * Rules: a brand's labels (the display_brand values its page lists) are its own name and its supplier labels. The store
 * shows a brand's products under its name, so a name belongs to its brand first: brands sharing a name, the larger one
 * owns it, and a supplier label written like another brand's name goes to that brand. Other labels (an admin's store
 * brand written as a label) belong to their brand. A brand whose name leaves no slug has no page; brands sharing a slug:
 * the larger one gets it. A label whose slug differs from its brand's (BLUE PRINT → blueprint) is an alias the page
 * redirects from, unless a page has that slug.
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
  const nameOwner = new Map<string, Brand>();
  for (const brand of brands.values()) {
    const taken = nameOwner.get(brand.name);
    if (!taken || wins(brand, taken)) nameOwner.set(brand.name, brand);
  }
  for (const brand of nameOwner.values()) brand.labels.add(brand.name);
  // A label listed under several brands (different suppliers) belongs to the one with more of its items.
  const labelOwner = new Map<string, Brand>();
  for (const [label, owners] of labelItems) {
    if (nameOwner.has(label)) continue;
    let owner: { brand: Brand; items: number } | undefined;
    for (const [id, items] of owners) {
      const brand = brands.get(id)!;
      if (!owner || items > owner.items || (items === owner.items && BigInt(id) < BigInt(owner.brand.id))) owner = { brand, items };
    }
    labelOwner.set(label, owner!.brand);
    owner!.brand.labels.add(label);
  }

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
  const ownerOf = (label: string) => nameOwner.get(label) ?? labelOwner.get(label);
  const manufacturerFor = (label: string) => {
    const brand = ownerOf(label);
    return brand && pages.get(brand.slug) === brand ? bySlug.get(brand.slug) ?? null : null;
  };
  return {
    all,
    find(slug) {
      const page = bySlug.get(slug);
      if (page) return { kind: "page", manufacturer: page };
      const alias = aliases.get(slug);
      return alias ? { kind: "alias", slug: alias.slug } : null;
    },
    pathForLabel(label) {
      const page = manufacturerFor(label);
      return page ? manufacturerPath(page.slug) : null;
    },
    manufacturerFor,
    labelsOf(label) {
      const brand = ownerOf(label);
      return brand ? [...brand.labels].sort() : [];
    },
  };
}

/**
 * The home page's manufacturer tiles: each entry of `order` (a label or a master brand name) resolves to its
 * manufacturer page, so a rename or merge keeps the tile (#811); tiles show the master brand name the catalog shows, only
 * when the catalog lists it (`shown`: display_brand values), once per manufacturer, in `order`.
 */
export function featuredManufacturers(order: readonly string[], shown: readonly string[], directory: ManufacturerDirectory) {
  const listed = new Set(shown), seen = new Set<string>();
  return order.flatMap(label => {
    const page = directory.manufacturerFor(label);
    if (!page || seen.has(page.slug) || !listed.has(page.name)) return [];
    seen.add(page.slug);
    return [{ brand: page.name, href: manufacturerPath(page.slug) }];
  });
}

/**
 * The manufacturer pages a new server requests once at start (#771): brands with at least `minItems` supplier items
 * (their labels summed), largest first, at most `limit`, each as the page `directory` shows its name under; a brand
 * without a page is left out, and a page reached by two brands is listed once. Their counts, page ids and facets scan
 * every row of the brand (ORIJINAL: ~3 s); warmed, an earlier value exists for the bounded wait after an epoch bump.
 */
export function manufacturerWarmSlugs(rows: ManufacturerRow[], directory: ManufacturerDirectory, minItems = 5000, limit = 60): string[] {
  const brands = new Map<string, { id: string; name: string; items: number }>();
  for (const row of rows) {
    const brand = brands.get(row.id) ?? { id: row.id, name: row.name, items: 0 };
    brand.items += row.items;
    brands.set(row.id, brand);
  }
  const ranked = [...brands.values()].filter(brand => brand.items >= minItems)
    .sort((a, b) => b.items - a.items || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
  const slugs = new Set<string>();
  for (const brand of ranked) {
    if (slugs.size >= limit) break;
    const page = directory.manufacturerFor(brand.name);
    if (page) slugs.add(page.slug);
  }
  return [...slugs];
}

/**
 * A manufacturer page is indexed as a plain listing (no search, filter, sort or page) with at least
 * `minIndexableListingProducts` listed products, unless it is one of the groups that are no manufacturer.
 */
export function manufacturerIndexable(slug: string, query: CatalogQuery, total: number): boolean {
  return isIndexableListing(query) && total >= minIndexableListingProducts && !unindexedManufacturerSlugs.includes(slug);
}

/** Whether a listing view is indexed: the rule behind the page's robots, and so its CollectionPage (#1241). */
export function listingViewIndexable(query: CatalogQuery, scope: { plainTotal?: number; manufacturer?: { slug: string; total: number } }): boolean {
  return scope.manufacturer ? manufacturerIndexable(scope.manufacturer.slug, query, scope.manufacturer.total) : listingIndexable(query, scope.plainTotal ?? 0);
}

export function manufacturerTrail(manufacturer: { name: string; slug: string }): Crumb[] {
  return [{ name: "Ana sayfa", path: "/" }, { name: "Katalog", path: catalogPath }, { name: manufacturer.name, path: manufacturerPath(manufacturer.slug) }];
}

export const manufacturerDescriptionLimit = descriptionMax;

/**
 * The page's title (also its H1), section heading, intro paragraph and meta description (at most 160 characters, fitDescription).
 * "Üretici", not "marka": the store says "marka" for vehicle makes.
 */
export function manufacturerTexts(name: string, total: number) {
  const count = total.toLocaleString("tr-TR");
  return {
    title: `${name} yedek parçaları`,
    heading: `${name} ürünlerini keşfet`,
    intro: `${name} üreticisinin ${count} yedek parça ve bakım ürünü listeleniyor. Ürünleri kategori ve teknik özelliklerine göre süz, ürün kodu veya OEM numarasıyla ara. Siparişten önce ürün sayfasındaki araç uyumluluğunu ve OEM numarasını kontrol et.`,
    description: fitDescription(`${name} üreticisinin ${count} yedek parça ve bakım ürünü: ürün kodu veya OEM numarasıyla ara, fiyat ve stok durumunu gör. Siparişten önce araç uyumluluğunu kontrol et.`, manufacturerDescriptionLimit),
  };
}
