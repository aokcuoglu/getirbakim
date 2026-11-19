/**
 * Payment states in which operations handle an order (confirm, procure, ship, deliver, cancel): paid online, a legacy
 * offline order ('none'), or a partner order on account (#426), invoiced to the partner later. Unpaid online orders
 * ('awaiting') expire on their own and are left alone. Kept import-free: admin pages and server modules both read it.
 */
export const handledPaymentStatuses = ["paid", "none", "on_account"] as const;

export function isHandledPayment(status: string) {
  return (handledPaymentStatuses as readonly string[]).includes(status);
}

/** The same list for SQL filters (`o.payment_status IN ${handledPaymentSql}`); constant text, no user input. */
export const handledPaymentSql = `(${handledPaymentStatuses.map(status => `'${status}'`).join(",")})`;
