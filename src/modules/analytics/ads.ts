import type { AnalyticsItem } from "@/modules/analytics/events";
import type { AdsConfig } from "@/modules/analytics/config";

/** One call to an advertising tag: `gtag(...args)` for Google Ads, `fbq(...args)` for Meta Pixel. */
export type AdCommand = { tag: "gtag" | "fbq"; args: unknown[] };

const metaEvents: Record<string, string> = {
  view_item: "ViewContent", add_to_cart: "AddToCart", begin_checkout: "InitiateCheckout", purchase: "Purchase",
};

const itemsOf = (params: Record<string, unknown>) =>
  (Array.isArray(params.items) ? params.items : []) as AnalyticsItem[];
const valueOf = (params: Record<string, unknown>) => (typeof params.value === "number" ? params.value : 0);
const currencyOf = (params: Record<string, unknown>) => (typeof params.currency === "string" ? params.currency : "TRY");

/**
 * The advertising commands for a GA4 event (#676). The payload carries only product ids, quantities, prices, the order value
 * and the order number; no personal data. Meta's own requests still carry the page address (fbevents.js adds it).
 * `value` is the GA4 value (VAT included, shipping excluded).
 */
export function adCommands(
  name: string, params: Record<string, unknown>, cfg: { ads: AdsConfig | null; metaPixel: string | null },
): AdCommand[] {
  const commands: AdCommand[] = [];
  const items = itemsOf(params);
  const value = valueOf(params);
  const currency = currencyOf(params);
  const metaEvent = metaEvents[name];
  if (cfg.metaPixel && metaEvent) {
    const payload: Record<string, unknown> = {
      content_type: "product",
      content_ids: items.map(item => item.item_id),
      contents: items.map(item => ({ id: item.item_id, quantity: item.quantity, item_price: item.price })),
      value, currency,
    };
    if (name === "begin_checkout" || name === "purchase") payload.num_items = items.reduce((sum, item) => sum + item.quantity, 0);
    const args: unknown[] = ["track", metaEvent, payload];
    // The order number deduplicates a purchase sent twice (e.g. later by the Conversions API).
    if (name === "purchase" && typeof params.transaction_id === "string") args.push({ eventID: params.transaction_id });
    commands.push({ tag: "fbq", args });
  }
  if (name === "purchase" && cfg.ads?.purchaseLabel) {
    commands.push({
      tag: "gtag",
      args: ["event", "conversion", {
        send_to: `${cfg.ads.id}/${cfg.ads.purchaseLabel}`, value, currency, transaction_id: params.transaction_id,
      }],
    });
  }
  return commands;
}
