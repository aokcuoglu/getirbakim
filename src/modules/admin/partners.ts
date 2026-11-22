import "server-only";
import { requireAdmin } from "@/modules/auth/session";
import { invoiceCollection, istanbulToday, limitUsage, partnerStatementInput, periodLabel, recentPeriods } from "./partner-input";
import { orphanPaymentCount, partnerInvoiceLedger, paymentTerms, recentInvoicePayments } from "@/modules/partner/collections";
import { partnerOrderLimitEnv, resolveOrderLimitKurus } from "@/modules/partner/order-dto";
import { lastDiscountChanges, panelDiscounts } from "@/modules/partner/discounts";
import { pausedPartners } from "@/modules/partner/intake";
import { partnerDiscountEnv, resolvePartnerDiscount, resolvePartnerDiscountBps } from "@/modules/partner/pricing";
import { parsePartnerWebhooks, partnerWebhooksEnv } from "@/modules/partner/webhook-contract";
import { partnerWebhookSummary, recentPartnerWebhookProblems } from "@/modules/partner/webhooks";
import { closedPeriods, dayInClosedPeriod, partnerStatement, periodEvents } from "@/modules/partner/periods";
import { knownPartners, noExposure, panelLimits, partnerExposures, partnerInvoiceChanges, resolvePartnerLimit, uninvoicedDays } from "@/modules/partner/limits";

/** /yonetim/partnerler (#426): every partner with its limit, its exposure and what can be invoiced. */
export async function adminPartners() {
  await requireAdmin();
  const { codes, configured } = await knownPartners();
  const [panel, exposures, days, paused, discounts, discountChanges] = await Promise.all([panelLimits(codes), partnerExposures(codes), uninvoicedDays(codes),
    pausedPartners(codes), panelDiscounts(codes), lastDiscountChanges(codes)]);
  const fallback = resolveOrderLimitKurus(process.env[partnerOrderLimitEnv]);
  const fallbackDiscountBps = resolvePartnerDiscountBps(process.env[partnerDiscountEnv]);
  return codes.map(code => {
    const limit = resolvePartnerLimit(panel.get(code), fallback);
    const exposure = exposures.get(code) ?? noExposure;
    const pause = paused.get(code);
    return { code, configured: configured.has(code), ...limit, ...exposure, panelKurus: panel.get(code) ?? null, days: days.get(code) ?? [],
      intakePausedAt: pause?.pausedAt ?? null, intakePausedBy: pause?.pausedBy ?? null, usage: limitUsage(exposure.exposureKurus, limit.limitKurus),
      discount: resolvePartnerDiscount(discounts.get(code), fallbackDiscountBps), panelDiscountBps: discounts.get(code) ?? null,
      discountChange: discountChanges.get(code) ?? null };
  });
}

/**
 * /yonetim/partnerler (#1018, #1006): marked invoices with their collection status (open ones however old, plus the
 * newest settled), the last payments and corrections, and per partner its term, what is uncollected and what is overdue.
 */
export async function adminPartnerInvoices() {
  await requireAdmin();
  const { codes } = await knownPartners();
  const [ledger, changes, recent, orphanCount, terms, closed] = await Promise.all([partnerInvoiceLedger(codes), partnerInvoiceChanges(codes),
    recentInvoicePayments(codes), orphanPaymentCount(codes), paymentTerms(codes), closedPeriods(codes)]);
  const today = istanbulToday();
  // A closed month (#1200) freezes invoices dated in it and payments paid in it: the page hides their change and void.
  // Closes are contiguous, so a month at or before the partner's latest closed month is frozen (period-guard.ts).
  const latestClosed = new Map<string, string>();
  for (const row of closed) if (row.period > (latestClosed.get(row.partner) ?? "")) latestClosed.set(row.partner, row.period);
  const isClosed = (partner: string, day: string) => dayInClosedPeriod(latestClosed, partner, day);
  const invoices = ledger.map(invoice => ({ ...invoice, ...invoiceCollection({ ...invoice, termDays: terms.get(invoice.partner) ?? null, today }),
    periodClosed: isClosed(invoice.partner, invoice.invoiceDate) }));
  const payments = recent.map(payment => ({ ...payment, paidPeriodClosed: isClosed(payment.partner, payment.paidOn) }));
  const collections = codes.map(code => {
    const own = invoices.filter(invoice => invoice.partner === code);
    const overdue = own.filter(invoice => invoice.state === "overdue");
    return { code, termDays: terms.get(code) ?? null, uncollectedKurus: own.reduce((sum, invoice) => sum + invoice.balanceKurus, 0),
      overdueKurus: overdue.reduce((sum, invoice) => sum + invoice.balanceKurus, 0), overdueCount: overdue.length };
  });
  return { invoices, changes, payments, orphanCount, collections };
}

/**
 * /yonetim/partnerler (#1002): per partner whether a webhook endpoint is configured (its host only, never the URL's path
 * or the secret) or its entry is broken, what waits, was given up or skipped, and the latest failing events.
 */
export async function adminPartnerWebhooks() {
  await requireAdmin();
  const { codes } = await knownPartners();
  const { endpoints, invalid, parseError } = parsePartnerWebhooks(process.env[partnerWebhooksEnv]);
  const [summary, problems] = await Promise.all([partnerWebhookSummary(codes), recentPartnerWebhookProblems(codes)]);
  const partners = codes.map(code => {
    const endpoint = endpoints.get(code);
    const counts = summary.get(code);
    const endpointState = parseError ? "unreadable" as const : endpoint ? "configured" as const
      : invalid.get(code) === "disabled" ? "disabled" as const : invalid.has(code) ? "invalid" as const : "missing" as const;
    return { code, endpointState, endpointHost: endpoint ? new URL(endpoint.url).host : null, pending: counts?.pending ?? 0, dead: counts?.dead ?? 0,
      skipped: counts?.skipped ?? 0, lastDeliveredAt: counts?.lastDeliveredAt ?? null };
  });
  return { partners, problems, parseError, configured: parseError || endpoints.size > 0 || invalid.size > 0 };
}

/**
 * /yonetim/partnerler period close card (#1200): per partner the current month and the two before it plus every other
 * closed month, each closed (when, by whom) or open; the last closes and reopens; the last 24 months for the statement.
 */
export async function adminPartnerPeriods() {
  await requireAdmin();
  const { codes } = await knownPartners();
  const [closed, events] = await Promise.all([closedPeriods(codes), periodEvents(codes)]);
  const periods = recentPeriods(new Date(), 24);
  const rows = codes.flatMap(partner => {
    const own = new Map(closed.filter(row => row.partner === partner).map(row => [row.period, row]));
    const months = [...new Set([...periods.slice(0, 3), ...own.keys()])].sort().reverse();
    return months.map(period => {
      const close = own.get(period);
      return { partner, period, closed: close ? { at: close.closedAt, by: close.closedBy } : null };
    });
  });
  return { rows, events, periods };
}

/**
 * A partner's monthly statement (#1200) for the CSV route (`?partner=&donem=YYYY-MM`), each invoice with its collection
 * status as of the month's end (today while the month runs); null for an invalid query or an unknown partner.
 */
export async function adminPartnerStatement(query: Record<string, string>) {
  await requireAdmin();
  const input = partnerStatementInput().safeParse(query);
  if (!input.success) return null;
  const { codes } = await knownPartners();
  if (!codes.includes(input.data.partner)) return null;
  const today = istanbulToday();
  const statement = await partnerStatement(input.data.partner, input.data.donem, today);
  const invoices = statement.invoices.map(invoice => ({ ...invoice, ...invoiceCollection({ ...invoice, termDays: statement.termDays, today: statement.asOf }) }));
  return { ...statement, invoices, periodLabel: periodLabel(statement.period), issuedOn: today };
}
