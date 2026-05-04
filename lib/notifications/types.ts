export type NotificationEventType =
  | 'CART_PRICE_CHANGED'
  | 'CART_STOCK_REDUCED'
  | 'CART_ITEM_REMOVED'
  | 'ORDER_STATUS_CHANGED'
  | 'ORDER_PAYMENT_SUCCEEDED'
  | 'ORDER_PAYMENT_FAILED'

export type NotificationRecord = {
  id: string
  type: NotificationEventType
  title: string
  message: string
  payload: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

export type CartReconcileEvent = {
  type: Extract<
    NotificationEventType,
    'CART_PRICE_CHANGED' | 'CART_STOCK_REDUCED' | 'CART_ITEM_REMOVED'
  >
  partId: number
  message: string
  oldPrice?: number
  newPrice?: number
  oldQuantity?: number
  newQuantity?: number
  reason?: 'NOT_FOUND' | 'PRICE_UNAVAILABLE' | 'OUT_OF_STOCK'
}
