import { parseConsent } from "@/lib/cookie-consent";

/** A paid order's purchase event is offered for this long after payment; later visits to the order page send nothing. */
export const PURCHASE_EVENT_WINDOW_DAYS = 7;
const windowMs = PURCHASE_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** Whether the order page should try to send the purchase event for an order paid at `paidAt`. */
export function purchaseEventOpen(paidAt: Date | string | null, now: Date) {
  if (!paidAt) return false;
  const paid = new Date(paidAt).getTime();
  return Number.isFinite(paid) && now.getTime() - paid < windowMs;
}

/**
 * The server's own check before the once-only flag is spent (#675, #676): a visitor who is not an admin (an admin opening the
 * order must not count as the purchase) and a channel that would measure it: a GA4 id with analytics consent, or an
 * advertising purchase tag (`marketing`) with marketing consent, in the request's consent cookie.
 */
export function purchaseClaimAllowed(input: {
  ga4: string | null; marketing: boolean; role: string | null | undefined; consent: string | null; now: number;
}) {
  if (input.role === "admin") return false;
  const consent = parseConsent(input.consent, input.now);
  return Boolean((input.ga4 !== null && consent?.analytics) || (input.marketing && consent?.marketing));
}
