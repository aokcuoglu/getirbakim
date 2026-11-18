import { carrierLabel } from "@/modules/store/shipment";
import { encodeOfferId } from "./dto";

/**
 * The partner order contract (#426, docs/partner-order-contract.md, `contractVersion: "2.0"`). Pure: rows in, DTO out,
 * so scripts/test-partner.ts checks the mapping and that no supplier internals (cost, markup, supplier, company) leak.
 */
export const partnerOrderLimitEnv = "PARTNER_ORDER_LIMIT_KURUS";

/** Open-order limit per partner in kuruş (VAT included). Unset, zero or malformed is null: orders are refused (fail closed). */
export function resolveOrderLimitKurus(raw: string | undefined | null): number | null {
  const text = raw?.trim() ?? "";
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** VAT of one unit, half up; `vatRateBps` 2000 = 20%. */
export function unitVatKurus(unitNetKurus: number, vatRateBps: number) {
  return Math.round(unitNetKurus * vatRateBps / 10000);
}

export type PartnerOrderStatus = "REQUESTED" | "CONFIRMED" | "SHIPPED" | "COMPLETED" | "CANCELLED";

/**
 * Store order status → contract status. The 1.0 names are kept where they still mean the same; RESERVATION_EXPIRED is
 * gone (nothing is reserved, nothing expires) and REJECTED is not emitted: an order operations refuse is CANCELLED with
 * `cancelledBy: "GETIRBAKIM"`. A partner order never waits for payment; `awaiting_payment` is mapped defensively.
 */
export function partnerOrderStatus(status: string): PartnerOrderStatus {
  switch (status) {
    case "confirmed": return "CONFIRMED";
    case "shipped": return "SHIPPED";
    case "delivered": return "COMPLETED";
    case "cancelled": return "CANCELLED";
    default: return "REQUESTED";
  }
}

export type PartnerOrderRow = {
  id: string; number: string; request_key: string; status: string; payment_status: string;
  total_kurus: string; shipping_kurus: string; note: string;
  customer_name: string; phone: string; email: string;
  delivery_province: string | null; delivery_district: string | null; delivery_address_line: string | null; delivery_postal_code: string | null;
  carrier: string | null; carrier_name: string | null; tracking_no: string | null; tracking_url: string | null;
  shipped_at: Date | null; delivered_at: Date | null; cancelled_by: string | null; cancelled_at: Date | null; created_at: Date;
};
/** `pricing_snapshot.partner` holds the binding unit price the order was taken at. */
export type PartnerOrderLineRow = { product_id: string; code: string; name: string; quantity: number; unit_price_kurus: string; pricing_snapshot: Record<string, unknown> };
export type PartnerLinePrice = { unit_net_kurus: number; unit_vat_kurus: number; vat_rate_bps: number };

function linePrice(line: PartnerOrderLineRow): PartnerLinePrice {
  const partner = line.pricing_snapshot.partner as Partial<PartnerLinePrice> | undefined;
  const gross = Number(line.unit_price_kurus);
  // Every partner line is written with these values; the fallback only keeps a hand-edited row readable.
  return typeof partner?.unit_net_kurus === "number" && typeof partner.unit_vat_kurus === "number" && typeof partner.vat_rate_bps === "number"
    ? { unit_net_kurus: partner.unit_net_kurus, unit_vat_kurus: partner.unit_vat_kurus, vat_rate_bps: partner.vat_rate_bps }
    : { unit_net_kurus: gross, unit_vat_kurus: 0, vat_rate_bps: 0 };
}

const iso = (value: Date | null) => value ? new Date(value).toISOString() : null;

export function toPartnerOrderDto(order: PartnerOrderRow, lines: PartnerOrderLineRow[]) {
  const priced = lines.map(line => ({ line, price: linePrice(line) }));
  const netKurus = priced.reduce((sum, { line, price }) => sum + price.unit_net_kurus * line.quantity, 0);
  const vatKurus = priced.reduce((sum, { line, price }) => sum + price.unit_vat_kurus * line.quantity, 0);
  const shipped = order.shipped_at != null || order.tracking_no != null;
  return {
    contractVersion: "2.0" as const,
    id: order.id,
    number: Number(order.number),
    idempotencyKey: order.request_key,
    status: partnerOrderStatus(order.status),
    paymentStatus: "ON_ACCOUNT" as const,
    currency: "TRY" as const,
    totals: { netKurus, vatKurus, shippingKurus: Number(order.shipping_kurus), grossKurus: Number(order.total_kurus) },
    lines: priced.map(({ line, price }) => ({
      selectedOfferId: encodeOfferId(line.product_id),
      partNo: line.code,
      name: line.name,
      quantity: line.quantity,
      unitNetKurus: price.unit_net_kurus,
      unitVatKurus: price.unit_vat_kurus,
      unitGrossKurus: Number(line.unit_price_kurus),
      vatRateBps: price.vat_rate_bps,
    })),
    shippingAddress: {
      recipientName: order.customer_name, phone: order.phone, email: order.email || null,
      province: order.delivery_province, district: order.delivery_district, addressLine: order.delivery_address_line, postalCode: order.delivery_postal_code,
    },
    note: order.note,
    shipment: shipped ? {
      carrier: order.carrier ? carrierLabel(order.carrier, order.carrier_name) : null,
      trackingNo: order.tracking_no, trackingUrl: order.tracking_url, shippedAt: iso(order.shipped_at), deliveredAt: iso(order.delivered_at),
    } : null,
    cancelledBy: order.status !== "cancelled" ? null : order.cancelled_by === "customer" ? "PARTNER" as const : "GETIRBAKIM" as const,
    cancelledAt: iso(order.cancelled_at),
    createdAt: iso(order.created_at),
  };
}
export type PartnerOrderDto = ReturnType<typeof toPartnerOrderDto>;
