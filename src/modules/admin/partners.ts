import "server-only";
import { requireAdmin } from "@/modules/auth/session";
import { limitUsage } from "./partner-input";
import { partnerOrderLimitEnv, resolveOrderLimitKurus } from "@/modules/partner/order-dto";
import { lastDiscountChanges, panelDiscounts } from "@/modules/partner/discounts";
import { pausedPartners } from "@/modules/partner/intake";
import { partnerDiscountEnv, resolvePartnerDiscount, resolvePartnerDiscountBps } from "@/modules/partner/pricing";
import { parsePartnerWebhooks, partnerWebhooksEnv } from "@/modules/partner/webhook-contract";
import { partnerWebhookSummary, recentPartnerWebhookProblems } from "@/modules/partner/webhooks";
import { knownPartners, noExposure, panelLimits, partnerExposures, partnerInvoiceChanges, partnerInvoices, resolvePartnerLimit, uninvoicedDays } from "@/modules/partner/limits";

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

/** /yonetim/partnerler (#1018): marked invoices that can be corrected or undone, and the last corrections. */
export async function adminPartnerInvoices() {
  await requireAdmin();
  const { codes } = await knownPartners();
  const [invoices, changes] = await Promise.all([partnerInvoices(codes), partnerInvoiceChanges(codes)]);
  return { invoices, changes };
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
