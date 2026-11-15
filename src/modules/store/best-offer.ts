// Pure: which of a product's offers sells, and the price a campaign replaces (#580). Shared by the storefront
// (withBestOffers), the admin product page and the matching page so all name the same source.

type Offer = { id: string; price_kurus: number | null; pricing_snapshot?: Record<string, unknown> | null };

function costOf(offer: Offer) {
  const cost = Number(offer.pricing_snapshot?.cost_kurus);
  return offer.pricing_snapshot?.cost_kurus != null && Number.isFinite(cost) ? cost : Infinity;
}

/**
 * Cheapest first; at the same price (a fixed price makes every source of a product equal) the lower cost, then the
 * listing's own row (`primaryId`), then the id, so the choice never depends on row order. Offers without a price last.
 * Mirrored in SQL by the admin product list and the matching page (ORDER BY price, cost_kurus, primary, id).
 */
export function compareOffers(primaryId: string) {
  return (a: Offer, b: Offer) => (a.price_kurus ?? Infinity) - (b.price_kurus ?? Infinity) || costOf(a) - costOf(b)
    || Number(b.id === primaryId) - Number(a.id === primaryId) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The regular price a running campaign sells below (shown struck through); null without a campaign. */
export function listPrice(product: { pricing_snapshot?: Record<string, unknown> | null }): number | null {
  const snapshot = product.pricing_snapshot;
  if (snapshot?.price_kind !== "sale") return null;
  const list = Number(snapshot.list_price_kurus);
  return Number.isSafeInteger(list) && list > 0 ? list : null;
}

/** When a running campaign ends, if it has an end. */
export function saleUntil(product: { pricing_snapshot?: Record<string, unknown> | null }): Date | null {
  const snapshot = product.pricing_snapshot;
  if (snapshot?.price_kind !== "sale" || typeof snapshot.sale_until !== "string") return null;
  const date = new Date(snapshot.sale_until);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The admin's fixed price behind a source's price, if any. */
export function fixedPrice(snapshot: Record<string, unknown> | null | undefined): number | null {
  const value = Number(snapshot?.fixed_price_kurus);
  return snapshot?.source === "override" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** A campaign's end for shoppers, in Istanbul time ("20 Kasım 2026 00:00"). */
export function campaignEndText(date: Date) {
  return new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
