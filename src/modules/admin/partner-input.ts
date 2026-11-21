import { z } from "zod";
import { paymentMethodLabels, paymentMethods, type PaymentMethod } from "@/modules/partner/payment-methods";
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

/** TL text ("1500", "1500,50", "1500.5") → kuruş; 0 when it is not such an amount. */
const tlKurus = (value: string) => {
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(value);
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : 0;
};

/** TL text → kuruş; empty clears the panel limit (null). */
export const limitTl = z.string().trim().transform((value, context) => {
  if (!value) return null;
  const kurus = tlKurus(value);
  if (kurus <= 0) {
    context.addIssue({ code: "custom", message: "Limit 0 TL'den büyük, en fazla iki ondalıklı bir tutar olmalı." });
    return z.NEVER;
  }
  return kurus;
});

/** A required TL amount above 0 (#1006 payments) → kuruş. */
export const amountTl = z.string().trim().transform((value, context) => {
  const kurus = tlKurus(value);
  if (kurus <= 0) {
    context.addIssue({ code: "custom", message: "Tutar 0 TL'den büyük, en fazla iki ondalıklı bir tutar olmalı." });
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

/** How a payment method reads in /yonetim (#1006). */
export const paymentMethodLabel = (method: PaymentMethod) => paymentMethodLabels[method];

/** The Istanbul calendar day 2 years before today, `YYYY-MM-DD`: the oldest payment day accepted. */
const twoYearsBack = (now: Date) => { const today = istanbulToday(now); return `${Number(today.slice(0, 4)) - 2}${today.slice(4)}`; };

/**
 * A payment against a marked invoice (#1006): the invoice by its number and day, a TL amount, a past payment day, the
 * method and an optional note; expectedTotal/expectedCollected are what the dialog showed.
 */
export const partnerPaymentInput = (now = new Date()) => z.object({
  partner: partnerCode,
  invoiceRef: z.string().trim().min(1).max(60),
  invoiceDate: z.string().trim().refine(validDay),
  amount: amountTl,
  // Up to 2 years back; a day before the invoice day is fine (partners may pay in advance).
  paidOn: pastDay(now).refine(value => value >= twoYearsBack(now), "Ödeme tarihi en fazla 2 yıl önce olabilir."),
  method: z.enum(paymentMethods, "Ödeme yöntemini seçin."),
  note: z.string().trim().max(500, "Not en fazla 500 karakter olabilir."),
  expectedTotal,
  expectedCollected: z.coerce.number().int().min(0),
});

/** Voiding a payment (#1006): its id and a reason, counted like an invoice change's. */
export const partnerPaymentVoidInput = z.object({
  payment: z.string().trim().regex(/^[1-9]\d{0,17}$/),
  reason: invoiceChangeReason,
});

/** A partner's payment term (#1006): whole days 0–365; empty clears it (null = no term, never overdue). */
export const partnerTermInput = z.object({
  partner: partnerCode,
  term: z.string().trim().transform((value, context) => {
    if (!value) return null;
    const days = /^\d{1,3}$/.test(value) ? Number(value) : -1;
    if (days < 0 || days > 365) {
      context.addIssue({ code: "custom", message: "Vade 0 ile 365 arasında tam gün olmalı." });
      return z.NEVER;
    }
    return days;
  }),
});

export type CollectionState = "paid" | "partial" | "open" | "overdue";

/** `YYYY-MM-DD` + days, in UTC so no clock change shifts the day. */
const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * An invoice's collection status (#1006): due on its day + the partner's term (none = never overdue). Overdue = a
 * balance left after the due day, partially paid ones included; due today is not overdue yet.
 */
export function invoiceCollection({ totalKurus, collectedKurus, invoiceDate, termDays, today }: {
  totalKurus: number; collectedKurus: number; invoiceDate: string; termDays: number | null; today: string;
}): { state: CollectionState; dueDate: string | null; balanceKurus: number; overdueDays: number } {
  const balanceKurus = Math.max(totalKurus - collectedKurus, 0);
  const dueDate = termDays == null ? null : addDays(invoiceDate, termDays);
  const overdueDays = balanceKurus > 0 && dueDate && dueDate < today ? daysBetween(dueDate, today) : 0;
  const state = balanceKurus === 0 ? "paid" : overdueDays > 0 ? "overdue" : collectedKurus > 0 ? "partial" : "open";
  return { state, dueDate, balanceKurus, overdueDays };
}

/** Usage of the limit: success below 80%, warning from 80% or with no limit (missing setup), destructive at 100%. */
export function limitUsage(exposureKurus: number, limitKurus: number | null) {
  if (limitKurus == null) return { tone: "warning" as const, percent: null };
  const percent = Math.floor(exposureKurus * 100 / limitKurus);
  return { tone: percent >= 100 ? "error" as const : percent >= 80 ? "warning" as const : "success" as const, percent };
}
