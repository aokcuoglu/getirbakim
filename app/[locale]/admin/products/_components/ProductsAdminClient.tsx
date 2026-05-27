'use client'

import {
  keepPreviousData,
  useQuery
} from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  Package,
  TrendingDown
} from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Pagination } from '@/components/ui/Pagination'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { MobileDataCard, ResponsiveDataView } from '@/components/admin/responsive-data-view'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminRowActions } from '@/components/admin/data-table/admin-row-actions'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { DpmatchDetailModal } from './DpmatchDetailModal'
import { AdminTablePageSkeleton } from '@/components/admin/admin-table-page-skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import type { AdminDpmatchFilterOptions } from '@/lib/admin/dpmatch-filter-options'
import {
  buildDpmatchWorkbenchSearchParams,
  DEFAULT_DPMATCH_WORKBENCH_FILTERS,
  parseDpmatchWorkbenchUrlState,
  type AdminDpmatchWorkbenchFilters
} from '@/lib/admin/dpmatch-workbench-url'
import {
  buildDpmatchRowsMap,
  createEmptyDpmatchWorkbenchResult
} from '@/lib/admin/dpmatch-workbench-mapper'
import type { AdminDpmatchRow } from '@/lib/admin/dpmatch-catalog'
import {
  adminDpmatchWorkbenchQueryKey,
  fetchDpmatchFilterOptions,
  fetchDpmatchWorkbench
} from '@/lib/api/admin-dpmatch-workbench'
import { DataTable } from '@/components/admin/data-table/data-table'
import { getProductColumns } from './product-columns'
import { formatCurrency } from '@/lib/utils'

interface ProductsAdminClientProps {
  initialFilters: AdminDpmatchWorkbenchFilters
  initialProductId: string | null
}

interface FilterOption {
  value: string
  label: string
  groupLabel?: string
}

function areFiltersEqual(
  a: AdminDpmatchWorkbenchFilters,
  b: AdminDpmatchWorkbenchFilters
) {
  return (
    a.q === b.q &&
    a.page === b.page &&
    a.limit === b.limit &&
    a.dinamikBrand === b.dinamikBrand &&
    a.manufacturerId === b.manufacturerId &&
    a.matchSide === b.matchSide &&
    a.mappingStatus === b.mappingStatus &&
    a.stockStatus === b.stockStatus
  )
}

export function ProductsAdminClient({
  initialFilters,
  initialProductId
}: ProductsAdminClientProps) {
  const t = useTranslations('AdminCatalog.products')
  const pathname = usePathname()

  const [filters, setFilters] = useState<AdminDpmatchWorkbenchFilters>(initialFilters)
  const [searchValue, setSearchValue] = useState(initialFilters.q)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(initialProductId)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)
  const selectedProductIdRef = useRef(selectedProductId)
  const dpmatchRowsRef = useRef<Record<string, AdminDpmatchRow>>({})

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  useEffect(() => {
    selectedProductIdRef.current = selectedProductId
  }, [selectedProductId])

  const syncUrlState = (
    nextFilters: AdminDpmatchWorkbenchFilters,
    nextProductId: string | null,
    mode: 'replace' | 'push'
  ) => {
    if (typeof window === 'undefined') return
    const params = buildDpmatchWorkbenchSearchParams({
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
    nextFilters: AdminDpmatchWorkbenchFilters,
    nextProductId: string | null,
    mode: 'replace' | 'push'
  ) => {
    setFilters(nextFilters)
    setSelectedProductId(nextProductId)
    syncUrlState(nextFilters, nextProductId, mode)
  }

  useEffect(() => {
    const handlePopState = () => {
      const nextState = parseDpmatchWorkbenchUrlState(
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
    queryKey: adminDpmatchWorkbenchQueryKey(filters),
    queryFn: async () => {
      const result = await fetchDpmatchWorkbench(
        filters,
        selectedProductIdRef.current
      )
      dpmatchRowsRef.current = buildDpmatchRowsMap(result.dpmatchRows)
      return result
    },
    placeholderData: keepPreviousData
  })

  const optionsQuery = useQuery({
    queryKey: ['admin-dpmatch-filter-options'],
    queryFn: fetchDpmatchFilterOptions,
    enabled: filtersOpen,
    staleTime: 10 * 60 * 1000
  })

  const workbenchData =
    workbenchQuery.data ?? createEmptyDpmatchWorkbenchResult(filters)
  const isInitialLoading = workbenchQuery.isLoading && !workbenchQuery.data
  const isListUpdating = workbenchQuery.isFetching && !!workbenchQuery.data
  const isInputLoading = isSearchPending || workbenchQuery.isFetching
  const filterOptions: AdminDpmatchFilterOptions = optionsQuery.data ?? {
    dinamikBrands: [],
    manufacturers: []
  }

  useEffect(() => {
    setSearchValue(filters.q)
  }, [filters.q])

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
    name: keyof AdminDpmatchWorkbenchFilters,
    value?: string | null
  ) => {
    const nextFilters = { ...filtersRef.current, page: 1 }

    if (name === 'q') {
      nextFilters.q = value?.trim() || ''
    } else if (name === 'dinamikBrand') {
      nextFilters.dinamikBrand =
        value && value !== 'all' ? value.trim() : null
    } else if (name === 'manufacturerId') {
      nextFilters.manufacturerId =
        value && value !== 'all' ? Number(value) : null
    } else if (name === 'matchSide') {
      nextFilters.matchSide =
        (value as AdminDpmatchWorkbenchFilters['matchSide']) || 'all'
    } else if (name === 'mappingStatus') {
      nextFilters.mappingStatus =
        (value as AdminDpmatchWorkbenchFilters['mappingStatus']) || 'all'
    } else if (name === 'stockStatus') {
      nextFilters.stockStatus =
        (value as AdminDpmatchWorkbenchFilters['stockStatus']) || 'all'
    }

    applyUrlState(nextFilters, selectedProductIdRef.current, 'replace')
  }

  const toggleMatchSide = (
    side: AdminDpmatchWorkbenchFilters['matchSide']
  ) => {
    setFilterParam(
      'matchSide',
      filtersRef.current.matchSide === side ? 'all' : side
    )
  }

  const resetFilters = () => {
    setSearchValue('')
    setIsSearchPending(false)
    applyUrlState(
      DEFAULT_DPMATCH_WORKBENCH_FILTERS,
      selectedProductIdRef.current,
      'replace'
    )
  }

  const openDetail = (rowId: string, mode: 'replace' | 'push' = 'push') => {
    setSelectedProductId(rowId)
    syncUrlState(filtersRef.current, rowId, mode)
  }

  const closeDetail = (mode: 'replace' | 'push' = 'push') => {
    setSelectedProductId(null)
    syncUrlState(filtersRef.current, null, mode)
  }

  const reloadCurrentPage = () => {
    void workbenchQuery.refetch()
  }

  const summary = workbenchData.dpmatchSummary
  const totalPages = workbenchData.pagination.pages

  // Memoize columns so meta reference is stable
  const columns = useMemo(
    () =>
      getProductColumns({
        onOpenDetail: (id) => openDetail(id)
      }),
    []
  )

  if (isInitialLoading) {
    return <AdminTablePageSkeleton />
  }

  if (workbenchQuery.isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-8 text-center">
        <p className="text-sm font-medium text-destructive">{t('loadError')}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-4"
          onClick={() => void workbenchQuery.refetch()}
        >
          Tekrar dene
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <AdminKpiGrid>
        <AdminKpiCard
          label={t('kpiTotal')}
          value={summary.total}
          tone="default"
          icon={<Package size={16} />}
        />
        <AdminKpiCard
          label={t('kpiMatched')}
          value={summary.matched}
          tone="default"
          icon={<Package size={16} />}
        />
        <AdminKpiCard
          label={t('kpiUnmatched')}
          value={summary.unmatched}
          tone="warning"
          icon={<TrendingDown size={16} />}
        />
        <AdminKpiCard
          label={t('kpiPending')}
          value={summary.pending}
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
          searchPlaceholder={t('searchPlaceholder')}
          isSearchLoading={isInputLoading}
          onRefresh={reloadCurrentPage}
          isRefreshing={isListUpdating}
          onAdvancedFilter={() => setFiltersOpen(true)}
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={filters.matchSide === 'matched'}
            onClick={() => toggleMatchSide('matched')}
            label={t('filterMatched')}
          />
          <AdminFilterChip
            active={filters.matchSide === 'unmatched'}
            onClick={() => toggleMatchSide('unmatched')}
            label={t('filterUnmatched')}
          />
          <AdminFilterChip
            active={filters.mappingStatus === 'PENDING'}
            onClick={() =>
              setFilterParam(
                'mappingStatus',
                filters.mappingStatus === 'PENDING' ? 'all' : 'PENDING'
              )
            }
            label={t('kpiPending')}
          />
          <AdminFilterChip
            active={filters.matchSide === 'dinamik_only'}
            onClick={() => toggleMatchSide('dinamik_only')}
            label={t('filterDinamikOnly')}
          />
          <AdminFilterChip
            active={filters.matchSide === 'pt_only'}
            onClick={() => toggleMatchSide('pt_only')}
            label={t('filterPtOnly')}
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
                        <p className="text-sm font-semibold text-foreground">
                          {formatCurrency(row.sellingPrice)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">TRY</p>
                      </div>
                      <div className="space-y-1">
                        <SyncBadge status={row.syncStatus} />
                        <p className="text-xs text-muted-foreground">
                          {row.isVisible ? 'Görünür' : 'Gizli'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-end">
                      <AdminRowActions
                        actions={[
                          {
                            label: 'Ürün Detayları',
                            onClick: () => openDetail(row.id)
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
          <DataTable
            columns={columns}
            data={workbenchData.products}
            isLoading={isListUpdating}
            emptyMessage="Kayıt bulunamadı."
            showViewOptions={false}
            pagination={{
              page: workbenchData.pagination.page,
              limit: workbenchData.pagination.limit,
              total: workbenchData.pagination.total,
              pages: totalPages
            }}
            onPaginationChange={(page) => {
              applyUrlState(
                { ...filtersRef.current, page },
                selectedProductIdRef.current,
                'push'
              )
            }}
            getRowClassName={(row) =>
              selectedProductId === row.id ? 'bg-muted' : undefined
            }
          />
        }
      />

      {/* Pagination is handled by DataTable now, but keep old one for mobile safety */}
      <Pagination
        currentPage={workbenchData.pagination.page}
        totalPages={totalPages}
        totalItems={workbenchData.pagination.total}
        itemsPerPage={workbenchData.pagination.limit}
        onPageChange={(page) => {
          applyUrlState(
            { ...filtersRef.current, page },
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
              label={t('filterDinamikBrand')}
              value={filters.dinamikBrand ?? 'all'}
              options={[
                { value: 'all', label: t('filterAll') },
                ...filterOptions.dinamikBrands.map((brand) => ({
                  value: brand,
                  label: brand
                }))
              ]}
              disabled={optionsQuery.isLoading}
              placeholder={
                optionsQuery.isLoading ? 'Markalar yükleniyor...' : 'Seçiniz'
              }
              onChange={(value) => setFilterParam('dinamikBrand', value)}
            />
            <FilterSelect
              label={t('filterManufacturer')}
              value={
                filters.manufacturerId != null
                  ? String(filters.manufacturerId)
                  : 'all'
              }
              options={[
                { value: 'all', label: t('filterAll') },
                ...filterOptions.manufacturers.map((manufacturer) => ({
                  value: String(manufacturer.id),
                  label: manufacturer.name
                }))
              ]}
              disabled={optionsQuery.isLoading}
              placeholder={
                optionsQuery.isLoading
                  ? 'Üreticiler yükleniyor...'
                  : 'Seçiniz'
              }
              onChange={(value) => setFilterParam('manufacturerId', value)}
            />
            <FilterSelect
              label={t('filterMatched')}
              value={filters.matchSide}
              options={[
                { value: 'all', label: t('filterAll') },
                { value: 'matched', label: t('filterMatched') },
                { value: 'unmatched', label: t('filterUnmatched') },
                { value: 'dinamik_only', label: t('filterDinamikOnly') },
                { value: 'pt_only', label: t('filterPtOnly') }
              ]}
              onChange={(value) => setFilterParam('matchSide', value)}
            />
            <FilterSelect
              label="Eşleştirme durumu"
              value={filters.mappingStatus}
              options={[
                { value: 'all', label: t('filterAll') },
                { value: 'APPROVED', label: 'APPROVED' },
                { value: 'PENDING', label: 'PENDING' },
                { value: 'REJECTED', label: 'REJECTED' },
                { value: 'IGNORED', label: 'IGNORED' }
              ]}
              onChange={(value) => setFilterParam('mappingStatus', value)}
            />
            <FilterSelect
              label="Stok"
              value={filters.stockStatus}
              options={[
                { value: 'all', label: t('filterAll') },
                { value: 'in_stock', label: 'Stokta' },
                { value: 'low_stock', label: 'Düşük Stok' },
                { value: 'out_of_stock', label: 'Stok Yok' },
                { value: 'zero_price', label: 'Sıfır Fiyat' }
              ]}
              onChange={(value) => setFilterParam('stockStatus', value)}
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

      {(() => {
        const selectedDpmatchRow = selectedProductId
          ? dpmatchRowsRef.current[selectedProductId]
          : null
        if (!selectedProductId || !selectedDpmatchRow) return null
        const row = selectedDpmatchRow
        return (
          <DpmatchDetailModal
            row={row}
            open={true}
            onClose={closeDetail}
          />
        )
      })()}
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