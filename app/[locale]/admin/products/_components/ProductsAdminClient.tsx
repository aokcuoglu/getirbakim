'use client'

import dynamic from 'next/dynamic'
import {
  keepPreviousData,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  DollarSign,
  Loader2,
  Package,
  TrendingDown
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/Pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import { AdminSortableHead } from '@/components/admin/data-table/admin-sortable-head'
import { AdminTableHead, adminTableHeaderRowClassName } from '@/components/admin/data-table/admin-table-head'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent
} from '@/components/ui/tooltip'
import { updateAdminProductInline } from '@/lib/actions/admin-products'
import {
  buildAdminProductsSearchParams,
  DEFAULT_ADMIN_PRODUCT_FILTERS,
  parseAdminProductsUrlState
} from '@/lib/admin-products-workbench'
import {
  adminProductDetailQueryKey,
  adminProductsWorkbenchQueryKey,
  fetchAdminProductDetail,
  fetchAdminProductOptions,
  fetchAdminProductsWorkbench
} from '@/lib/api/admin-products-workbench'
import type {
  AdminProductDetail,
  AdminProductFilters,
  AdminProductListItem,
  AdminProductOptions,
  AdminProductsWorkbenchResult,
  AdminSortBy,
  AdminSortOrder
} from '@/lib/types/admin-products'

const ProductDetailDrawer = dynamic(
  () =>
    import('./ProductDetailDrawer').then((module) => ({
      default: module.ProductDetailDrawer
    })),
  { ssr: false }
)

interface ProductsAdminClientProps {
  data: AdminProductsWorkbenchResult
  initialProductId: string | null
}

interface RowDraft {
  sellingPrice: string
  isVisible: boolean
}

interface FilterOption {
  value: string
  label: string
  groupLabel?: string
}

function mapCategoryToFilterOption(category: {
  id: number
  name: string
}): FilterOption {
  const slashIndex = category.name.indexOf('/')
  if (slashIndex <= 0) {
    return {
      value: String(category.id),
      label: category.name
    }
  }

  const parent = category.name.slice(0, slashIndex).trim()
  const subcategory = category.name.slice(slashIndex + 1).trim()
  return {
    value: String(category.id),
    label: subcategory || category.name,
    groupLabel: parent
  }
}

function areFiltersEqual(
  a: Required<AdminProductFilters>,
  b: Required<AdminProductFilters>
) {
  return (
    a.q === b.q &&
    a.page === b.page &&
    a.limit === b.limit &&
    a.brandId === b.brandId &&
    a.categoryId === b.categoryId &&
    a.providerId === b.providerId &&
    a.stockStatus === b.stockStatus &&
    a.visibility === b.visibility &&
    a.syncStatus === b.syncStatus &&
    a.sortBy === b.sortBy &&
    a.sortOrder === b.sortOrder
  )
}

function toRowPatch(detail: AdminProductDetail): Partial<AdminProductListItem> {
  return {
    articleLinkId: detail.articleLinkId,
    name: detail.name,
    brand: detail.brand,
    category: detail.category,
    supplierPrice: detail.supplierPrice,
    sellingPrice: detail.sellingPrice,
    supplierStockQty: detail.supplierStockQty,
    reservedStockQty: detail.reservedStockQty,
    minStockLevel: detail.minStockLevel,
    availableStockQty: detail.availableStockQty,
    stockStatus: detail.stockStatus,
    syncStatus: detail.syncStatus,
    lastSyncedAt: detail.lastSyncedAt,
    isVisible: detail.isVisible,
    lockPrice: detail.lockPrice,
    lockVisibility: detail.lockVisibility,
    note: detail.note,
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  }
}

function patchWorkbenchRow(
  current: AdminProductsWorkbenchResult | undefined,
  partId: string,
  patch: Partial<AdminProductListItem>
) {
  if (!current) return current

  return {
    ...current,
    products: current.products.map((product) =>
      product.id === partId ? { ...product, ...patch } : product
    )
  }
}

export function ProductsAdminClient({
  data,
  initialProductId
}: ProductsAdminClientProps) {
  const pathname = usePathname()
  const queryClient = useQueryClient()

  const [filters, setFilters] = useState<Required<AdminProductFilters>>(
    data.filters
  )
  const [searchValue, setSearchValue] = useState(data.filters.q)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    initialProductId
  )
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [rowDrafts, setRowDrafts] = useState<Record<string, RowDraft>>({})
  const [isSaving, startSavingTransition] = useTransition()
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)
  const selectedProductIdRef = useRef(selectedProductId)
  const lastAutoOpenedQueryRef = useRef('')
  const initialFiltersRef = useRef(data.filters)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  useEffect(() => {
    selectedProductIdRef.current = selectedProductId
  }, [selectedProductId])

  const syncUrlState = (
    nextFilters: Required<AdminProductFilters>,
    nextProductId: string | null,
    mode: 'replace' | 'push'
  ) => {
    if (typeof window === 'undefined') return
    const params = buildAdminProductsSearchParams({
      filters: nextFilters,
      productId: nextProductId
    })
    const query = params.toString()
    const url = query ? `${pathname}?${query}` : pathname
    const write =
      mode === 'push' ? window.history.pushState : window.history.replaceState
    write.call(window.history, null, '', url)
  }

  const applyUrlState = (
    nextFilters: Required<AdminProductFilters>,
    nextProductId: string | null,
    mode: 'replace' | 'push'
  ) => {
    setFilters(nextFilters)
    setSelectedProductId(nextProductId)
    syncUrlState(nextFilters, nextProductId, mode)
  }

  useEffect(() => {
    const handlePopState = () => {
      const nextState = parseAdminProductsUrlState(
        new URLSearchParams(window.location.search)
      )
      setFilters((current) =>
        areFiltersEqual(current, nextState.filters)
          ? current
          : nextState.filters
      )
      setSearchValue(nextState.filters.q)
      setSelectedProductId(nextState.productId)
      setIsSearchPending(false)
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const workbenchQuery = useQuery({
    queryKey: adminProductsWorkbenchQueryKey(filters),
    queryFn: () => fetchAdminProductsWorkbench(filters),
    initialData: () =>
      areFiltersEqual(filters, initialFiltersRef.current) ? data : undefined,
    placeholderData: keepPreviousData
  })

  const optionsQuery = useQuery({
    queryKey: ['admin-products-options'],
    queryFn: fetchAdminProductOptions,
    enabled: filtersOpen,
    staleTime: 10 * 60 * 1000
  })

  const workbenchData = workbenchQuery.data ?? data
  const isListUpdating = workbenchQuery.isFetching
  const isInputLoading = isSearchPending || isListUpdating
  const options: AdminProductOptions = optionsQuery.data ?? {
    brands: [],
    categories: []
  }

  useEffect(() => {
    const nextDrafts: Record<string, RowDraft> = {}
    for (const row of workbenchData.products) {
      nextDrafts[row.id] = {
        sellingPrice: row.sellingPrice.toString(),
        isVisible: row.isVisible
      }
    }
    setRowDrafts(nextDrafts)
  }, [workbenchData.products])

  useEffect(() => {
    setSearchValue(filters.q)
  }, [filters.q])

  useEffect(() => {
    const { normalizedQuery, primaryMatchPartId } = workbenchData.searchMeta
    if (!normalizedQuery) {
      lastAutoOpenedQueryRef.current = ''
      return
    }
    if (!primaryMatchPartId) return
    if (lastAutoOpenedQueryRef.current === normalizedQuery) return

    lastAutoOpenedQueryRef.current = normalizedQuery
    setSelectedProductId(primaryMatchPartId)
    syncUrlState(filtersRef.current, primaryMatchPartId, 'replace')
  }, [workbenchData.searchMeta])

  const onSearch = useDebouncedCallback((term: string) => {
    const trimmed = term.trim()
    const nextFilters = {
      ...filtersRef.current,
      q: trimmed,
      page: 1
    }
    setIsSearchPending(false)
    applyUrlState(nextFilters, selectedProductIdRef.current, 'replace')
  }, 250)

  const setFilterParam = (
    name: keyof Required<AdminProductFilters>,
    value?: string | null
  ) => {
    const nextFilters = { ...filtersRef.current, page: 1 }

    if (name === 'q') {
      nextFilters.q = value?.trim() || ''
    } else if (name === 'brandId') {
      nextFilters.brandId = value && value !== 'all' ? Number(value) : null
    } else if (name === 'categoryId') {
      nextFilters.categoryId = value && value !== 'all' ? Number(value) : null
    } else if (name === 'stockStatus') {
      nextFilters.stockStatus =
        (value as Required<AdminProductFilters>['stockStatus']) || 'all'
    } else if (name === 'visibility') {
      nextFilters.visibility =
        (value as Required<AdminProductFilters>['visibility']) || 'all'
    } else if (name === 'syncStatus') {
      nextFilters.syncStatus =
        (value as Required<AdminProductFilters>['syncStatus']) || 'all'
    } else if (name === 'sortBy') {
      nextFilters.sortBy =
        (value as Required<AdminProductFilters>['sortBy']) || 'created_at'
    } else if (name === 'sortOrder') {
      nextFilters.sortOrder =
        (value as Required<AdminProductFilters>['sortOrder']) || 'desc'
    } else if (name === 'providerId') {
      nextFilters.providerId = value ? Number(value) : null
    }

    applyUrlState(nextFilters, selectedProductIdRef.current, 'replace')
  }

  const handleSort = (sortBy: AdminSortBy, sortOrder: AdminSortOrder) => {
    applyUrlState(
      { ...filtersRef.current, page: 1, sortBy, sortOrder },
      selectedProductIdRef.current,
      'replace'
    )
  }

  const resetFilters = () => {
    lastAutoOpenedQueryRef.current = ''
    setSearchValue('')
    setIsSearchPending(false)
    applyUrlState(
      DEFAULT_ADMIN_PRODUCT_FILTERS,
      selectedProductIdRef.current,
      'replace'
    )
  }

  const openDetail = (partId: string, mode: 'replace' | 'push' = 'push') => {
    setSelectedProductId(partId)
    syncUrlState(filtersRef.current, partId, mode)
  }

  const closeDetail = (mode: 'replace' | 'push' = 'push') => {
    setSelectedProductId(null)
    syncUrlState(filtersRef.current, null, mode)
  }

  const prefetchDetail = (partId: string) => {
    void queryClient.prefetchQuery({
      queryKey: adminProductDetailQueryKey(partId),
      queryFn: () => fetchAdminProductDetail(partId),
      staleTime: 60 * 1000
    })
  }

  const updateDraft = (id: string, patch: Partial<RowDraft>) => {
    setRowDrafts((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        ...patch
      }
    }))
  }

  const saveInline = (id: string) => {
    const draft = rowDrafts[id]
    if (!draft) return

    const parsedPrice = Number(draft.sellingPrice)
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      toast.error('Geçerli fiyat girin.')
      return
    }

    startSavingTransition(async () => {
      const result = await updateAdminProductInline({
        partId: id,
        sellingPriceOverride: parsedPrice,
        isVisible: draft.isVisible
      })

      if (!result.success) {
        toast.error(result.message)
        return
      }

      queryClient.setQueryData<AdminProductsWorkbenchResult>(
        adminProductsWorkbenchQueryKey(filtersRef.current),
        (current) =>
          patchWorkbenchRow(current, id, {
            sellingPrice: parsedPrice,
            isVisible: draft.isVisible
          })
      )
      void queryClient.invalidateQueries({
        queryKey: adminProductDetailQueryKey(id)
      })
      void queryClient.invalidateQueries({
        queryKey: ['admin-products-workbench'],
        refetchType: 'active'
      })
      toast.success('Satır güncellendi.')
    })
  }

  const handleDetailSaved = (detail: AdminProductDetail) => {
    const patch = toRowPatch(detail)
    queryClient.setQueryData<AdminProductsWorkbenchResult>(
      adminProductsWorkbenchQueryKey(filtersRef.current),
      (current) => patchWorkbenchRow(current, detail.id, patch)
    )
    queryClient.setQueryData(adminProductDetailQueryKey(detail.id), detail)
    setRowDrafts((prev) => ({
      ...prev,
      [detail.id]: {
        sellingPrice: detail.sellingPrice.toString(),
        isVisible: detail.isVisible
      }
    }))
    void queryClient.invalidateQueries({
      queryKey: ['admin-products-workbench'],
      refetchType: 'active'
    })
  }

  const reloadCurrentPage = () => {
    void workbenchQuery.refetch()
    if (selectedProductIdRef.current) {
      void queryClient.invalidateQueries({
        queryKey: adminProductDetailQueryKey(selectedProductIdRef.current)
      })
    }
  }

  const totalPages = workbenchData.pagination.pages

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label="Toplam Ürün"
          value={workbenchData.kpis.totalProducts}
          tone="default"
          icon={<Package size={16} />}
        />
        <AdminKpiCard
          label="Düşük Stok"
          value={workbenchData.kpis.lowStockCount}
          tone="warning"
          icon={<TrendingDown size={16} />}
        />
        <AdminKpiCard
          label="Sıfır Fiyat"
          value={workbenchData.kpis.zeroPriceCount}
          tone="danger"
          icon={<DollarSign size={16} />}
        />
        <AdminKpiCard
          label="Senkron Hatası"
          value={workbenchData.kpis.syncErrorCount}
          tone="info"
          icon={<AlertTriangle size={16} />}
        />
      </AdminKpiGrid>

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            setIsSearchPending(true)
            onSearch(nextValue)
          }}
          searchPlaceholder="Ürün adı veya part no ara..."
          isSearchLoading={isInputLoading}
          onRefresh={reloadCurrentPage}
          isRefreshing={isListUpdating}
          onAdvancedFilter={() => setFiltersOpen(true)}
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={filters.stockStatus === 'low_stock'}
            onClick={() => setFilterParam('stockStatus', 'low_stock')}
            label="Düşük Stok"
          />
          <AdminFilterChip
            active={filters.stockStatus === 'zero_price'}
            onClick={() => setFilterParam('stockStatus', 'zero_price')}
            label="Sıfır Fiyat"
          />
          <AdminFilterChip
            active={filters.syncStatus === 'ERROR'}
            onClick={() => setFilterParam('syncStatus', 'ERROR')}
            label="Senkron Hatası"
          />
          <AdminFilterChip
            active={filters.visibility === 'hidden'}
            onClick={() => setFilterParam('visibility', 'hidden')}
            label="Gizli Ürün"
          />
          <AdminFilterChip
            active={filters.providerId === 1}
            onClick={() =>
              setFilterParam(
                'providerId',
                filters.providerId === 1 ? null : '1'
              )
            }
            label="Dinamik"
          />
        </AdminFilterBar>
      </div>

      <ResponsiveDataView
        mobile={
          workbenchData.products.length === 0 ? (
            <div className="rounded-lg border border-border bg-background px-4 py-14 text-center text-sm text-muted-foreground">
              Kayıt bulunamadı.
            </div>
          ) : (
            <div className="space-y-3">
              {isListUpdating ? (
                <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  <Loader2 size={12} className="animate-spin" />
                  Veriler güncelleniyor
                </div>
              ) : null}

              {workbenchData.products.map((row) => {
                const draft = rowDrafts[row.id]
                const isSelected = selectedProductId === row.id
                return (
                  <MobileDataCard
                    key={row.id}
                    className={isSelected ? 'ring-1 ring-border' : undefined}
                  >
                    <button
                      type="button"
                      onClick={() => openDetail(row.id)}
                      className="flex w-full items-start gap-3 text-left"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground shrink-0">
                        <Package size={16} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {row.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          #{row.id} | Article Link: {row.articleLinkId}
                        </p>
                        {row.variantCount && row.variantCount > 1 ? (
                          <p className="text-xs text-muted-foreground">
                            {row.variantCount} varyant
                          </p>
                        ) : null}
                      </div>
                    </button>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                      <p className="truncate">Marka: {row.brand || 'Markasız'}</p>
                      <p className="truncate">
                        Kategori: {row.category || 'Kategorisiz'}
                      </p>
                      <p className="col-span-2">
                        Stok: {row.availableStockQty} <StockBadge status={row.stockStatus} />
                      </p>
                    </div>

                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div>
                        <input
                          value={draft?.sellingPrice ?? row.sellingPrice.toString()}
                          onChange={(event) =>
                            updateDraft(row.id, {
                              sellingPrice: event.target.value
                            })
                          }
                          className="w-full rounded-md border border-border px-2 py-2 text-sm"
                          inputMode="decimal"
                        />
                        <p className="mt-1 text-xs text-muted-foreground">TRY</p>
                      </div>
                      <div className="space-y-1">
                        <SyncBadge status={row.syncStatus} />
                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={draft?.isVisible ?? row.isVisible}
                            onChange={(event) =>
                              updateDraft(row.id, {
                                isVisible: event.target.checked
                              })
                            }
                          />
                          Görünür
                        </label>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end">
                      <AdminRowActions
                        actions={[
                          {
                            label: 'Ürün Detayları',
                            onClick: () => openDetail(row.id)
                          },
                          {
                            label: isSaving ? 'Kaydediliyor…' : 'Kaydet',
                            onClick: () => saveInline(row.id),
                            disabled: isSaving || isListUpdating
                          }
                        ]}
                      />
                    </div>
                  </MobileDataCard>
                )
              })}
            </div>
          )
        }
        desktop={
          <AdminTableShell isLoading={isListUpdating}>
            <Table>
              <TableHeader>
                <TableRow className={adminTableHeaderRowClassName()}>
                  <TableHead className="w-[280px]">
                    <AdminSortableHead
                      label="Ürün"
                      sortKey="name"
                      activeSortBy={filters.sortBy}
                      activeSortOrder={filters.sortOrder}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Marka</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Kategori</AdminTableHead>
                  </TableHead>
                  <TableHead>
                    <AdminSortableHead
                      label="Fiyat"
                      sortKey="selling_price"
                      activeSortBy={filters.sortBy}
                      activeSortOrder={filters.sortOrder}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead className="whitespace-nowrap">
                    <AdminSortableHead
                      label="Stok"
                      sortKey="supplier_stock_qty"
                      activeSortBy={filters.sortBy}
                      activeSortOrder={filters.sortOrder}
                      onSort={handleSort}
                    />
                  </TableHead>
                  <TableHead>
                    <AdminTableHead>Durum</AdminTableHead>
                  </TableHead>
                  <TableHead className="text-right">
                    <AdminTableHead className="justify-end">Aksiyon</AdminTableHead>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workbenchData.products.map((row) => {
                  const draft = rowDrafts[row.id]
                  const isSelected = selectedProductId === row.id
                  const isDirty =
                    draft != null &&
                    (draft.sellingPrice !== row.sellingPrice.toString() ||
                      draft.isVisible !== row.isVisible)
                  return (
                    <TableRow
                      key={row.id}
                      className={`group transition-colors duration-150 ${
                        isSelected
                          ? 'bg-muted'
                          : ''
                      }`}
                      onMouseEnter={() => prefetchDetail(row.id)}
                      onFocus={() => prefetchDetail(row.id)}
                    >
                      <TableCell className="max-w-[280px]">
                        <button
                          type="button"
                          onClick={() => openDetail(row.id)}
                          className="flex items-center gap-3 text-left group/product w-full"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-muted to-muted text-muted-foreground ring-1 ring-border/60 transition-all group-hover/product:text-muted-foreground">
                            <Package size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-semibold text-foreground text-sm leading-snug truncate group-hover/product:text-foreground transition-colors">
                              {row.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">
                              #{row.id} · ArtLink {row.articleLinkId}
                              {row.variantCount && row.variantCount > 1
                                ? ` · ${row.variantCount} varyant`
                                : null}
                            </p>
                          </div>
                        </button>
                      </TableCell>

                      <TableCell>
                        <span className="text-sm font-medium text-foreground">
                          {row.brand || <span className="text-muted-foreground italic">—</span>}
                        </span>
                      </TableCell>

                      <TableCell>
                        <span className="text-sm text-muted-foreground max-w-[140px] truncate block">
                          {row.category || <span className="text-muted-foreground italic">—</span>}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <input
                            value={draft?.sellingPrice ?? row.sellingPrice.toString()}
                            onChange={(event) =>
                              updateDraft(row.id, {
                                sellingPrice: event.target.value
                              })
                            }
                            className="w-24 rounded-md border border-border bg-muted/50 px-2.5 py-1.5 text-sm font-medium text-foreground transition-all focus-visible:border-ring focus:bg-background focus:outline-none focus:ring-2 focus-visible:ring-ring/50"
                            inputMode="decimal"
                          />
                          <span className="text-[11px] font-medium text-muted-foreground">₺</span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-2">
                          <StockBadge status={row.stockStatus} />
                          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                            {row.availableStockQty} adet
                          </span>
                        </div>
                      </TableCell>

                      <TableCell>
                        <div className="flex items-center gap-3">
                          <SyncBadge status={row.syncStatus} />
                          <div className="flex items-center gap-1.5">
                            <Switch
                              checked={draft?.isVisible ?? row.isVisible}
                              onCheckedChange={(checked) =>
                                updateDraft(row.id, {
                                  isVisible: checked
                                })
                              }
                              className="data-[state=checked]:bg-success/100"
                            />
                            <span className="text-[11px] font-medium text-muted-foreground">
                              {(draft?.isVisible ?? row.isVisible) ? 'Görünür' : 'Gizli'}
                            </span>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell className="text-right">
                        <div className="flex items-center justify-end">
                          <AdminRowActions
                            actions={[
                              {
                                label: 'Ürün Detayları',
                                onClick: () => openDetail(row.id)
                              },
                              {
                                label: isSaving ? 'Kaydediliyor…' : 'Kaydet',
                                onClick: () => saveInline(row.id),
                                disabled: isSaving || isListUpdating || !isDirty
                              }
                            ]}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}

                {workbenchData.products.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-48 text-center"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Package size={32} className="text-muted-foreground/50" />
                        <p className="text-sm font-medium text-muted-foreground">Kayıt bulunamadı.</p>
                        <p className="text-xs text-muted-foreground">Farklı filtreler deneyebilirsiniz.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </AdminTableShell>
        }
      />

      <Pagination
        currentPage={workbenchData.pagination.page}
        totalPages={totalPages}
        totalItems={workbenchData.pagination.total}
        itemsPerPage={workbenchData.pagination.limit}
        onPageChange={(page) => {
          applyUrlState(
            {
              ...filtersRef.current,
              page
            },
            selectedProductIdRef.current,
            'push'
          )
        }}
        compact
      />

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-[420px]"
        >
          <SheetHeader>
            <SheetTitle>Gelişmiş Filtreler</SheetTitle>
            <SheetDescription>
              Varsayılan ekran sade tutulur. İleri filtreleri buradan yönetin.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-3">
            <FilterSelect
              label="Marka"
              value={filters.brandId != null ? String(filters.brandId) : 'all'}
              options={[
                { value: 'all', label: 'Tümü' },
                ...options.brands.map((brand) => ({
                  value: String(brand.id),
                  label: brand.name
                }))
              ]}
              disabled={optionsQuery.isLoading}
              placeholder={
                optionsQuery.isLoading ? 'Markalar yükleniyor...' : 'Seçiniz'
              }
              onChange={(value) => setFilterParam('brandId', value)}
            />
            <FilterSelect
              label="Kategori"
              value={
                filters.categoryId != null ? String(filters.categoryId) : 'all'
              }
              options={[
                { value: 'all', label: 'Tümü' },
                ...options.categories.map(mapCategoryToFilterOption)
              ]}
              disabled={optionsQuery.isLoading}
              placeholder={
                optionsQuery.isLoading ? 'Kategoriler yükleniyor...' : 'Seçiniz'
              }
              onChange={(value) => setFilterParam('categoryId', value)}
            />
            <FilterSelect
              label="Stok"
              value={filters.stockStatus}
              options={[
                { value: 'all', label: 'Tümü' },
                { value: 'in_stock', label: 'Stokta' },
                { value: 'low_stock', label: 'Düşük Stok' },
                { value: 'out_of_stock', label: 'Stok Yok' },
                { value: 'zero_price', label: 'Sıfır Fiyat' }
              ]}
              onChange={(value) => setFilterParam('stockStatus', value)}
            />
            <FilterSelect
              label="Senkron"
              value={filters.syncStatus}
              options={[
                { value: 'all', label: 'Tümü' },
                { value: 'OK', label: 'OK' },
                { value: 'PENDING', label: 'PENDING' },
                { value: 'ERROR', label: 'ERROR' }
              ]}
              onChange={(value) => setFilterParam('syncStatus', value)}
            />
            <FilterSelect
              label="Görünürlük"
              value={filters.visibility}
              options={[
                { value: 'all', label: 'Tümü' },
                { value: 'visible', label: 'Görünür' },
                { value: 'hidden', label: 'Gizli' }
              ]}
              onChange={(value) => setFilterParam('visibility', value)}
            />
            <FilterSelect
              label="Sırala"
              value={filters.sortBy}
              options={[
                { value: 'created_at', label: 'Oluşturma' },
                { value: 'name', label: 'Ürün Adı' },
                { value: 'selling_price', label: 'Satış Fiyatı' },
                { value: 'supplier_stock_qty', label: 'Stok Adedi' },
                { value: 'last_synced_at', label: 'Son Senkron' }
              ]}
              onChange={(value) => setFilterParam('sortBy', value)}
            />
            <FilterSelect
              label="Sıra Yönü"
              value={filters.sortOrder}
              options={[
                { value: 'desc', label: 'Azalan' },
                { value: 'asc', label: 'Artan' }
              ]}
              onChange={(value) => setFilterParam('sortOrder', value)}
            />
          </div>

          <SheetFooter>
            <Button
              type="button"
              variant="outline"
              className="flex-1 sm:flex-none"
              onClick={() => {
                resetFilters()
                setFiltersOpen(false)
              }}
            >
              Filtreleri Sıfırla
            </Button>
            <Button
              type="button"
              className="flex-1 sm:flex-none"
              onClick={() => setFiltersOpen(false)}
            >
              Kapat
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {selectedProductId ? (
        <ProductDetailDrawer
          partId={selectedProductId}
          open={Boolean(selectedProductId)}
          onOpenChange={(open) => {
            if (!open) closeDetail()
          }}
          onSaved={handleDetailSaved}
        />
      ) : null}
    </div>
  )
}

function FilterSelect({
  label,
  value,
  options,
  disabled = false,
  placeholder = 'Seçiniz',
  onChange
}: {
  label: string
  value: string
  options: FilterOption[]
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value) ?? null,
    [options, value]
  )

  const filteredOptions = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return options
    return options.filter((option) => {
      const haystack =
        `${option.groupLabel || ''} ${option.label}`.toLowerCase()
      return haystack.includes(term)
    })
  }, [options, query])

  const groupedOptions = useMemo(() => {
    const plain: FilterOption[] = []
    const groups = new Map<string, FilterOption[]>()

    for (const option of filteredOptions) {
      if (!option.groupLabel) {
        plain.push(option)
        continue
      }
      const current = groups.get(option.groupLabel) || []
      current.push(option)
      groups.set(option.groupLabel, current)
    }

    return {
      plain,
      groups: Array.from(groups.entries())
    }
  }, [filteredOptions])

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const frame = requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus({ preventScroll: true })
      const cursor = input.value.length
      input.setSelectionRange(cursor, cursor)
    })

    return () => cancelAnimationFrame(frame)
  }, [open, query, filteredOptions.length])

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div ref={containerRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((prev) => !prev)}
          className="flex h-9 w-full items-center justify-between rounded-md border border-border bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={selectedOption ? 'text-foreground' : 'text-muted-foreground'}>
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>

        {open ? (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-md">
            <div className="border-b border-border p-2">
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`${label} ara...`}
                className="h-8 text-xs"
              />
            </div>

            <div className="max-h-80 overflow-y-auto p-1">
              {filteredOptions.length > 0 ? (
                <>
                  {groupedOptions.plain.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelect(option.value)}
                      className={`block w-full rounded-sm px-2 py-1.5 text-left text-xs ${
                        value === option.value
                          ? 'bg-muted text-foreground'
                          : 'text-foreground hover:bg-muted'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}

                  {groupedOptions.groups.map(
                    ([groupLabel, groupOptions], index) => (
                      <div key={groupLabel}>
                        {(groupedOptions.plain.length > 0 || index > 0) && (
                          <div className="my-1 h-px bg-muted" />
                        )}
                        <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {groupLabel}
                        </p>
                        {groupOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => handleSelect(option.value)}
                            className={`block w-full rounded-sm px-2 py-1.5 text-left text-xs ${
                              value === option.value
                                ? 'bg-muted text-foreground'
                                : 'text-foreground hover:bg-muted'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    )
                  )}
                </>
              ) : (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Sonuç bulunamadı.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StockBadge({
  status
}: {
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK'
}) {
  if (status === 'IN_STOCK') {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] bg-success/10 text-success border-success/20">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Stokta
      </Badge>
    )
  }

  if (status === 'LOW_STOCK') {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20">
        <span className="h-1.5 w-1.5 rounded-full bg-warning" />
        Düşük Stok
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="gap-1.5 text-[10px] bg-destructive/10 text-destructive border-destructive/20">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      Stok Yok
    </Badge>
  )
}

function SyncBadge({ status }: { status: 'OK' | 'PENDING' | 'ERROR' }) {
  if (status === 'OK') {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] bg-success/10 text-success border-success/20">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        OK
      </Badge>
    )
  }

  if (status === 'PENDING') {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
        Bekliyor
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="gap-1.5 text-[10px] bg-destructive/10 text-destructive border-destructive/20">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      Hata
    </Badge>
  )
}
