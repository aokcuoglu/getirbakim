// Pure builders of the store's schema.org JSON-LD (#637). Nothing here reads an account, a discount or a vehicle:
// the price is the product's own list price, so a service's B2B price never reaches the markup.
import { saleUntil } from "@/modules/store/best-offer";
import { organizationId } from "@/lib/site";
import { absoluteUrl, catalogPath, listingPath, makesPath, productPath } from "./paths";

export type Crumb = { name: string; path: string };
export type JsonLdNode = Record<string, unknown>;
type Named = { name: string; slug: string };

const home: Crumb = { name: "Ana sayfa", path: "/" };

/** Home, catalog, the product's categories, the product (the last crumb is the page itself). */
export function productTrail(input: { categories: Named[]; title: string; productId: string }): Crumb[] {
  return [home, { name: "Katalog", path: catalogPath },
    ...input.categories.map(category => ({ name: category.name, path: listingPath({ categorySlug: category.slug }) })),
    { name: input.title, path: productPath(input.productId) }];
}

/** A listing's trail: without a make "Katalog" (only while no category is chosen), with one "Araç markaları" and the make. */
export function catalogTrail(input: { make?: Named; categories: Named[] }): Crumb[] {
  const makeSlug = input.make?.slug;
  return [home,
    ...input.make ? [{ name: "Araç markaları", path: makesPath }, { name: input.make.name, path: listingPath({ makeSlug }) }]
      : input.categories.length ? [] : [{ name: "Katalog", path: catalogPath }],
    ...input.categories.map(category => ({ name: category.name, path: listingPath({ makeSlug, categorySlug: category.slug }) }))];
}

export function pageTrail(title: string, path: string): Crumb[] {
  return [home, { name: title, path }];
}

export function breadcrumbJsonLd(trail: Crumb[], base: string): JsonLdNode | null {
  if (trail.length < 2) return null;
  return { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: absoluteUrl(base, crumb.path) })) };
}

export type ProductJsonLdInput = {
  id: string; supplier: string; name: string; description?: string; sku: string; mpn: string; brand: string;
  /** Site-relative image paths. */
  images: string[];
  gtin?: { property: "gtin8" | "gtin12" | "gtin13" | "gtin14"; value: string } | null;
  category?: string;
  /** The product's own price (KDV included, no campaign discount of an account). */
  priceKurus: number | null;
  available: boolean; stockLabel: string; unavailable?: boolean;
  pricingSnapshot?: Record<string, unknown> | null;
  vehicleModels?: string[];
};

export const maxStructuredVehicles = 20;
/** From the delivery and return text (teslimat-ve-iade): 14 days without a reason, no return fee with the named carrier. */
export const returnPolicy = { days: 14, country: "TR" } as const;

const outOfStockLabel = "Stokta yok";

function istanbulDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** The Offer, only where the page itself states price and stock: no price, no supply, or an unknown stock gives none. */
export function productOffer(input: ProductJsonLdInput, base: string, now = new Date()): JsonLdNode | null {
  if (input.unavailable || input.priceKurus === null || !(input.priceKurus >= 1)) return null;
  if (!input.available && input.stockLabel !== outOfStockLabel) return null;
  const until = saleUntil({ pricing_snapshot: input.pricingSnapshot });
  return {
    "@type": "Offer", url: absoluteUrl(base, productPath(input.id)),
    price: (input.priceKurus / 100).toFixed(2), priceCurrency: "TRY",
    ...until && until > now ? { priceValidUntil: istanbulDay(until) } : {},
    availability: input.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/NewCondition",
    seller: { "@type": "Organization", "@id": organizationId, name: "Getirbakim", url: base },
    hasMerchantReturnPolicy: { "@type": "MerchantReturnPolicy", applicableCountry: returnPolicy.country,
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow", merchantReturnDays: returnPolicy.days,
      returnMethod: "https://schema.org/ReturnByMail", returnFees: "https://schema.org/FreeReturn" },
  };
}

/** The Product; null for the synthetic demo products, which are not indexed. */
export function productJsonLd(input: ProductJsonLdInput, base: string, now = new Date()): JsonLdNode | null {
  if (input.supplier === "demo") return null;
  const offer = productOffer(input, base, now);
  const vehicles = [...new Set(input.vehicleModels ?? [])].slice(0, maxStructuredVehicles);
  return { "@context": "https://schema.org", "@type": "Product", name: input.name,
    sku: input.sku, mpn: input.mpn, brand: { "@type": "Brand", name: input.brand },
    ...input.description ? { description: input.description } : {},
    ...input.category ? { category: input.category } : {},
    ...input.images.length ? { image: input.images.map(image => absoluteUrl(base, image)) } : {},
    url: absoluteUrl(base, productPath(input.id)),
    ...input.gtin ? { [input.gtin.property]: input.gtin.value } : {},
    ...vehicles.length ? { isAccessoryOrSparePartFor: vehicles.map(name => ({ "@type": "Vehicle", name })) } : {},
    ...offer ? { offers: offer } : {} };
}

export function collectionJsonLd(input: { name: string; description?: string; path: string; items: { id: string; name: string }[] }, base: string): JsonLdNode {
  return { "@context": "https://schema.org", "@type": "CollectionPage", name: input.name, url: absoluteUrl(base, input.path),
    ...input.description ? { description: input.description } : {},
    mainEntity: { "@type": "ItemList", numberOfItems: input.items.length,
      itemListElement: input.items.map((item, index) => ({ "@type": "ListItem", position: index + 1, url: absoluteUrl(base, productPath(item.id)), name: item.name })) } };
}

/** JSON for a script tag: `<` is escaped so no value can close the tag. */
export function serializeJsonLd(data: JsonLdNode): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
