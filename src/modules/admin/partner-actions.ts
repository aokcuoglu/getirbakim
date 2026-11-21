"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin } from "@/modules/auth/session";
import { savePartnerDiscount } from "@/modules/partner/discounts";
import { setPartnerIntakePaused } from "@/modules/partner/intake";
import { changePartnerInvoice, invoicePartnerOrders, knownPartners, savePartnerOrderLimit, undoPartnerOrderInvoice } from "@/modules/partner/limits";
import { parsePartnerWebhooks, partnerWebhooksEnv } from "@/modules/partner/webhook-contract";
import { deliverPartnerWebhooksSafely, readPartnerWebhookEvent, requeuePartnerWebhook, requeuePartnerWebhooks } from "@/modules/partner/webhooks";
import { orderListReturn } from "./order-list-return";
import { partnerDiscountInput, partnerInvoiceChangeInput, partnerInvoiceInput, partnerIntakeInput, partnerLimitInput, partnerOrderInvoiceUndoInput, partnerWebhookRequeueAllInput,
  partnerWebhookRequeueInput } from "./partner-input";

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

/** Whether the partner has a usable webhook endpoint now; a requeue without one would only wait or be skipped. */
const hasWebhookEndpoint = (partner: string) => parsePartnerWebhooks(process.env[partnerWebhooksEnv]).endpoints.has(partner);
const webhookReturn = (outcome: string, partner?: string, count?: number) =>
  `/yonetim/partnerler?webhook=${outcome}${partner ? `&partner=${encodeURIComponent(partner)}` : ""}${count ? `&count=${count}` : ""}`;

/**
 * Sends one given-up partner webhook again (#1002): the event keeps its id, gets a fresh 72 hours and is sent now, so the
 * page shows the outcome. Refused while the partner has no usable endpoint.
 */
export async function requeuePartnerWebhookEvent(form: FormData) {
  const admin = await requireAdmin();
  const input = partnerWebhookRequeueInput.safeParse(Object.fromEntries(form));
  if (!input.success) redirect(webhookReturn("gone"));
  const { codes } = await knownPartners();
  const event = await readPartnerWebhookEvent(input.data.event);
  if (!event || event.status !== "dead" || !codes.includes(event.partner)) redirect(webhookReturn("gone"));
  if (!hasWebhookEndpoint(event.partner)) redirect(webhookReturn("no_endpoint", event.partner));
  const requeued = await requeuePartnerWebhook(input.data.event, admin.id, [event.partner]);
  if (!requeued) redirect(webhookReturn("gone"));
  // Sends the order's pending events now; this one is claimed at once (no claim, a fresh requeue).
  await deliverPartnerWebhooksSafely({ orderId: requeued.orderId });
  const sent = await readPartnerWebhookEvent(input.data.event);
  revalidatePath("/yonetim/partnerler");
  redirect(webhookReturn(sent?.status === "delivered" ? "delivered" : sent?.status === "pending" ? "pending" : "gone", requeued.partner));
}

/** Requeues every given-up webhook event of one partner (#1002); they go out right after the answer (next sweep at the latest). */
export async function requeuePartnerWebhookEvents(form: FormData) {
  const admin = await requireAdmin();
  const input = partnerWebhookRequeueAllInput.safeParse(Object.fromEntries(form));
  const { codes } = await knownPartners();
  if (!input.success || !codes.includes(input.data.partner)) redirect(webhookReturn("gone"));
  if (!hasWebhookEndpoint(input.data.partner)) redirect(webhookReturn("no_endpoint", input.data.partner));
  const count = await requeuePartnerWebhooks(input.data.partner, admin.id);
  if (count > 0) after(() => deliverPartnerWebhooksSafely({ limit: 20 }));
  revalidatePath("/yonetim/partnerler");
  redirect(count > 0 ? webhookReturn("queued", input.data.partner, count) : webhookReturn("gone"));
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
  if (outcome.status === "merge") return { status: "error", errors: { newInvoiceRef: ["Bu partnerin aynı numara ve tarihli başka bir faturası var; iki fatura birleşirdi. Farklı bir numara ya da tarih girin."] } };
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
  revalidatePath("/yonetim/siparisler");
  revalidatePath("/yonetim/partnerler");
  // invoice_emptied: the order was the invoice's last one, so the invoice is gone from /yonetim/partnerler.
  return { status: "success", next: orderListReturn(form.get("back"), outcome.remaining ? "invoice_undone" : "invoice_emptied", outcome.orderNumber) };
}
