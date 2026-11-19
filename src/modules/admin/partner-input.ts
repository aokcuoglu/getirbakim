import { z } from "zod";

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

const partnerCode = z.string().trim().min(1).max(100);

export const partnerLimitInput = z.object({ partner: partnerCode, limit: limitTl });

export const partnerInvoiceInput = (now = new Date()) => z.object({
  partner: partnerCode,
  deliveredUntil: pastDay(now),
  invoiceRef: z.string().trim().min(1, "Fatura numarasını girin.").max(60, "Fatura numarası en fazla 60 karakter olabilir."),
  invoiceDate: pastDay(now),
  expectedCount: z.coerce.number().int().min(1),
  expectedTotal: z.coerce.number().int().min(1),
});

/** Usage of the limit: success below 80%, warning from 80%, destructive at 100% or with no limit (ordering closed). */
export function limitUsage(exposureKurus: number, limitKurus: number | null) {
  if (limitKurus == null) return { tone: "error" as const, percent: null };
  const percent = Math.floor(exposureKurus * 100 / limitKurus);
  return { tone: percent >= 100 ? "error" as const : percent >= 80 ? "warning" as const : "success" as const, percent };
}
