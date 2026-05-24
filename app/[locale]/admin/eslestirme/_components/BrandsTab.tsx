'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Check, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { SortingState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable } from './data-table'
import { BrandRow, createBrandsColumns } from './columns/brands-columns'

interface BrandFilters { q: string; status: string; page: number; limit: number; sort?: string; sort_dir?: string }

interface BrandSummary {
  total: number; approved: number; pending: number; rejected: number; ignored: number
  totalDinamikBrands: number; totalPcManufacturers: number; matchedBrands: number; unmatchedBrands: number
}

interface Manufacturer { id: number; name: string }

export function BrandsTab() {
  const [isPending, startTransition] = useTransition()
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [summary, setSummary] = useState<BrandSummary | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [filters, setFilters] = useState<BrandFilters>({ q: '', status: 'all', page: 1, limit: 50 })
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const filtersRef = useRef(filters)
  const hasLoadedRef = useRef(false)
  useEffect(() => { filtersRef.current = filters }, [filters])

  const loadBrands = useCallback(async (f: BrandFilters) => {
    const isInitialLoad = !hasLoadedRef.current
    if (isInitialLoad) setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.q) params.set('q', f.q)
      if (f.status !== 'all') params.set('status', f.status)
      params.set('page', String(f.page))
      params.set('limit', String(f.limit))
      if (f.sort) { params.set('sort', f.sort); params.set('sort_dir', f.sort_dir || 'asc') }
      const res = await fetch(`/api/admin/eslestirme/brands?${params}`)
      if (!res.ok) {
        toast.error(`Eşleştirmeler yüklenemedi (${res.status})`)
        if (isInitialLoad) setLoading(false)
        return
      }
      const data = await res.json()
      if (!data.error) {
        setBrands(data.rows || [])
        setPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 1 })
        setSummary(data.summary || null)
      }
    } catch { toast.error('Eşleştirmeler yüklenemedi') }
    hasLoadedRef.current = true
    setHasLoaded(true)
    setLoading(false)
  }, [])

  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateTarget, setUpdateTarget] = useState<BrandRow | null>(null)
  const [manufacturerSearch, setManufacturerSearch] = useState('')
  const [manufacturerResults, setManufacturerResults] = useState<Manufacturer[]>([])

  useEffect(() => { void loadBrands(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSortingChange = useCallback((next: SortingState) => {
    setSorting(next)
    if (next.length === 0) { void loadBrands(filtersRef.current); return }
    const s = next[0]
    const patch: Partial<BrandFilters> = { sort: s.id, sort_dir: s.desc ? 'desc' : 'asc', page: 1 }
    const f = { ...filtersRef.current, ...patch }
    setFilters(f)
    void loadBrands(f)
  }, [loadBrands])

  const applyFilters = useCallback((patch: Partial<BrandFilters>) => {
    const next = { ...filtersRef.current, ...patch }
    setFilters(next)
    void loadBrands(next)
  }, [loadBrands])

  const handleAction = useCallback(async (id: number, action: string) => {
    try {
      const res = await fetch(`/api/admin/eslestirme/brands/${id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const data = await res.json()
      if (!data.error) { toast.success(data.message || `İşlem başarılı`); void loadBrands(filtersRef.current) }
      else toast.error(data.error?.message || 'İşlem başarısız')
    } catch { toast.error('İşlem başarısız') }
  }, [loadBrands])

  const handleUpdate = useCallback(async () => {
    if (!updateTarget || !manufacturerSearch) return
    const mfrId = parseInt(manufacturerSearch, 10)
    if (isNaN(mfrId)) return
    try {
      const res = await fetch(`/api/admin/eslestirme/brands/${updateTarget.id}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ parcatedarikManufacturerId: mfrId }) })
      const data = await res.json()
      if (!data.error) { toast.success('Eşleştirme güncellendi'); setUpdateDialogOpen(false); void loadBrands(filtersRef.current) }
      else toast.error(data.error?.message || 'Güncelleme başarısız')
    } catch { toast.error('Güncelleme başarısız') }
  }, [updateTarget, manufacturerSearch, loadBrands])

  const handleGenerate = useCallback(() => {
    setGenerating(true)
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/eslestirme/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate' }) })
        const data = await res.json()
        if (!data.error) { toast.success('Marka eşleştirmeleri oluşturuldu'); void loadBrands(filtersRef.current) }
        else toast.error(data.error?.message || 'Oluşturma başarısız')
      } catch { toast.error('Oluşturma başarısız') }
      setGenerating(false)
    })
  }, [loadBrands])

  const handleBulkApprove = useCallback(() => {
    const ids = Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id))
    if (ids.length === 0) { toast.error('En az bir eşleştirme seçin'); return }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/eslestirme/brands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk-approve', ids, minConfidence: 0.85 }) })
        const data = await res.json()
        if (!data.error) { toast.success(data.message || `${data.approved} eşleştirme onaylandı`); setRowSelection({}); void loadBrands(filtersRef.current) }
        else toast.error(data.error?.message || 'Toplu onay başarısız')
      } catch { toast.error('Toplu onay başarısız') }
    })
  }, [rowSelection, loadBrands])

  const searchManufacturers = useCallback(async (q: string) => {
    if (!q || q.length < 2) { setManufacturerResults([]); return }
    try {
      const res = await fetch(`/api/admin/eslestirme/brands/manufacturers?q=${encodeURIComponent(q)}&limit=20`)
      if (res.ok) setManufacturerResults(await res.json())
    } catch {}
  }, [])

  const columns = createBrandsColumns({
    onAction: handleAction,
    onUpdate: (row) => { setUpdateTarget(row); setManufacturerSearch(String(row.parcatedarikManufacturerId)); setUpdateDialogOpen(true) },
  })

  const summaryCards = summary ? [
    { label: 'Toplam', value: summary.total, color: 'bg-muted-foreground' },
    { label: 'Dinamik Markalar', value: summary.totalDinamikBrands, color: 'bg-primary' },
    { label: 'PT Üreticiler', value: summary.totalPcManufacturers, color: 'bg-secondary' },
    { label: 'Eşleşen', value: summary.matchedBrands, color: 'bg-success' },
    { label: 'Beklemede', value: summary.pending, color: 'bg-warning' },
    { label: 'Onaylandı', value: summary.approved, color: 'bg-success' },
    { label: 'Reddedildi', value: summary.rejected, color: 'bg-destructive' },
    { label: 'Eşleşmeyen', value: summary.unmatchedBrands, color: 'bg-warning' },
  ] : []

  const isInitialLoading = !hasLoaded && loading

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {isInitialLoading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border bg-card px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))
        ) : summaryCards.map((card, i) => (
          <div key={i} className="rounded-xl border bg-card px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{typeof card.value === 'number' ? card.value.toLocaleString('tr-TR') : card.value}</span>
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
        <Button variant="outline" size="sm" onClick={handleBulkApprove} disabled={isPending || Object.values(rowSelection).filter(Boolean).length === 0}>
          <Check className="mr-1.5 h-3.5 w-3.5" /> Seçilenleri Onayla ({Object.values(rowSelection).filter(Boolean).length})
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-64">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground"><Search className="mr-1 inline h-3 w-3" />Marka / Üretici Ara</label>
          <Input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') applyFilters({ q: filters.q }) }} placeholder="Ara..." className="h-8 text-sm" />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Durum</label>
          <Select value={filters.status} onValueChange={v => applyFilters({ status: v, page: 1 })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="pending">Beklemede</SelectItem>
              <SelectItem value="approved">Onaylandı</SelectItem>
              <SelectItem value="rejected">Reddedildi</SelectItem>
              <SelectItem value="ignored">Yoksayıldı</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => applyFilters({ q: filters.q })}><Search className="mr-1.5 h-3.5 w-3.5" />Filtrele</Button>
      </div>

      <DataTable
        columns={columns}
        data={brands}
        getRowId={(row) => String(row.id)}
        isLoading={isInitialLoading}
        pagination={pagination}
        onPaginationChange={(page) => applyFilters({ page })}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        emptyMessage="Eşleştirme bulunamadı"
      />

      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eşleştirmeyi Değiştir</DialogTitle>
            <DialogDescription>{updateTarget && <span>&quot;{updateTarget.dinamikBrand}&quot; markası için ParçaTedarik üreticisi değiştir</span>}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">ParçaTedarik Üretici ID veya Adı</label>
              <Input value={manufacturerSearch} onChange={e => { setManufacturerSearch(e.target.value); if (e.target.value.length >= 2) void searchManufacturers(e.target.value) }} placeholder="Üretici adı veya ID ara..." className="h-9" />
            </div>
            {manufacturerResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded border p-1">
                {manufacturerResults.map(mfr => (
                  <button key={mfr.id} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setManufacturerSearch(String(mfr.id)); setManufacturerResults([]) }}>
                    <span className="text-muted-foreground">#{mfr.id}</span><span className="font-medium">{mfr.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setUpdateDialogOpen(false)}>İptal</Button>
            <Button size="sm" onClick={handleUpdate} disabled={isPending}>{isPending ? 'Kaydediliyor...' : 'Kaydet'}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
