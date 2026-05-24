'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SortingState } from '@tanstack/react-table'
import { useDebouncedCallback } from 'use-debounce'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminLoadingState } from '@/components/admin/admin-loading-state'
import { AdminFilterBar, AdminFilterChip } from '@/components/admin/data-table/admin-filter-chip'
import { AdminFilterSelect } from '@/components/admin/data-table/admin-filter-select'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DataTable } from './data-table'
import { ModelRow, createModelColumns } from './columns/model-columns'

type MatchSide = 'all' | 'matched' | 'dinamik_only' | 'pt_only'

interface ModelFilters {
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

interface ModelSummary {
  total: number
  approved: number
  pending: number
  rejected: number
  ignored: number
}

interface ModelFilterOptions {
  dinamikBrands: string[]
  manufacturers: Array<{ id: number; name: string }>
}

const DEFAULT_MODEL_FILTERS: ModelFilters = {
  q: '',
  status: 'all',
  dinamikBrand: null,
  manufacturerId: null,
  matchSide: 'all',
  page: 1,
  limit: 50,
}

function buildModelSearchParams(f: ModelFilters) {
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

export function ProductsTab() {
  const [models, setModels] = useState<ModelRow[]>([])
  const [summary, setSummary] = useState<ModelSummary | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState<ModelFilters>(DEFAULT_MODEL_FILTERS)
  const [searchValue, setSearchValue] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterOptions, setFilterOptions] = useState<ModelFilterOptions>({ dinamikBrands: [], manufacturers: [] })
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)

  useEffect(() => { filtersRef.current = filters }, [filters])

  const [linkOpen, setLinkOpen] = useState(false)
  const [linkTarget, setLinkTarget] = useState<ModelRow | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<any[]>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkLoaded, setLinkLoaded] = useState(false)

  const loadModels = useCallback(async (f: ModelFilters) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/eslestirme/models?${buildModelSearchParams(f)}`)
      if (!res.ok) { toast.error(`Eşleştirmeler yüklenemedi (${res.status})`); setLoading(false); return }
      const data = await res.json()
      if (!data.error) {
        setModels(data.rows || [])
        setPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 1 })
        setSummary(data.summary || null)
      }
    } catch { toast.error('Eşleştirmeler yüklenemedi') }
    setLoading(false)
  }, [])

  const loadFilterOptions = useCallback(async () => {
    setOptionsLoading(true)
    try {
      const res = await fetch('/api/admin/eslestirme/models/options')
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

  useEffect(() => { void loadModels(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadFilterOptions() }, [loadFilterOptions])

  useEffect(() => {
    setSearchValue(filters.q)
  }, [filters.q])

  const handleSortingChange = useCallback((next: SortingState) => {
    setSorting(next)
    if (next.length === 0) { void loadModels(filtersRef.current); return }
    const s = next[0]
    const patch: Partial<ModelFilters> = { sort: s.id, sort_dir: s.desc ? 'desc' : 'asc', page: 1 }
    const updated = { ...filtersRef.current, ...patch }
    setFilters(updated)
    void loadModels(updated)
  }, [loadModels])

  const applyFilters = useCallback((patch: Partial<ModelFilters>) => {
    const next = { ...filtersRef.current, ...patch }
    setFilters(next)
    void loadModels(next)
  }, [loadModels])

  const onSearch = useDebouncedCallback((term: string) => {
    setIsSearchPending(false)
    applyFilters({ q: term.trim(), page: 1 })
  }, 250)

  const setFilterParam = useCallback((
    name: keyof Pick<ModelFilters, 'status' | 'dinamikBrand' | 'manufacturerId' | 'matchSide'>,
    value?: string | null
  ) => {
    const patch: Partial<ModelFilters> = { page: 1 }
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
  }, [applyFilters])

  const resetFilters = useCallback(() => {
    setSearchValue('')
    setIsSearchPending(false)
    applyFilters(DEFAULT_MODEL_FILTERS)
  }, [applyFilters])

  const toggleChipFilter = useCallback((
    name: 'status' | 'matchSide',
    value: string,
    currentValue: string
  ) => {
    setFilterParam(name, currentValue === value ? 'all' : value)
  }, [setFilterParam])

  const handleAction = useCallback(async (id: number, action: string) => {
    try {
      const res = await fetch(`/api/admin/eslestirme/models/${id}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({})
      })
      const data = await res.json()
      if (!data.error) { toast.success(data.message || 'İşlem başarılı'); void loadModels(filtersRef.current) }
      else toast.error(data.error?.message || 'İşlem başarısız')
    } catch { toast.error('İşlem başarısız') }
  }, [loadModels])

  const handleGenerate = useCallback(() => {
    setGenerating(true)
    fetch('/api/admin/eslestirme/models', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apply: true })
    }).then(r => r.json()).then(data => {
      if (!data.error) { toast.success(data.message || 'Eşleştirmeler oluşturuldu'); void loadModels(filtersRef.current) }
      else toast.error(data.error?.message || 'Oluşturma başarısız')
    }).catch(() => toast.error('Oluşturma başarısız')).finally(() => setGenerating(false))
  }, [loadModels])

  const handleBulkApprove = useCallback(() => {
    const ids = Object.entries(rowSelection).filter(([, s]) => s).map(([id]) => Number(id))
    if (ids.length === 0) { toast.error('En az bir eşleştirme seçin'); return }
    fetch('/api/admin/eslestirme/models/bulk-approve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids })
    }).then(r => r.json()).then(data => {
      if (!data.error) { toast.success(data.message || `${data.approved} onaylandı`); setRowSelection({}); void loadModels(filtersRef.current) }
      else toast.error(data.error?.message || 'Başarısız')
    }).catch(() => toast.error('Başarısız'))
  }, [rowSelection, loadModels])

  const handleLink = useCallback((row: ModelRow) => {
    setLinkTarget(row)
    setLinkSearch('')
    setLinkResults([])
    setLinkLoaded(false)
    setLinkOpen(true)
  }, [])

  const loadLinkResults = useCallback(async (q: string, target: ModelRow | null) => {
    if (!target) { setLinkResults([]); return }
    setLinkLoading(true)
    try {
      const params = new URLSearchParams({ limit: '50' })
      if (q.trim().length >= 2) params.set('q', q.trim())
      if (target.productId && !target.dproductsId) {
        params.set('direction', 'from_product')
        params.set('productId', String(target.productId))
      } else {
        params.set('direction', 'from_dproducts')
        params.set('dproductsId', target.dproductsId || '0')
      }
      const res = await fetch(`/api/admin/eslestirme/models/search-dinamik?${params}`)
      if (res.ok) setLinkResults(await res.json())
      else setLinkResults([])
    } catch {
      setLinkResults([])
    } finally {
      setLinkLoading(false)
      setLinkLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (linkOpen && linkTarget) {
      void loadLinkResults('', linkTarget)
    }
  }, [linkOpen, linkTarget, loadLinkResults])

  const searchLink = useCallback(async (q: string) => {
    if (!linkTarget) { setLinkResults([]); return }
    if (q.trim().length === 1) return
    await loadLinkResults(q, linkTarget)
  }, [linkTarget, loadLinkResults])

  const handleManualLink = useCallback(async (targetId: string) => {
    if (!linkTarget) return
    const hasProduct = !!linkTarget.productId
    const body = hasProduct
      ? { dproductsId: targetId, productId: linkTarget.productId }
      : { dproductsId: linkTarget.dproductsId, productId: Number(targetId) }
    try {
      const res = await fetch('/api/admin/eslestirme/models/manual-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!data.error) { toast.success('Eşleştirildi'); setLinkOpen(false); void loadModels(filtersRef.current) }
      else toast.error(data.error?.message || 'Başarısız')
    } catch { toast.error('Başarısız') }
  }, [linkTarget, loadModels])

  const columns = createModelColumns({
    onAction: handleAction,
    onLinkProduct: () => {},
    onLinkDproducts: handleLink,
    onBulkApproveRows: () => {},
  })

  const summaryCards = summary ? [
    { label: 'Toplam', value: summary.total, color: 'bg-slate-500' },
    { label: 'Onaylandı', value: summary.approved, color: 'bg-emerald-500' },
    { label: 'Beklemede', value: summary.pending, color: 'bg-amber-500' },
    { label: 'Reddedildi', value: summary.rejected, color: 'bg-rose-500' },
    { label: 'Yoksayıldı', value: summary.ignored, color: 'bg-slate-400' },
  ] : []

  const selectedCount = Object.values(rowSelection).filter(Boolean).length

  const linkBrandName = linkTarget
    ? (linkTarget.dinamik.brand || linkTarget.parcatedarik.manufacturerName || '').trim()
    : ''
  const linkSearchTarget = linkTarget && linkTarget.productId && !linkTarget.dproductsId ? 'Dinamik' : 'PT'
  const linkEmptyMessage = linkBrandName
    ? `${linkBrandName} markasına ait ${linkSearchTarget} ürün bulunamadı.`
    : `Onaylı marka eşleşmesi bulunamadı; ${linkSearchTarget} ürün listelenemedi.`

  const isListUpdating = loading || isSearchPending
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
        {loading && !summary ? (
          <div className="col-span-full">
            <AdminLoadingState minHeight="min-h-[120px]" label="Özet yükleniyor..." />
          </div>
        ) : summaryCards.map((c, i) => (
          <div key={i} className="rounded-xl border bg-card px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground">{c.label}</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{c.value.toLocaleString('tr-TR')}</span>
              <span className={`inline-block h-2 w-2 rounded-full ${c.color}`} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Oluşturuluyor...' : 'Populate & Eşleştir'}
        </Button>
        <Button variant="outline" size="sm" onClick={handleBulkApprove} disabled={selectedCount === 0}>
          <Check className="mr-1.5 h-3.5 w-3.5" /> Seçilenleri Onayla ({selectedCount})
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            setIsSearchPending(true)
            onSearch(nextValue)
          }}
          searchPlaceholder="Stok kodu / ad / ürün ara..."
          isSearchLoading={isListUpdating}
          onRefresh={() => void loadModels(filtersRef.current)}
          isRefreshing={loading}
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
              <span className="rounded-full border bg-muted/40 px-2.5 py-1">
                Dinamik Marka: <strong className="text-foreground">{filters.dinamikBrand}</strong>
              </span>
            )}
            {filters.manufacturerId && (
              <span className="rounded-full border bg-muted/40 px-2.5 py-1">
                PT Üretici:{' '}
                <strong className="text-foreground">
                  {filterOptions.manufacturers.find((m) => m.id === filters.manufacturerId)?.name || filters.manufacturerId}
                </strong>
              </span>
            )}
          </div>
        )}
      </div>

      <DataTable
        columns={columns}
        data={models}
        getRowId={(row) => String(row.id)}
        isLoading={loading}
        pagination={pagination}
        onPaginationChange={(page) => applyFilters({ page })}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        emptyMessage="Eşleştirme bulunamadı"
      />

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eşleştir</DialogTitle>
            <DialogDescription>
              {linkTarget && !linkTarget.dproductsId && linkTarget.productId && 'Bu PT ürüne Dinamik karşılığı ara'}
              {linkTarget && linkTarget.dproductsId && !linkTarget.productId && 'Bu Dinamik ürüne PT karşılığı ara'}
              {linkTarget && linkTarget.dproductsId && linkTarget.productId && 'Mevcut eşleşmeyi değiştir'}
            </DialogDescription>
          </DialogHeader>
          {linkTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded border p-3 space-y-1 text-sm bg-muted/30">
                {linkTarget.dproductsId && (
                  <p className="font-medium font-mono">{linkTarget.dinamik.stockCode || '—'}</p>
                )}
                {linkTarget.productId && (
                  <p className="font-medium">{linkTarget.parcatedarik.title?.slice(0, 60) || '—'}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {linkTarget.dinamik.brand || linkTarget.parcatedarik.manufacturerName || ''}
                </p>
              </div>
              <Input
                value={linkSearch}
                onChange={e => { setLinkSearch(e.target.value); searchLink(e.target.value) }}
                placeholder={linkTarget.productId && !linkTarget.dproductsId ? 'Dinamik ürün ara...' : 'PT ürün ara...'}
                className="h-9"
                autoFocus
              />
              {linkBrandName && (
                <p className="text-xs text-muted-foreground">
                  {linkSearch.trim().length >= 2
                    ? `"${linkSearch.trim()}" araması — ${linkBrandName} markası`
                    : `${linkBrandName} markasına ait ${linkSearchTarget} ürünler`}
                </p>
              )}
              {linkLoading && (
                <p className="text-sm text-muted-foreground py-2 text-center">Yükleniyor...</p>
              )}
              {!linkLoading && linkLoaded && linkResults.length === 0 && (
                <div className="rounded border border-dashed p-4 text-center text-sm text-muted-foreground">
                  <p>{linkEmptyMessage}</p>
                  {linkBrandName && (
                    <p className="mt-1 text-xs">Arama kutusunu kullanarak farklı bir terim deneyebilirsiniz.</p>
                  )}
                </div>
              )}
              {!linkLoading && linkResults.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded border p-1">
                  {linkResults.map((r: any) => (
                    <button key={r.id} className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => handleManualLink(r.id)}>
                      {r.stockCode !== undefined ? (
                        <div className="min-w-0">
                          <p className="font-medium font-mono">{r.stockCode}</p>
                          <p className="text-xs text-muted-foreground">{r.brand || '-'} — {r.stockName || '-'}</p>
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <p className="text-sm">{(r.title || '-').slice(0, 60)}</p>
                          <p className="text-xs text-muted-foreground">{r.manufacturerName || '-'} — model: {r.model || '-'}</p>
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>Gelişmiş Filtreler</SheetTitle>
            <SheetDescription>
              Marka ve eşleşme durumuna göre listeyi daraltın.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-6 space-y-3">
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

          <div className="mt-6 flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={resetFilters}>
              Filtreleri Sıfırla
            </Button>
            <Button type="button" className="flex-1" onClick={() => setFiltersOpen(false)}>
              Kapat
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  )
}
