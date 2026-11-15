import { z } from "zod";

// Procurement of order lines (#606). Pure: shared by the admin list query, the lines dialog and the server action.

export const procurementStatuses = ["pending", "ordered", "procured"] as const;
export type ProcurementStatus = typeof procurementStatuses[number];
export const procurementLabel: Record<ProcurementStatus, string> = {
  pending: "Bekliyor", ordered: "Tedarikçiye sipariş verildi", procured: "Tedarik edildi",
};

export const procurementInput = z.object({
  order: z.uuid(), product: z.uuid(), status: z.enum(procurementStatuses), reference: z.string().trim().max(200),
});

/** One order line as the admin list carries it; pricing_snapshot is the checkout's record (db/commerce.sql). */
export type AdminOrderLine = {
  product_id: string; code: string; name: string; supplier: string; quantity: number; unit_price_kurus: number;
  pricing_snapshot: Record<string, unknown>; procurement_status: ProcurementStatus; procurement_ref: string | null;
  procurement_ordered_at: string | null; procured_at: string | null;
  /** The line's product is still a supplier item (its page can be opened). */
  supplier_item: boolean;
  /** Master product the supplier item is matched to, if any. */
  master_id: string | null;
};

/** Store-stock lines are sold from our own shelf; only supplier lines are ordered from a supplier. */
export const needsProcurement = (line: Pick<AdminOrderLine, "pricing_snapshot">) => line.pricing_snapshot.source !== "store";

const numberOf = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};
const textOf = (value: unknown) => typeof value === "string" && value ? value : null;

/**
 * Per-unit figures of a line: supplier cost without VAT (cost_kurus, or nf × exchange rate on lines written before
 * #580), the sale price without VAT and their difference. null where the snapshot cannot tell.
 */
export function lineFigures(snapshot: Record<string, unknown>, unitPriceKurus: number) {
  const recorded = numberOf(snapshot.cost_kurus);
  const nf = numberOf(snapshot.nf), rate = numberOf(snapshot.exchange_rate);
  const costKurus = recorded ?? (nf !== null && rate !== null ? Math.round(nf * rate * 100) : null);
  const vat = numberOf(snapshot.vat_percent);
  const netSaleKurus = vat !== null ? Math.round(unitPriceKurus / (1 + vat / 100)) : null;
  const marginKurus = costKurus !== null && netSaleKurus !== null ? netSaleKurus - costKurus : null;
  return { costKurus, netSaleKurus, marginKurus };
}

/** Where the line was sourced: supplier company, list group, warehouse and when the price/stock was observed. */
export function lineScope(snapshot: Record<string, unknown>) {
  return {
    company: textOf(snapshot.company), listGroup: textOf(snapshot.list_group), warehouse: textOf(snapshot.warehouse),
    observedAt: textOf(snapshot.observed_at), checkoutMode: textOf(snapshot.checkout_mode),
  };
}

const supplierPaths: Record<string, string> = { basbug: "basbug", dinamik: "dinamik", seta: "seta", manual: "manuel" };
/** The supplier's product page in /yonetim/tedarikciler; null for suppliers without one. */
export function supplierItemHref(supplier: string, id: string) {
  const path = supplierPaths[supplier];
  return path ? `/yonetim/tedarikciler/${path}/urun/${id}` : null;
}

/** Line counts of an order: needed = lines that need procurement, split by their status. */
export function procurementSummary(lines: Pick<AdminOrderLine, "pricing_snapshot" | "procurement_status">[]) {
  const needed = lines.filter(needsProcurement);
  const count = (status: ProcurementStatus) => needed.filter(line => line.procurement_status === status).length;
  return { needed: needed.length, pending: count("pending"), ordered: count("ordered"), procured: count("procured") };
}

/** Open orders (alias o) with a supplier line not yet procured. */
export const procurementOpenSql = "o.status IN ('pending','confirmed') AND EXISTS(SELECT 1 FROM commerce_order_items i WHERE i.order_id=o.id AND i.procurement_status<>'procured' AND COALESCE(i.pricing_snapshot->>'source','')<>'store')";
