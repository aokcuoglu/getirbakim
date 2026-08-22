export type AdminStockFilter =
  | 'all'
  | 'in_stock'
  | 'out_of_stock'
  | 'zero_price'
export type AdminSortBy =
  | 'created_at'
  | 'name'
  | 'selling_price'
  | 'supplier_stock_qty'
  | 'last_synced_at'
export type AdminSortOrder = 'asc' | 'desc'

export interface AdminProductFilters {
  q?: string
  page?: number
  limit?: number
  brandId?: number | null
  categoryId?: number | null
  stockStatus?: AdminStockFilter
  sortBy?: AdminSortBy
  sortOrder?: AdminSortOrder
}

export interface AdminProductListItem {
  id: string
  articleLinkId: string
  name: string
  variantCount?: number
  brand: string | null
  category: string | null
  supplierPrice: number | null
  sellingPrice: number
  supplierStockQty: number
  availableStockQty: number
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  lastSyncedAt: string | null
  lockPrice: boolean
  note: string | null
  createdAt: string
  updatedAt: string
}

export interface AdminProductDetail extends AdminProductListItem {
  brandId: number | null
  categoryId: number | null
  inBasket: boolean
  description: string | null
  computedCostExVat: number | null
  eans: string[]
  oemReferences: Array<{ brand: string; code: string }>
  crossReferences: Array<{ brand: string; articleNumber: string }>
  properties: Array<{ key: string; value: string }>
  documents: Array<{
    id: number
    name: string
    type: string
    url: string | null
  }>
  imageUrls: string[]
  recentSyncRuns: Array<{
    id: number
    source: string
    status: string
    startedAt: string
    endedAt: string | null
    totalCount: number
    successCount: number
    failedCount: number
    errorSummary: string | null
  }>
  variants: Array<{
    id: string
    articleLinkId: string
    name: string
    supplierStockQty: number
    updatedAt: string
  }>
}

export interface AdminBulkUpdateInput {
  partIds: string[]
  sellingPriceOverride?: number | null
  lockPrice?: boolean
}

export interface AdminImportPreviewRow {
  row: number
  partId: string | null
  articleLinkId: string | null
  status: 'READY' | 'UPDATED' | 'ERROR' | 'SKIPPED'
  message: string
}

export interface AdminNewImportPreviewRow {
  row: number
  partId: string | null
  articleLinkId: string | null
  templatePartId: string | null
  status: 'READY' | 'CREATED' | 'ERROR' | 'SKIPPED'
  message: string
}

export interface AdminProductKpis {
  totalProducts: number
  zeroPriceCount: number
}

export interface AdminProductSearchMeta {
  normalizedQuery: string
  primaryMatchPartId: string | null
  primaryMatchStrength: 'exact' | 'prefix' | null
}

export interface AdminProductOptions {
  brands: Array<{ id: number; name: string }>
  categories: Array<{ id: number; name: string }>
}

export interface AdminProductsListResult {
  filters: Required<AdminProductFilters>
  products: AdminProductListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
}

export interface AdminProductsWorkbenchResult {
  filters: AdminProductsListResult['filters']
  products: AdminProductsListResult['products']
  pagination: AdminProductsListResult['pagination']
  kpis: AdminProductKpis
  searchMeta: AdminProductSearchMeta
}

export interface AdminProductsResult extends AdminProductsWorkbenchResult {
  options: AdminProductOptions
}

export interface AdminDinamikProductFilters {
  q?: string
  queryBrand?: string | null
  page?: number
  limit?: number
}

export interface AdminDinamikProductListItem {
  queryBrand: string | null
  partNo: string | null
  stockCode: string
  stockName: string | null
  brand: string | null
  price: number | null
  barcode1: string | null
  barcode2: string | null
  barcode3: string | null
  updatedAt: string | null
}

export interface AdminDinamikProductsResult {
  filters: Required<AdminDinamikProductFilters>
  products: AdminDinamikProductListItem[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  kpis: {
    totalProducts: number
    distinctBrands: number
    pricedRows: number
  }
  options: {
    queryBrands: string[]
    brands: Array<{ id: number; name: string }>
    categories: Array<{ id: number; name: string }>
  }
}

export interface AdminDashboardData {
  /** Sayımlar catalog.products üzerinden — sattığımız kanonik ürün kaydı. */
  metrics: {
    totalProducts: number
    outOfStockCount: number
    unpricedCount: number
    /** primary_part_id boş: public.part_* arşivinden zenginleştirilmemiş. */
    unenrichedCount: number
  }
  salesSeries: Array<{
    month: string
    revenue: number
    orders: number
  }>
  recentOrders: Array<{
    id: number
    customerName: string
    customerEmail: string | null
    createdAt: string
    totalAmount: number
    status: string
  }>
  alerts: Array<{
    id: string
    label: string
    value: number
    severity: 'high' | 'medium' | 'low'
  }>
}
/**
 * `updateAdminProductTechnicalDetail` girdisi (lib/actions/admin-products.ts).
 *
 * Tip daha önce hiç tanımlanmamıştı — eylem, var olmayan bir dışa aktarımı
 * içeri alıyordu ve bu, `tsc` altında kalite kapısını kırmanın yanında eylemin
 * gövdesindeki her satırı da örtük `any` yapıyordu. Alanlar eylemin GERÇEKTEN
 * okuduğu şekilden türetildi; davranış değişmedi.
 *
 * Alanların hepsi isteğe bağlı: eylem her birini `|| []` ile okuyor, yani
 * gönderilmeyen bir bölüm "boşalt" değil "dokunma" anlamına gelmiyor —
 * ilgili satırlar her durumda silinip yeniden yazılıyor.
 */
export interface PartTechnicalReferenceInput {
  eans?: string[]
  oemReferences?: Array<{ brand: string | null; code: string | null }>
  crossReferences?: Array<{ brand: string | null; articleNumber: string | null }>
  properties?: Array<{ key: string | null; value: string | null }>
}
