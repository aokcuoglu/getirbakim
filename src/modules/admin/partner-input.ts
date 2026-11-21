import { z } from "zod";
import { maxPartnerDiscountBps } from "@/modules/partner/pricing";

/**
 * /yonetim/partnerler form input and view rules (#426), kept pure so scripts/test-partner-orders.ts checks it without a session.
 * Amounts are typed in TL (up to 2 decimals, "." or ",") and stored in kuruş; dates are Istanbul calendar days.
 */
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

/** Today's calendar day in Istanbul, `YYYY-MM-DD`. */
export const istanbulToday = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(now);

const validDay = (value: string) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  // 2026-02-30 rolls over to March 2: only a day that survives the round trip is real.
  return dayPattern.test(value) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
};
const pastDay = (now: Date) => z.string().trim().refine(validDay, "Geçerli bir tarih girin.").refine(value => value <= istanbulToday(now), "Tarih bugünden sonra olamaz.");

/** TL text → kuruş; empty clears the panel limit (null). */
export const limitTl = z.string().trim().transform((value, context) => {
  if (!value) return null;
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value);
  const kurus = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : 0;
  if (kurus <= 0) {
    context.addIssue({ code: "custom", message: "Limit 0 TL'den büyük, en fazla iki ondalıklı bir tutar olmalı." });
    return z.NEVER;
  }
  return kurus;
});

/** Percent text ("10", "12,5", "7.25") → basis points 0–9000 (#1130); empty clears the panel discount (null). */
export const discountPercent = z.string().trim().transform((value, context) => {
  if (!value) return null;
  const match = /^%?\s*(\d{1,2})(?:[.,](\d{1,2}))?\s*%?$/.exec(value);
  const bps = match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : -1;
  if (bps < 0 || bps > maxPartnerDiscountBps) {
    context.addIssue({ code: "custom", message: "İndirim %0 ile %90 arasında, en fazla iki ondalıklı bir oran olmalı." });
    return z.NEVER;
  }
  return bps;
});

/** Basis points → the percent text the discount input shows ("10" or "12,5"). */
export const percentText = (bps: number) => (bps / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2, useGrouping: false });

const partnerCode = z.string().trim().min(1).max(100);

export const partnerDiscountInput = z.object({ partner: partnerCode, discount: discountPercent });

export const partnerLimitInput = z.object({ partner: partnerCode, limit: limitTl });

/** Order intake switch (#1009): "1" pauses the partner's new quotes and orders, "0" resumes them. */
export const partnerIntakeInput = z.object({ partner: partnerCode, paused: z.enum(["1", "0"]).transform(value => value === "1") });

/** Requeuing one given-up partner webhook event (#1002), or all of one partner's. */
export const partnerWebhookRequeueInput = z.object({ event: z.uuid() });
export const partnerWebhookRequeueAllInput = z.object({ partner: partnerCode });

/** The invoice number operations type, when marking and when correcting a mark. */
const invoiceRef = z.string().trim().min(1, "Fatura numarasını girin.").max(60, "Fatura numarası en fazla 60 karakter olabilir.");
const expectedCount = z.coerce.number().int().min(1);
const expectedTotal = z.coerce.number().int().min(1);

export const partnerInvoiceInput = (now = new Date()) => z.object({
  partner: partnerCode,
  deliveredUntil: pastDay(now),
  invoiceRef,
  invoiceDate: pastDay(now),
  expectedCount,
  expectedTotal,
});

/** Why a mark is corrected or undone; counted in code points like the table's CHECK (length(btrim(reason))>=5), not UTF-16 units. */
const invoiceChangeReason = z.string().trim().refine(value => [...value].length >= 5, "Gerekçeyi yazın (en az 5 karakter).").max(500, "Gerekçe en fazla 500 karakter olabilir.");

/**
 * Correcting or undoing a marked invoice (#1018): the invoice is named by its current number and day; a reason is
 * required for both, a correction also needs the new number and a past day.
 */
export const partnerInvoiceChangeInput = (now = new Date()) => {
  const marked = {
    partner: partnerCode,
    invoiceRef: z.string().trim().min(1).max(60),
    invoiceDate: z.string().trim().refine(validDay),
    reason: invoiceChangeReason,
    expectedCount,
    expectedTotal,
  };
  return z.discriminatedUnion("action", [
    z.object({ action: z.literal("undo"), ...marked }),
    z.object({ action: z.literal("correct"), ...marked, newInvoiceRef: invoiceRef, newInvoiceDate: pastDay(now) }),
  ]);
};

/** Undoing one order's invoiced mark (#1038): the order, the mark the dialog showed, and a reason. */
export const partnerOrderInvoiceUndoInput = z.object({
  order: z.uuid(),
  invoiceRef: z.string().trim().min(1).max(60),
  invoiceDate: z.string().trim().refine(validDay),
  reason: invoiceChangeReason,
});

/** Usage of the limit: success below 80%, warning from 80% or with no limit (missing setup), destructive at 100%. */
export function limitUsage(exposureKurus: number, limitKurus: number | null) {
  if (limitKurus == null) return { tone: "warning" as const, percent: null };
  const percent = Math.floor(exposureKurus * 100 / limitKurus);
  return { tone: percent >= 100 ? "error" as const : percent >= 80 ? "warning" as const : "success" as const, percent };
}
