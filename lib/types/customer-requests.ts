export const CUSTOMER_REQUEST_TYPES = [
  'PRICE_REQUEST',
  'PRODUCT_QUESTION',
  'MISSING_PRODUCT'
] as const

export type CustomerRequestType = (typeof CUSTOMER_REQUEST_TYPES)[number]

export const CUSTOMER_REQUEST_STATUSES = [
  'NEW',
  'IN_REVIEW',
  'RESOLVED',
  'ARCHIVED'
] as const

export type CustomerRequestStatus = (typeof CUSTOMER_REQUEST_STATUSES)[number]

export const CUSTOMER_REQUEST_SOURCES = [
  'PRICE_MODAL',
  'PRODUCT_FAQ_FORM',
  'MISSING_PRODUCT_MODAL'
] as const

export type CustomerRequestSource = (typeof CUSTOMER_REQUEST_SOURCES)[number]

export interface CustomerRequestVehicleSnapshot {
  id?: string
  year?: number
  make?: string
  model?: string
  engine?: string
  fuel?: string
  variant?: string
  urlKey?: string
  vehicleTypeId?: number
}

export interface CreateCustomerRequestInput {
  requestType: CustomerRequestType
  source: CustomerRequestSource
  name: string
  email: string
  phone?: string
  partId?: number | null
  partNameSnapshot?: string
  brandNameSnapshot?: string
  categoryNameSnapshot?: string
  pageUrl?: string
  locale?: string
  vehicle?: CustomerRequestVehicleSnapshot | null
  searchQuery?: string
  requestedSkuOrOem?: string
  message?: string
}

export interface CustomerRequestFilters {
  q?: string
  type?: CustomerRequestType | 'all'
  status?: CustomerRequestStatus | 'all'
  source?: CustomerRequestSource | 'all'
  from?: string
  to?: string
  page?: number
  limit?: number
}

export interface CustomerRequestListItem {
  id: number
  requestType: CustomerRequestType
  status: CustomerRequestStatus
  source: CustomerRequestSource
  name: string
  email: string
  phone: string | null
  partId: number | null
  partNameSnapshot: string | null
  brandNameSnapshot: string | null
  categoryNameSnapshot: string | null
  pageUrl: string | null
  locale: string | null
  vehicle: CustomerRequestVehicleSnapshot | null
  searchQuery: string | null
  requestedSkuOrOem: string | null
  message: string | null
  adminNote: string | null
  assignedTo: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  userId: string | null
}

export interface CustomerRequestDetail extends CustomerRequestListItem {}

export interface CustomerRequestsResult {
  filters: Required<Omit<CustomerRequestFilters, 'page' | 'limit'>> & {
    page: number
    limit: number
  }
  requests: CustomerRequestListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  kpis: {
    openTotal: number
    newToday: number
    priceRequestsOpen: number
    productQuestionsOpen: number
    missingProductsOpen: number
  }
}

export interface UpdateCustomerRequestInput {
  id: number
  status?: CustomerRequestStatus
  adminNote?: string
}

export interface CustomerRequestMutationResult<T = undefined> {
  success: boolean
  message: string
  data?: T
}
