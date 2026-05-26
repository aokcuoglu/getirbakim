'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Link2, Package, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import type { SortingState } from '@tanstack/react-table'
import { useDebouncedCallback } from 'use-debounce'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminFilterSelect } from '@/components/admin/data-table/admin-filter-select'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { Link } from '@/lib/navigation'
import type {
  AdminApprovedDpmatchListResult,
  AdminApprovedDpmatchRow
} from '@/lib/admin/approved-dpmatch-catalog'
import { DataTable } from '../../eslestirme/_components/data-table'
import { approvedProductColumns } from './approved-product-columns'

type MatchSide = 'all' | 'matched' | 'unmatched' | 'dinamik_only' | 'pt_only'

type ProductFilters = {
  q: string
  dinamikBrand: string | null
  manufacturerId: number | null
  matchSide: MatchSide
  page: number
  limit: number
  sort?: string
  sort_dir?: string
}

const DEFAULT_FILTERS: ProductFilters = {
  q: '',
  dinamikBrand: null,
  manufacturerId: null,
  matchSide: 'all',
  page: 1,
  limit: 50
}

function buildSearchParams(f: ProductFilters) {
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.dinamikBrand) params.set('dinamikBrand', f.dinamikBrand)
  if (f.manufacturerId) params.set('manufacturerId', String(f.manufacturerId))
  if (f.matchSide !== 'all') params.set('matchSide', f.matchSide)
  params.set('page', String(f.page))
  params.set('limit', String(f.limit))
  if (f.sort) {
    params.set('sort', f.sort)
    params.set('sort_dir', f.sort_dir || 'asc')
  }
  return params
}

interface ApprovedDpmatchProductsClientProps {
  initialData: AdminApprovedDpmatchListResult
}

export function ApprovedDpmatchProductsClient({
  initialData
}: ApprovedDpmatchProductsClientProps) {
  const t = useTranslations('AdminCatalog.products')
  const [rows, setRows] = useState<AdminApprovedDpmatchRow[]>(initialData.rows)
  const [summary, setSummary] = useState(initialData.summary)
  const [pagination, setPagination] = useState(initialData.pagination)
  const [initialLoading, setInitialLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [filters, setFilters] = useState<ProductFilters>({
    ...DEFAULT_FILTERS,
    q: initialData.filters.q,
    dinamikBrand: initialData.filters.dinamikBrand,
    manufacturerId: initialData.filters.manufacturerId,
    matchSide: initialData.filters.matchSide,
    page: initialData.filters.page,
    limit: initialData.filters.limit
  })
  const [searchValue, setSearchValue] = useState(initialData.filters.q)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterOptions, setFilterOptions] = useState<{
    dinamikBrands: string[]
    manufacturers: Array<{ id: number; name: string }>
  }>({ dinamikBrands: [], manufacturers: [] })
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)
  const hasLoadedRef = useRef(true)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const loadRows = useCallback(async (f: ProductFilters) => {
    const isInitial = !hasLoadedRef.current
    if (isInitial) setInitialLoading(true)
    else setIsFetching(true)

    try {
      const res = await fetch(`/api/admin/catalog/products?${buildSearchParams(f)}`)
      if (!res.ok) {
        toast.error(t('loadError'))
        return
      }
      const data = await res.json()
      if (!data.error) {
        setRows(data.rows || [])
        setPagination(data.pagination || pagination)
        setSummary(data.summary || summary)
      }
    } catch {
      toast.error(t('loadError'))
    } finally {
      if (isInitial) setInitialLoading(false)
      else setIsFetching(false)
      hasLoadedRef.current = true
    }
  }, [pagination, summary, t])

  const loadFilterOptions = useCallback(async () => {
    setOptionsLoading(true)
    try {
      const res = await fetch('/api/admin/eslestirme/models/options')
      if (res.ok) {
        const data = await res.json()
        if (!data.error) {
          setFilterOptions({
            dinamikBrands: data.dinamikBrands || [],
            manufacturers: data.manufacturers || []
          })
        }
      }
    } catch {
      toast.error(t('optionsError'))
    } finally {
      setOptionsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadFilterOptions()
  }, [loadFilterOptions])

  const handleSortingChange = useCallback(
    (next: SortingState) => {
      setSorting(next)
      if (next.length === 0) {
        void loadRows(filtersRef.current)
        return
      }
      const s = next[0]
      const updated = {
        ...filtersRef.current,
        sort: s.id,
        sort_dir: s.desc ? 'desc' : 'asc',
        page: 1
      }
      setFilters(updated)
      void loadRows(updated)
    },
    [loadRows]
  )

  const applyFilters = useCallback(
    (patch: Partial<ProductFilters>) => {
      const next = { ...filtersRef.current, ...patch }
      setFilters(next)
      void loadRows(next)
    },
    [loadRows]
  )

  const onSearch = useDebouncedCallback((term: string) => {
    setIsSearchPending(false)
    applyFilters({ q: term.trim(), page: 1 })
  }, 250)

  const setFilterParam = useCallback(
    (
      name: keyof Pick<
        ProductFilters,
        'dinamikBrand' | 'manufacturerId' | 'matchSide'
      >,
      value?: string | null
    ) => {
      const patch: Partial<ProductFilters> = { page: 1 }
      if (name === 'dinamikBrand') {
        patch.dinamikBrand = value && value !== 'all' ? value : null
      } else if (name === 'manufacturerId') {
        patch.manufacturerId = value && value !== 'all' ? Number(value) : null
      } else if (name === 'matchSide') {
        patch.matchSide = (value as MatchSide) || 'all'
      }
      applyFilters(patch)
    },
    [applyFilters]
  )

  const resetFilters = useCallback(() => {
    setSearchValue('')
    setIsSearchPending(false)
    applyFilters(DEFAULT_FILTERS)
  }, [applyFilters])

  if (initialLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-96 w-full" />
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
          icon={<Link2 size={16} />}
        />
        <AdminKpiCard
          label={t('kpiUnmatched')}
          value={summary.unmatched}
          tone="warning"
        />
        <AdminKpiCard
          label={t('kpiPending')}
          value={summary.pending}
          tone="info"
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
          isSearchLoading={isSearchPending || isFetching}
          onRefresh={() => void loadRows(filtersRef.current)}
          isRefreshing={isFetching}
          onAdvancedFilter={() => setFiltersOpen((open) => !open)}
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={filters.matchSide === 'unmatched'}
            onClick={() =>
              setFilterParam(
                'matchSide',
                filters.matchSide === 'unmatched' ? 'all' : 'unmatched'
              )
            }
            label={t('filterUnmatched')}
          />
          <AdminFilterChip
            active={filters.matchSide === 'matched'}
            onClick={() =>
              setFilterParam(
                'matchSide',
                filters.matchSide === 'matched' ? 'all' : 'matched'
              )
            }
            label={t('filterMatched')}
          />
          <AdminFilterChip
            active={filters.matchSide === 'dinamik_only'}
            onClick={() =>
              setFilterParam(
                'matchSide',
                filters.matchSide === 'dinamik_only' ? 'all' : 'dinamik_only'
              )
            }
            label={t('filterDinamikOnly')}
          />
          <AdminFilterChip
            active={filters.matchSide === 'pt_only'}
            onClick={() =>
              setFilterParam(
                'matchSide',
                filters.matchSide === 'pt_only' ? 'all' : 'pt_only'
              )
            }
            label={t('filterPtOnly')}
          />
        </AdminFilterBar>

        {filtersOpen ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <AdminFilterSelect
              label={t('filterDinamikBrand')}
              value={filters.dinamikBrand ?? 'all'}
              onChange={(value) => setFilterParam('dinamikBrand', value)}
              options={[
                { value: 'all', label: t('filterAll') },
                ...filterOptions.dinamikBrands.map((brand) => ({
                  value: brand,
                  label: brand
                }))
              ]}
              disabled={optionsLoading}
            />
            <AdminFilterSelect
              label={t('filterManufacturer')}
              value={
                filters.manufacturerId != null
                  ? String(filters.manufacturerId)
                  : 'all'
              }
              onChange={(value) => setFilterParam('manufacturerId', value)}
              options={[
                { value: 'all', label: t('filterAll') },
                ...filterOptions.manufacturers.map((mfr) => ({
                  value: String(mfr.id),
                  label: mfr.name
                }))
              ]}
              disabled={optionsLoading}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {t('pagination', {
            page: pagination.page,
            pages: pagination.pages,
            total: pagination.total
          })}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href="/admin/eslestirme">{t('goToMatching')}</Link>
        </Button>
      </div>

      <DataTable
        columns={approvedProductColumns}
        data={rows}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        isLoading={isFetching}
        pagination={pagination}
        onPaginationChange={(page) => applyFilters({ page })}
        emptyMessage={t('empty')}
      />
    </div>
  )
}
