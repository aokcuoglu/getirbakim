import "server-only";
// Callers resolve the customer's owners from the session (order-read.ts); kept free of it so tests can run it.
import { db } from "@/lib/db";
import { catalogItem, purchase, vatIncludedKurus, type AnalyticsItem, type PurchaseEvent } from "@/modules/analytics/events";
import { PURCHASE_EVENT_WINDOW_DAYS } from "@/modules/analytics/purchase";
import { storefrontCompanies } from "@/modules/suppliers/storefront-sources";
import type { CartOwner } from "./cart";
import { catalogSql, listingIds } from "./catalog";
import { getCatalogProductDetails } from "./product-enrichment";
import { catalogCardTitle } from "./product-override-display";

// The order the claim may take: the customer's own, paid, not measured yet and paid within the window.
const claimable = `id=$1 AND payment_status='paid' AND purchase_tracked_at IS NULL
 AND paid_at > now() - make_interval(days => $2) AND (owner_kind,owner_id) IN (SELECT * FROM unnest($3::text[],$4::text[]))`;

type Line = { product_id: string; name: string; quantity: number; unit_price_kurus: string; vat_percent: string | null };
type CatalogLine = Line & {
  catalog_id: string | null; catalog_name: string | null; name_overridden: boolean | null; code: string | null;
  display_code: string | null; brand: string | null; display_brand: string | null;
};

const lineQuery = (catalog: boolean) => `SELECT i.product_id::text,i.name,i.quantity,i.unit_price_kurus::text,i.pricing_snapshot->>'vat_percent' AS vat_percent
 ${catalog ? `,p.id::text AS catalog_id,p.name AS catalog_name,p.name_overridden,p.code,p.display_code,p.brand,p.display_brand` : ""}
 FROM commerce_order_items i
 ${catalog ? `-- LATERAL + OFFSET 0 keeps the view from being planned as one catalog-wide scan per line (#705).
 LEFT JOIN LATERAL (SELECT * FROM (${catalogSql}) priced WHERE priced.id=i.product_id OFFSET 0) p ON true` : ""}
 WHERE i.order_id=$${catalog ? 2 : 1} ORDER BY i.code,i.product_id`;

/** The order's lines named like the listing card; a catalog failure or a product gone from it falls back to the order line's name. */
async function purchaseItems(orderId: string): Promise<{ lines: Line[]; items: AnalyticsItem[] }> {
  try {
    const lines = (await db.query<CatalogLine>(lineQuery(true), [storefrontCompanies(), orderId])).rows;
    const listed = lines.flatMap(line => line.catalog_id ? [{ id: line.catalog_id, code: line.code ?? "", brand: line.brand ?? "" }] : []);
    const [details, listing] = await Promise.all([getCatalogProductDetails(listed), listingIds(lines.map(line => line.product_id)).catch(error => {
      console.error("Purchase event listing ids failed", { orderId, error: error instanceof Error ? error.message : error });
      return new Map<string, string>();
    })]);
    return {
      lines,
      items: lines.map((line, index) => catalogItem({
        id: listing.get(line.product_id) ?? line.product_id,
        name: line.catalog_id ? catalogCardTitle({
          name: line.catalog_name ?? line.name, name_overridden: line.name_overridden ?? false, code: line.code ?? "",
          display_code: line.display_code ?? "", brand: line.brand ?? "", display_brand: line.display_brand ?? "",
        }, details.get(line.catalog_id)?.partNumber) : line.name,
        brand: line.catalog_id ? line.display_brand ?? "" : "",
      }, Number(line.unit_price_kurus), { quantity: line.quantity, index })),
    };
  } catch (error) {
    console.error("Purchase event catalog lookup failed", { orderId, error: error instanceof Error ? error.message : error });
    const lines = (await db.query<Line>(lineQuery(false), [orderId])).rows;
    // The listing ids may be what failed above; the fallback keeps its own guard.
    const listing = await listingIds(lines.map(line => line.product_id)).catch(() => new Map<string, string>());
    return { lines, items: lines.map((line, index) => catalogItem({ id: listing.get(line.product_id) ?? line.product_id, name: line.name, brand: "" }, Number(line.unit_price_kurus), { quantity: line.quantity, index })) };
  }
}

/**
 * The GA4 purchase event of a paid order, handed out at most once (#675). Everything is read first, so a failed read never
 * spends the flag; the last step claims `purchase_tracked_at` atomically and only the request that claimed it gets the payload.
 * Null for strangers, unpaid or refunded orders, orders already measured and orders paid more than the window ago.
 */
export async function claimPurchase(orderId: string, owners: CartOwner[]): Promise<PurchaseEvent | null> {
  if (!owners.length) return null;
  const params = [orderId, PURCHASE_EVENT_WINDOW_DAYS, owners.map(owner => owner.kind), owners.map(owner => owner.id)];
  const order = (await db.query<{ number: string; subtotal_kurus: string; shipping_kurus: string; vat_percent: string }>(
    `SELECT number::text,subtotal_kurus::text,shipping_kurus::text,
     (SELECT vat_percent::text FROM commerce_settings WHERE commerce_settings.id=true) AS vat_percent FROM commerce_orders WHERE ${claimable}`,
    params,
  )).rows[0];
  if (!order) return null;
  const { lines, items } = await purchaseItems(orderId);
  const fallbackVat = Number(order.vat_percent);
  const taxKurus = lines.reduce((sum, line) => {
    const rate = line.vat_percent === null ? fallbackVat : Number(line.vat_percent);
    return sum + vatIncludedKurus(Number(line.unit_price_kurus) * line.quantity, Number.isFinite(rate) ? rate : fallbackVat);
  }, 0);
  // value = subtotal + shipping; the installment fee (installment_fee_kurus) is intentionally excluded (#894).
  const payload = purchase({
    transactionId: order.number, subtotalKurus: Number(order.subtotal_kurus), shippingKurus: Number(order.shipping_kurus), taxKurus, items,
  });
  const claimed = await db.query(`UPDATE commerce_orders SET purchase_tracked_at=now() WHERE ${claimable} RETURNING id`, params);
  return claimed.rowCount === 1 ? payload : null;
}
