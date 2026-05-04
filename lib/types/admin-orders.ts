export type AdminOrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'PAYMENT_FAILED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REFUNDED'

export interface AdminOrderFilters {
  q?: string
  status?: 'all' | AdminOrderStatus
  page?: number
  limit?: number
}

export interface AdminOrderListItem {
  id: number
  orderNumber: string
  userId: string | null
  guestName: string | null
  guestEmail: string | null
  guestPhone: string | null
  customerName: string
  customerEmail: string | null
  paymentStatus: string
  paymentMethod: string | null
  totalAmount: number
  status: string
  createdAt: string
  updatedAt: string
  itemsCount: number
}

export interface AdminOrderDetail {
  id: number
  orderNumber: string
  userId: string | null
  guestName: string | null
  guestEmail: string | null
  guestPhone: string | null
  customerName: string
  customerEmail: string | null
  paymentStatus: string
  paymentMethod: string | null
  shippingMethod: string | null
  subtotalAmount: number
  shippingFee: number
  note: string | null
  totalAmount: number
  status: string
  createdAt: string
  updatedAt: string
  latestPayment: {
    provider: string
    status: string
    providerPaymentId: string | null
    paidAt: string | null
    failureReason: string | null
  } | null
  items: Array<{
    id: number
    partId: string
    quantity: number
    price: number
    productName: string
    articleLinkId: string
  }>
  summary: {
    itemsTotal: number
    totalQuantity: number
  }
}

export interface AdminOrdersResult {
  filters: Required<AdminOrderFilters>
  orders: AdminOrderListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  kpis: {
    totalOrders: number
    pendingOrders: number
    completedOrders: number
    cancelledOrders: number
  }
}
