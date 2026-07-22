'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, Tag, Merge, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import type { SortingState } from '@tanstack/react-table'
import { useDebouncedCallback } from 'use-debounce'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type {
  AdminApprovedBrandListResult,
  AdminApprovedBrandRow
} from '@/lib/admin/approved-dnbrd-catalog'
import { DataTable } from '@/components/admin/data-table/data-table'
import { BrandMatchSheet } from './BrandMatchSheet'
import { createApprovedBrandColumns } from './approved-brand-columns'
import { BrandDetailModal } from './BrandDetailModal'

type LogoStatus = 'all' | 'missing' | 'has_logo'
type MatchSide = 'all' | 'matched' | 'dinamik_only' | 'pt_only' | 'pending' | 'unmatched'

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
  if (f.matchSide && f.matchSide !== 'all') params.set('matchSide', f.matchSide)
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
    matchSide: (initialData.filters.matchSide as MatchSide) ?? 'all',
    page: initialData.filters.page,
    limit: initialData.filters.limit
  })
  const [searchValue, setSearchValue] = useState(initialData.filters.q)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [matchSheetOpen, setMatchSheetOpen] = useState(false)
  const [matchSource, setMatchSource] = useState<AdminApprovedBrandRow | null>(null)
  const [targetId, setTargetId] = useState<string>('')
  const [isMerging, setIsMerging] = useState(false)
  const [detailBrand, setDetailBrand] = useState<AdminApprovedBrandRow | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)
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
          setSelectedIds([]) // Clear selection on refresh
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
        setDetailBrand((current) =>
          current && current.id === row.id ? { ...current, logoUrl } : current
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

  const handleToggleSelect = useCallback((id: number) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    )
  }, [])

  const handleViewDetail = useCallback((row: AdminApprovedBrandRow) => {
    setDetailBrand(row)
    setDetailDialogOpen(true)
  }, [])

  const handleMatch = useCallback((row: AdminApprovedBrandRow) => {
    setMatchSource(row)
    setMatchSheetOpen(true)
  }, [])

  const handleRename = useCallback(
    async (row: AdminApprovedBrandRow, name: string): Promise<boolean> => {
      const trimmed = name.trim()
      try {
        const res = await fetch(`/api/admin/catalog/brands/${row.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed })
        })
        const data = await res.json()
        if (data.error) {
          toast.error(data.error?.message || 'Marka adı güncellenemedi.')
          return false
        }
        toast.success('Marka adı güncellendi.')
        const patch = (r: AdminApprovedBrandRow) =>
          r.id === row.id ? { ...r, normalizedName: trimmed } : r
        setRows((cur) => cur.map(patch))
        setDetailBrand((cur) => (cur ? patch(cur) : cur))
        return true
      } catch {
        toast.error('Marka adı güncellenemedi.')
        return false
      }
    },
    []
  )

  const handleMappingAction = useCallback(
    async (
      row: AdminApprovedBrandRow,
      mapping: AdminApprovedBrandRow['mappings'][number],
      action: 'approve' | 'reject' | 'ignore' | 'unlink'
    ): Promise<boolean> => {
      const patchRow = (updater: (r: AdminApprovedBrandRow) => AdminApprovedBrandRow) => {
        const apply = (r: AdminApprovedBrandRow) => (r.id === row.id ? updater(r) : r)
        setRows((cur) => cur.map(apply))
        setDetailBrand((cur) => (cur ? apply(cur) : cur))
      }

      try {
        if (action === 'unlink') {
          const targets: Array<{ supplier: string; supplierBrandId: string | number }> = []
          if (mapping.dnmkBrandsId) targets.push({ supplier: 'dinamik', supplierBrandId: mapping.dnmkBrandsId })
          if (mapping.ptdrkBrandsId != null) targets.push({ supplier: 'ptdrk', supplierBrandId: mapping.ptdrkBrandsId })
          if (mapping.bsbgBrandsId) targets.push({ supplier: 'basbug', supplierBrandId: mapping.bsbgBrandsId })
          if (targets.length === 0) {
            toast.error('Kaldırılacak tedarikçi bağlantısı bulunamadı.')
            return false
          }
          for (const target of targets) {
            const res = await fetch('/api/admin/eslestirme/brands/unlink', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(target)
            })
            const data = await res.json()
            if (data.error) {
              toast.error(data.error?.message || 'Eşleşme kaldırılamadı.')
              return false
            }
          }
          toast.success('Eşleşme kaldırıldı.')
          patchRow((r) => ({
            ...r,
            mappings: r.mappings.filter((m) => m.mappingId !== mapping.mappingId)
          }))
          return true
        }

        const res = await fetch(`/api/admin/eslestirme/brands/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mappingId: mapping.mappingId })
        })
        const data = await res.json()
        if (data.error) {
          toast.error(data.error?.message || 'İşlem başarısız.')
          return false
        }
        const statusMap = { approve: 'APPROVED', reject: 'REJECTED', ignore: 'IGNORED' } as const
        toast.success(data.message || 'Eşleşme güncellendi.')
        patchRow((r) => ({
          ...r,
          mappings: r.mappings.map((m) =>
            m.mappingId === mapping.mappingId ? { ...m, mappingStatus: statusMap[action] } : m
          )
        }))
        return true
      } catch {
        toast.error('İşlem sırasında hata oluştu.')
        return false
      }
    },
    []
  )

  const handleDeleteBrand = useCallback(
    async (row: AdminApprovedBrandRow): Promise<boolean> => {
      try {
        const res = await fetch(`/api/admin/catalog/brands/${row.id}`, { method: 'DELETE' })
        const data = await res.json()
        if (data.error) {
          toast.error(data.error?.message || 'Marka silinemedi.')
          return false
        }
        toast.success('Marka silindi.')
        setRows((cur) => cur.filter((r) => r.id !== row.id))
        setSelectedIds((cur) => cur.filter((id) => id !== row.id))
        setSummary((cur) => ({
          total: Math.max(0, cur.total - 1),
          withLogo: row.logoUrl ? Math.max(0, cur.withLogo - 1) : cur.withLogo,
          missingLogo: row.logoUrl ? cur.missingLogo : Math.max(0, cur.missingLogo - 1)
        }))
        setPagination((cur) => ({ ...cur, total: Math.max(0, cur.total - 1) }))
        return true
      } catch {
        toast.error('Marka silinirken hata oluştu.')
        return false
      }
    },
    []
  )

  const handleMerge = useCallback(async () => {
    if (selectedIds.length < 2) {
      toast.error('En az 2 marka seçmelisiniz.')
      return
    }
    if (!targetId) {
      toast.error('Hedef marka seçmelisiniz.')
      return
    }
    const target = parseInt(targetId, 10)
    if (!selectedIds.includes(target)) {
      toast.error('Hedef marka seçili markalar arasında olmalıdır.')
      return
    }

    const sourceIds = selectedIds.filter(id => id !== target)

    setIsMerging(true)
    try {
      const res = await fetch('/api/admin/brands/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceIds, targetId: target })
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.error?.message || 'Birleştirme başarısız.')
      } else {
        toast.success('Markalar başarıyla birleştirildi.')
        setMergeDialogOpen(false)
        setSelectedIds([])
        setTargetId('')
        await loadRows(filtersRef.current)
      }
    } catch {
      toast.error('Birleştirme sırasında hata oluştu.')
    } finally {
      setIsMerging(false)
    }
  }, [selectedIds, targetId, loadRows])

  const selectedRows = useMemo(() => {
    return rows.filter((row) => selectedIds.includes(row.id))
  }, [rows, selectedIds])

  const columns = useMemo(
    () =>
      createApprovedBrandColumns({
        onUpload: handleUpload,
        onUploadFromUrl: handleUploadFromUrl,
        uploadingId,
        selectedIds,
        onToggleSelect: handleToggleSelect,
        onViewDetail: handleViewDetail,
        onMatch: handleMatch
      }),
    [handleUpload, handleUploadFromUrl, uploadingId, selectedIds, handleToggleSelect, handleViewDetail, handleMatch]
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
    setSelectedIds([])
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
        <div className="flex flex-wrap items-center gap-2">
          <AdminTableToolbar
            searchValue={searchValue}
            onSearchChange={(nextValue) => {
              setSearchValue(nextValue)
              setIsSearchPending(true)
              onSearch(nextValue)
            }}
            searchPlaceholder={(t('searchPlaceholder') as string) || 'Ara...'}
            isSearchLoading={isSearchPending || isFetching}
            onRefresh={() => void loadRows(filtersRef.current)}
            isRefreshing={isFetching}
          />
          {selectedIds.length >= 2 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMergeDialogOpen(true)}
              className="shrink-0"
            >
              <Merge className="h-4 w-4 mr-1" />
              Birleştir ({selectedIds.length})
            </Button>
          )}
        </div>

        <AdminFilterBar onReset={resetFilters} className="mt-3">
          <AdminFilterChip
            active={filters.logoStatus === 'missing'}
            onClick={() =>
              applyFilters({
                logoStatus: filters.logoStatus === 'missing' ? 'all' : 'missing',
                page: 1
              })
            }
            label={t('filterMissingLogo') as string}
          />
          <AdminFilterChip
            active={filters.logoStatus === 'has_logo'}
            onClick={() =>
              applyFilters({
                logoStatus: filters.logoStatus === 'has_logo' ? 'all' : 'has_logo',
                page: 1
              })
            }
            label={t('filterHasLogo') as string}
          />
          <span className="mx-1 h-4 w-px bg-border" />
          <AdminFilterChip
            active={filters.matchSide === 'matched'}
            onClick={() =>
              applyFilters({
                matchSide: filters.matchSide === 'matched' ? 'all' : 'matched',
                page: 1
              })
            }
            label="Eşleşmiş"
          />
          <AdminFilterChip
            active={filters.matchSide === 'pending'}
            onClick={() =>
              applyFilters({
                matchSide: filters.matchSide === 'pending' ? 'all' : 'pending',
                page: 1
              })
            }
            label="Bekleyen"
          />
          <AdminFilterChip
            active={filters.matchSide === 'unmatched'}
            onClick={() =>
              applyFilters({
                matchSide: filters.matchSide === 'unmatched' ? 'all' : 'unmatched',
                page: 1
              })
            }
            label="Eşleşmemiş"
          />

        </AdminFilterBar>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p>
          {pagination.total} marka (sayfa {pagination.page} / {pagination.pages})
        </p>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        isLoading={isFetching}
        pagination={pagination}
        onPaginationChange={(page) => applyFilters({ page })}
        emptyMessage={(t('empty') as string) || 'Sonuç bulunamadı.'}
      />

      {/* Brand Detail Modal (edit) */}
      <BrandDetailModal
        brand={detailBrand}
        open={detailDialogOpen}
        onOpenChange={(open) => {
          setDetailDialogOpen(open)
          if (!open) setDetailBrand(null)
        }}
        uploadingId={uploadingId}
        onRename={handleRename}
        onUpload={handleUpload}
        onUploadFromUrl={handleUploadFromUrl}
        onMappingAction={handleMappingAction}
        onDelete={handleDeleteBrand}
      />

      {/* Brand Match Sheet (source brand_list → target brand_list merge) */}
      <BrandMatchSheet
        source={matchSource}
        open={matchSheetOpen}
        onOpenChange={(open) => {
          setMatchSheetOpen(open)
          if (!open) setMatchSource(null)
        }}
        onLinked={() => void loadRows(filtersRef.current)}
      />

      {/* Merge Dialog */}
      <Dialog open={mergeDialogOpen} onOpenChange={setMergeDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Markaları Birleştir</DialogTitle>
            <DialogDescription>
              Seçilen {selectedIds.length} markayı tek bir marka altında birleştirin.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Birleştirilecek Markalar</Label>
              <div className="mt-2 space-y-1 max-h-32 overflow-y-auto rounded-md border p-2">
                {selectedRows.map((row) => (
                  <div key={row.id} className="text-sm">
                    ID {row.id}: <strong>{row.normalizedName}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-sm font-medium">Hedef Marka (Kalacak Olan)</Label>
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Hedef marka seçin..." />
                </SelectTrigger>
                <SelectContent>
                  {selectedRows.map((row) => (
                    <SelectItem key={row.id} value={String(row.id)}>
                      {row.normalizedName} (ID: {row.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMergeDialogOpen(false)
                setTargetId('')
              }}
              disabled={isMerging}
            >
              İptal
            </Button>
            <Button
              onClick={() => void handleMerge()}
              disabled={isMerging || !targetId}
            >
              {isMerging ? 'Birleştiriliyor...' : 'Birleştir'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
