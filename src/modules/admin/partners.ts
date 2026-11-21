import "server-only";
import { requireAdmin } from "@/modules/auth/session";
import { limitUsage } from "./partner-input";
import { partnerOrderLimitEnv, resolveOrderLimitKurus } from "@/modules/partner/order-dto";
import { lastDiscountChanges, panelDiscounts } from "@/modules/partner/discounts";
import { pausedPartners } from "@/modules/partner/intake";
import { partnerDiscountEnv, resolvePartnerDiscount, resolvePartnerDiscountBps } from "@/modules/partner/pricing";
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
