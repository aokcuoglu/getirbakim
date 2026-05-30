'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SortingState } from '@tanstack/react-table'
import { useDebouncedCallback } from 'use-debounce'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminFilterSelect } from '@/components/admin/data-table/admin-filter-select'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DataTable } from './data-table'
import {
  BrandRow,
  createBrandsColumns,
} from './columns/brands-columns'

type MatchSide = 'all' | 'matched' | 'dinamik_only' | 'pt_only' | 'bsbg_only'

interface BrandFilters {
  q: string
  status: string
  matchSide: MatchSide
  page: number
  limit: number
  sort?: string
  sort_dir?: string
}

interface BrandSummary {
  total: number
  approved: number
  pending: number
  rejected: number
  ignored: number
}

const DEFAULT_BRAND_FILTERS: BrandFilters = {
  q: '',
  status: 'all',
  matchSide: 'all',
  page: 1,
  limit: 50,
}

function buildBrandSearchParams(f: BrandFilters) {
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.status !== 'all') params.set('status', f.status)
  if (f.matchSide !== 'all') params.set('matchSide', f.matchSide)
  params.set('page', String(f.page))
  params.set('limit', String(f.limit))
  if (f.sort) {
    params.set('sort', f.sort)
    params.set('sort_dir', f.sort_dir || 'asc')
  }
  return params
}

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'APPROVED', className: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800' },
  PENDING: { label: 'PENDING', className: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-800' },
  REJECTED: { label: 'REJECTED', className: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950 dark:text-red-400 dark:border-red-800' },
  IGNORED: { label: 'IGNORED', className: 'bg-muted text-muted-foreground border-border' },
}

interface MatchItem {
  id: number
  name: string
}

type MatchTarget = 'pt' | 'dinamik' | 'bsbg'

const SEARCH_PATHS: Record<MatchTarget, string> = {
  pt: '/api/admin/eslestirme/brands/manufacturers',
  dinamik: '/api/admin/eslestirme/brands/dinamik-brands',
  bsbg: '/api/admin/eslestirme/brands/bsbg-brands',
}

const SEARCH_LABELS: Record<MatchTarget, { name: string; placeholder: string }> = {
  pt: { name: 'ParçaTedarik Üretici', placeholder: 'Üretici adı ara...' },
  dinamik: { name: 'Dinamik Marka', placeholder: 'Marka adı ara...' },
  bsbg: { name: 'Başbuğ Marka', placeholder: 'Marka adı ara...' },
}

export function BrandsTab() {
  const [isPending, startTransition] = useTransition()
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [summary, setSummary] = useState<BrandSummary | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 })
  const [initialLoading, setInitialLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState<BrandFilters>(DEFAULT_BRAND_FILTERS)
  const [searchValue, setSearchValue] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const [detailBrand, setDetailBrand] = useState<BrandRow | null>(null)
  const [detailDialogOpen, setDetailDialogOpen] = useState(false)

  const [matchTarget, setMatchTarget] = useState<MatchTarget>('pt')
  const [matchQuery, setMatchQuery] = useState('')
  const [matchResults, setMatchResults] = useState<MatchItem[]>([])
  const [isSearchingMatch, setIsSearchingMatch] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [matchDialogOpen, setMatchDialogOpen] = useState(false)
  const [selectedMatch, setSelectedMatch] = useState<MatchItem | null>(null)
  const [selectedMappingId, setSelectedMappingId] = useState<number | null>(null)
  const [selectedBrandListId, setSelectedBrandListId] = useState<number | null>(null)

  const loadBrands = useCallback(async (f: BrandFilters) => {
    const isInitial = !hasLoadedRef.current
    if (isInitial) setInitialLoading(true)
    else setIsFetching(true)

    try {
      const res = await fetch(`/api/admin/eslestirme/brands?${buildBrandSearchParams(f)}`)
      if (!res.ok) {
        toast.error(`Eşleştirmeler yüklenemedi (${res.status})`)
        return
      }
      const data = await res.json()
      if (data.error) {
        toast.error(data.error?.message || 'Eşleştirmeler yüklenemedi')
        return
      }
      setBrands(data.rows || [])
      setPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 1 })
      setSummary(data.summary || null)
    } catch {
      toast.error('Eşleştirmeler yüklenemedi')
    } finally {
      if (isInitial) setInitialLoading(false)
      else setIsFetching(false)
      hasLoadedRef.current = true
    }
  }, [])

  useEffect(() => {
    void loadBrands(filters)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setSearchValue(filters.q)
  }, [filters.q])

  const handleSortingChange = useCallback(
    (next: SortingState) => {
      setSorting(next)
      if (next.length === 0) {
        void loadBrands(filtersRef.current)
        return
      }
      const s = next[0]
      const patch: Partial<BrandFilters> = {
        sort: s.id,
        sort_dir: s.desc ? 'desc' : 'asc',
        page: 1,
      }
      const updated = { ...filtersRef.current, ...patch }
      setFilters(updated)
      void loadBrands(updated)
    },
    [loadBrands]
  )

  const applyFilters = useCallback(
    (patch: Partial<BrandFilters>) => {
      const next = { ...filtersRef.current, ...patch }
      setFilters(next)
      void loadBrands(next)
    },
    [loadBrands]
  )

  const onSearch = useDebouncedCallback((term: string) => {
    setIsSearchPending(false)
    applyFilters({ q: term.trim(), page: 1 })
  }, 250)

  const setFilterParam = useCallback(
    (
      name: keyof Pick<BrandFilters, 'status' | 'matchSide'>,
      value?: string | null
    ) => {
      const patch: Partial<BrandFilters> = { page: 1 }
      if (name === 'status') {
        patch.status = value && value !== 'all' ? value : 'all'
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
    applyFilters(DEFAULT_BRAND_FILTERS)
  }, [applyFilters])

  const toggleChipFilter = useCallback(
    (name: 'status' | 'matchSide', value: string, currentValue: string) => {
      setFilterParam(name, currentValue === value ? 'all' : value)
    },
    [setFilterParam]
  )

  const handleGenerate = useCallback(() => {
    setGenerating(true)
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/eslestirme/brands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate' }),
        })
        const data = await res.json()
        if (!data.error) {
          toast.success('Marka eşleştirmeleri oluşturuldu')
          void loadBrands(filtersRef.current)
        } else toast.error(data.error?.message || 'Oluşturma başarısız')
      } catch {
        toast.error('Oluşturma başarısız')
      }
      setGenerating(false)
    })
  }, [loadBrands])

  const handleBulkApprove = useCallback(() => {
    const ids = Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id))
    if (ids.length === 0) {
      toast.error('En az bir eşleştirme seçin')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/eslestirme/brands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'bulk-approve', ids }),
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || `${data.approved} eşleştirme onaylandı`)
          setRowSelection({})
          void loadBrands(filtersRef.current)
        } else toast.error(data.error?.message || 'Toplu onay başarısız')
      } catch {
        toast.error('Toplu onay başarısız')
      }
    })
  }, [rowSelection, loadBrands])

  const handleAction = useCallback(
    async (id: number, action: string) => {
      try {
        const res = await fetch(`/api/admin/eslestirme/brands/${id}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || 'İşlem başarılı')
          void loadBrands(filtersRef.current)
        } else toast.error(data.error?.message || 'İşlem başarısız')
      } catch {
        toast.error('İşlem başarısız')
      }
    },
    [loadBrands]
  )

  const searchMatchItems = useCallback(async (q: string, target: MatchTarget) => {
    const trimmed = q.trim()
    if (!trimmed || trimmed.length < 2) {
      setMatchResults([])
      setIsSearchingMatch(false)
      return
    }
    const searchPath = SEARCH_PATHS[target]
    setIsSearchingMatch(true)
    try {
      const res = await fetch(`${searchPath}?q=${encodeURIComponent(trimmed)}&limit=20`)
      if (res.ok) {
        const data = await res.json()
        setMatchResults(Array.isArray(data) ? data : [])
      } else {
        setMatchResults([])
      }
    } catch {
      setMatchResults([])
    } finally {
      setIsSearchingMatch(false)
    }
  }, [])

  const debouncedSearchMatchItems = useDebouncedCallback((q: string) => {
    void searchMatchItems(q, matchTarget)
  }, 250)

  const openMatchDialog = useCallback((target: MatchTarget, mappingId: number | null, brandListId: number) => {
    setMatchTarget(target)
    setSelectedMappingId(mappingId)
    setSelectedBrandListId(brandListId)
    setSelectedMatch(null)
    setMatchQuery('')
    setMatchResults([])
    setMatchDialogOpen(true)
  }, [])

  const handleMatchSave = useCallback(async () => {
    if (!selectedMatch) return
    setIsUpdating(true)
    try {
      if (selectedMappingId) {
        const body: Record<string, unknown> = {}
        if (matchTarget === 'pt') body.parcatedarikManufacturerId = selectedMatch.id
        else if (matchTarget === 'dinamik') body.dinamikBrandId = selectedMatch.id
        else if (matchTarget === 'bsbg') body.bsbgBrandId = selectedMatch.id

        const res = await fetch(`/api/admin/eslestirme/brands/${selectedMappingId}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!data.error) {
          toast.success('Eşleştirme güncellendi')
        } else {
          toast.error(data.error?.message || 'Güncelleme başarısız')
        }
      } else if (selectedBrandListId) {
        const body: Record<string, unknown> = { action: 'add-mapping', brandListId: selectedBrandListId }
        if (matchTarget === 'pt') body.parcatedarikManufacturerId = selectedMatch.id
        else if (matchTarget === 'dinamik') body.dinamikBrandId = selectedMatch.id
        else if (matchTarget === 'bsbg') body.bsbgBrandId = selectedMatch.id

        const res = await fetch('/api/admin/eslestirme/brands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!data.error) {
          toast.success('Eşleştirme oluşturuldu')
        } else {
          toast.error(data.error?.message || 'Oluşturma başarısız')
        }
      }
      setMatchDialogOpen(false)
      void loadBrands(filtersRef.current)
    } catch {
      toast.error('Güncelleme başarısız')
    } finally {
      setIsUpdating(false)
    }
  }, [selectedMatch, selectedMappingId, selectedBrandListId, matchTarget, loadBrands])

  const columns = createBrandsColumns({
    onAction: handleAction,
    onViewDetail: (row) => {
      setDetailBrand(row)
      setDetailDialogOpen(true)
    },
  })

  const summaryCards = summary
    ? [
        { label: 'Toplam Marka', value: summary.total, color: 'bg-muted-foreground' },
        { label: 'Onaylandı', value: summary.approved, color: 'bg-success' },
        { label: 'Beklemede', value: summary.pending, color: 'bg-warning' },
        { label: 'Reddedildi', value: summary.rejected, color: 'bg-destructive' },
        { label: 'Yoksayıldı', value: summary.ignored, color: 'bg-muted-foreground' },
      ]
    : []

  const selectedCount = Object.values(rowSelection).filter(Boolean).length
  const isInitialLoading = initialLoading
  const isTableLoading = initialLoading || isFetching || isSearchPending
  const hasActiveFilters =
    filters.q !== '' ||
    filters.status !== 'all' ||
    filters.matchSide !== 'all'

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {isInitialLoading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="rounded-lg border bg-card px-4 py-3">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-3 h-7 w-16" />
                </div>
              ))
            : summaryCards.map((card, i) => (
                <div key={i} className="rounded-lg border bg-card px-4 py-3">
                  <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
                  <div className="mt-1.5 flex items-baseline gap-2">
                    <span className="text-2xl font-semibold">
                      {card.value.toLocaleString('tr-TR')}
                    </span>
                    <span className={`inline-block h-2 w-2 rounded-full ${card.color}`} />
                  </div>
                </div>
              ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
            {generating ? 'Oluşturuluyor...' : 'Otomatik Eşleştir'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkApprove}
            disabled={isPending || selectedCount === 0}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" /> Seçilenleri Onayla ({selectedCount})
          </Button>
        </div>

        <div className="rounded-md border border-border bg-card p-4">
          <AdminTableToolbar
            searchValue={searchValue}
            onSearchChange={(nextValue) => {
              setSearchValue(nextValue)
              setIsSearchPending(true)
              onSearch(nextValue)
            }}
            searchPlaceholder="Marka / sağlayıcı ara..."
            isSearchLoading={isSearchPending}
            onRefresh={() => void loadBrands(filtersRef.current)}
            isRefreshing={isFetching}
            onAdvancedFilter={() => setFiltersOpen(true)}
          />

          <AdminFilterBar onReset={hasActiveFilters ? resetFilters : undefined} className="mt-3">
            <AdminFilterChip
              label="Beklemede"
              active={filters.status === 'PENDING'}
              onClick={() => toggleChipFilter('status', 'PENDING', filters.status)}
            />
            <AdminFilterChip
              label="Onaylandı"
              active={filters.status === 'APPROVED'}
              onClick={() => toggleChipFilter('status', 'APPROVED', filters.status)}
            />
            <AdminFilterChip
              label="Tam Eşleşme"
              active={filters.matchSide === 'matched'}
              onClick={() => toggleChipFilter('matchSide', 'matched', filters.matchSide)}
            />
            <AdminFilterChip
              label="Sadece Dinamik"
              active={filters.matchSide === 'dinamik_only'}
              onClick={() => toggleChipFilter('matchSide', 'dinamik_only', filters.matchSide)}
            />
            <AdminFilterChip
              label="Sadece PT"
              active={filters.matchSide === 'pt_only'}
              onClick={() => toggleChipFilter('matchSide', 'pt_only', filters.matchSide)}
            />
            <AdminFilterChip
              label="Sadece Başbuğ"
              active={filters.matchSide === 'bsbg_only'}
              onClick={() => toggleChipFilter('matchSide', 'bsbg_only', filters.matchSide)}
            />
          </AdminFilterBar>
        </div>

        <DataTable
          columns={columns}
          data={brands}
          getRowId={(row) => String(row.id)}
          isLoading={isTableLoading}
          pagination={pagination}
          onPaginationChange={(page) => applyFilters({ page })}
          sorting={sorting}
          onSortingChange={handleSortingChange}
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          emptyMessage="Eşleştirme bulunamadı"
        />

        {detailBrand && (
          <Dialog open={detailDialogOpen} onOpenChange={(open) => { setDetailDialogOpen(open); if (!open) setDetailBrand(null) }}>
            <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-lg">{detailBrand.normalizedName}</DialogTitle>
                <DialogDescription>
                  Mapping ID: {detailBrand.id} &middot; Brand List ID: {detailBrand.brandListId}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sağlayıcılar</p>
                  <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm">
                    {detailBrand.dinamikBrand && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 border-primary/20 bg-primary/5 text-primary">Dinamik</Badge>
                        <span className="font-medium">{detailBrand.dinamikBrand}</span>
                      </div>
                    )}
                    {detailBrand.ptName && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 border-primary/20 bg-primary/5 text-primary">P-Tedarik</Badge>
                        <span className="font-medium">{detailBrand.ptName}</span>
                      </div>
                    )}
                    {detailBrand.bsbgBrand && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 border-primary/20 bg-primary/5 text-primary">Başbuğ</Badge>
                        <span className="font-medium">{detailBrand.bsbgBrand}</span>
                      </div>
                    )}
                    {!detailBrand.dinamikBrand && !detailBrand.ptName && !detailBrand.bsbgBrand && (
                      <span className="text-xs text-muted-foreground">Sağlayıcı bağlantısı yok</span>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Durum & Yöntem</p>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const st = STATUS_MAP[detailBrand.mappingStatus] ?? { label: detailBrand.mappingStatus, className: 'bg-muted text-muted-foreground border-border' }
                      return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${st.className}`}>{st.label}</span>
                    })()}
                    {detailBrand.matchMethod && (
                      <Badge variant="outline" className="border-success/20 bg-success/10 text-xs text-success">
                        {detailBrand.matchMethod}
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Eşleştir</p>
                  <div className="flex flex-wrap gap-2">
                    {!detailBrand.dinamikBrand && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setDetailDialogOpen(false); openMatchDialog('dinamik', detailBrand.id, detailBrand.brandListId) }}>
                        + Dinamik
                      </Button>
                    )}
                    {!detailBrand.ptName && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setDetailDialogOpen(false); openMatchDialog('pt', detailBrand.id, detailBrand.brandListId) }}>
                        + P-Tedarik
                      </Button>
                    )}
                    {!detailBrand.bsbgBrand && (
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setDetailDialogOpen(false); openMatchDialog('bsbg', detailBrand.id, detailBrand.brandListId) }}>
                        + Başbuğ
                      </Button>
                    )}
                    {detailBrand.dinamikBrand && detailBrand.ptName && detailBrand.bsbgBrand && (
                      <span className="text-xs text-muted-foreground">Tüm sağlayıcılar bağlı</span>
                    )}
                  </div>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}

        <Dialog open={matchDialogOpen} onOpenChange={(open) => { setMatchDialogOpen(open); if (!open) { setSelectedMatch(null); setMatchQuery(''); setMatchResults([]) } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Eşleştir: {SEARCH_LABELS[matchTarget].name}</DialogTitle>
              <DialogDescription>
                Eşleştirmek istediğiniz {SEARCH_LABELS[matchTarget].name.toLowerCase()} seçin.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {selectedMatch ? (
                <div className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm animate-in fade-in slide-in-from-top-1 duration-200">
                  <Check className="size-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{selectedMatch.name}</p>
                    <p className="text-xs text-muted-foreground">ID #{selectedMatch.id}</p>
                  </div>
                  <Button variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => { setSelectedMatch(null); setMatchQuery(''); setMatchResults([]) }}>
                    Değiştir
                  </Button>
                </div>
              ) : null}

              <div>
                <label htmlFor="match-search" className="mb-1.5 block text-sm font-medium">
                  {SEARCH_LABELS[matchTarget].name}
                </label>
                <Command
                  shouldFilter={false}
                  className="overflow-hidden rounded-md border border-border/60 bg-background"
                >
                  <CommandInput
                    id="match-search"
                    value={matchQuery}
                    onValueChange={(value) => {
                      setMatchQuery(value)
                      debouncedSearchMatchItems(value)
                    }}
                    placeholder={SEARCH_LABELS[matchTarget].placeholder}
                    className="h-9"
                  />
                  {(matchQuery.trim().length >= 2 || isSearchingMatch || matchResults.length > 0) && (
                    <CommandList className="max-h-48 border-t border-border/60">
                      {isSearchingMatch ? (
                        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                          <Loader2 className="size-4 animate-spin" />
                          Aranıyor...
                        </div>
                      ) : matchResults.length > 0 ? (
                        <CommandGroup>
                          {matchResults.map((item) => (
                            <CommandItem
                              key={item.id}
                              value={String(item.id)}
                              onSelect={() => {
                                setSelectedMatch(item)
                                setMatchQuery('')
                                setMatchResults([])
                              }}
                              className="cursor-pointer"
                            >
                              <span className="font-medium">{item.name}</span>
                              <span className="ml-auto text-xs text-muted-foreground">#{item.id}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      ) : (
                        <CommandEmpty className="py-6 text-sm">Sonuç bulunamadı</CommandEmpty>
                      )}
                    </CommandList>
                  )}
                </Command>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  En az 2 karakter yazarak arayın.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setMatchDialogOpen(false)} disabled={isUpdating}>
                İptal
              </Button>
              <Button onClick={() => void handleMatchSave()} disabled={!selectedMatch || isUpdating}>
                {isUpdating ? 'Kaydediliyor...' : 'Kaydet'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader>
              <DialogTitle>Gelişmiş Filtreler</DialogTitle>
              <DialogDescription>Marka ve eşleşme durumuna göre listeyi daraltın.</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <AdminFilterSelect
                label="Durum"
                value={filters.status}
                options={[
                  { value: 'all', label: 'Tümü' },
                  { value: 'PENDING', label: 'Beklemede' },
                  { value: 'APPROVED', label: 'Onaylandı' },
                  { value: 'REJECTED', label: 'Reddedildi' },
                  { value: 'IGNORED', label: 'Yoksayıldı' },
                ]}
                onChange={(value) => setFilterParam('status', value)}
              />
              <AdminFilterSelect
                label="Eşleşme Durumu"
                value={filters.matchSide}
                options={[
                  { value: 'all', label: 'Tümü' },
                  { value: 'matched', label: 'Tam Eşleşme' },
                  { value: 'dinamik_only', label: 'Sadece Dinamik (PT yok)' },
                  { value: 'pt_only', label: 'Sadece PT (Dinamik yok)' },
                  { value: 'bsbg_only', label: 'Sadece Başbuğ' },
                ]}
                onChange={(value) => setFilterParam('matchSide', value)}
              />
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={resetFilters}>
                Filtreleri Sıfırla
              </Button>
              <Button onClick={() => setFiltersOpen(false)}>
                Kapat
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  )
}