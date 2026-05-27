import { DEFAULT_DPMATCH_WORKBENCH_FILTERS } from '@/lib/admin/dpmatch-workbench-url'
import type {
  AdminDpmatchWorkbenchFilters
} from '@/lib/admin/dpmatch-workbench-url'
import type {
  AdminProductKpis,
  AdminProductListItem,
  AdminProductSearchMeta
} from '@/lib/types/admin-products'
import type { AdminDpmatchListResult, AdminDpmatchRow } from './dpmatch-catalog'

export type AdminDpmatchWorkbenchResult = {
  filters: AdminDpmatchWorkbenchFilters
  products: AdminProductListItem[]
  pagination: { page: number; limit: number; total: number; pages: number }
  kpis: AdminProductKpis
  dpmatchSummary: AdminDpmatchListResult['summary']
  dpmatchRows: AdminDpmatchRow[]
  searchMeta: AdminProductSearchMeta
}

function parsePrice(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function mapSyncStatus(
  mappingStatus: string
): AdminProductListItem['syncStatus'] {
  if (mappingStatus === 'APPROVED') return 'OK'
  if (mappingStatus === 'PENDING') return 'PENDING'
  return 'ERROR'
}

function getProductName(row: AdminDpmatchRow): string {
  if (row.matchSide === 'pt_only') {
    return row.parcatedarik.title || row.parcatedarik.model || '—'
  }
  return (
    row.dinamik.stockName ||
    row.dinamik.stockCode ||
    row.parcatedarik.title ||
    '—'
  )
}

export function mapDpmatchRowToProductListItem(
  row: AdminDpmatchRow
): AdminProductListItem {
  const stockQty = row.dinamik.stockQty ?? 0
  const sellingPrice =
    parsePrice(row.dinamik.price) || parsePrice(row.parcatedarik.price)

  return {
    id: String(row.id),
    articleLinkId:
      row.normalized ||
      row.dproductsId ||
      (row.productId != null ? String(row.productId) : String(row.id)),
    name: getProductName(row),
    brand: row.dinamik.brand || row.parcatedarik.manufacturerName || null,
    category:
      row.parcatedarik.model ||
      row.dinamik.partNo ||
      row.parcatedarik.refNo ||
      null,
    supplierPrice: parsePrice(row.dinamik.price) || null,
    sellingPrice,
    supplierStockQty: stockQty,
    reservedStockQty: 0,
    minStockLevel: 3,
    availableStockQty: stockQty,
    stockStatus:
      stockQty <= 0
        ? 'OUT_OF_STOCK'
        : stockQty <= 3
          ? 'LOW_STOCK'
          : 'IN_STOCK',
    syncStatus: mapSyncStatus(row.mappingStatus),
    lastSyncedAt: null,
    isVisible: row.mappingStatus === 'APPROVED',
    lockPrice: false,
    lockVisibility: false,
    note: row.matchMethod,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function buildKpis(summary: AdminDpmatchListResult['summary']): AdminProductKpis {
  return {
    totalProducts: summary.total,
    lowStockCount: summary.lowStock,
    zeroPriceCount: summary.zeroPrice,
    syncErrorCount: summary.rejected + summary.ignored + summary.pending
  }
}

export function buildDpmatchRowsMap(
  rows: AdminDpmatchRow[]
): Record<string, AdminDpmatchRow> {
  return Object.fromEntries(rows.map((row) => [String(row.id), row]))
}

export function createEmptyDpmatchWorkbenchResult(
  filters: AdminDpmatchWorkbenchFilters
): AdminDpmatchWorkbenchResult {
  return {
    filters,
    products: [],
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: 0,
      pages: 1
    },
    kpis: {
      totalProducts: 0,
      lowStockCount: 0,
      zeroPriceCount: 0,
      syncErrorCount: 0
    },
    dpmatchSummary: {
      total: 0,
      matched: 0,
      unmatched: 0,
      dinamikOnly: 0,
      ptOnly: 0,
      approved: 0,
      pending: 0,
      rejected: 0,
      ignored: 0,
      lowStock: 0,
      zeroPrice: 0
    },
    dpmatchRows: [],
    searchMeta: {
      normalizedQuery: filters.q,
      primaryMatchPartId: null,
      primaryMatchStrength: null
    }
  }
}

export function mapDpmatchListToProductsResult(
  input: AdminDpmatchListResult
): AdminDpmatchWorkbenchResult {
  const products = input.rows.map(mapDpmatchRowToProductListItem)

  return {
    filters: {
      ...DEFAULT_DPMATCH_WORKBENCH_FILTERS,
      q: input.filters.q,
      dinamikBrand: input.filters.dinamikBrand,
      manufacturerId: input.filters.manufacturerId,
      matchSide: input.filters.matchSide,
      mappingStatus: input.filters.mappingStatus,
      stockStatus: input.filters.stockStatus,
      page: input.filters.page,
      limit: input.filters.limit
    },
    products,
    pagination: input.pagination,
    kpis: buildKpis(input.summary),
    dpmatchSummary: input.summary,
    dpmatchRows: input.rows,
    searchMeta: {
      normalizedQuery: input.filters.q,
      primaryMatchPartId: null,
      primaryMatchStrength: null
    }
  }
}

export function buildMatchingHref(row: AdminDpmatchRow): string {
  const query =
    row.dinamik.stockCode ||
    row.parcatedarik.model ||
    row.normalized ||
    row.parcatedarik.title ||
    ''
  return query
    ? `/admin/eslestirme?tab=products&q=${encodeURIComponent(query)}`
    : '/admin/eslestirme?tab=products'
}
