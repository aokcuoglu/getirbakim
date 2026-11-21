import { z } from "zod";
import type { ReturnReason } from "@/modules/store/returns";
import { encodeOfferId } from "./dto";
import { lineAmounts, linePrice, type PartnerOrderLineRow } from "./order-dto";
import { maxPartnerLineQuantity, maxPartnerOrderLines } from "./quotes";

/**
 * Partner return requests (#1007, docs/partner-order-contract.md, Return object `contractVersion: "2.1"`). Pure: the
 * request body schema and rows → DTO, so scripts/test-partner.ts covers them. Amounts are the order's own unit prices
 * (pricing_snapshot.partner); shipping is not refunded through a return request.
 */
const reasonMap = {
  NOT_FIT: "not_fit", WRONG_ITEM: "wrong_item", DAMAGED: "damaged", DEFECTIVE: "defective", CHANGED_MIND: "changed_mind", OTHER: "other",
} as const satisfies Record<string, ReturnReason>;
export type PartnerReturnReason = keyof typeof reasonMap;
const partnerReasons = Object.fromEntries(Object.entries(reasonMap).map(([partner, store]) => [store, partner])) as Record<ReturnReason, PartnerReturnReason>;

const lineSchema = z.object({
  selectedOfferId: z.string().regex(/^offer_[0-9a-f]{32}$/),
  quantity: z.number().int().min(1).max(maxPartnerLineQuantity),
  reason: z.enum(["NOT_FIT", "WRONG_ITEM", "DAMAGED", "DEFECTIVE", "CHANGED_MIND", "OTHER"] satisfies PartnerReturnReason[]).transform(reason => reasonMap[reason]),
}).strict();

export const returnRequestSchema = z.object({
  lines: z.array(lineSchema).min(1).max(maxPartnerOrderLines)
    .refine(lines => new Set(lines.map(line => line.selectedOfferId)).size === lines.length, { message: "Each offer may appear on one line only." }),
  note: z.string().trim().max(1000).optional().default(""),
}).strict();
export type ReturnRequest = z.output<typeof returnRequestSchema>;

export type PartnerReturnStatus = "REQUESTED" | "APPROVED" | "REJECTED";

export function partnerReturnStatus(status: string): PartnerReturnStatus {
  return status === "approved" ? "APPROVED" : status === "rejected" ? "REJECTED" : "REQUESTED";
}

export type PartnerReturnRow = { id: string; order_id: string; request_key: string; status: string; note: string; requested_at: Date; decided_at: Date | null };
/** A request line with its order line (`ordered_quantity` = the order line's quantity, for the price fallback). */
export type PartnerReturnLineRow = Omit<PartnerOrderLineRow, "quantity"> & { ordered_quantity: number; quantity: number; reason: ReturnReason };

const iso = (value: Date | null) => value ? new Date(value).toISOString() : null;

export function toPartnerReturnDto(request: PartnerReturnRow, lines: PartnerReturnLineRow[]) {
  const priced = lines.map(line => {
    const price = linePrice({ ...line, quantity: line.ordered_quantity });
    return { line, price, amounts: lineAmounts(price.unit_net_kurus, line.quantity, price.vat_rate_bps) };
  });
  const netKurus = priced.reduce((sum, { amounts }) => sum + amounts.lineNetKurus, 0);
  const vatKurus = priced.reduce((sum, { amounts }) => sum + amounts.lineVatKurus, 0);
  return {
    contractVersion: "2.1" as const,
    id: request.id,
    orderId: request.order_id,
    idempotencyKey: request.request_key,
    status: partnerReturnStatus(request.status),
    lines: priced.map(({ line, price, amounts }) => ({
      selectedOfferId: encodeOfferId(line.product_id),
      partNo: line.code,
      name: line.name,
      quantity: line.quantity,
      reason: partnerReasons[line.reason],
      unitNetKurus: price.unit_net_kurus,
      vatRateBps: price.vat_rate_bps,
      ...amounts,
    })),
    totals: { netKurus, vatKurus, grossKurus: netKurus + vatKurus },
    note: request.note,
    requestedAt: iso(request.requested_at),
    decidedAt: iso(request.decided_at),
  };
}
export type PartnerReturnDto = ReturnType<typeof toPartnerReturnDto>;
