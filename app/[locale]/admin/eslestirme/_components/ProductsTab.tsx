'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { SortingState } from '@tanstack/react-table'
import { useDebouncedCallback } from 'use-debounce'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { AdminFilterBar } from '@/components/admin/data-table/admin-filter-chip'
import { AdminFilterSelect } from '@/components/admin/data-table/admin-filter-select'
import { AdminTableToolbar } from '@/components/admin/data-table/admin-table-toolbar'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import { TooltipProvider } from '@/components/ui/tooltip'
import { DataTable } from './data-table'
import { ModelRow, createModelColumns } from './columns/model-columns'

type MatchSide = 'all' | 'matched' | 'dinamik_only' | 'pt_only'

interface ModelFilters {
  q: string
  status: string
  dinamikBrand: string | null
  canonicalBrand: string | null
  bsbgBrand: string | null
  manufacturerId: number | null
  matchSide: MatchSide
  matchMethod: string
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
  canonicalBrands: string[]
  bsbgBrands: string[]
}

const DEFAULT_MODEL_FILTERS: ModelFilters = {
  q: '',
  status: 'all',
  dinamikBrand: null,
  canonicalBrand: null,
  bsbgBrand: null,
  manufacturerId: null,
  matchSide: 'all',
  matchMethod: 'all',
  page: 1,
  limit: 50,
}

function buildModelSearchParams(f: ModelFilters) {
  const params = new URLSearchParams()
  if (f.q) params.set('q', f.q)
  if (f.status !== 'all') params.set('status', f.status)
  if (f.dinamikBrand) params.set('dinamikBrand', f.dinamikBrand)
  if (f.canonicalBrand) params.set('canonicalBrand', f.canonicalBrand)
  if (f.bsbgBrand) params.set('bsbgBrand', f.bsbgBrand)
  if (f.manufacturerId) params.set('manufacturerId', String(f.manufacturerId))
  if (f.matchSide !== 'all') params.set('matchSide', f.matchSide)
  if (f.matchMethod !== 'all') params.set('matchMethod', f.matchMethod)
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
  const [initialLoading, setInitialLoading] = useState(true)
  const [isFetching, setIsFetching] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [, startTransition] = useTransition()
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState<ModelFilters>(DEFAULT_MODEL_FILTERS)
  const [searchValue, setSearchValue] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterOptions, setFilterOptions] = useState<ModelFilterOptions>({ dinamikBrands: [], manufacturers: [], canonicalBrands: [], bsbgBrands: [] })
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [isSearchPending, setIsSearchPending] = useState(false)
  const filtersRef = useRef(filters)
  const hasLoadedRef = useRef(false)

  useEffect(() => { filtersRef.current = filters }, [filters])

  const [linkOpen, setLinkOpen] = useState(false)
  const [linkTarget, setLinkTarget] = useState<ModelRow | null>(null)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<any[]>([])
  const [linkLoading, setLinkLoading] = useState(false)
  const [linkLoaded, setLinkLoaded] = useState(false)
  const linkAbortRef = useRef<AbortController | null>(null)

  const [detailRow, setDetailRow] = useState<ModelRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [oemResults, setOemResults] = useState<any[]>([])
  const [oemLoading, setOemLoading] = useState(false)
  const [oemSaving, setOemSaving] = useState<Record<string, boolean>>({})
  const [savedOems, setSavedOems] = useState<any[]>([])
  const [savedOemDeleting, setSavedOemDeleting] = useState<Record<number, boolean>>({})

  const [manualOemInput, setManualOemInput] = useState('')
  const [manualOemPreviews, setManualOemPreviews] = useState<any[]>([])
  const [manualOemPreviewLoading, setManualOemPreviewLoading] = useState(false)
  const [manualOemSaving, setManualOemSaving] = useState(false)
  const [mappingBrandListId, setMappingBrandListId] = useState<number | null>(null)

  const loadModels = useCallback(async (f: ModelFilters) => {
    const isInitial = !hasLoadedRef.current
    if (isInitial) setInitialLoading(true)
    else setIsFetching(true)

    try {
      const res = await fetch(`/api/admin/eslestirme/models?${buildModelSearchParams(f)}`)
      if (!res.ok) {
        toast.error(`Eşleştirmeler yüklenemedi (${res.status})`)
        return
      }
      const data = await res.json()
      if (!data.error) {
        setModels(data.rows || [])
        setPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 1 })
        setSummary(data.summary || null)
      }
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
      const res = await fetch('/api/admin/eslestirme/models/options')
      if (res.ok) {
        const data = await res.json()
        if (!data.error) {
          setFilterOptions({
            dinamikBrands: data.dinamikBrands || [],
            manufacturers: data.manufacturers || [],
            canonicalBrands: data.canonicalBrands || [],
            bsbgBrands: data.bsbgBrands || [],
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
    name: keyof Pick<ModelFilters, 'status' | 'dinamikBrand' | 'canonicalBrand' | 'bsbgBrand' | 'manufacturerId' | 'matchSide' | 'matchMethod'>,
    value?: string | null
  ) => {
    const patch: Partial<ModelFilters> = { page: 1 }
    if (name === 'status') {
      patch.status = value && value !== 'all' ? value : 'all'
    } else if (name === 'dinamikBrand') {
      patch.dinamikBrand = value && value !== 'all' ? value : null
    } else if (name === 'canonicalBrand') {
      patch.canonicalBrand = value && value !== 'all' ? value : null
    } else if (name === 'bsbgBrand') {
      patch.bsbgBrand = value && value !== 'all' ? value : null
    } else if (name === 'manufacturerId') {
      patch.manufacturerId = value && value !== 'all' ? Number(value) : null
    } else if (name === 'matchSide') {
      patch.matchSide = (value as MatchSide) || 'all'
    } else if (name === 'matchMethod') {
      patch.matchMethod = value && value !== 'all' ? value : 'all'
    }
    applyFilters(patch)
  }, [applyFilters])

  const resetFilters = useCallback(() => {
    setSearchValue('')
    setIsSearchPending(false)
    applyFilters(DEFAULT_MODEL_FILTERS)
  }, [applyFilters])

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
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/eslestirme/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate', apply: true }),
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || 'Eşleştirmeler oluşturuldu')
          void loadModels(filtersRef.current)
        } else toast.error(data.error?.message || 'Oluşturma başarısız')
      } catch {
        toast.error('Oluşturma başarısız')
      } finally {
        setGenerating(false)
      }
    })
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

  function getInitialLinkSearch(row: ModelRow): string {
    if (row.dnprdId) {
      return row.dinamik.barcode1 || row.dinamik.partNo || row.dinamik.stockCode || ''
    }
    return row.parcatedarik.model || row.parcatedarik.refNo?.split(',')[0]?.trim() || ''
  }

  const loadLinkResults = useCallback(async (q: string, target: ModelRow | null) => {
    if (!target) { setLinkResults([]); return }

    linkAbortRef.current?.abort()
    const controller = new AbortController()
    linkAbortRef.current = controller

    setLinkLoading(true)
    try {
      const params = new URLSearchParams({ limit: '30' })
      if (q.trim().length >= 2) params.set('q', q.trim())
      if (target.productId && !target.dnprdId) {
        params.set('direction', 'from_product')
        params.set('productId', String(target.productId))
      } else {
        params.set('direction', 'from_dnprd')
        params.set('dnprdId', target.dnprdId || '0')
      }
      const res = await fetch(`/api/admin/eslestirme/models/search-dinamik?${params}`, {
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      if (res.ok) setLinkResults(await res.json())
      else setLinkResults([])
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setLinkResults([])
    } finally {
      if (!controller.signal.aborted) {
        setLinkLoading(false)
        setLinkLoaded(true)
      }
    }
  }, [])

  const handleLink = useCallback((row: ModelRow) => {
    const initialSearch = getInitialLinkSearch(row)
    setLinkTarget(row)
    setLinkSearch(initialSearch)
    setLinkResults([])
    setLinkLoaded(false)
    setLinkOpen(true)
    void loadLinkResults(initialSearch, row)
  }, [loadLinkResults])

  const searchLinkDebounced = useDebouncedCallback((q: string, target: ModelRow) => {
    void loadLinkResults(q, target)
  }, 200)

  const searchLink = useCallback((q: string) => {
    if (!linkTarget) { setLinkResults([]); return }
    if (q.trim().length === 1) return
    setLinkLoaded(false)
    searchLinkDebounced(q, linkTarget)
  }, [linkTarget, searchLinkDebounced])

  const handleManualLink = useCallback(async (targetId: string) => {
    if (!linkTarget) return
    const hasProduct = !!linkTarget.productId
    const body = hasProduct
      ? { dnprdId: targetId, productId: linkTarget.productId }
      : { dnprdId: linkTarget.dnprdId, productId: Number(targetId) }
    try {
      const res = await fetch('/api/admin/eslestirme/models/manual-match', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      const data = await res.json()
      if (!data.error) { toast.success('Eşleştirildi'); setLinkOpen(false); void loadModels(filtersRef.current) }
      else toast.error(data.error?.message || 'Başarısız')
    } catch { toast.error('Başarısız') }
  }, [linkTarget, loadModels])

  const handleViewDetail = useCallback((row: ModelRow) => {
    setDetailRow(row)
    setDetailOpen(true)
    setOemResults([])
    setSavedOems([])
    setOemSaving({})
    setManualOemInput('')
    setManualOemPreviews([])
    setMappingBrandListId(null)
    fetchOemResults(row, row.parcatedarik.refNo || '')
  }, [])

  const fetchOemResults = useCallback(async (row: ModelRow, refNo: string) => {
    setOemLoading(true)
    try {
      const params = new URLSearchParams({ refNo, limit: '25' })
      if (row.dnprdId) params.set('dnmkProductsId', row.dnprdId)
      if (row.productId) params.set('ptdrkProductsId', String(row.productId))
      if (row.id) params.set('mappingId', String(row.id))
      const res = await fetch(`/api/admin/eslestirme/models/oems?${params}`)
      if (res.ok) {
        const data = await res.json()
        setOemResults(data.results || [])
        setSavedOems(data.saved || [])
        setMappingBrandListId(data.mappingBrandListId ?? null)
      }
    } catch {
      toast.error('OEM araması başarısız')
    } finally {
      setOemLoading(false)
    }
  }, [])

  const handleSaveOem = useCallback(async (result: any) => {
    if (!detailRow) return
    setOemSaving(prev => ({ ...prev, [result.bsbgProductId]: true }))
    try {
      const res = await fetch('/api/admin/eslestirme/models/oems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnmkProductsId: detailRow.dnprdId || null,
          ptdrkProductsId: detailRow.productId || null,
          bsbgProductsId: result.bsbgProductId,
          oemNo: result.oemNo || null,
          refNo: detailRow.parcatedarik.refNo || null,
          relationType: result.relationType,
        }),
      })
      const data = await res.json()
      if (!data.error) {
        toast.success('OEM eşleştirmesi kaydedildi')
        const refNo = detailRow.parcatedarik.refNo
        if (refNo) fetchOemResults(detailRow, refNo)
      } else {
        toast.error(data.error?.message || 'Kaydetme başarısız')
      }
    } catch {
      toast.error('Kaydetme başarısız')
    } finally {
      setOemSaving(prev => ({ ...prev, [result.bsbgProductId]: false }))
    }
  }, [detailRow, fetchOemResults])

  const handleDeleteOem = useCallback(async (result: any) => {
    if (!detailRow) return
    setOemSaving(prev => ({ ...prev, [result.bsbgProductId]: true }))
    try {
      const res = await fetch('/api/admin/eslestirme/models/oems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnmkProductsId: detailRow.dnprdId || null,
          bsbgProductsId: result.bsbgProductId,
          oemNo: result.oemNo || null,
          action: 'delete',
        }),
      })
      const data = await res.json()
      if (!data.error) {
        toast.success('OEM eşleştirmesi silindi')
        const refNo = detailRow.parcatedarik.refNo
        if (refNo) fetchOemResults(detailRow, refNo)
      } else {
        toast.error(data.error?.message || 'Silme başarısız')
      }
    } catch {
      toast.error('Silme başarısız')
    } finally {
      setOemSaving(prev => ({ ...prev, [result.bsbgProductId]: false }))
    }
  }, [detailRow, fetchOemResults])

  const fetchManualOemPreview = useCallback(async (oemNos: string[]) => {
    if (!detailRow || oemNos.length === 0) {
      setManualOemPreviews([])
      return
    }
    setManualOemPreviewLoading(true)
    try {
      const res = await fetch('/api/admin/eslestirme/models/oems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preview',
          oemNos,
          dnmkProductsId: detailRow.dnprdId || null,
          ptdrkProductsId: detailRow.productId || null,
          mappingId: detailRow.id || null,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setManualOemPreviews(data.previews || [])
        if (data.mappingBrandListId != null) {
          setMappingBrandListId(data.mappingBrandListId)
        }
      } else {
        const err = await res.json().catch(() => ({}))
        toast.error(err?.error?.message || 'Ön izleme alınamadı')
      }
    } catch {
      toast.error('Ön izleme isteği başarısız')
    } finally {
      setManualOemPreviewLoading(false)
    }
  }, [detailRow])

  const debouncedFetchPreview = useDebouncedCallback((oemNos: string[]) => {
    fetchManualOemPreview(oemNos)
  }, 400)

  const handleManualOemChange = useCallback((value: string) => {
    setManualOemInput(value)
    const nos = value.split(/[,;|/]+/).map((s) => s.trim()).filter((s) => s.length >= 2)
    if (nos.length > 0) {
      debouncedFetchPreview(nos)
    } else {
      setManualOemPreviews([])
    }
  }, [debouncedFetchPreview])

  const handleSaveManualOems = useCallback(async () => {
    if (!detailRow || manualOemPreviews.length === 0) return

    const toSave = manualOemPreviews.filter((p) => !p.alreadySaved && p.status !== 'invalid')
    if (toSave.length === 0) {
      toast.info('Eklenecek yeni OEM bulunamadı')
      return
    }

    setManualOemSaving(true)
    let successCount = 0
    let failCount = 0

    for (const p of toSave) {
      try {
        const res = await fetch('/api/admin/eslestirme/models/oems', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'save_manual',
              dnmkProductsId: detailRow.dnprdId || null,
              ptdrkProductsId: detailRow.productId || null,
              oemNo: p.oemNo,
              bsbgProductsId: p.bsbgProductId || null,
              createBsbgIfMissing: p.status === 'create_needed' && !!p.bsbgBrandId,
              bsbgBrandId: p.bsbgBrandId || null,
              brandListId: p.brandListId != null ? p.brandListId : null,
              relationType: p.relationType || 'CROSS_REFERENCE',
              refNo: detailRow.parcatedarik.refNo || null,
            }),
        })
        const data = await res.json()
        if (!data.error) successCount++
        else failCount++
      } catch {
        failCount++
      }
    }

    setManualOemSaving(false)
    if (successCount > 0) {
      toast.success(`${successCount} OEM eklendi${failCount > 0 ? `, ${failCount} başarısız` : ''}`)
      setManualOemInput('')
      setManualOemPreviews([])
      fetchOemResults(detailRow, detailRow.parcatedarik.refNo || '')
    } else {
      toast.error('Hiçbir OEM eklenemedi')
    }
  }, [detailRow, manualOemPreviews, fetchOemResults])

  const columns = createModelColumns({
    onAction: handleAction,
    onLinkProduct: handleLink,
    onLinkDproducts: handleLink,
    onBulkApproveRows: () => {},
    onViewDetail: handleViewDetail,
  })

  const isEmptyCatalog = !initialLoading && summary?.total === 0

  const summaryCards = summary ? [
    { label: 'Toplam', value: summary.total, color: 'bg-muted-foreground' },
    { label: 'Onaylandı', value: summary.approved, color: 'bg-success' },
    { label: 'Beklemede', value: summary.pending, color: 'bg-warning' },
    { label: 'Reddedildi', value: summary.rejected, color: 'bg-destructive' },
    { label: 'Yoksayıldı', value: summary.ignored, color: 'bg-muted-foreground' },
  ] : []

  const selectedCount = Object.values(rowSelection).filter(Boolean).length

  const linkBrandName = linkTarget
    ? (linkTarget.dinamik.brand || linkTarget.parcatedarik.manufacturerName || '').trim()
    : ''
  const linkSearchTarget = linkTarget && linkTarget.productId && !linkTarget.dnprdId ? 'Dinamik' : 'PT'
  const linkEmptyMessage = linkBrandName
    ? `${linkBrandName} markasına ait ${linkSearchTarget} ürün bulunamadı.`
    : `Onaylı marka eşleşmesi bulunamadı; ${linkSearchTarget} ürün listelenemedi.`

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
        {isInitialLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-card px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-3 h-7 w-16" />
            </div>
          ))
        ) : summaryCards.map((c, i) => (
          <div key={i} className="rounded-lg border bg-card px-4 py-3">
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

      {isEmptyCatalog && (
        <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Henüz ürün eşleştirmesi yok</p>
          <p className="mt-1">
            Onaylı ve eşleşmiş marka çiftlerine göre{' '}
            <span className="font-mono text-xs">part_no = model</span> kuralıyla otomatik eşleştirme yapılır.
            &quot;Populate &amp; Eşleştir&quot; ile başlatın; büyük kataloglarda işlem birkaç dakika sürebilir.
          </p>
        </div>
      )}

      <div className="rounded-md border border-border bg-card p-4">
        <AdminTableToolbar
          searchValue={searchValue}
          onSearchChange={(nextValue) => {
            setSearchValue(nextValue)
            setIsSearchPending(true)
            onSearch(nextValue)
          }}
          searchPlaceholder="Stok kodu / ad / ürün ara..."
          isSearchLoading={isSearchPending}
          onRefresh={() => void loadModels(filtersRef.current)}
          isRefreshing={isFetching}
          onAdvancedFilter={() => setFiltersOpen(true)}
        />

        <AdminFilterBar onReset={hasActiveFilters ? resetFilters : undefined} className="mt-3" />

        {(filters.dinamikBrand || filters.canonicalBrand || filters.bsbgBrand || filters.manufacturerId) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {filters.dinamikBrand && (
              <span className="rounded-sm border bg-muted/40 px-2.5 py-1">
                Dinamik Marka: <strong className="text-foreground">{filters.dinamikBrand}</strong>
              </span>
            )}
            {filters.canonicalBrand && (
              <span className="rounded-sm border bg-muted/40 px-2.5 py-1">
                Marka: <strong className="text-foreground">{filters.canonicalBrand}</strong>
              </span>
            )}
            {filters.bsbgBrand && (
              <span className="rounded-sm border bg-muted/40 px-2.5 py-1">
                Başbuğ Marka: <strong className="text-foreground">{filters.bsbgBrand}</strong>
              </span>
            )}
            {filters.manufacturerId && (
              <span className="rounded-sm border bg-muted/40 px-2.5 py-1">
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
        isLoading={isTableLoading}
        pagination={pagination}
        onPaginationChange={(page) => applyFilters({ page })}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        emptyMessage={isEmptyCatalog ? 'Ürün eşleştirmesi bulunamadı — Populate & Eşleştir ile başlatın' : 'Eşleştirme bulunamadı'}
      />

      <Dialog open={linkOpen} onOpenChange={(open) => {
        if (!open) linkAbortRef.current?.abort()
        setLinkOpen(open)
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eşleştir</DialogTitle>
            <DialogDescription>
              {linkTarget && !linkTarget.dnprdId && linkTarget.productId && 'Bu PT ürüne Dinamik karşılığı ara'}
              {linkTarget && linkTarget.dnprdId && !linkTarget.productId && 'Bu Dinamik ürüne PT karşılığı ara'}
              {linkTarget && linkTarget.dnprdId && linkTarget.productId && 'Mevcut eşleşmeyi değiştir'}
            </DialogDescription>
          </DialogHeader>
          {linkTarget && (
            <div className="space-y-4 py-2">
              <div className="rounded border p-3 space-y-1 text-sm bg-muted/30">
                {linkTarget.dnprdId && (
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
                placeholder={linkTarget.productId && !linkTarget.dnprdId ? 'Dinamik ürün ara...' : 'PT ürün ara...'}
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
                <div className="space-y-2 py-1">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
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

      {detailRow && (
        <Dialog open={detailOpen} onOpenChange={(open) => { setDetailOpen(open); if (!open) { setDetailRow(null); setOemResults([]); setManualOemInput(''); setManualOemPreviews([]); setMappingBrandListId(null) } }}>
          <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-lg font-mono">{detailRow.part_no || detailRow.dinamik.stockCode || detailRow.parcatedarik.title?.slice(0, 40) || 'Ürün Detayı'}</DialogTitle>
              <DialogDescription>
                Mapping ID: {detailRow.id}
                {detailRow.dnprdId && <> &middot; Dinamik ID: {detailRow.dnprdId}</>}
                {detailRow.bsbgProductsId && <> &middot; Başbuğ ID: {detailRow.bsbgProductsId}</>}
                {detailRow.productId && <> &middot; PT ID: {detailRow.productId}</>}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sağlayıcı Ürünleri</p>
                <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                  {detailRow.dnprdId && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 border-primary/20 bg-primary/5 text-primary">Dinamik</Badge>
                        <span className="font-mono font-medium">{detailRow.dinamik.stockCode || '—'}</span>
                      </div>
                      <div className="ml-8 space-y-0.5 text-xs text-muted-foreground">
                        {detailRow.dinamik.stockName && <p>{detailRow.dinamik.stockName}</p>}
                        {detailRow.dinamik.brand && <p>Marka: {detailRow.dinamik.brand}</p>}
                        {detailRow.dinamik.partNo && <p className="font-mono">Part No: {detailRow.dinamik.partNo}</p>}
                        {detailRow.dinamik.barcode1 && <p className="font-mono">Barkod: {detailRow.dinamik.barcode1}</p>}
                        {detailRow.dinamik.price && <p>Fiyat: {detailRow.dinamik.price} TL</p>}
                      </div>
                    </div>
                  )}
                  {detailRow.productId && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 border-primary/20 bg-primary/5 text-primary">P-Tedarik</Badge>
                        <span className="font-medium">{detailRow.parcatedarik.title?.slice(0, 60) || '—'}</span>
                      </div>
                      <div className="ml-8 space-y-0.5 text-xs text-muted-foreground">
                        <p>{detailRow.parcatedarik.manufacturerName || '—'}</p>
                        {detailRow.parcatedarik.model && <p className="font-mono">Model: {detailRow.parcatedarik.model}</p>}
                        {detailRow.parcatedarik.refNo && (
                          <p className="font-mono font-medium text-foreground">ref_no: {detailRow.parcatedarik.refNo}</p>
                        )}
                      </div>
                    </div>
                  )}
                  {detailRow.bsbgProductsId && (
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1.5 border-primary/20 bg-primary/5 text-primary">Başbuğ</Badge>
                        <span className="font-medium">{detailRow.bsbg.partNo || detailRow.bsbg.malzemeNo || '—'}</span>
                      </div>
                      <div className="ml-8 space-y-0.5 text-xs text-muted-foreground">
                        {detailRow.bsbg.malzemeNo && <p className="font-mono">Malzeme No: {detailRow.bsbg.malzemeNo}</p>}
                        {detailRow.bsbg.partNo && <p className="font-mono">Part No: {detailRow.bsbg.partNo}</p>}
                      </div>
                    </div>
                  )}
                  {!detailRow.dnprdId && !detailRow.productId && !detailRow.bsbgProductsId && (
                    <span className="text-xs text-muted-foreground">Ürün bağlantısı yok</span>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Manuel OEM Ekle</p>
                <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                  <Label htmlFor="manual-oem-input" className="text-xs font-normal leading-relaxed text-muted-foreground">
                    Virgül (,), noktalı virgül (;), pipe (|) veya slash (/) ile ayırarak OEM numaraları girin.
                    Mevcut Başbuğ ürünlerinde aranır; bulunamazsa doğrudan kaydedilir.
                  </Label>
                  <Input
                    id="manual-oem-input"
                    placeholder="örn: 1K0615301AA; 5Q0615301H"
                    value={manualOemInput}
                    onChange={(e) => handleManualOemChange(e.target.value)}
                    className="font-mono text-xs h-9"
                  />
                  {manualOemPreviewLoading && (
                    <div className="flex justify-center py-2">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {!manualOemPreviewLoading && manualOemPreviews.length > 0 && (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {manualOemPreviews.map((p) => (
                        <div key={p.oemNo} className="rounded border bg-background p-2 text-xs flex items-center justify-between gap-2">
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-mono font-medium">{p.oemNo}</span>
                              {p.status === 'found' && (
                                <Badge variant="outline" className="text-[10px] border-success/20 bg-success/10 text-success whitespace-nowrap">
                                  Bulundu
                                </Badge>
                              )}
                              {p.status === 'create_needed' && (
                                <Badge variant="outline" className="text-[10px] border-warning/20 bg-warning/10 text-warning whitespace-nowrap">
                                  Yeni kayıt
                                </Badge>
                              )}
                              {p.status === 'invalid' && (
                                <Badge variant="outline" className="text-[10px] border-destructive/20 bg-destructive/10 text-destructive whitespace-nowrap">
                                  Geçersiz
                                </Badge>
                              )}
                              {p.alreadySaved && (
                                <Badge variant="outline" className="text-[10px] border-muted-foreground/20 bg-muted text-muted-foreground whitespace-nowrap">
                                  Zaten ekli
                                </Badge>
                              )}
                            </div>
                            {p.status === 'found' && (
                              <p className="text-muted-foreground">
                                <span className="font-mono">{p.malzemeNo}</span>
                                {p.bsbgBrand && <> &middot; {p.bsbgBrand}</>}
                              </p>
                            )}
                            {p.status === 'create_needed' && (
                              <p className="text-muted-foreground">
                                {p.bsbgBrandId ? 'Yeni bsbg kaydı oluşturulacak' : 'Bsbg bağlantısı olmadan kaydedilecek'}
                                {p.relationType === 'SAME_BRAND' && <> &middot; Aynı marka</>}
                              </p>
                            )}
                          </div>
                          {p.relationType === 'SAME_BRAND' && p.status === 'found' && (
                            <Badge variant="outline" className="text-[10px] border-success/20 bg-success/10 text-success shrink-0">Aynı Marka</Badge>
                          )}
                          {p.relationType === 'CROSS_REFERENCE' && p.status === 'found' && (
                            <Badge variant="outline" className="text-[10px] border-warning/20 bg-warning/10 text-warning shrink-0">Çapraz</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {!manualOemPreviewLoading && manualOemInput && manualOemPreviews.length === 0 && (
                    <p className="text-xs text-muted-foreground">Geçerli OEM numarası bulunamadı (en az 2 karakter).</p>
                  )}
                  <div className="flex justify-end gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setManualOemInput(''); setManualOemPreviews([]) }}
                      disabled={!manualOemInput || manualOemSaving}
                    >
                      Temizle
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleSaveManualOems}
                      disabled={
                        manualOemSaving ||
                        manualOemPreviews.length === 0 ||
                        manualOemPreviews.every((p) => p.status === 'invalid' || p.alreadySaved)
                      }
                    >
                      {manualOemSaving ? 'Kaydediliyor…' : 'OEM\'leri Ekle'}
                    </Button>
                  </div>
                </div>
              </div>

              {savedOems.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Bu Ürüne Kaydedilmiş OEM'ler</p>
                  <div className="rounded-md border bg-muted/30 p-3 space-y-1.5 text-sm max-h-48 overflow-y-auto">
                    {savedOems.map((oem) => (
                      <div key={oem.id} className="rounded border bg-background p-2 text-xs flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono font-medium">{oem.oemNo}</span>
                            {oem.bsbgProductId && (
                              <Badge variant="outline" className="text-[10px] border-success/20 bg-success/10 text-success whitespace-nowrap">
                                Başbuğ bağlantılı
                              </Badge>
                            )}
                            {!oem.bsbgProductId && (
                              <Badge variant="outline" className="text-[10px] border-warning/20 bg-warning/10 text-warning whitespace-nowrap">
                                Başbuğ'suz
                              </Badge>
                            )}
                          </div>
                          {oem.malzemeNo && <p className="text-muted-foreground"><span className="font-mono">{oem.malzemeNo}</span>{oem.bsbgBrand && <> &middot; {oem.bsbgBrand}</>}</p>}
                          <p className="text-muted-foreground">
                            {oem.createdAt && new Date(oem.createdAt).toLocaleString('tr-TR', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            {oem.relationType === 'SAME_BRAND' && ' · Aynı marka'}
                            {oem.relationType === 'CROSS_REFERENCE' && ' · Çapraz'}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs text-destructive shrink-0"
                          disabled={savedOemDeleting[oem.id]}
                          onClick={async () => {
                            setSavedOemDeleting(prev => ({ ...prev, [oem.id]: true }))
                            try {
                              const res = await fetch('/api/admin/eslestirme/models/oems', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  action: 'delete',
                                  id: oem.id,
                                }),
                              })
                              const data = await res.json()
                              if (!data.error) {
                                toast.success('OEM silindi')
                                setSavedOems(prev => prev.filter(s => s.id !== oem.id))
                              } else {
                                toast.error(data.error?.message || 'Silme başarısız')
                              }
                            } catch {
                              toast.error('Silme başarısız')
                            } finally {
                              setSavedOemDeleting(prev => ({ ...prev, [oem.id]: false }))
                            }
                          }}
                        >
                          {savedOemDeleting[oem.id] ? '...' : 'Sil'}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {detailRow.parcatedarik.refNo && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">OEM Eşleşmesi (ref_no &rarr; oem_no)</p>
                  <div className="rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      ref_no: <span className="font-mono font-medium text-foreground">{detailRow.parcatedarik.refNo}</span>
                    </p>
                    {oemLoading && (
                      <div className="flex justify-center py-4">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    )}
                    {!oemLoading && oemResults.length === 0 && (
                      <p className="text-xs text-muted-foreground">Bu ref_no ile eşleşen Başbuğ ürünü bulunamadı.</p>
                    )}
                    {!oemLoading && oemResults.length > 0 && (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto">
                        {oemResults.map((r) => (
                          <div key={r.bsbgProductId} className="rounded border bg-background p-2 text-xs space-y-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 space-y-0.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <Badge variant="outline" className="text-[10px] px-1.5 border-primary/20 bg-primary/5 text-primary">Başbuğ</Badge>
                                  <span className="font-mono font-medium">{r.malzemeNo}</span>
                                  <span className="text-muted-foreground">— {r.bsbgBrand}</span>
                                </div>
                                {r.aciklama && <p className="text-muted-foreground">{r.aciklama.slice(0, 80)}</p>}
                                <p className="font-mono text-muted-foreground">oem_no: {r.oemNo || '—'}</p>
                                <div className="flex items-center gap-2">
                                  {r.relationType === 'SAME_BRAND' && (
                                    <Badge variant="outline" className="text-[10px] border-success/20 bg-success/10 text-success">Aynı Marka</Badge>
                                  )}
                                  {r.relationType === 'CROSS_REFERENCE' && (
                                    <Badge variant="outline" className="text-[10px] border-warning/20 bg-warning/10 text-warning">Çapraz Referans</Badge>
                                  )}
                                  {r.relationType === 'UNKNOWN' && (
                                    <Badge variant="outline" className="text-[10px] border-border bg-muted text-muted-foreground">Marka Bilinmiyor</Badge>
                                  )}
                                  {r.canonicalBrand && (
                                    <span className="text-muted-foreground">Marka: {r.canonicalBrand}</span>
                                  )}
                                </div>
                              </div>
                              <Button
                                variant={r.alreadySaved ? 'outline' : 'default'}
                                size="sm"
                                className="h-7 text-xs shrink-0"
                                disabled={oemSaving[r.bsbgProductId]}
                                onClick={() => r.alreadySaved ? handleDeleteOem(r) : handleSaveOem(r)}
                              >
                                {oemSaving[r.bsbgProductId] ? '...' : r.alreadySaved ? 'Kaldır' : 'Eşleştir'}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Durum & Yöntem</p>
                <div className="flex items-center gap-2">
                  {(() => {
                    const colors: Record<string, string> = {
                      PENDING: 'bg-warning/15 text-warning border-warning/20',
                      APPROVED: 'bg-success/15 text-success border-success/20',
                      REJECTED: 'bg-destructive/15 text-destructive border-destructive/20',
                      IGNORED: 'bg-muted text-muted-foreground border-border',
                    }
                    const labels: Record<string, string> = { PENDING: 'Beklemede', APPROVED: 'Onaylandı', REJECTED: 'Reddedildi', IGNORED: 'Yoksayıldı' }
                    return (
                      <Badge variant="outline" className={`text-xs font-medium ${colors[detailRow.mappingStatus] || ''}`}>
                        {labels[detailRow.mappingStatus] || detailRow.mappingStatus}
                      </Badge>
                    )
                  })()}
                  {detailRow.matchMethod && (
                    <Badge variant="outline" className="border-success/20 bg-success/10 text-xs text-success">
                      {detailRow.matchMethod.charAt(0).toUpperCase() + detailRow.matchMethod.slice(1).toLowerCase()}
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {detailRow.mappingStatus === 'PENDING' && (
                      <>
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { handleAction(detailRow.id, 'approve'); setDetailRow(prev => prev ? { ...prev, mappingStatus: 'APPROVED', matchMethod: 'MANUAL' } : null) }}>
                          <Check className="h-3 w-3 mr-1" /> Onayla
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => { handleAction(detailRow.id, 'reject'); setDetailRow(prev => prev ? { ...prev, mappingStatus: 'REJECTED' } : null) }}>
                          Reddet
                        </Button>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-muted-foreground" onClick={() => { handleAction(detailRow.id, 'ignore'); setDetailRow(prev => prev ? { ...prev, mappingStatus: 'IGNORED' } : null) }}>
                          Yoksay
                        </Button>
                      </>
                    )}
                    {(detailRow.mappingStatus === 'APPROVED' || detailRow.mappingStatus === 'REJECTED') && (
                      <Button size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => { handleAction(detailRow.id, 'unmatch'); setDetailRow(prev => prev ? { ...prev, mappingStatus: 'PENDING', matchMethod: null } : null) }}>
                        Eşleştirmeyi Kaldır
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Gelişmiş Filtreler</DialogTitle>
            <DialogDescription>
              Marka ve eşleşme durumuna göre listeyi daraltın.
            </DialogDescription>
          </DialogHeader>

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
              label="Marka (brand_list)"
              value={filters.canonicalBrand ?? 'all'}
              options={[
                { value: 'all', label: 'Tümü' },
                ...filterOptions.canonicalBrands.map((brand) => ({
                  value: brand,
                  label: brand,
                })),
              ]}
              disabled={optionsLoading}
              placeholder={optionsLoading ? 'Markalar yükleniyor...' : 'Seçiniz'}
              onChange={(value) => setFilterParam('canonicalBrand', value)}
            />
            <AdminFilterSelect
              label="Başbuğ Marka"
              value={filters.bsbgBrand ?? 'all'}
              options={[
                { value: 'all', label: 'Tümü' },
                ...filterOptions.bsbgBrands.map((brand) => ({
                  value: brand,
                  label: brand,
                })),
              ]}
              disabled={optionsLoading}
              placeholder={optionsLoading ? 'Markalar yükleniyor...' : 'Seçiniz'}
              onChange={(value) => setFilterParam('bsbgBrand', value)}
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
              value={filters.matchMethod}
              options={[
                { value: 'all', label: 'Tümü' },
                { value: 'EXACT_MATCH', label: 'Tam Eşleşme' },
                { value: 'MANUAL', label: 'Manuel' },
                { value: 'NONE', label: 'Boş' },
              ]}
              onChange={(value) => setFilterParam('matchMethod', value)}
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
