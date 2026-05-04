export interface AdminCustomerFilters {
  q?: string
  role?: 'all' | 'ADMIN' | 'CUSTOMER'
  page?: number
  limit?: number
}

export interface AdminCustomerListItem {
  id: string
  name: string
  email: string
  role: string
  emailVerified: boolean
  image: string | null
  createdAt: string
  ordersCount: number
  totalSpent: number
  lastOrderAt: string | null
}

export interface AdminCustomerDetail {
  id: string
  name: string
  email: string
  role: string
  emailVerified: boolean
  image: string | null
  createdAt: string
  updatedAt: string
  ordersCount: number
  totalSpent: number
  lastOrderAt: string | null
  orders: Array<{
    id: number
    status: string
    totalAmount: number
    createdAt: string
    itemsCount: number
  }>
  vehicles: Array<{
    id: number
    createdAt: string | null
    vehicleData: unknown
  }>
}

export interface AdminCustomersResult {
  filters: Required<AdminCustomerFilters>
  customers: AdminCustomerListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  kpis: {
    totalCustomers: number
    adminUsers: number
    verifiedCustomers: number
    activeCustomers: number
  }
}
