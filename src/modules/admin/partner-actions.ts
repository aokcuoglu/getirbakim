"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/modules/auth/session";
import { savePartnerDiscount } from "@/modules/partner/discounts";
import { setPartnerIntakePaused } from "@/modules/partner/intake";
import { changePartnerInvoice, invoicePartnerOrders, knownPartners, savePartnerOrderLimit, undoPartnerOrderInvoice } from "@/modules/partner/limits";
import { recordInvoicePayment, savePartnerPaymentTerm as storePaymentTerm, voidInvoicePayment } from "@/modules/partner/collections";
import { money } from "@/modules/store/money";
import { orderListReturn } from "./order-list-return";
import { partnerDiscountInput, partnerInvoiceChangeInput, partnerInvoiceInput, partnerIntakeInput, partnerLimitInput, partnerOrderInvoiceUndoInput, partnerPaymentInput,
  partnerPaymentVoidInput, partnerTermInput } from "./partner-input";

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

/**
 * A partner's B2B discount (#1130): a percent (0–90) applied to its product prices, quotes and orders at once, or empty
 * to fall back to PARTNER_B2B_DISCOUNT_BPS. The change is recorded with the admin (partner_discount_changes).
 */
export async function savePartnerDiscountRate(form: FormData) {
  const admin = await requireAdmin();
  const input = partnerDiscountInput.safeParse(Object.fromEntries(form));
  const { codes } = await knownPartners();
  const partner = form.get("partner");
  if (!input.success || !codes.includes(input.data.partner)) {
    redirect(`/yonetim/partnerler?error=discount${typeof partner === "string" && codes.includes(partner) ? `&partner=${encodeURIComponent(partner)}` : ""}`);
  }
  await savePartnerDiscount(input.data.partner, input.data.discount, admin.id);
  revalidatePath("/yonetim/partnerler");
  redirect(`/yonetim/partnerler?discount=${encodeURIComponent(input.data.partner)}`);
}

/** Pauses or resumes a partner's order intake (#1009): paused partners get 503 ORDER_INTAKE_PAUSED for new quotes and orders. */
export async function setPartnerIntake(form: FormData) {
  const admin = await requireAdmin();
  const input = partnerIntakeInput.safeParse(Object.fromEntries(form));
  const { codes } = await knownPartners();
  if (!input.success || !codes.includes(input.data.partner)) redirect("/yonetim/partnerler?error=intake");
  await setPartnerIntakePaused(input.data.partner, input.data.paused, admin.id);
  revalidatePath("/yonetim/partnerler");
  redirect(`/yonetim/partnerler?${input.data.paused ? "paused" : "resumed"}=${encodeURIComponent(input.data.partner)}`);
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

/** An undo that would leave an invoice's recorded payments above what is left of it (#1006). */
const collectedMessage = "Bu faturaya tahsilat girilmiş; önce tahsilatı iptal edin.";

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
  if (outcome.status === "merge") return { status: "error", errors: { newInvoiceRef: ["Bu partnerin aynı numara ve tarihli başka bir faturası var; iki fatura birleşirdi. Farklı bir numara ya da tarih girin."] } };
  if (outcome.status === "collected") return { status: "error", message: collectedMessage };
  revalidatePath("/yonetim/siparisler");
  const done = outcome.status === "undone" ? "undone" : "corrected";
  return { status: "success", next: `/yonetim/partnerler?${done}=${outcome.count}&partner=${encodeURIComponent(change.partner)}` };
}

export type PartnerOrderInvoiceUndoResult = { status: "idle" | "success" | "error"; message?: string; errors?: Partial<Record<"reason", string[]>>; next?: string };

/**
 * Undoes one partner order's invoiced mark from /yonetim/siparisler (#1038) with a reason. Refused when the mark differs
 * from what the dialog showed; the order counts against the partner's limit again, the invoice's other orders keep theirs.
 */
export async function undoPartnerOrderInvoiceMark(_previous: PartnerOrderInvoiceUndoResult, form: FormData): Promise<PartnerOrderInvoiceUndoResult> {
  const admin = await requireAdmin();
  const input = partnerOrderInvoiceUndoInput.safeParse(Object.fromEntries(form));
  if (!input.success) {
    const reason = input.error.flatten().fieldErrors.reason;
    return reason ? { status: "error", errors: { reason } } : { status: "error", message: "Sipariş bulunamadı. Listeyi yenileyin." };
  }
  const { order, invoiceRef, invoiceDate, reason } = input.data;
  const outcome = await undoPartnerOrderInvoice({ orderId: order, reason, adminId: admin.id, expected: { invoiceRef, invoiceDate } });
  if (outcome.status === "nothing") return { status: "error", message: "Bu sipariş artık faturalandı olarak işaretli değil; başka biri geri almış olabilir. Listeyi yenileyin." };
  if (outcome.status === "changed") return { status: "error", message: "Siparişin fatura bilgisi bu pencere açıldıktan sonra değişti; hiçbir şey değiştirilmedi. Listeyi yenileyip yeniden deneyin." };
  if (outcome.status === "collected") return { status: "error", message: collectedMessage };
  revalidatePath("/yonetim/siparisler");
  revalidatePath("/yonetim/partnerler");
  // invoice_emptied: the order was the invoice's last one, so the invoice is gone from /yonetim/partnerler.
  return { status: "success", next: orderListReturn(form.get("back"), outcome.remaining ? "invoice_undone" : "invoice_emptied", outcome.orderNumber) };
}

/** A partner's payment term (#1006): whole days, or empty for none (its invoices are then never overdue). */
export async function savePartnerPaymentTerm(form: FormData) {
  const admin = await requireAdmin();
  const input = partnerTermInput.safeParse(Object.fromEntries(form));
  const { codes } = await knownPartners();
  const partner = form.get("partner");
  if (!input.success || !codes.includes(input.data.partner)) {
    redirect(`/yonetim/partnerler?error=term${typeof partner === "string" && codes.includes(partner) ? `&partner=${encodeURIComponent(partner)}` : ""}`);
  }
  await storePaymentTerm(input.data.partner, input.data.term, admin.id);
  revalidatePath("/yonetim/partnerler");
  redirect(`/yonetim/partnerler?term=${encodeURIComponent(input.data.partner)}`);
}

export type PartnerPaymentResult = {
  status: "idle" | "success" | "error";
  message?: string;
  errors?: Partial<Record<"amount" | "paidOn" | "method" | "note", string[]>>;
  next?: string;
};

/**
 * "Tahsilat gir" (#1006): one payment against a marked invoice. Refused when the invoice is gone, its total or collected
 * amount differs from what the dialog showed, or the amount is above its balance.
 */
export async function recordPartnerPayment(_previous: PartnerPaymentResult, form: FormData): Promise<PartnerPaymentResult> {
  const admin = await requireAdmin();
  const input = partnerPaymentInput().safeParse(Object.fromEntries(form));
  if (!input.success) {
    const errors: Partial<Record<string, string[]>> = input.error.flatten().fieldErrors;
    const shown = { amount: errors.amount, paidOn: errors.paidOn, method: errors.method, note: errors.note };
    return Object.values(shown).some(Boolean) ? { status: "error", errors: shown } : { status: "error", message: "Fatura bulunamadı. Sayfayı yenileyin." };
  }
  const { codes } = await knownPartners();
  if (!codes.includes(input.data.partner)) return { status: "error", message: "Partner bulunamadı. Sayfayı yenileyin." };
  const { partner, invoiceRef, invoiceDate, amount, paidOn, method, note, expectedTotal, expectedCollected } = input.data;
  const outcome = await recordInvoicePayment({ partner, invoiceRef, invoiceDate, amountKurus: amount, paidOn, method, note, adminId: admin.id,
    expected: { totalKurus: expectedTotal, collectedKurus: expectedCollected } });
  revalidatePath("/yonetim/partnerler");
  if (outcome.status === "nothing") return { status: "error", message: "Bu fatura artık işaretli değil; düzeltilmiş ya da geri alınmış olabilir. Sayfayı yenileyin." };
  if (outcome.status === "changed") return { status: "error", message: "Faturanın tutarı ya da tahsilatı bu pencere açıldıktan sonra değişti; tahsilat kaydedilmedi. Sayfayı yenileyip yeniden deneyin." };
  if (outcome.status === "overpaid") return { status: "error", errors: { amount: [`Tutar faturanın kalanını (${money(outcome.balanceKurus)}) aşamaz.`] } };
  return { status: "success", next: `/yonetim/partnerler?collected=${encodeURIComponent(partner)}` };
}

export type PartnerPaymentVoidResult = { status: "idle" | "success" | "error"; message?: string; errors?: Partial<Record<"reason", string[]>>; next?: string };

/** "Tahsilatı iptal et" (#1006): voids a payment with a reason; the invoice's balance opens again. */
export async function voidPartnerPayment(_previous: PartnerPaymentVoidResult, form: FormData): Promise<PartnerPaymentVoidResult> {
  const admin = await requireAdmin();
  const input = partnerPaymentVoidInput.safeParse(Object.fromEntries(form));
  if (!input.success) {
    const reason = input.error.flatten().fieldErrors.reason;
    return reason ? { status: "error", errors: { reason } } : { status: "error", message: "Tahsilat bulunamadı. Sayfayı yenileyin." };
  }
  const outcome = await voidInvoicePayment({ paymentId: input.data.payment, reason: input.data.reason, adminId: admin.id });
  revalidatePath("/yonetim/partnerler");
  if (outcome.status === "nothing") return { status: "error", message: "Bu tahsilat zaten iptal edilmiş ya da bulunamadı. Sayfayı yenileyin." };
  return { status: "success", next: `/yonetim/partnerler?voided=${encodeURIComponent(outcome.partner)}` };
}
