// Client-safe (no zod): the store card fields an admin can set by hand (db/product-overrides.sql, #575) and the
// product's hand-set prices (#580).

/** The "Mağaza bilgileri" form: NULL follows the automatic sources; hidden=false is the automatic state (published). */
export const productCardFields = ["name", "description", "short_description", "seo_title", "seo_description", "category_id", "hidden", "brand", "part_number"] as const;
/** The "Fiyat" form: VAT-included kuruş; campaign times as Istanbul wall clock "YYYY-MM-DDTHH:MM". NULL is the formula. */
export const productPriceFields = ["price_kurus", "sale_price_kurus", "sale_from", "sale_until"] as const;
/** The references card (#615): the supplier rows' OEM field hidden on the store; false is the automatic state (shown). */
export const productReferenceFlagFields = ["hide_supplier_oem"] as const;
export const productOverrideFields = [...productCardFields, ...productPriceFields, ...productReferenceFlagFields] as const;
export type ProductCardField = (typeof productCardFields)[number];
export type ProductPriceField = (typeof productPriceFields)[number];
export type ProductOverrideField = (typeof productOverrideFields)[number];
export type ProductCardValues = {
  name: string | null; description: string | null;
  /** The intro paragraph under the product page title (#697), at most 300 characters; no automatic source. */
  short_description: string | null;
  seo_title: string | null; seo_description: string | null; category_id: number | null; hidden: boolean;
  /** A master brand's name (brands.name) shown as the store brand (#602). */
  brand: string | null;
  /** The manufacturer part number shown in the store; supplier codes, orders and matching keep the supplier's code. */
  part_number: string | null;
};
export type ProductPriceValues = { price_kurus: number | null; sale_price_kurus: number | null; sale_from: string | null; sale_until: string | null };
export type ProductOverrideValues = ProductCardValues & ProductPriceValues & { hide_supplier_oem: boolean };

export const productOverrideLabels: Record<ProductOverrideField, string> = {
  name: "Mağaza ürün adı",
  description: "Açıklama",
  short_description: "Kısa açıklama",
  seo_title: "SEO başlığı",
  seo_description: "SEO açıklaması",
  category_id: "Kategori",
  hidden: "Mağazada görünürlük",
  brand: "Mağaza markası",
  part_number: "Üretici parça numarası",
  price_kurus: "Sabit satış fiyatı",
  sale_price_kurus: "Kampanya fiyatı",
  sale_from: "Kampanya başlangıcı",
  sale_until: "Kampanya bitişi",
  hide_supplier_oem: "Tedarikçi OEM alanı",
};

/** A save's outcome; on success the stored edits and their version, which the form adopts (product-override-form-state.ts). */
export type ProductOverrideResult = {
  status: "idle" | "success" | "error"; message?: string; reset?: ProductCardField; values?: ProductCardValues; version?: string;
};
/** The price form's save (product-price-form-state.ts); `warning` names sources sold below their cost (the save stands). */
export type ProductPriceResult = {
  status: "idle" | "success" | "error"; message?: string; warning?: string; reset?: "price_kurus" | "sale_price_kurus";
  values?: ProductPriceValues; version?: string;
};

/** VAT-included kuruş as Turkish lira ("₺1.249,90"). */
export function priceText(kurus: number) {
  return (kurus / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
}

/** An Istanbul wall-clock "YYYY-MM-DDTHH:MM" as "20.11.2026 00:00" (already Istanbul time: no conversion). */
export function campaignTimeText(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}` : value;
}

/**
 * A value as the change history shows it: NULL is "automatic"; hidden as published/hidden; a hidden supplier OEM field
 * as "Mağazada gizli"; prices as lira; campaign times in Istanbul time. History rows store text, so numbers arrive as strings.
 */
export function overrideValueText(value: string | number | boolean | null, field?: ProductOverrideField): string | null {
  if (value === null) return null;
  if (field === "hide_supplier_oem") return value === true || value === "true" ? "Mağazada gizli" : null;
  if (typeof value === "boolean") return value ? "Gizli" : "Yayında";
  if (field === "hidden") return value === "true" ? "Gizli" : "Yayında";
  if ((field === "price_kurus" || field === "sale_price_kurus") && /^\d+$/.test(String(value))) return priceText(Number(value));
  if (field === "sale_from" || field === "sale_until") return `${campaignTimeText(String(value))} (İstanbul)`;
  return String(value);
}

/** The VAT-included cost in kuruş, rounded like the catalog; null without a cost or VAT rate. */
export function costWithVat(costKurus: number | null, vatPercent: number | null) {
  if (costKurus === null || vatPercent === null || !Number.isFinite(costKurus) || !Number.isFinite(vatPercent) || costKurus <= 0) return null;
  return Math.round(costKurus * (100 + vatPercent) / 100);
}

/**
 * Whether a VAT-included price is below the source's VAT-included cost (`costKurus`: cost × rate × 100, VAT excluded,
 * from pricing_snapshot.cost_kurus). Unknown inputs are never "below".
 */
export function belowCost(priceKurus: number | null, costKurus: number | null, vatPercent: number | null) {
  const cost = costWithVat(costKurus, vatPercent);
  return priceKurus !== null && cost !== null && priceKurus < cost;
}
