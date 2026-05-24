'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { SortingState } from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AdminLoadingState } from '@/components/admin/admin-loading-state'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
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

  const [linkOpen, setLinkOpen] = useState(false)
  const [linkTarget, setLinkTarget] = useState<ModelRow | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<any[]>([])

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
    void loadModels({ ...filtersRef.current, ...patch })
  }, [loadModels])

  const applyFilters = useCallback((patch: Partial<ModelFilters>) => {
    const next = { ...filtersRef.current, ...patch }
    setFilters(next)
    void loadModels(next)
  }, [loadModels])

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
    setLinkOpen(true)
  }, [])

  const searchLink = useCallback(async (q: string) => {
    if (!q || q.length < 2 || !linkTarget) { setLinkResults([]); return }
    const params = new URLSearchParams({ q, limit: '20' })
    // If this row has only productId (PT product), search dproducts
    if (linkTarget.productId && !linkTarget.dproductsId) {
      params.set('direction', 'from_product')
      params.set('productId', String(linkTarget.productId))
    } else {
      // If this row has dproductsId (Dinamik), search products
      params.set('direction', 'from_dproducts')
      params.set('dproductsId', linkTarget.dproductsId || '0')
    }
    try {
      const res = await fetch(`/api/admin/eslestirme/models/search-dinamik?${params}`)
      if (res.ok) setLinkResults(await res.json())
    } catch {}
  }, [linkTarget])

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

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground"><Search className="mr-1 inline h-3 w-3" />Ara</label>
          <Input value={filters.q} onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') applyFilters({ q: filters.q, page: 1 }) }} placeholder="Stok kodu / ad / ürün..." className="h-8 text-sm" />
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
              {linkResults.length > 0 && (
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
    </div>
    </TooltipProvider>
  )
}
