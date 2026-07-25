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

/**
 * Sheet'te gösterilen bir görsel. `id` yalnız catalog.product_images satırında
 * doludur; devralınan (public.part_images, TecDoc) görseller id'siz gelir ve
 * salt-okunurdur — silmek için kaynak parçayı değiştirmek gerekir.
 */
export interface AdminCatalogImage {
  id: string | null
  url: string
  thumb: string | null
  position: number
  source: string
  isPrimary: boolean
}

/** Sheet'te gösterilen bir teknik özellik. `id` kuralı görsellerle aynı. */
export interface AdminCatalogProperty {
  id: string | null
  key: string
  value: string
  source: string
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
  eans: Array<{ code: string; source: string }>
  images: AdminCatalogImage[]
  properties: AdminCatalogProperty[]
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

export interface MutateProductCodeInput {
  id: string
  code: string
  /**
   * OEM silmede marka varyantını hedefler (bkz. removeCatalogProductOem).
   * Verilmezse kodun tüm marka varyantları silinir. EAN mutasyonlarında
   * kullanılmaz.
   */
  brand?: string | null
}

export interface MutateProductOemResult extends AdminCatalogActionResult {
  oems: Array<{ code: string; brand: string | null; source: string }>
}

export interface MutateProductEanResult extends AdminCatalogActionResult {
  eans: Array<{ code: string; source: string }>
}

export interface MutateProductImageResult extends AdminCatalogActionResult {
  images: AdminCatalogImage[]
  /** products.primary_image_url — vitrin kartı/arama indeksi bunu kullanır. */
  primaryImageUrl: string | null
}

export interface MutateProductPropertyResult extends AdminCatalogActionResult {
  properties: AdminCatalogProperty[]
}

export interface MutateProductPropertyInput {
  id: string
  key: string
  value?: string
}
