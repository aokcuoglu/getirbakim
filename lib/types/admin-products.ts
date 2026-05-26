import type { DinamikRegionalStock } from '@/lib/suppliers/dinamik-stock'

export type AdminStockFilter =
  | 'all'
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'zero_price'
export type AdminVisibilityFilter = 'all' | 'visible' | 'hidden'
export type AdminSyncFilter = 'all' | 'OK' | 'PENDING' | 'ERROR'
export type AdminSortBy =
  | 'created_at'
  | 'name'
  | 'selling_price'
  | 'supplier_stock_qty'
  | 'last_synced_at'
export type AdminSortOrder = 'asc' | 'desc'
export type RegionalStock = DinamikRegionalStock

export interface AdminProductFilters {
  q?: string
  page?: number
  limit?: number
  brandId?: number | null
  categoryId?: number | null
  providerId?: number | null
  stockStatus?: AdminStockFilter
  visibility?: AdminVisibilityFilter
  syncStatus?: AdminSyncFilter
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
  reservedStockQty: number
  minStockLevel: number
  availableStockQty: number
  stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
  syncStatus: 'OK' | 'PENDING' | 'ERROR'
  lastSyncedAt: string | null
  isVisible: boolean
  lockPrice: boolean
  lockVisibility: boolean
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
  supplierSummary?: ProductSupplierSummary | null
  variants: Array<{
    id: string
    articleLinkId: string
    name: string
    supplierStockQty: number
    syncStatus: 'OK' | 'PENDING' | 'ERROR'
    isVisible: boolean
    updatedAt: string
  }>
}

export interface AdminBulkUpdateInput {
  partIds: string[]
  sellingPriceOverride?: number | null
  isVisible?: boolean
  lockPrice?: boolean
  lockVisibility?: boolean
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
  lowStockCount: number
  zeroPriceCount: number
  syncErrorCount: number
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
  metrics: {
    totalProducts: number
    lowStockCount: number
    zeroPriceCount: number
    syncErrorCount: number
    failedSyncRate: number
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

export interface SupplierProvider {
  id: number
  code: string
  name: string
  status: string
  priority: number
  schedule: string | null
  baseUrl: string | null
  lastSyncAt: string | null
  syncStats: {
    lastRunStatus: string | null
    lastRunAt: string | null
    failedRate30d: number
    totalRuns30d: number
  }
  productCounts: {
    total: number
    approved: number
    queue: number
    ignored: number
  }
}

export interface SupplierProduct {
  id: number
  providerId: number
  supplierProductKey: string
  supplierSku: string
  supplierBrand: string | null
  supplierName: string | null
  supplierPrice: number | null
  supplierStockQty: number
  currency: string
  lastSeenAt: string
}

export interface SupplierPartMapping {
  id: number
  providerId: number
  supplierProductId: number
  supplierSku: string
  partId: string | null
  status: 'QUEUE' | 'APPROVED' | 'IGNORED'
  workflowStatus:
    | 'NEW'
    | 'NEEDS_BRAND_MAPPING'
    | 'NEEDS_CATEGORY_MAPPING'
    | 'MATCHED_EXISTING'
    | 'READY_TO_CLONE'
    | 'CLONED_DRAFT'
    | 'IGNORED'
  confidence: number | null
  matchReason: string | null
  isManual: boolean
  approvedBy: string | null
  approvedAt: string | null
  ignoredReason: string | null
  supplierProduct: {
    id: number
    sku: string
    name: string | null
    brand: string | null
    price: number | null
    stockQty: number
    currency: string
    lastSeenAt: string
  }
  part: {
    id: string
    articleLinkId: string
    name: string
    brand: string | null
  } | null
}

export interface SupplierProductMappingRow {
  supplierProductId: number
  providerId: number
  providerCode: string
  providerName: string
  queryBrand: string | null
  partNo: string | null
  stockCode: string
  stockName: string | null
  brand: string | null
  price: number | null
  currency: string
  barcode1: string | null
  barcode2: string | null
  barcode3: string | null
  updatedAt: string | null
  mappingStatus: 'QUEUE' | 'APPROVED' | 'IGNORED' | null
  supplierStockQty: number
  workflowStatus: string | null
  matchedPart: {
    id: string
    articleLinkId: string
    name: string
    brand: string | null
  } | null
}

export interface SupplierProductMappingDetail {
  provider: {
    id: number
    code: string
    name: string
  }
  row: SupplierProductMappingRow
  supplierProduct: {
    id: number
    key: string
    sku: string
    name: string | null
    brand: string | null
    price: number | null
    currency: string
    stockQty: number
    barcode1: string | null
    barcode2: string | null
    barcode3: string | null
    regionalStock: RegionalStock | null
    lastSeenAt: string
    rawJson: unknown
  }
  mapping: {
    id: number
    status: 'QUEUE' | 'APPROVED' | 'IGNORED'
    workflowStatus:
      | 'NEW'
      | 'NEEDS_BRAND_MAPPING'
      | 'NEEDS_CATEGORY_MAPPING'
      | 'MATCHED_EXISTING'
      | 'READY_TO_CLONE'
      | 'CLONED_DRAFT'
      | 'IGNORED'
    confidence: number | null
    matchReason: string | null
    isManual: boolean
    partId: string | null
  } | null
  referenceClone: {
    partId: string
    sourcePartId: string
    relationType: string
    copyMode: string
    isActive: boolean
  } | null
  suggestedQuery: string
  suggestedOemCodes: string[]
  suggestedRefCodes: string[]
  manualOemCodes: string[]
  options: {
    brands: Array<{ id: number; name: string }>
    supplierBrands: string[]
    categories: Array<{ id: number; name: string }>
  }
}

export interface PartTechnicalReferenceInput {
  eans: string[]
  oemReferences: Array<{ brand: string; code: string }>
  crossReferences: Array<{ brand: string; articleNumber: string }>
  properties: Array<{ key: string; value: string }>
}

export interface SupplierPartSearchAdvancedInput {
  providerCode: string
  supplierProductId?: number
  q?: string
  oemCodes?: string[]
  refCodes?: string[]
  limit?: number
}

export interface SupplierOffer {
  providerId: number
  providerCode: string
  providerName: string
  supplierProductId: number
  supplierSku: string
  supplierName: string | null
  supplierPrice: number | null
  supplierStockQty: number
  currency: string
  campaignRate: number
  standardDiscountRate: number
  marginRate: number
  computedNetCost: number | null
  computedSellingPrice: number | null
  regionalStock: RegionalStock | null
  lastSyncedAt: string | null
  isActive: boolean
}

export interface ProductSupplierSummary {
  sourceProvider: {
    id: number
    code: string
    name: string
  } | null
  sourceSupplierProductId: number | null
  currency: string
  policyAppliedAt: string | null
  selectionReason: string
  selectedRegionalStock: RegionalStock | null
  offers: SupplierOffer[]
}

export interface MappingCandidate {
  partId: string
  articleLinkId: string
  partNo?: string | null
  name: string
  brand: string | null
  confidence: number
  reasons: string[]
}

export interface SupplierReferenceCloneDocumentInput {
  id?: number | null
  name: string
  fileTypeName: string
  docId: string
  docTypeId: number
  docTypeName: string
  url: string | null
}

export interface SupplierReferenceCloneImageInput {
  image: string
  thumb: string | null
}

export interface SupplierReferenceCloneVehicleTypeInput {
  id: number
  label: string
}

export interface SupplierReferenceCloneOfferInput {
  supplierPrice: number | null
  supplierStockQty: number
  currency: string
  isActive: boolean
}

export interface SupplierReferenceCloneEditableFields {
  name: string
  articleLinkId: string
  brandId: number | null
  categoryId: number | null
  inBasket: boolean
  sellingPriceOverride: number | null
  isVisible: boolean
  lockPrice: boolean
  lockVisibility: boolean
  note: string
  supplierPrice: number | null
  supplierStockQty: number
  reservedStockQty: number
  minStockLevel: number
  currency: string
  syncStatus: string
  eans: string[]
  oemReferences: Array<{ brand: string; code: string }>
  crossReferences: Array<{ brand: string; articleNumber: string }>
  properties: Array<{ key: string; value: string }>
  infos: string[]
  images: SupplierReferenceCloneImageInput[]
  documents: SupplierReferenceCloneDocumentInput[]
  vehicleTypes: SupplierReferenceCloneVehicleTypeInput[]
  supplierOffer: SupplierReferenceCloneOfferInput
}

export interface PartReferenceLink {
  id: string
  sourcePartId: string
  derivedPartId: string
  providerId: number
  supplierProductId: number
  relationType: string
  copyMode: string
  createdBy: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface SupplierReferenceCloneDraft {
  mode: 'create' | 'edit'
  partId: string | null
  sourcePart: {
    id: string
    articleLinkId: string
    name: string
    brandId: number
    brandName: string | null
    categoryId: number
    categoryName: string | null
  }
  supplierProduct: {
    id: number
    sku: string
    name: string | null
    brand: string | null
    price: number | null
    stockQty: number
    currency: string
  }
  provider: {
    id: number
    code: string
    name: string
  }
  resolvedBrand: {
    id: number | null
    name: string | null
    status: 'APPROVED' | 'FALLBACK_SOURCE' | 'UNRESOLVED'
  }
  resolvedCategory: {
    id: number | null
    name: string | null
  }
  referenceLink: PartReferenceLink | null
  options: {
    brands: Array<{ id: number; name: string }>
    categories: Array<{ id: number; name: string }>
  }
  warnings: string[]
  editable: SupplierReferenceCloneEditableFields
}

export interface SupplierReferenceCloneInput {
  providerCode: string
  supplierProductId: number
  sourcePartId: string
  partId?: string | null
  editable: SupplierReferenceCloneEditableFields
}
