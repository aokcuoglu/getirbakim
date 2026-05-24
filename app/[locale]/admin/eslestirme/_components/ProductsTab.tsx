'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, RefreshCw, Search, Link2 } from 'lucide-react'
import { toast } from 'sonner'
import { SortingState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable } from './data-table'
import { ModelRow, createModelColumns } from './columns/model-columns'

interface ModelFilters {
  q: string
  status: string
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

export function ProductsTab() {
  const [models, setModels] = useState<ModelRow[]>([])
  const [summary, setSummary] = useState<ModelSummary | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState<ModelFilters>({ q: '', status: 'all', page: 1, limit: 50 })
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])

  const [linkDialogOpen, setLinkDialogOpen] = useState(false)
  const [linkTarget, setLinkTarget] = useState<ModelRow | null>(null)
  const [linkSearchQ, setLinkSearchQ] = useState('')
  const [linkSearchResults, setLinkSearchResults] = useState<Array<{ id: string; stockCode: string; stockName: string | null; brand: string | null }>>([])
  const [linkDirection, setLinkDirection] = useState<'from_product' | 'from_dproducts'>('from_product')

  const loadModels = useCallback(async (f: ModelFilters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.q) params.set('q', f.q)
      if (f.status !== 'all') params.set('status', f.status)
      params.set('page', String(f.page))
      params.set('limit', String(f.limit))
      if (f.sort) { params.set('sort', f.sort); params.set('sort_dir', f.sort_dir || 'asc') }
      const res = await fetch(`/api/admin/eslestirme/models?${params}`)
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

  useEffect(() => { void loadModels(filters) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSortingChange = useCallback((next: SortingState) => {
    setSorting(next)
    if (next.length === 0) { void loadModels(filtersRef.current); return }
    const s = next[0]
    const patch: Partial<ModelFilters> = { sort: s.id, sort_dir: s.desc ? 'desc' : 'asc', page: 1 }
    const f = { ...filtersRef.current, ...patch }
    setFilters(f)
    void loadModels(f)
  }, [loadModels])

  const applyFilters = useCallback((patch: Partial<ModelFilters>) => {
    const next = { ...filtersRef.current, ...patch }
    setFilters(next)
    void loadModels(next)
  }, [loadModels])

  const handleAction = useCallback(async (id: number, action: string) => {
    try {
      const res = await fetch(`/api/admin/eslestirme/models/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const data = await res.json()
      if (!data.error) { toast.success(data.message || 'İşlem başarılı'); void loadModels(filtersRef.current) }
      else toast.error(data.error?.message || 'İşlem başarısız')
    } catch { toast.error('İşlem başarısız') }
  }, [loadModels])

  const handleGenerate = useCallback(() => {
    setGenerating(true)
    try {
      fetch('/api/admin/eslestirme/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true })
      })
        .then(res => res.json())
        .then(data => {
          if (!data.error) { toast.success(data.message || 'Eşleştirmeler oluşturuldu'); void loadModels(filtersRef.current) }
          else toast.error(data.error?.message || 'Oluşturma başarısız')
        })
        .catch(() => toast.error('Oluşturma başarısız'))
        .finally(() => setGenerating(false))
    } catch {
      toast.error('Oluşturma başarısız')
      setGenerating(false)
    }
  }, [loadModels])

  const handleBulkApprove = useCallback(() => {
    const ids = Object.entries(rowSelection)
      .filter(([, selected]) => selected)
      .map(([id]) => Number(id))
    if (ids.length === 0) { toast.error('En az bir eşleştirme seçin'); return }
    fetch('/api/admin/eslestirme/models/bulk-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    })
      .then(res => res.json())
      .then(data => {
        if (!data.error) { toast.success(data.message || `${data.approved} eşleştirme onaylandı`); setRowSelection({}); void loadModels(filtersRef.current) }
        else toast.error(data.error?.message || 'Toplu onay başarısız')
      })
      .catch(() => toast.error('Toplu onay başarısız'))
  }, [rowSelection, loadModels])

  const handleLinkDproducts = useCallback((row: ModelRow) => {
    setLinkTarget(row)
    setLinkSearchQ('')
    setLinkSearchResults([])
    setLinkDirection('from_product')
    setLinkDialogOpen(true)
  }, [])

  const searchLinkTargets = useCallback(async (q: string) => {
    if (!q || q.length < 2 || !linkTarget) { setLinkSearchResults([]); return }
    try {
      const params = new URLSearchParams({ q, limit: '20' })
      if (linkDirection === 'from_product') {
        params.set('direction', 'from_product')
        params.set('productId', String(linkTarget.productId))
      } else {
        params.set('direction', 'from_dproducts')
        params.set('dproductsId', linkTarget.dproductsId)
      }
      const res = await fetch(`/api/admin/eslestirme/models/search-dinamik?${params}`)
      if (res.ok) setLinkSearchResults(await res.json())
    } catch {}
  }, [linkTarget, linkDirection])

  const handleManualLink = useCallback(async (targetId: string) => {
    if (!linkTarget) return
    try {
      const body = linkDirection === 'from_product'
        ? { dproductsId: targetId, productId: linkTarget.productId }
        : { dproductsId: linkTarget.dproductsId, productId: Number(targetId) }
      const res = await fetch('/api/admin/eslestirme/models/manual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!data.error) {
        toast.success('Manuel eşleştirme yapıldı')
        setLinkDialogOpen(false)
        void loadModels(filtersRef.current)
      } else toast.error(data.error?.message || 'Eşleştirme başarısız')
    } catch { toast.error('Eşleştirme başarısız') }
  }, [linkTarget, linkDirection, loadModels])

  const columns = createModelColumns({
    onAction: handleAction,
    onLinkProduct: () => {},
    onLinkDproducts: handleLinkDproducts,
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

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading && !summary ? Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card px-4 py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-16" />
          </div>
        )) : summaryCards.map((card, i) => (
          <div key={i} className="rounded-xl border bg-card px-4 py-3">
            <div className="text-xs font-medium text-muted-foreground">{card.label}</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{card.value.toLocaleString('tr-TR')}</span>
              <span className={`inline-block h-2 w-2 rounded-full ${card.color}`} />
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

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground"><Search className="mr-1 inline h-3 w-3" />Stok Kodu / Ad / Ürün Ara</label>
          <Input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') applyFilters({ q: filters.q, page: 1 }) }} placeholder="Ara..." className="h-8 text-sm" />
        </div>
        <div className="w-40">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Durum</label>
          <Select value={filters.status} onValueChange={v => applyFilters({ status: v, page: 1 })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tümü</SelectItem>
              <SelectItem value="PENDING">Beklemede</SelectItem>
              <SelectItem value="APPROVED">Onaylandı</SelectItem>
              <SelectItem value="REJECTED">Reddedildi</SelectItem>
              <SelectItem value="IGNORED">Yoksayıldı</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" className="h-8" onClick={() => applyFilters({ page: 1 })}>Filtrele</Button>
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

      <Dialog open={linkDialogOpen} onOpenChange={setLinkDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manuel Eşleştir</DialogTitle>
            <DialogDescription>
              {linkTarget && (
                <span>
                  Mevcut eşleşmeyi değiştirmek için farklı bir ürün ara
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          {linkTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded border p-3 space-y-1 text-sm">
                {linkDirection === 'from_product' ? (
                  <>
                    <p className="font-medium">PT Ürün: {linkTarget.parcatedarik.title?.slice(0, 80)}</p>
                    <p className="text-xs text-muted-foreground">{linkTarget.parcatedarik.manufacturerName}</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium font-mono">Dinamik: {linkTarget.dinamik.stockCode}</p>
                    <p className="text-xs text-muted-foreground">{linkTarget.dinamik.brand}</p>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant={linkDirection === 'from_product' ? 'default' : 'outline'} size="sm" onClick={() => { setLinkDirection('from_product'); setLinkSearchQ(''); setLinkSearchResults([]) }}>
                  PT → Dinamik
                </Button>
                <Button variant={linkDirection === 'from_dproducts' ? 'default' : 'outline'} size="sm" onClick={() => { setLinkDirection('from_dproducts'); setLinkSearchQ(''); setLinkSearchResults([]) }}>
                  Dinamik → PT
                </Button>
              </div>
              <div>
                <Input
                  value={linkSearchQ}
                  onChange={e => { setLinkSearchQ(e.target.value); searchLinkTargets(e.target.value) }}
                  placeholder={linkDirection === 'from_product' ? 'Dinamik ürün ara (stok kodu/ad)...' : 'PT ürün ara (başlık/model)...'}
                  className="h-9"
                  autoFocus
                />
              </div>
              {linkSearchResults.length > 0 && (
                <div className="max-h-56 overflow-y-auto rounded border p-1">
                  {linkSearchResults.map((r: any) => (
                    <button
                      key={r.id}
                      className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                      onClick={() => handleManualLink(r.id)}
                    >
                      {linkDirection === 'from_product' ? (
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
    </div>
  )
}
