export type CatalogProductStatus = 'ACTIVE' | 'DRAFT' | 'HIDDEN' | 'ARCHIVED'

export type CatalogStatusFilter = 'all' | CatalogProductStatus
export type CatalogStockFilter = 'all' | 'in' | 'out'
export type CatalogSortKey = 'updated' | 'price_asc' | 'price_desc' | 'stock'

export interface AdminCatalogFilters {
  q?: string
  status?: CatalogStatusFilter
  stock?: CatalogStockFilter
  sort?: CatalogSortKey
  page?: number
  limit?: number
}

export interface AdminCatalogKpis {
  totalProducts: number
  inStock: number
  priced: number
  enriched: number
}

export interface AdminCatalogListItem {
  id: string
  partNo: string
  name: string
  displayName: string
  slug: string | null
  status: CatalogProductStatus
  brandName: string
  categoryName: string | null
  sellingPriceExVat: number | null
  priceIncVat: number | null
  totalStockQty: number
  inStock: boolean
  offerCount: number
  isEnriched: boolean
  hasPriceOverride: boolean
  lockPrice: boolean
  href: string | null
  updatedAt: string
}

export interface AdminCatalogPagination {
  page: number
  limit: number
  total: number
  pages: number
}

export interface AdminCatalogListResult {
  products: AdminCatalogListItem[]
  kpis: AdminCatalogKpis
  pagination: AdminCatalogPagination
}

export interface AdminCatalogOffer {
  id: string
  supplierCode: string
  supplierName: string
  supplierSku: string
  listPrice: number | null
  costTry: number | null
  netCostTry: number | null
  sellingPriceTry: number | null
  currency: string
  stockQty: number
  isActive: boolean
  lastSyncedAt: string | null
}

export interface AdminCatalogProductDetail {
  id: string
  partNo: string
  name: string
  slug: string | null
  status: CatalogProductStatus
  brandName: string
  categoryId: number | null
  categoryName: string | null
  primaryImageUrl: string | null
  primaryPartId: string | null
  sellingPriceExVat: number | null
  totalStockQty: number
  offerCount: number
  href: string | null
  offers: AdminCatalogOffer[]
  oems: Array<{ code: string; brand: string | null; source: string }>
  eanCount: number
  imageCount: number
  propertyCount: number
  vehicleCount: number
  override: {
    sellingPriceOverride: number | null
    lockPrice: boolean
    nameOverride: string | null
    categoryOverrideId: number | null
    note: string | null
    updatedBy: string | null
    updatedAt: string | null
  } | null
  updatedAt: string
}

export interface UpdateCatalogOverrideInput {
  id: string
  status?: CatalogProductStatus
  sellingPriceOverride?: number | null
  lockPrice?: boolean
  nameOverride?: string | null
  note?: string | null
}

export interface AdminCatalogActionResult {
  success: boolean
  message: string
}
