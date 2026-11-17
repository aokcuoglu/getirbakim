// Pure builders of the store's schema.org JSON-LD (#637). Nothing here reads an account, a discount or a vehicle:
// the price is the product's own list price, so a service's B2B price never reaches the markup.
import { saleUntil } from "@/modules/store/best-offer";
import { defaultSocialImage, organizationId, siteName } from "@/lib/site";
import { guidePath, guidesPath, type Guide } from "@/content/guides";
import { absoluteUrl, catalogPath, listingPath, makesPath } from "./paths";

export type Crumb = { name: string; path: string };
export type JsonLdNode = Record<string, unknown>;
type Named = { name: string; slug: string };

const home: Crumb = { name: "Ana sayfa", path: "/" };

/** Home, catalog, the product's categories, the product (the last crumb is the page itself). */
export function productTrail(input: { categories: Named[]; title: string; path: string }): Crumb[] {
  return [home, { name: "Katalog", path: catalogPath },
    ...input.categories.map(category => ({ name: category.name, path: listingPath({ categorySlug: category.slug }) })),
    { name: input.title, path: input.path }];
}

/**
 * A listing's trail: without a make "Katalog" (only while no category is chosen), with one "Araç markaları", the make
 * and its model (#639).
 */
export function catalogTrail(input: { make?: Named; model?: Named; categories: Named[] }): Crumb[] {
  const makeSlug = input.make?.slug, modelSlug = input.make && input.model?.slug;
  return [home,
    ...input.make ? [{ name: "Araç markaları", path: makesPath }, { name: input.make.name, path: listingPath({ makeSlug }) },
      ...input.model ? [{ name: input.model.name, path: listingPath({ makeSlug, modelSlug }) }] : []]
      : input.categories.length ? [] : [{ name: "Katalog", path: catalogPath }],
    ...input.categories.map(category => ({ name: category.name, path: listingPath({ makeSlug, modelSlug, categorySlug: category.slug }) }))];
}

export function pageTrail(title: string, path: string): Crumb[] {
  return [home, { name: title, path }];
}

/** Home, guides, and the article (when `guide` is given). */
export function guideTrail(guide?: Pick<Guide, "title" | "slug">): Crumb[] {
  return [home, { name: "Rehber", path: guidesPath }, ...guide ? [{ name: guide.title, path: guidePath(guide.slug) }] : []];
}

export function breadcrumbJsonLd(trail: Crumb[], base: string): JsonLdNode | null {
  if (trail.length < 2) return null;
  return { "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({ "@type": "ListItem", position: index + 1, name: crumb.name, item: absoluteUrl(base, crumb.path) })) };
}

export type ProductJsonLdInput = {
  /** The product's address (productPath). */
  path: string; supplier: string; name: string; description?: string; sku: string; mpn: string; brand: string;
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

/** The stock labels of db/commerce.sql the markup depends on (a test ties both to the SQL). */
export const outOfStockLabel = "Stokta yok";
export const unconfirmedStockLabel = "Stokta · Siparişten sonra teyit edilir";
/** The label before #878: a page cached or a view not yet re-created still carries it. */
export const legacyUnconfirmedStockLabel = "Kayıtlı stokta mevcut · Teyit bekliyor";
const unconfirmedStockLabels = new Set([unconfirmedStockLabel, legacyUnconfirmedStockLabel]);

function istanbulDay(date: Date) {
  // The last moment of the offer: a campaign ending at midnight ends on the day before.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date.getTime() - 1));
}

/** The Offer, only where the page itself states price and stock: no price, no supply, or an unknown stock gives none. */
export function productOffer(input: ProductJsonLdInput, base: string, now = new Date()): JsonLdNode | null {
  if (input.unavailable || input.priceKurus === null || !(input.priceKurus >= 1)) return null;
  // A recorded but unconfirmed stock is not published as InStock; an unknown stock is not OutOfStock.
  if (input.available ? unconfirmedStockLabels.has(input.stockLabel) : input.stockLabel !== outOfStockLabel) return null;
  const until = saleUntil({ pricing_snapshot: input.pricingSnapshot });
  return {
    "@type": "Offer", url: absoluteUrl(base, input.path),
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
    url: absoluteUrl(base, input.path),
    ...input.gtin ? { [input.gtin.property]: input.gtin.value } : {},
    ...vehicles.length ? { isAccessoryOrSparePartFor: vehicles.map(name => ({ "@type": "Vehicle", name })) } : {},
    ...offer ? { offers: offer } : {} };
}

export function collectionJsonLd(input: { name: string; description?: string; path: string; items: { path: string; name: string }[] }, base: string): JsonLdNode {
  return { "@context": "https://schema.org", "@type": "CollectionPage", name: input.name, url: absoluteUrl(base, input.path),
    ...input.description ? { description: input.description } : {},
    mainEntity: { "@type": "ItemList", numberOfItems: input.items.length,
      itemListElement: input.items.map((item, index) => ({ "@type": "ListItem", position: index + 1, url: absoluteUrl(base, item.path), name: item.name })) } };
}

type ArticleInput = { title: string; description: string; path: string; published: string; updated: string; image?: { url: string } };

/** An Article whose author and publisher is the organization (no person is named). */
export function articleJsonLd(input: ArticleInput, base: string): JsonLdNode {
  const org = { "@type": "Organization", "@id": organizationId, name: siteName };
  return { "@context": "https://schema.org", "@type": "Article", headline: input.title, description: input.description,
    datePublished: input.published, dateModified: input.updated, inLanguage: "tr-TR",
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(base, input.path) },
    author: org, publisher: org,
    image: absoluteUrl(base, (input.image ?? defaultSocialImage).url) };
}

/** A FAQPage; the answer text is the plain text the page shows. Null without questions. */
export function faqJsonLd(items: { question: string; answer: string }[]): JsonLdNode | null {
  if (!items.length) return null;
  return { "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: items.map(item => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })) };
}

/** The About page; the organization itself is printed once by the layout, so only its @id is referenced. */
export function aboutPageJsonLd(path: string, base: string): JsonLdNode {
  return { "@context": "https://schema.org", "@type": "AboutPage", url: absoluteUrl(base, path), inLanguage: "tr-TR", mainEntity: { "@id": organizationId } };
}

/** JSON for a script tag: `<` is escaped so no value can close the tag. */
export function serializeJsonLd(data: JsonLdNode): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
