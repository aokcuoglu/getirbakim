/**
 * Partner (B2B) prices (#424). Every output is TRY kuruş, VAT excluded: the partner is a workshop that adds its
 * own margin and VAT, so it gets the storefront price before VAT, optionally discounted, never below our cost.
 *
 * Exact decimal arithmetic: the inputs are Postgres numerics (`nf` 2 decimals, exchange rate up to 10) and
 * `1.005 * 100` style binary rounding must not move a kuruş.
 */
export const partnerDiscountEnv = "PARTNER_B2B_DISCOUNT_BPS";
/** No configured rate means no discount: an invented default would ship a margin nobody approved. */
export const defaultPartnerDiscountBps = 0;
/** More than 90% is a configuration error. */
export const maxPartnerDiscountBps = 9000;

type Decimal = { digits: bigint; scale: number };
// tsconfig targets ES2017, which has BigInt but not the `1n` literal syntax.
const [zero, one, two, ten, hundred] = [0, 1, 2, 10, 100].map(BigInt);
const maxKurus = BigInt(2_147_483_647);

function toDecimal(value: unknown): Decimal | null {
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : typeof value === "string" ? value.trim() : "";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const fraction = match[3] ?? "";
  const digits = BigInt(match[2] + fraction);
  return { digits: match[1] ? -digits : digits, scale: fraction.length };
}

/** Product of decimals rounded half up to an integer; null when an input is not a plain decimal or not positive. */
function roundedProduct(values: (Decimal | null)[]): number | null {
  let digits = one, scale = 0;
  for (const decimal of values) {
    if (!decimal || decimal.digits <= zero) return null;
    digits *= decimal.digits;
    scale += decimal.scale;
  }
  const divisor = ten ** BigInt(scale);
  const rounded = (digits * two + divisor) / (divisor * two);
  return rounded > zero && rounded <= maxKurus ? Number(rounded) : null;
}

/** round(price × 100 / (100 + vat)) half up, exactly; null for a missing or negative rate or a non-integer price. */
function withoutVat(priceKurus: number, vat: Decimal | null): number | null {
  if (!Number.isSafeInteger(priceKurus) || priceKurus <= 0 || !vat || vat.digits < zero) return null;
  const scale = ten ** BigInt(vat.scale);
  const numerator = BigInt(priceKurus) * hundred * scale, denominator = hundred * scale + vat.digits;
  const rounded = (numerator * two + denominator) / (denominator * two);
  return rounded > zero && rounded <= maxKurus ? Number(rounded) : null;
}

export function resolvePartnerDiscountBps(raw: string | undefined | null): number {
  const parsed = Number((raw ?? "").trim());
  if (!raw?.trim() || !Number.isFinite(parsed) || parsed <= 0) return defaultPartnerDiscountBps;
  return Math.min(Math.round(parsed), maxPartnerDiscountBps);
}

export type PartnerDiscountSource = "panel" | "env" | "none";
export type PartnerDiscount = { discountBps: number; source: PartnerDiscountSource };

/**
 * The partner's requested discount (#1130): its /yonetim value (`panelBps`, partner_settings.discount_bps, 0 included)
 * first, then the deployment fallback (`fallbackBps`, PARTNER_B2B_DISCOUNT_BPS), else none. The cost floor applies later.
 */
export function resolvePartnerDiscount(panelBps: number | null | undefined, fallbackBps: number): PartnerDiscount {
  if (panelBps != null) return { discountBps: Math.min(Math.max(Math.trunc(panelBps), 0), maxPartnerDiscountBps), source: "panel" };
  if (fallbackBps > 0) return { discountBps: fallbackBps, source: "env" };
  return { discountBps: defaultPartnerDiscountBps, source: "none" };
}

/** The storefront's pricing inputs (`commerce_catalog.pricing_snapshot` of a supplier row). */
export type SupplierPricing = { source?: unknown; nf?: unknown; exchange_rate?: unknown; markup_percent?: unknown; vat_percent?: unknown };

export type PartnerPrice = {
  /** Storefront price before VAT. */
  listPriceKurus: number | null;
  /** What the partner pays before VAT: the list price discounted, not below cost. */
  b2bPriceKurus: number | null;
  /** The discount actually applied (smaller than requested when the cost floor applies). */
  discountBps: number;
  vatRateBps: number;
  currency: "TRY";
};

/**
 * `priceKurus`: the storefront's VAT-included price for the row right now (`commerce_catalog.price_kurus`); null
 * means no sellable price, whose freshness and exchange-rate gates decide, so a stale observation never becomes a
 * partner price. A price an admin set (`source: "override"`, #580: fixed or campaign) is the partner's too: its VAT
 * is taken out of the storefront price. Otherwise the formula is recomputed before VAT, exactly.
 */
export function resolvePartnerPrice(pricing: SupplierPricing, priceKurus: number | null, discountBps: number): PartnerPrice {
  const hundredPercent = toDecimal(100);
  const vat = toDecimal(pricing.vat_percent);
  const vatRateBps = vat?.digits === zero ? 0 : roundedProduct([vat, hundredPercent]) ?? 2000;
  const unpriced: PartnerPrice = { listPriceKurus: null, b2bPriceKurus: null, discountBps: 0, vatRateBps, currency: "TRY" };
  if (priceKurus == null) return unpriced;
  const cost = toDecimal(pricing.nf), rate = toDecimal(pricing.exchange_rate);
  const costKurus = roundedProduct([cost, rate, hundredPercent]);
  let listPriceKurus: number | null;
  if (pricing.source === "override") listPriceKurus = withoutVat(priceKurus, vat);
  else {
    // cost × rate × (100 + markup) is the price in kuruş before VAT; the same expression as commerce_catalog.
    const markup = toDecimal(pricing.markup_percent);
    if (!markup || markup.digits < zero) return unpriced;
    const markupFactor = { digits: hundred * ten ** BigInt(markup.scale) + markup.digits, scale: markup.scale };
    listPriceKurus = roundedProduct([cost, rate, markupFactor]);
  }
  if (listPriceKurus == null) return unpriced;
  const requested = Math.min(Math.max(Math.trunc(discountBps), 0), maxPartnerDiscountBps);
  const discounted = Math.round(listPriceKurus * (10000 - requested) / 10000);
  const b2bPriceKurus = costKurus != null && costKurus > discounted ? Math.min(costKurus, listPriceKurus) : discounted;
  return { listPriceKurus, b2bPriceKurus, discountBps: Math.round((listPriceKurus - b2bPriceKurus) / listPriceKurus * 10000), vatRateBps, currency: "TRY" };
}
