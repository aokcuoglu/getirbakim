'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Tag } from 'lucide-react'
import { toast } from 'sonner'
import type { SortingState } from '@tanstack/react-table'
import { useDebouncedCallback } from 'use-debounce'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { Link } from '@/lib/navigation'
import type {
  AdminApprovedBrandListResult,
  AdminApprovedBrandRow
} from '@/lib/admin/approved-dnbrd-catalog'
import { DataTable } from '@/components/admin/data-table/data-table'
import { createApprovedBrandColumns } from './approved-brand-columns'

type LogoStatus = 'all' | 'missing' | 'has_logo'
type MatchSide = 'all' | 'matched' | 'dinamik_only' | 'pt_only'

type BrandFilters = {
  q: string
  logoStatus: LogoStatus
  matchSide: MatchSide
  page: number
  limit: number
  sort?: string
  sort_dir?: string
}

const DEFAULT_FILTERS: BrandFilters = {
  q: '',
  logoStatus: 'all',
  matchSide: 'all',
  page: 1,
  limit: 50
}

function buildSearchParams(f: BrandFilters) {
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.logoStatus !== 'all') params.set('logoStatus', f.logoStatus)
  if (f.matchSide !== 'all') params.set('matchSide', f.matchSide)
  params.set('page', String(f.page))
  params.set('limit', String(f.limit))
  if (f.sort) {
    params.set('sort', f.sort)
    params.set('sort_dir', f.sort_dir || 'asc')
  }
  return params
}

interface ApprovedBrandsAdminClientProps {
  initialData: AdminApprovedBrandListResult
}

export function ApprovedBrandsAdminClient({
  initialData
}: ApprovedBrandsAdminClientProps) {
  const t = useTranslations('AdminCatalog.brands')
  const [rows, setRows] = useState<AdminApprovedBrandRow[]>(initialData.rows)
  const [summary, setSummary] = useState(initialData.summary)
  const [pagination, setPagination] = useState(initialData.pagination)
  const [initialLoading, setInitialLoading] = useState(false)
  const [isFetching, setIsFetching] = useState(false)
  const [uploadingId, setUploadingId] = useState<number | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [filters, setFilters] = useState<BrandFilters>({
    ...DEFAULT_FILTERS,
    q: initialData.filters.q,
    logoStatus: initialData.filters.logoStatus,
    matchSide: initialData.filters.matchSide,
    page: initialData.filters.page,
    limit: initialData.filters.limit
  })
  const [searchValue, setSearchValue] = useState(initialData.filters.q)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)
  const hasLoadedRef = useRef(true)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const loadRows = useCallback(
    async (f: BrandFilters) => {
      const isInitial = !hasLoadedRef.current
      if (isInitial) setInitialLoading(true)
      else setIsFetching(true)

      try {
        const res = await fetch(`/api/admin/catalog/brands?${buildSearchParams(f)}`)
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
    },
    [pagination, summary, t]
  )

  const applyLogoUploadResult = useCallback(
    (
      row: AdminApprovedBrandRow,
      data: { error?: { message?: string }; logoUrl?: string; message?: string }
    ): boolean => {
      if (!data.error && data.logoUrl) {
        toast.success(data.message || t('uploadSuccess'))
        const logoUrl = data.logoUrl!
        setRows((current) =>
          current.map((item) =>
            item.id === row.id ? { ...item, logoUrl } : item
          )
        )
        setSummary((current) => ({
          ...current,
          withLogo: current.withLogo + (row.logoUrl ? 0 : 1),
          missingLogo: Math.max(0, current.missingLogo - (row.logoUrl ? 0 : 1))
        }))
        return true
      }
      toast.error(data.error?.message || t('uploadError'))
      return false
    },
    [t]
  )

  const handleUpload = useCallback(
    async (row: AdminApprovedBrandRow, file: File): Promise<boolean> => {
      setUploadingId(row.id)
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`/api/admin/catalog/brands/${row.id}/logo`, {
          method: 'POST',
          body: formData
        })
        const data = await res.json()
        return applyLogoUploadResult(row, data)
      } catch {
        toast.error(t('uploadError'))
        return false
      } finally {
        setUploadingId(null)
      }
    },
    [applyLogoUploadResult, t]
  )

  const handleUploadFromUrl = useCallback(
    async (row: AdminApprovedBrandRow, url: string): Promise<boolean> => {
      setUploadingId(row.id)
      try {
        const formData = new FormData()
        formData.append('url', url.trim())
        const res = await fetch(`/api/admin/catalog/brands/${row.id}/logo`, {
          method: 'POST',
          body: formData
        })
        const data = await res.json()
        return applyLogoUploadResult(row, data)
      } catch {
        toast.error(t('uploadError'))
        return false
      } finally {
        setUploadingId(null)
      }
    },
    [applyLogoUploadResult, t]
  )

  const columns = useMemo(
    () =>
      createApprovedBrandColumns({
        onUpload: handleUpload,
        onUploadFromUrl: handleUploadFromUrl,
        uploadingId
      }),
    [handleUpload, handleUploadFromUrl, uploadingId]
  )

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
    (patch: Partial<BrandFilters>) => {
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
          icon={<Tag size={16} />}
        />
        <AdminKpiCard
          label={t('kpiWithLogo')}
          value={summary.withLogo}
          tone="default"
          icon={<ImageIcon size={16} />}
        />
        <AdminKpiCard
          label={t('kpiMissingLogo')}
          value={summary.missingLogo}
          tone="warning"
          icon={<ImageIcon size={16} />}
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
        />

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={filters.logoStatus === 'missing'}
            onClick={() =>
              applyFilters({
                logoStatus:
                  filters.logoStatus === 'missing' ? 'all' : 'missing',
                page: 1
              })
            }
            label={t('filterMissingLogo')}
          />
          <AdminFilterChip
            active={filters.logoStatus === 'has_logo'}
            onClick={() =>
              applyFilters({
                logoStatus:
                  filters.logoStatus === 'has_logo' ? 'all' : 'has_logo',
                page: 1
              })
            }
            label={t('filterHasLogo')}
          />
          <AdminFilterChip
            active={filters.matchSide === 'matched'}
            onClick={() =>
              applyFilters({
                matchSide:
                  filters.matchSide === 'matched' ? 'all' : 'matched',
                page: 1
              })
            }
            label={t('filterMatched')}
          />
        </AdminFilterBar>
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
          <Link href="/admin/eslestirme?tab=brands">{t('goToMatching')}</Link>
        </Button>
      </div>

      <DataTable
        columns={columns}
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
