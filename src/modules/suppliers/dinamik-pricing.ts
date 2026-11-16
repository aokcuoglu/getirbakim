// Pure Dinamik cost rules, kept apart from the import (node:https) so admin client components can use them.

/** Dealer discounts on Dinamik's list price, in percent, applied one after another (commercial terms, #809). */
export const DINAMIK_DEALER_DISCOUNTS = [45, 5] as const;

/** A campaign rate is a percent in [0, 100); anything else (missing, negative, ≥ 100, not a number) is no campaign. */
export function dinamikCampaignRate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 100 ? value : 0;
}

/**
 * VAT-exclusive cost of a Dinamik row: list price less each dealer discount, then the campaign rate, rounded to the
 * kuruş. db/commerce.sql's one-off "dinamik-dealer-discount" backfill uses the same formula.
 */
export function dinamikCost(listPrice: number, campaignRate: unknown) {
  // Exact decimal arithmetic, rounded once at the end (half up), like the backfill's numeric: list prices carry up to
  // 4 decimals (5.219,775) and percents up to 2, so both are scaled to integers; floats would miss half-kuruş ties.
  const factors = [...DINAMIK_DEALER_DISCOUNTS, dinamikCampaignRate(campaignRate)].map(pct => BigInt(10000 - Math.round(pct * 100)));
  const scaled = factors.reduce((n, f) => n * f, BigInt(Math.round(listPrice * 10000)));
  const divisor = 10n ** BigInt(4 * factors.length + 2); // price scale 10⁴ · 10⁴ per factor ÷ 10² for kuruş
  return Number((scaled * 2n + divisor) / (divisor * 2n)) / 100;
}
