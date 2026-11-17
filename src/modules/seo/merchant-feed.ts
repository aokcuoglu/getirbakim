// The Google Merchant Center / Meta catalog product feed (#643, docs/merchant-feed.md): pure item builder and XML.
// One RSS 2.0 file with the Google namespace, gzipped; scripts/merchant-feed.ts writes it to object storage and
// src/app/feeds/[file]/route.ts serves it. Nothing here reads an account or a discount: the price is the store's own
// list price (KDV included), the same the product page and its Offer show, so a service's B2B price never enters.
import type { CatalogProduct } from "@/modules/store/catalog";
import { listPrice, saleUntil } from "@/modules/store/best-offer";
import { shownProductName } from "@/modules/store/product-name";
import { absoluteUrl } from "./paths";
import { numberWithoutBrand, productSeoDescription, productSeoTitle } from "./product-meta";
import { productPath } from "./product-path";
import { escapeXml, sitemapEnabled } from "./sitemap";
import { offerAvailability } from "./structured-data";

/** A catalog row (after withBestOffers) with what the loader adds: the shown image, a barcode and the category path. */
export type FeedSource = Pick<CatalogProduct, "id" | "supplier" | "source" | "code" | "name" | "name_overridden" | "description" | "oem"
  | "display_brand" | "display_code" | "price_kurus" | "available" | "stock_label" | "pricing_snapshot" | "unavailable"> & {
  image: { src: string; width: number; height: number } | null;
  gtin: string | null;
  /** Category names from the root down. */
  productType: string[];
};

export type FeedItem = {
  id: string; title: string; description: string; link: string; imageLink: string;
  availability: "in_stock"; condition: "new";
  /** "1234.50 TRY"; during a campaign the regular price, with the campaign price in salePrice. */
  price: string; salePrice?: string; salePriceEffectiveDate?: string;
  brand?: string; mpn: string; gtin?: string; identifierExists?: "no";
  googleProductCategory: number; productType?: string;
};

export type FeedSkipReason = "demo" | "noPrice" | "notAvailable" | "noImage";

/** Google product taxonomy: "Vehicles & Parts > Vehicle Parts & Accessories > Motor Vehicle Parts" (taxonomy 2021-09-21). */
export const merchantCategoryId = 899;
/** Google's smallest image for a non-apparel product (shorter side, px). */
export const minimumImageSide = 100;
export const titleLimit = 150;
export const descriptionLimit = 1000;
const productTypeLimit = 750;
const unspecifiedBrand = "Belirtilmemiş";

/** The feed files the route serves, by public name; the object key in S3_BUCKET. */
export const feedFiles: Readonly<Record<string, { key: string }>> = { "google.xml.gz": { key: "feeds/google.xml.gz" } };
/** The last run's counters (MerchantFeedManifest), read by the next run's drop guard. */
export const feedManifestKey = "feeds/google.json";

export function feedFileKey(file: string): string | null {
  return Object.hasOwn(feedFiles, file) ? feedFiles[file].key : null;
}

/** Staging serves no feed, as it serves no sitemap. */
export const feedEnabled = () => sitemapEnabled();

type Env = Record<string, string | undefined>;

/**
 * Why a writing run does nothing. SITE_URL must be given explicitly (as for IndexNow): a run without it would write
 * links to the production domain from wherever it runs.
 */
export function feedDisabledReason(env: Env = process.env): string | null {
  if (env.APP_ENV === "staging") return "APP_ENV is staging";
  if (!env.SITE_URL?.trim()) return "SITE_URL is not set";
  if (!env.S3_BUCKET?.trim()) return "S3_BUCKET is not set";
  return null;
}

const money = (kurus: number) => `${(kurus / 100).toFixed(2)} TRY`;

/**
 * Why a catalog row stays out before its image is looked at: demo, no price, or not offered as in stock by the page
 * (offerAvailability: an unconfirmed or unknown stock is not "in_stock").
 */
export function feedOfferSkipReason(source: Omit<FeedSource, "image" | "gtin" | "productType">): Exclude<FeedSkipReason, "noImage"> | null {
  if (source.supplier === "demo") return "demo";
  if (source.price_kurus === null || !(source.price_kurus >= 1)) return "noPrice";
  const availability = offerAvailability({ priceKurus: source.price_kurus, available: source.available, stockLabel: source.stock_label, unavailable: source.unavailable });
  return availability === "in_stock" ? null : "notAvailable";
}

/** Why a row stays out of the feed, or null when it goes in. Only rows the page offers as in stock, with an image, enter. */
export function feedSkipReason(source: FeedSource): FeedSkipReason | null {
  const offer = feedOfferSkipReason(source);
  if (offer) return offer;
  if (!source.image || Math.min(source.image.width, source.image.height) < minimumImageSide) return "noImage";
  return null;
}

/** The feed item of a row, or null when it stays out (feedSkipReason). `base` is the site origin without a trailing slash. */
export function feedItem(source: FeedSource, base: string, now = new Date()): FeedItem | null {
  if (feedSkipReason(source) !== null || !source.image || source.price_kurus === null) return null;
  const brand = source.display_brand.trim() === unspecifiedBrand ? "" : source.display_brand.trim();
  const name = shownProductName(source);
  const hint = `${source.name} ${source.description}`;
  const regular = listPrice(source);
  const onSale = regular !== null && regular > source.price_kurus;
  const until = onSale ? saleUntil(source) : null;
  const productType = source.productType.join(" > ").slice(0, productTypeLimit);
  return {
    id: source.id,
    title: productSeoTitle({ brand, name, partNumber: source.display_code, vehicles: [], hint, max: titleLimit }).slice(0, titleLimit),
    description: productSeoDescription({ brand, name, partNumber: source.display_code, oem: source.oem, vehicles: [], text: source.description, hint, max: descriptionLimit })
      .slice(0, descriptionLimit),
    link: absoluteUrl(base, productPath(source)),
    imageLink: new URL(source.image.src, `${base}/`).toString(),
    availability: "in_stock", condition: "new",
    price: money(onSale ? regular : source.price_kurus),
    ...onSale ? { salePrice: money(source.price_kurus) } : {},
    ...until && until > now ? { salePriceEffectiveDate: `${now.toISOString()}/${until.toISOString()}` } : {},
    ...brand ? { brand } : {},
    mpn: numberWithoutBrand(source.display_code, source.display_brand),
    ...source.gtin ? { gtin: source.gtin } : {},
    ...!source.gtin && !brand ? { identifierExists: "no" as const } : {},
    googleProductCategory: merchantCategoryId,
    ...productType ? { productType } : {},
  };
}

// XML 1.0 allows tab, line feed, carriage return and the ranges below; anything else (other control characters, a lone
// surrogate) makes the whole file unreadable, so it is dropped before escaping.
const invalidXmlChars = /[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu;
export const xmlText = (value: string) => escapeXml(value.replace(invalidXmlChars, ""));

const tag = (name: string, value: string | number | undefined) => value === undefined ? "" : `<g:${name}>${xmlText(String(value))}</g:${name}>`;

export function renderFeedHeader(base: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n<channel>\n`
    + `<title>Getirbakim</title>\n<link>${xmlText(`${base}/`)}</link>\n<description>Getirbakim yedek parça ürünleri</description>\n`;
}

export function renderFeedItem(item: FeedItem) {
  return `<item>${tag("id", item.id)}${tag("title", item.title)}${tag("description", item.description)}${tag("link", item.link)}`
    + `${tag("image_link", item.imageLink)}${tag("availability", item.availability)}${tag("condition", item.condition)}${tag("price", item.price)}`
    + `${tag("sale_price", item.salePrice)}${tag("sale_price_effective_date", item.salePriceEffectiveDate)}${tag("brand", item.brand)}`
    + `${tag("mpn", item.mpn)}${tag("gtin", item.gtin)}${tag("identifier_exists", item.identifierExists)}`
    + `${tag("google_product_category", item.googleProductCategory)}${tag("product_type", item.productType)}</item>\n`;
}

export function renderFeedFooter() {
  return "</channel>\n</rss>\n";
}

/**
 * False when a run would drop more than half of a feed of over 100 items: a broken price or stock import should not
 * empty the merchant accounts. The old file stays; --force publishes anyway.
 */
export function feedDropGuard(previousCount: number, nextCount: number): boolean {
  return !(previousCount > 100 && nextCount < previousCount / 2);
}

export type FeedCheckoutMode = "live" | "snapshot";

/**
 * Whether a finished run replaces the published file. In snapshot checkout mode every supplier stock is "recorded,
 * unconfirmed" and the page offers nothing as in stock, so the feed is empty on purpose: it is published without the
 * drop guard (switching the mode is a deliberate withdrawal) and the manifest says why.
 */
export function feedPublishDecision(input: { previousItems: number; items: number; checkoutMode: FeedCheckoutMode; force: boolean }):
  { publish: true; note?: string } | { publish: false; reason: string } {
  if (input.checkoutMode === "snapshot") return { publish: true, note: "checkout mode is snapshot: unconfirmed stock is not published, the feed is empty" };
  if (input.force || feedDropGuard(input.previousItems, input.items)) return { publish: true, ...input.force && !feedDropGuard(input.previousItems, input.items) ? { note: "drop guard overridden with --force" } : {} };
  return { publish: false, reason: `${input.items} items would replace ${input.previousItems}: more than half would leave the feed; check prices and stock, or accept with --force` };
}

export type FeedSkipCounters = Record<FeedSkipReason, number>;

/** The JSON object stored next to the feed (feedManifestKey). */
export type MerchantFeedManifest = {
  generatedAt: string; items: number; checked: number; skipped: FeedSkipCounters; checkoutMode: FeedCheckoutMode;
  bytes: number; ms: number; note?: string;
};

export function parseManifest(text: string | null): MerchantFeedManifest | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === "object" && "items" in value && typeof value.items === "number") return value as MerchantFeedManifest;
  } catch { /* an unreadable manifest counts as none */ }
  return null;
}
