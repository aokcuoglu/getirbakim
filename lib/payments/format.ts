export function formatCheckoutPaymentTitle(method: string | null): string {
  if (method === 'TAMI') return 'Tami'
  if (method === 'CASH_ON_DELIVERY') return 'Cash on Delivery'
  return method || '-'
}
