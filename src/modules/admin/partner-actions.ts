"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/modules/auth/session";
import { changePartnerInvoice, invoicePartnerOrders, knownPartners, savePartnerOrderLimit } from "@/modules/partner/limits";
import { partnerInvoiceChangeInput, partnerInvoiceInput, partnerLimitInput } from "./partner-input";

/** A partner's open-order limit (#426): a TL amount, or empty to fall back to PARTNER_ORDER_LIMIT_KURUS. */
export async function savePartnerLimit(form: FormData) {
  const admin = await requireAdmin();
  const input = partnerLimitInput.safeParse(Object.fromEntries(form));
  const { codes } = await knownPartners();
  const partner = form.get("partner");
  if (!input.success || !codes.includes(input.data.partner)) {
    // The page shows the partner only when it is a known code.
    redirect(`/yonetim/partnerler?error=limit${typeof partner === "string" && codes.includes(partner) ? `&partner=${encodeURIComponent(partner)}` : ""}`);
  }
  await savePartnerOrderLimit(input.data.partner, input.data.limit, admin.id);
  revalidatePath("/yonetim/partnerler");
  redirect(`/yonetim/partnerler?saved=${encodeURIComponent(input.data.partner)}`);
}

export type PartnerInvoiceResult = {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: Partial<Record<"deliveredUntil" | "invoiceRef" | "invoiceDate", string[]>>;
  next?: string;
};

/**
 * "Faturalandı işaretle" (#426): one invoice number and date for the partner's delivered, uninvoiced orders delivered on
 * or before a day. Refused when the orders differ from what the dialog showed; invoiced orders are never marked again.
 */
export async function markPartnerInvoiced(_previous: PartnerInvoiceResult, form: FormData): Promise<PartnerInvoiceResult> {
  const admin = await requireAdmin();
  const input = partnerInvoiceInput().safeParse(Object.fromEntries(form));
  if (!input.success) {
    const errors = input.error.flatten().fieldErrors;
    const shown = { deliveredUntil: errors.deliveredUntil, invoiceRef: errors.invoiceRef, invoiceDate: errors.invoiceDate };
    return Object.values(shown).some(Boolean) ? { status: "error", errors: shown } : { status: "error", message: "İşaretlenecek sipariş bulunamadı. Sayfayı yenileyin." };
  }
  const { partner, deliveredUntil, invoiceRef, invoiceDate, expectedCount, expectedTotal } = input.data;
  const outcome = await invoicePartnerOrders({ partner, deliveredUntil, invoiceRef, invoiceDate, adminId: admin.id, expected: { count: expectedCount, totalKurus: expectedTotal } });
  revalidatePath("/yonetim/partnerler");
  if (outcome.status === "nothing") return { status: "error", message: "Bu tarihe kadar teslim edilmiş, faturalanmamış sipariş kalmadı. Sayfayı yenileyin." };
  if (outcome.status === "changed") return { status: "error", message: "Siparişler bu pencere açıldıktan sonra değişti; hiçbir sipariş işaretlenmedi. Sayfayı yenileyip yeniden deneyin." };
  revalidatePath("/yonetim/siparisler");
  return { status: "success", next: `/yonetim/partnerler?invoiced=${outcome.count}&partner=${encodeURIComponent(partner)}` };
}

export type PartnerInvoiceChangeResult = {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: Partial<Record<"newInvoiceRef" | "newInvoiceDate" | "reason", string[]>>;
  next?: string;
};

/**
 * Corrects or undoes a marked partner invoice (#1018) with a reason. Refused when the invoice differs from what the
 * dialog showed; an undone invoice's orders count against the partner's limit again.
 */
export async function changePartnerInvoiceMark(_previous: PartnerInvoiceChangeResult, form: FormData): Promise<PartnerInvoiceChangeResult> {
  const admin = await requireAdmin();
  const input = partnerInvoiceChangeInput().safeParse(Object.fromEntries(form));
  if (!input.success) {
    const errors: Partial<Record<string, string[]>> = input.error.flatten().fieldErrors;
    const shown = { newInvoiceRef: errors.newInvoiceRef, newInvoiceDate: errors.newInvoiceDate, reason: errors.reason };
    return Object.values(shown).some(Boolean) ? { status: "error", errors: shown } : { status: "error", message: "Fatura bulunamadı. Sayfayı yenileyin." };
  }
  const { codes } = await knownPartners();
  if (!codes.includes(input.data.partner)) return { status: "error", message: "Partner bulunamadı. Sayfayı yenileyin." };
  const { expectedCount, expectedTotal, ...change } = input.data;
  const outcome = await changePartnerInvoice({ ...change, adminId: admin.id, expected: { count: expectedCount, totalKurus: expectedTotal } });
  revalidatePath("/yonetim/partnerler");
  if (outcome.status === "nothing") return { status: "error", message: "Bu fatura artık işaretli değil; başka biri düzeltmiş ya da geri almış olabilir. Sayfayı yenileyin." };
  if (outcome.status === "changed") return { status: "error", message: "Fatura bu pencere açıldıktan sonra değişti; hiçbir şey değiştirilmedi. Sayfayı yenileyip yeniden deneyin." };
  if (outcome.status === "same") return { status: "error", message: "Yeni fatura bilgisi eskisiyle aynı." };
  revalidatePath("/yonetim/siparisler");
  const done = outcome.status === "undone" ? "undone" : "corrected";
  return { status: "success", next: `/yonetim/partnerler?${done}=${outcome.count}&partner=${encodeURIComponent(change.partner)}` };
}
