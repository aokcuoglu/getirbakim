import "server-only";
import { requireAdmin } from "@/modules/auth/session";
import { limitUsage } from "./partner-input";
import { partnerOrderLimitEnv, resolveOrderLimitKurus } from "@/modules/partner/order-dto";
import { knownPartners, noExposure, panelLimits, partnerExposures, partnerInvoiceChanges, partnerInvoices, resolvePartnerLimit, uninvoicedDays } from "@/modules/partner/limits";

/** /yonetim/partnerler (#426): every partner with its limit, its exposure and what can be invoiced. */
export async function adminPartners() {
  await requireAdmin();
  const { codes, configured } = await knownPartners();
  const [panel, exposures, days] = await Promise.all([panelLimits(codes), partnerExposures(codes), uninvoicedDays(codes)]);
  const fallback = resolveOrderLimitKurus(process.env[partnerOrderLimitEnv]);
  return codes.map(code => {
    const limit = resolvePartnerLimit(panel.get(code), fallback);
    const exposure = exposures.get(code) ?? noExposure;
    return { code, configured: configured.has(code), ...limit, ...exposure, panelKurus: panel.get(code) ?? null, days: days.get(code) ?? [], usage: limitUsage(exposure.exposureKurus, limit.limitKurus) };
  });
}

/** /yonetim/partnerler (#1018): marked invoices that can be corrected or undone, and the last corrections. */
export async function adminPartnerInvoices() {
  await requireAdmin();
  const { codes } = await knownPartners();
  const [invoices, changes] = await Promise.all([partnerInvoices(codes), partnerInvoiceChanges(codes)]);
  return { invoices, changes };
}
