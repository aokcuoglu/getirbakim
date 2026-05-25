'use client'

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
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
import { AdminFormDialog } from '@/components/admin/admin-form-dialog'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DataTable } from './data-table'
import {
  BrandRow,
  createBrandsColumns,
  getBrandMatchSide,
} from './columns/brands-columns'

type MatchSide = 'all' | 'matched' | 'dinamik_only' | 'pt_only'

interface BrandFilters {
  q: string
  status: string
  dinamikBrand: string | null
  manufacturerId: number | null
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

interface BrandFilterOptions {
  dinamikBrands: string[]
  manufacturers: Array<{ id: number; name: string }>
}

interface Manufacturer {
  id: number
  name: string
}

type BrandUpdateTarget = 'pt' | 'dinamik'

const PT_MANUFACTURER_SEARCH_PATH = '/api/admin/eslestirme/brands/manufacturers'
const DINAMIK_BRAND_SEARCH_PATH = '/api/admin/eslestirme/brands/dinamik-brands'

/** Which catalog side the update modal assigns (missing side, or PT when paired). */
function getBrandUpdateTarget(row: BrandRow): BrandUpdateTarget | null {
  const side = getBrandMatchSide(row)
  if (side === 'empty') return null
  if (side === 'pt_only') return 'dinamik'
  return 'pt'
}

function getUpdateModalDescription(row: BrandRow): ReactNode {
  const side = getBrandMatchSide(row)
  if (side === 'dinamik_only') {
    return (
      <>
        &quot;{row.dinamikBrand}&quot; Dinamik markası için ParçaTedarik üreticisi seçin
      </>
    )
  }
  if (side === 'pt_only') {
    return (
      <>
        &quot;{row.parcatedarikManufacturerName}&quot; ParçaTedarik üreticisi için Dinamik marka
        seçin (Dinamik marka henüz bağlı değil)
      </>
    )
  }
  if (side === 'paired') {
    return (
      <>
        &quot;{row.dinamikBrand}&quot; ↔ &quot;{row.parcatedarikManufacturerName}&quot; eşleşmesinde
        ParçaTedarik üreticisini seçin
      </>
    )
  }
  return <>Eşleştirme tarafı seçin</>
}

function getUpdateSearchLabel(target: BrandUpdateTarget): string {
  return target === 'dinamik' ? 'Dinamik Marka' : 'ParçaTedarik Üretici'
}

function getUpdateSearchPlaceholder(target: BrandUpdateTarget): string {
  return target === 'dinamik' ? 'Dinamik marka adı ara...' : 'Üretici adı ara...'
}

const DEFAULT_BRAND_FILTERS: BrandFilters = {
  q: '',
  status: 'all',
  dinamikBrand: null,
  manufacturerId: null,
  matchSide: 'all',
  page: 1,
  limit: 50,
}

function buildBrandSearchParams(f: BrandFilters) {
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.status !== 'all') params.set('status', f.status)
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
  const [filterOptions, setFilterOptions] = useState<BrandFilterOptions>({
    dinamikBrands: [],
    manufacturers: [],
  })
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateTarget, setUpdateTarget] = useState<BrandRow | null>(null)
  const updateTargetRef = useRef<BrandRow | null>(null)
  const [updateSearchTarget, setUpdateSearchTarget] = useState<BrandUpdateTarget>('pt')
  const [selectedMatchItem, setSelectedMatchItem] = useState<Manufacturer | null>(null)
  const [matchItemQuery, setMatchItemQuery] = useState('')
  const [matchItemResults, setMatchItemResults] = useState<Manufacturer[]>([])
  const [isSearchingMatchItems, setIsSearchingMatchItems] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

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

  const loadFilterOptions = useCallback(async () => {
    setOptionsLoading(true)
    try {
      const res = await fetch('/api/admin/eslestirme/brands/options')
      if (res.ok) {
        const data = await res.json()
        if (!data.error) {
          setFilterOptions({
            dinamikBrands: data.dinamikBrands || [],
            manufacturers: data.manufacturers || [],
          })
        }
      }
    } catch {
      toast.error('Filtre seçenekleri yüklenemedi')
    } finally {
      setOptionsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBrands(filters)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void loadFilterOptions()
  }, [loadFilterOptions])

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
      name: keyof Pick<BrandFilters, 'status' | 'dinamikBrand' | 'manufacturerId' | 'matchSide'>,
      value?: string | null
    ) => {
      const patch: Partial<BrandFilters> = { page: 1 }
      if (name === 'status') {
        patch.status = value && value !== 'all' ? value : 'all'
      } else if (name === 'dinamikBrand') {
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
    applyFilters(DEFAULT_BRAND_FILTERS)
  }, [applyFilters])

  const toggleChipFilter = useCallback(
    (name: 'status' | 'matchSide', value: string, currentValue: string) => {
      setFilterParam(name, currentValue === value ? 'all' : value)
    },
    [setFilterParam]
  )

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

  const handleUpdate = useCallback(async () => {
    if (!updateTarget || !selectedMatchItem) return
    setIsUpdating(true)
    try {
      const body =
        updateSearchTarget === 'dinamik'
          ? { dinamikBrandId: selectedMatchItem.id }
          : { parcatedarikManufacturerId: selectedMatchItem.id }
      const res = await fetch(`/api/admin/eslestirme/brands/${updateTarget.id}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!data.error) {
        toast.success('Eşleştirme güncellendi')
        setUpdateDialogOpen(false)
        void loadBrands(filtersRef.current)
      } else toast.error(data.error?.message || 'Güncelleme başarısız')
    } catch {
      toast.error('Güncelleme başarısız')
    } finally {
      setIsUpdating(false)
    }
  }, [updateTarget, selectedMatchItem, updateSearchTarget, loadBrands])

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

  const handleBulkApprovePtOnly = useCallback(() => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/eslestirme/brands', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'bulk-approve-pt-only' }),
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || `${data.approved ?? 0} PT-only onaylandı`)
          setRowSelection({})
          void loadBrands(filtersRef.current)
        } else toast.error(data.error?.message || 'PT-only toplu onay başarısız')
      } catch {
        toast.error('PT-only toplu onay başarısız')
      }
    })
  }, [loadBrands])

  const searchMatchItems = useCallback(async (q: string) => {
    const trimmed = q.trim()
    if (!trimmed || trimmed.length < 2) {
      setMatchItemResults([])
      setIsSearchingMatchItems(false)
      return
    }

    const row = updateTargetRef.current
    const target = row ? getBrandUpdateTarget(row) : null
    if (!target) {
      setMatchItemResults([])
      setIsSearchingMatchItems(false)
      return
    }

    const searchPath =
      target === 'dinamik' ? DINAMIK_BRAND_SEARCH_PATH : PT_MANUFACTURER_SEARCH_PATH

    setIsSearchingMatchItems(true)
    try {
      const res = await fetch(
        `${searchPath}?q=${encodeURIComponent(trimmed)}&limit=20`
      )
      if (res.ok) {
        const data = await res.json()
        setMatchItemResults(Array.isArray(data) ? data : [])
      } else {
        setMatchItemResults([])
      }
    } catch {
      setMatchItemResults([])
    } finally {
      setIsSearchingMatchItems(false)
    }
  }, [])

  const debouncedSearchMatchItems = useDebouncedCallback((q: string) => {
    void searchMatchItems(q)
  }, 250)

  const resetUpdateDialog = useCallback(() => {
    setUpdateTarget(null)
    updateTargetRef.current = null
    setUpdateSearchTarget('pt')
    setSelectedMatchItem(null)
    setMatchItemQuery('')
    setMatchItemResults([])
    setIsSearchingMatchItems(false)
  }, [])

  const handleUpdateDialogOpenChange = useCallback(
    (open: boolean) => {
      setUpdateDialogOpen(open)
      if (!open) resetUpdateDialog()
    },
    [resetUpdateDialog]
  )

  const columns = createBrandsColumns({
    onAction: handleAction,
    onUpdate: (row) => {
      const target = getBrandUpdateTarget(row) ?? 'pt'
      updateTargetRef.current = row
      setUpdateTarget(row)
      setUpdateSearchTarget(target)
      setSelectedMatchItem(
        target === 'pt' && row.parcatedarikManufacturerId
          ? {
              id: row.parcatedarikManufacturerId,
              name:
                row.parcatedarikManufacturerName ||
                `Üretici #${row.parcatedarikManufacturerId}`,
            }
          : null
      )
      setMatchItemQuery('')
      setMatchItemResults([])
      setUpdateDialogOpen(true)
    },
  })

  const summaryCards = summary
    ? [
        { label: 'Toplam', value: summary.total, color: 'bg-muted-foreground' },
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
    filters.dinamikBrand != null ||
    filters.manufacturerId != null ||
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
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkApprovePtOnly}
            disabled={isPending}
            title="Dinamik karşılığı olmayan bekleyen PT-only markaları onayla"
          >
            <Check className="mr-1.5 h-3.5 w-3.5" /> PT-only Bekleyenleri Onayla
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
            searchPlaceholder="Marka / üretici ara..."
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
              label="PT Bekliyor"
              active={filters.matchSide === 'dinamik_only'}
              onClick={() => toggleChipFilter('matchSide', 'dinamik_only', filters.matchSide)}
            />
            <AdminFilterChip
              label="Dinamik Bekliyor"
              active={filters.matchSide === 'pt_only'}
              onClick={() => toggleChipFilter('matchSide', 'pt_only', filters.matchSide)}
            />
            <AdminFilterChip
              label="Tam Eşleşme"
              active={filters.matchSide === 'matched'}
              onClick={() => toggleChipFilter('matchSide', 'matched', filters.matchSide)}
            />
            <AdminFilterChip
              label="Onaylandı"
              active={filters.status === 'APPROVED'}
              onClick={() => toggleChipFilter('status', 'APPROVED', filters.status)}
            />
          </AdminFilterBar>

          {(filters.dinamikBrand || filters.manufacturerId) && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
              {filters.dinamikBrand && (
                <span className="rounded-sm border bg-muted/40 px-2.5 py-1">
                  Dinamik Marka:{' '}
                  <strong className="text-foreground">{filters.dinamikBrand}</strong>
                </span>
              )}
              {filters.manufacturerId && (
                <span className="rounded-sm border bg-muted/40 px-2.5 py-1">
                  PT Üretici:{' '}
                  <strong className="text-foreground">
                    {filterOptions.manufacturers.find((m) => m.id === filters.manufacturerId)
                      ?.name || filters.manufacturerId}
                  </strong>
                </span>
              )}
            </div>
          )}
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

        <AdminFormDialog
          open={updateDialogOpen}
          onOpenChange={handleUpdateDialogOpenChange}
          title="Eşleştirmeyi Değiştir"
          description={updateTarget ? getUpdateModalDescription(updateTarget) : undefined}
          onSave={handleUpdate}
          isSaving={isUpdating}
          saveDisabled={!selectedMatchItem}
          saveLabel="Kaydet"
          showClose
          footerLayout="row"
          size="md"
        >
          <div className="space-y-4">
            {selectedMatchItem ? (
              <div
                key={selectedMatchItem.id}
                className="flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm animate-in fade-in slide-in-from-top-1 duration-200"
              >
                <Check className="size-4 shrink-0 text-primary transition-transform duration-200" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{selectedMatchItem.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ID #{selectedMatchItem.id}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs transition-colors"
                  onClick={() => {
                    setSelectedMatchItem(null)
                    setMatchItemQuery('')
                    setMatchItemResults([])
                  }}
                >
                  Değiştir
                </Button>
              </div>
            ) : null}

            <div>
              <label
                htmlFor="match-item-search"
                className="mb-1.5 block text-sm font-medium"
              >
                {getUpdateSearchLabel(updateSearchTarget)}
              </label>
              <Command
                shouldFilter={false}
                className="overflow-hidden rounded-md border border-border/60 bg-background"
              >
                <CommandInput
                  id="match-item-search"
                  value={matchItemQuery}
                  onValueChange={(value) => {
                    setMatchItemQuery(value)
                    debouncedSearchMatchItems(value)
                  }}
                  placeholder={getUpdateSearchPlaceholder(updateSearchTarget)}
                  className="h-9"
                />
                {(matchItemQuery.trim().length >= 2 ||
                  isSearchingMatchItems ||
                  matchItemResults.length > 0) && (
                  <CommandList
                    className={cn(
                      'max-h-48 border-t border-border/60 transition-all duration-200',
                      matchItemResults.length > 0 || isSearchingMatchItems
                        ? 'animate-in fade-in slide-in-from-top-1'
                        : ''
                    )}
                  >
                    {isSearchingMatchItems ? (
                      <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        Aranıyor...
                      </div>
                    ) : matchItemResults.length > 0 ? (
                      <CommandGroup>
                        {matchItemResults.map((item) => (
                          <CommandItem
                            key={item.id}
                            value={String(item.id)}
                            onSelect={() => {
                              setSelectedMatchItem(item)
                              setMatchItemQuery('')
                              setMatchItemResults([])
                            }}
                            className="cursor-pointer transition-colors duration-150"
                          >
                            <span className="font-medium">{item.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              #{item.id}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ) : (
                      <CommandEmpty className="py-6 text-sm">
                        {updateSearchTarget === 'dinamik'
                          ? 'Eşleşen Dinamik marka bulunamadı'
                          : 'Eşleşen üretici bulunamadı'}
                      </CommandEmpty>
                    )}
                  </CommandList>
                )}
              </Command>
              <p className="mt-1.5 text-xs text-muted-foreground">
                En az 2 karakter yazarak {updateSearchTarget === 'dinamik' ? 'marka' : 'üretici'}{' '}
                adına göre arayın.
              </p>
            </div>
          </div>
        </AdminFormDialog>

        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[420px]">
            <SheetHeader>
              <SheetTitle>Gelişmiş Filtreler</SheetTitle>
              <SheetDescription>Marka ve eşleşme durumuna göre listeyi daraltın.</SheetDescription>
            </SheetHeader>

            <div className="space-y-3">
              <AdminFilterSelect
                label="Dinamik Marka"
                value={filters.dinamikBrand ?? 'all'}
                options={[
                  { value: 'all', label: 'Tümü' },
                  ...filterOptions.dinamikBrands.map((brand) => ({
                    value: brand,
                    label: brand,
                  })),
                ]}
                disabled={optionsLoading}
                placeholder={optionsLoading ? 'Markalar yükleniyor...' : 'Seçiniz'}
                onChange={(value) => setFilterParam('dinamikBrand', value)}
              />
              <AdminFilterSelect
                label="PT Üretici"
                value={filters.manufacturerId != null ? String(filters.manufacturerId) : 'all'}
                options={[
                  { value: 'all', label: 'Tümü' },
                  ...filterOptions.manufacturers.map((manufacturer) => ({
                    value: String(manufacturer.id),
                    label: manufacturer.name,
                  })),
                ]}
                disabled={optionsLoading}
                placeholder={optionsLoading ? 'Üreticiler yükleniyor...' : 'Seçiniz'}
                onChange={(value) => setFilterParam('manufacturerId', value)}
              />
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
                  { value: 'dinamik_only', label: 'PT Bekliyor (sadece Dinamik)' },
                  { value: 'pt_only', label: 'Dinamik Bekliyor (sadece PT)' },
                ]}
                onChange={(value) => setFilterParam('matchSide', value)}
              />
            </div>

            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={resetFilters}
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
      </div>
    </TooltipProvider>
  )
}
