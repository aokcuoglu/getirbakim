/** How a partner paid an invoice (#1006); partner_invoice_payments.method's CHECK lists the same values. */
export const paymentMethods = ["bank_transfer", "check", "offset", "other"] as const;
export type PaymentMethod = (typeof paymentMethods)[number];

/** How each method reads in /yonetim, in the payment dialog's order. */
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  bank_transfer: "Havale/EFT", check: "Çek", offset: "Mahsup (iade faturası)", other: "Diğer",
};
