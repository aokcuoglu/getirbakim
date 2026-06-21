'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Link2, CheckCircle2, Clock, XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AdminKpiCard, AdminKpiGrid } from '@/components/admin/data-table/admin-kpi-card'
import { AdminTableEmptyState } from '@/components/admin/data-table/admin-table-empty-state'
import { AdminTableShell } from '@/components/admin/data-table/admin-table-shell'
import { DataTablePagination } from '@/components/admin/data-table/data-table-pagination'
import { AdminFilterBar, AdminFilterChip, AdminFilterSelectChip } from '@/components/admin/data-table/admin-filter-chip'
import { useDebouncedCallback } from 'use-debounce'

// ─── Types ────────────────────────────────────────────────────────────────────

type TabSource = 'dnmk' | 'bsbg' | 'ptdrk'

interface DnmkProductRow {
  id: number
  stock_code: string
  part_no: string | null
  stock_name: string | null
  brand: string
  brand_list_id: number
  mapping_status: string | null
}

interface BsbgProductRow {
  id: number
  malzeme_no: string
  part_no: string | null
  aciklama: string | null
  brand: string
  brand_list_id: number
  mapping_status: string | null
}

interface PtdrkProductRow {
  id: number
  product_id: string
  part_no: string | null
  title: string
  brand: string
  brand_list_id: number
  mapping_status: string | null
}

interface BrandOption {
  id: number
  brand: string
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  pages: number
}

interface SummaryInfo {
  total: number
  matched: number
  pending: number
  unmatched: number
}

interface BulkSuggestPair {
  dnmk_id: string
  dnmk_stock_code: string
  dnmk_part_no: string | null
  dnmk_stock_name: string | null
  ptdrk_id: string
  ptdrk_product_id: string
  ptdrk_part_no: string | null
  ptdrk_title: string
  brand_list_id: string
  brand_name: string
  similarity: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isApproved = (s: string | null) => s === 'APPROVED' || s === 'APPROVED_MANUAL'
const isPending = (s: string | null) => s === 'PENDING'

function statusColor(status: string | null): string {
  if (isApproved(status)) return 'text-green-600 bg-green-50 border-green-200'
  if (isPending(status)) return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-muted-foreground bg-muted border-border'
}

function statusLabel(status: string | null): string {
  if (isApproved(status)) return 'Onaylandı'
  if (isPending(status)) return 'Bekleyen'
  return 'Eşleşmemiş'
}

function statusIcon(status: string | null) {
  if (isApproved(status)) return <CheckCircle2 size={12} />
  if (isPending(status)) return <Clock size={12} />
  return <XCircle size={12} />
}

const TABS: { value: TabSource; label: string }[] = [
  { value: 'dnmk', label: 'DNMK Ürünleri' },
  { value: 'bsbg', label: 'BSBG Ürünleri' },
  { value: 'ptdrk', label: 'PT Ürünleri' },
]

// ─── Component ────────────────────────────────────────────────────────────────

export function ProductMatchClient() {
  const [activeTab, setActiveTab] = useState<TabSource>('dnmk')

  // DNMK state
  const [dnmkRows, setDnmkRows] = useState<DnmkProductRow[]>([])
  const [dnmkPagination, setDnmkPagination] = useState<PaginationInfo>({ page: 1, limit: 50, total: 0, pages: 0 })
  const [dnmkSummary, setDnmkSummary] = useState<SummaryInfo>({ total: 0, matched: 0, pending: 0, unmatched: 0 })

  // BSBG state
  const [bsbgRows, setBsbgRows] = useState<BsbgProductRow[]>([])
  const [bsbgPagination, setBsbgPagination] = useState<PaginationInfo>({ page: 1, limit: 50, total: 0, pages: 0 })
  const [bsbgSummary, setBsbgSummary] = useState<SummaryInfo>({ total: 0, matched: 0, pending: 0, unmatched: 0 })

  // PTDRK state
  const [ptdrkRows, setPtdrkRows] = useState<PtdrkProductRow[]>([])
  const [ptdrkPagination, setPtdrkPagination] = useState<PaginationInfo>({ page: 1, limit: 50, total: 0, pages: 0 })
  const [ptdrkSummary, setPtdrkSummary] = useState<SummaryInfo>({ total: 0, matched: 0, pending: 0, unmatched: 0 })

  // Shared state
  const [brands, setBrands] = useState<BrandOption[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [inputValue, setInputValue] = useState('')
  const [searchValue, setSearchValue] = useState('')
  const [filters, setFilters] = useState({ matchSide: 'all', brandListId: '' })

  // Match dialog state
  const [matchDialogOpen, setMatchDialogOpen] = useState(false)
  const [matchDnmkProduct, setMatchDnmkProduct] = useState<DnmkProductRow | null>(null)
  const [selectedBrandListId, setSelectedBrandListId] = useState('')
  const [ptSearchQuery, setPtSearchQuery] = useState('')
  const [ptCandidates, setPtCandidates] = useState<Array<{ id: number; product_id: string; part_no: string | null; title: string; similarity?: number }>>([])
  const [ptSearchLoading, setPtSearchLoading] = useState(false)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [selectedPtIds, setSelectedPtIds] = useState<Set<number>>(new Set())
  const [matchingLoading, setMatchingLoading] = useState(false)

  // Bulk match modal state
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false)
  const [bulkPairs, setBulkPairs] = useState<BulkSuggestPair[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)
  const [bulkApproving, setBulkApproving] = useState(false)
  const [bulkSelectedKeys, setBulkSelectedKeys] = useState<Set<string>>(new Set())
  const [bulkPage, setBulkPage] = useState(1)
  const [bulkPagination, setBulkPagination] = useState<PaginationInfo>({ page: 1, limit: 200, total: 0, pages: 0 })

  const openMatchDialog = useCallback((product: DnmkProductRow) => {
    setMatchDnmkProduct(product)
    setSelectedBrandListId(String(product.brand_list_id))
    setPtSearchQuery('')
    setPtCandidates([])
    setSelectedPtIds(new Set())
    setMatchDialogOpen(true)
  }, [])

  const fetchSuggestions = useCallback(async (dnmkId: number, brandListId: string) => {
    if (!brandListId) return
    setSuggestLoading(true)
    try {
      const res = await fetch(`/api/admin/products/match?target=ptdrk_suggest&dnmkProductsId=${dnmkId}&brandListId=${brandListId}&threshold=0.5&limit=20`)
      const data = await res.json()
      if (!data.error) setPtCandidates(data.rows || [])
    } catch {
      toast.error('Öneriler yüklenemedi.')
    } finally {
      setSuggestLoading(false)
    }
  }, [])

  // Initial suggestions when dialog opens (after brand is set)
  useEffect(() => {
    if (matchDialogOpen && matchDnmkProduct && selectedBrandListId && ptSearchQuery === '' && ptCandidates.length === 0) {
      void fetchSuggestions(matchDnmkProduct.id, selectedBrandListId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchDialogOpen, matchDnmkProduct, selectedBrandListId])

  const searchPtProducts = useDebouncedCallback(async (brandListId: string, query: string) => {
    if (!brandListId) return
    setPtSearchLoading(true)
    try {
      const res = await fetch(`/api/admin/products/match?target=ptdrk&brandListId=${brandListId}&q=${encodeURIComponent(query)}&limit=20`)
      const data = await res.json()
      if (!data.error) {
        setPtCandidates(data.rows || [])
        setSelectedPtIds(new Set())
      }
    } catch {
      toast.error('PT ürünleri aranamadı.')
    } finally {
      setPtSearchLoading(false)
    }
  }, 300)

  const buildParams = useCallback((f: typeof filters, q: string, page: number, source: TabSource) => {
    const params = new URLSearchParams()
    params.set('source', source)
    if (q) params.set('q', q)
    if (f.matchSide !== 'all') params.set('matchSide', f.matchSide)
    if (f.brandListId) params.set('brandListId', f.brandListId)
    params.set('page', String(page))
    params.set('limit', '50')
    return params
  }, [])

  const fetchRows = useCallback(async (f: typeof filters, q: string, page: number, source: TabSource) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/admin/products/match?${buildParams(f, q, page, source)}`)
      const data = await res.json()
      if (!data.error) {
        if (source === 'dnmk') {
          setDnmkRows(data.rows || [])
          setDnmkPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 0 })
          setDnmkSummary(data.summary || { total: 0, matched: 0, pending: 0, unmatched: 0 })
        } else if (source === 'bsbg') {
          setBsbgRows(data.rows || [])
          setBsbgPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 0 })
          setBsbgSummary(data.summary || { total: 0, matched: 0, pending: 0, unmatched: 0 })
        } else {
          setPtdrkRows(data.rows || [])
          setPtdrkPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 0 })
          setPtdrkSummary(data.summary || { total: 0, matched: 0, pending: 0, unmatched: 0 })
        }
      }
    } catch {
      toast.error('Ürünler yüklenemedi.')
    } finally {
      setIsLoading(false)
    }
  }, [buildParams])

  const handleBulkLink = useCallback(async () => {
    if (!matchDnmkProduct || !selectedBrandListId || selectedPtIds.size === 0) return
    setMatchingLoading(true)
    try {
      const res = await fetch('/api/admin/products/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_link_dnmk_pt',
          dnmkProductsId: matchDnmkProduct.id,
          ptdrkProductsIds: [...selectedPtIds],
          brandListId: parseInt(selectedBrandListId),
        }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || 'Toplu eşleştirme başarısız.')
        return
      }
      toast.success(`${data.linked ?? selectedPtIds.size} ürün eşleştirildi.`)
      setMatchDialogOpen(false)
      const page = activeTab === 'dnmk' ? dnmkPagination.page : activeTab === 'bsbg' ? bsbgPagination.page : ptdrkPagination.page
      void fetchRows(filters, searchValue, page, activeTab)
    } catch {
      toast.error('Bir hata oluştu.')
    } finally {
      setMatchingLoading(false)
    }
  }, [matchDnmkProduct, selectedBrandListId, selectedPtIds, filters, searchValue, dnmkPagination.page, bsbgPagination.page, ptdrkPagination.page, activeTab, fetchRows])

  const handleApproveWithoutMatch = useCallback(async () => {
    if (!matchDnmkProduct || !selectedBrandListId) return
    setMatchingLoading(true)
    try {
      const res = await fetch('/api/admin/products/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dnmkProductsId: matchDnmkProduct.id,
          brandListId: parseInt(selectedBrandListId),
        }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || 'Onaylama başarısız.')
        return
      }
      toast.success('Ürün eşleşmesiz onaylandı.')
      setMatchDialogOpen(false)
      const page = activeTab === 'dnmk' ? dnmkPagination.page : activeTab === 'bsbg' ? bsbgPagination.page : ptdrkPagination.page
      void fetchRows(filters, searchValue, page, activeTab)
    } catch {
      toast.error('Bir hata oluştu.')
    } finally {
      setMatchingLoading(false)
    }
  }, [matchDnmkProduct, selectedBrandListId, filters, searchValue, dnmkPagination.page, bsbgPagination.page, ptdrkPagination.page, activeTab, fetchRows])

  const bulkSelectedKeysRef = useRef<Set<string>>(new Set())
  const syncBulkSelectedKeysRef = (next: Set<string>) => {
    bulkSelectedKeysRef.current = next
    setBulkSelectedKeys(next)
  }

  const fetchBulkPairs = useCallback(async (page: number) => {
    if (!filters.brandListId) return
    setBulkLoading(true)
    try {
      const res = await fetch(`/api/admin/products/match?target=bulk_suggest&brandListId=${filters.brandListId}&threshold=0.5&limit=200&page=${page}&perDnmk=1`)
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || 'Adaylar yüklenemedi.')
        return
      }
      const rows: BulkSuggestPair[] = data.rows || []
      setBulkPairs(rows)
      setBulkPagination(data.pagination || { page, limit: 200, total: 0, pages: 0 })
      setBulkPage(page)
      // Pre-select high-confidence pairs (>= 0.7) on the first page of a fresh open
      if (page === 1 && bulkSelectedKeysRef.current.size === 0) {
        syncBulkSelectedKeysRef(new Set(
          rows.filter((r) => r.similarity >= 0.7).map((r) => `${r.dnmk_id}:${r.ptdrk_id}`)
        ))
      }
    } catch {
      toast.error('Adaylar yüklenemedi.')
    } finally {
      setBulkLoading(false)
    }
  }, [filters.brandListId])

  const openBulkDialog = useCallback(async () => {
    if (!filters.brandListId) {
      toast.error('Önce bir marka seçin.')
      return
    }
    setBulkDialogOpen(true)
    setBulkPairs([])
    syncBulkSelectedKeysRef(new Set())
    setBulkPage(1)
    setBulkPagination({ page: 1, limit: 200, total: 0, pages: 0 })
    void fetchBulkPairs(1)
  }, [filters.brandListId, fetchBulkPairs])

  const handleBulkPageChange = useCallback((p: number) => {
    void fetchBulkPairs(p)
  }, [fetchBulkPairs])

  const handleBulkApprove = useCallback(async () => {
    if (bulkSelectedKeys.size === 0) return
    setBulkApproving(true)
    try {
      const pairs = [...bulkSelectedKeys].map((key) => {
        const [dnmkId, ptdrkId] = key.split(':')
        return { dnmkId: Number(dnmkId), ptdrkId: Number(ptdrkId) }
      })
      const res = await fetch('/api/admin/products/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_approve_pairs',
          pairs,
          brandListId: parseInt(filters.brandListId),
        }),
      })
      const data = await res.json()
      if (data.error) {
        toast.error(data.message || 'Toplu onay başarısız.')
        return
      }
      toast.success(`${data.approved ?? pairs.length} eşleştirme onaylandı.`)
      setBulkDialogOpen(false)
      const page = activeTab === 'dnmk' ? dnmkPagination.page : activeTab === 'bsbg' ? bsbgPagination.page : ptdrkPagination.page
      void fetchRows(filters, searchValue, page, activeTab)
    } catch {
      toast.error('Bir hata oluştu.')
    } finally {
      setBulkApproving(false)
    }
  }, [bulkSelectedKeys, filters.brandListId, filters, searchValue, dnmkPagination.page, bsbgPagination.page, ptdrkPagination.page, activeTab, fetchRows])

  const fetchBrands = useCallback(async (source: TabSource) => {
    try {
      const res = await fetch(`/api/admin/products/match?target=brands&source=${source}`)
      const data = await res.json()
      if (!data.error) setBrands(data.rows || [])
    } catch {}
  }, [])

  useEffect(() => {
    void fetchRows(filters, searchValue, 1, activeTab)
    void fetchBrands(activeTab)
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSearch = useDebouncedCallback((term: string) => {
    setSearchValue(term)
    void fetchRows(filters, term, 1, activeTab)
  }, 300)

  const applyFilters = useCallback((patch: Partial<typeof filters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch }
      void fetchRows(next, searchValue, 1, activeTab)
      return next
    })
  }, [searchValue, activeTab])

  // ── Shared ─────────────────────────────────────────────────────────────────

  const brandOptions = useMemo(() => [
    { value: '', label: 'Tümü' },
    ...brands.map((b) => ({ value: String(b.id), label: b.brand }))
  ], [brands])

  const activeRows = activeTab === 'dnmk' ? dnmkRows : activeTab === 'bsbg' ? bsbgRows : ptdrkRows
  const activePagination = activeTab === 'dnmk' ? dnmkPagination : activeTab === 'bsbg' ? bsbgPagination : ptdrkPagination
  const activeSummary = activeTab === 'dnmk' ? dnmkSummary : activeTab === 'bsbg' ? bsbgSummary : ptdrkSummary

  const onTabChange = useCallback((value: string) => {
    const tab = value as TabSource
    setActiveTab(tab)
    onSearch.cancel()
    setInputValue('')
    setSearchValue('')
    setFilters({ matchSide: 'all', brandListId: '' })
  }, [onSearch])

  const handleFilterReset = useCallback(() => {
    onSearch.cancel()
    setInputValue('')
    setSearchValue('')
    setFilters({ matchSide: 'all', brandListId: '' })
    void fetchRows({ matchSide: 'all', brandListId: '' }, '', 1, activeTab)
  }, [onSearch, activeTab])

  const handleRefresh = useCallback(() => {
    void fetchRows(filters, searchValue, activePagination.page, activeTab)
  }, [filters, searchValue, activePagination.page, activeTab, fetchRows])

  const handlePageChange = useCallback((p: number) => {
    void fetchRows(filters, searchValue, p, activeTab)
  }, [filters, searchValue, activeTab])

  // ─── Render helpers ────────────────────────────────────────────────────────

  const renderDnmkActions = (row: DnmkProductRow) => {
    if (row.mapping_status !== null && isApproved(row.mapping_status)) {
      return <span className="text-xs text-muted-foreground">-</span>
    }
    return (
      <Button variant="outline" size="sm" onClick={() => openMatchDialog(row)} className="h-7 gap-1 text-xs">
        <Link2 size={12} />
        Eşleştir
      </Button>
    )
  }

  const renderBsbgActions = () => <span className="text-xs text-muted-foreground">-</span>

  const renderPtdrkActions = () => <span className="text-xs text-muted-foreground">-</span>

  // ─── Main render ───────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {activeTab === 'dnmk' && (
        <AdminKpiGrid>
          <AdminKpiCard label="Toplam DNMK Ürün" value={activeSummary.total} tone="default" />
          <AdminKpiCard label="Eşleşmiş" value={activeSummary.matched} tone="success" />
          <AdminKpiCard label="Bekleyen" value={activeSummary.pending} tone="warning" />
          <AdminKpiCard label="Eşleşmemiş" value={activeSummary.unmatched} tone="danger" />
        </AdminKpiGrid>
      )}
      {activeTab === 'bsbg' && (
        <AdminKpiGrid>
          <AdminKpiCard label="Toplam BSBG Ürün" value={activeSummary.total} tone="default" />
          <AdminKpiCard label="Eşleşmiş" value={activeSummary.matched} tone="success" />
          <AdminKpiCard label="Bekleyen" value={activeSummary.pending} tone="warning" />
          <AdminKpiCard label="Eşleşmemiş" value={activeSummary.unmatched} tone="danger" />
        </AdminKpiGrid>
      )}
      {activeTab === 'ptdrk' && (
        <AdminKpiGrid>
          <AdminKpiCard label="Toplam PT Ürün" value={activeSummary.total} tone="default" />
          <AdminKpiCard label="DNMK'e Eşleşmiş" value={activeSummary.matched} tone="success" />
          <AdminKpiCard label="Bekleyen" value={activeSummary.pending} tone="warning" />
          <AdminKpiCard label="Eşleşmemiş" value={activeSummary.unmatched} tone="danger" />
        </AdminKpiGrid>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder={activeTab === 'dnmk' ? 'Marka, stok kodu, parça no, barkod ile ara...' : activeTab === 'bsbg' ? 'Marka, malzeme no, parça no, açıklama ile ara...' : 'Marka, ürün kodu, parça no ile ara...'}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value)
              onSearch(e.target.value)
            }}
            className="pl-8"
          />
        </div>
      </div>

      <AdminFilterBar onReset={handleFilterReset} onRefresh={handleRefresh}>
        <AdminFilterChip
          active={filters.matchSide === 'all' && filters.brandListId === ''}
          onClick={() => applyFilters({ matchSide: 'all' })}
          label="Tümü"
        />
        <AdminFilterChip
          active={filters.matchSide === 'matched'}
          onClick={() => applyFilters({ matchSide: filters.matchSide === 'matched' ? 'all' : 'matched' })}
          label="Eşleşmiş"
        />
        <AdminFilterChip
          active={filters.matchSide === 'pending'}
          onClick={() => applyFilters({ matchSide: filters.matchSide === 'pending' ? 'all' : 'pending' })}
          label="Bekleyen"
        />
        <AdminFilterChip
          active={filters.matchSide === 'unmatched'}
          onClick={() => applyFilters({ matchSide: filters.matchSide === 'unmatched' ? 'all' : 'unmatched' })}
          label="Eşleşmemiş"
        />

        <AdminFilterSelectChip
          prefix="Marka:"
          value={filters.brandListId}
          options={brandOptions}
          onChange={(v) => applyFilters({ brandListId: v })}
        />

        <Button
          type="button"
          variant="default"
          size="sm"
          className="h-7 px-3 text-xs gap-1.5"
          onClick={openBulkDialog}
          disabled={!filters.brandListId}
          title={filters.brandListId ? 'Seçili marka için trigram adaylarını göster' : 'Önce marka seçin'}
        >
          <Link2 className="h-3 w-3" />
          Toplu Eşleştir
        </Button>
      </AdminFilterBar>

      <AdminTableShell>
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : activeRows.length === 0 ? (
          <AdminTableEmptyState
            icon={<Link2 className="size-8" />}
            title="Ürün bulunamadı"
            description="Filtrelere uygun ürün bulunamadı."
          />
        ) : activeTab === 'dnmk' ? (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Marka</th>
                <th className="px-4 py-3">Stok Kodu</th>
                <th className="px-4 py-3">Parça No</th>
                <th className="px-4 py-3 w-0">Ürün Adı</th>
                <th className="px-4 py-3 w-48">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {(activeRows as DnmkProductRow[]).map((row) => (
                <tr key={row.id} className="border-b text-sm hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(row.mapping_status)}`}>
                      {statusIcon(row.mapping_status)}
                      {statusLabel(row.mapping_status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{row.brand}</td>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{row.stock_code}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.part_no ?? '-'}</td>
                  <td className="px-4 py-2.5 truncate max-w-[300px]">{row.stock_name ?? '-'}</td>
                  <td className="px-4 py-2.5">{renderDnmkActions(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : activeTab === 'bsbg' ? (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Marka</th>
                <th className="px-4 py-3">Malzeme No</th>
                <th className="px-4 py-3">Parça No</th>
                <th className="px-4 py-3">Açıklama</th>
                <th className="px-4 py-3 w-48">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {(activeRows as BsbgProductRow[]).map((row) => (
                <tr key={row.id} className="border-b text-sm hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(row.mapping_status)}`}>
                      {statusIcon(row.mapping_status)}
                      {statusLabel(row.mapping_status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{row.brand}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.malzeme_no}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.part_no ?? '-'}</td>
                  <td className="px-4 py-2.5 max-w-xs truncate">{row.aciklama ?? '-'}</td>
                  <td className="px-4 py-2.5">{renderBsbgActions()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3">Durum</th>
                <th className="px-4 py-3">Marka</th>
                <th className="px-4 py-3">Ürün Kodu</th>
                <th className="px-4 py-3">Açıklama</th>
                <th className="px-4 py-3 w-48">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {(activeRows as PtdrkProductRow[]).map((row) => (
                <tr key={row.id} className="border-b text-sm hover:bg-muted/50">
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(row.mapping_status)}`}>
                      {statusIcon(row.mapping_status)}
                      {statusLabel(row.mapping_status)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{row.brand}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.part_no ?? '-'}</td>
                  <td className="px-4 py-2.5 max-w-xs truncate">{row.title}</td>
                  <td className="px-4 py-2.5">{renderPtdrkActions()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <DataTablePagination
          page={activePagination.page}
          pages={activePagination.pages}
          totalRows={activePagination.total}
          onPageChange={handlePageChange}
        />
      </AdminTableShell>

      {matchDialogOpen && matchDnmkProduct && (
        <Dialog open={matchDialogOpen} onOpenChange={setMatchDialogOpen}>
          <DialogContent className="max-w-2xl overflow-hidden">
            <DialogHeader className="min-w-0">
              <DialogTitle>Ürün Eşleştir</DialogTitle>
              <DialogDescription className="text-xs font-mono truncate min-w-0">
                {matchDnmkProduct.stock_code} — {matchDnmkProduct.stock_name ?? matchDnmkProduct.part_no ?? '-'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 min-w-0">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Marka</label>
                <Select
                  value={selectedBrandListId}
                  onValueChange={(v) => {
                    setSelectedBrandListId(v)
                    setPtCandidates([])
                    setSelectedPtIds(new Set())
                    setPtSearchQuery('')
                    if (matchDnmkProduct) void fetchSuggestions(matchDnmkProduct.id, v)
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Marka seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={String(b.id)}>{b.brand}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">PT Ürünlerinde Ara</label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    placeholder="Parça no, ürün kodu, isim, OEM no ile ara... (boşaltınca öneriler geri döner)"
                    value={ptSearchQuery}
                    onChange={(e) => {
                      const v = e.target.value
                      setPtSearchQuery(v)
                      if (v.trim() === '') {
                        if (matchDnmkProduct) void fetchSuggestions(matchDnmkProduct.id, selectedBrandListId)
                      } else {
                        searchPtProducts(selectedBrandListId, v)
                      }
                    }}
                    className="pl-8"
                    disabled={!selectedBrandListId}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedBrandListId
                    ? 'Açılışta part_no benzerliğine göre öneriler gelir. Aramak için yazın; silince öneriler geri döner.'
                    : 'Önce bir marka seçin.'}
                </p>
              </div>

              <div className="max-h-72 overflow-y-auto overflow-x-hidden border rounded-md divide-y">
                {ptSearchLoading || suggestLoading ? (
                  <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin mr-2" />
                    {ptSearchLoading ? 'Aranıyor...' : 'Öneriler yükleniyor...'}
                  </div>
                ) : ptCandidates.length === 0 ? (
                  <div className="py-8 text-sm text-muted-foreground text-center">
                    {ptSearchQuery
                      ? 'Eşleşen PT ürünü bulunamadı.'
                      : 'Benzer part_no bulunamadı. Arama yaparak farklı bir PT ürünü arayabilirsiniz.'}
                  </div>
                ) : (
                  ptCandidates.map((pt) => {
                    const checked = selectedPtIds.has(pt.id)
                    return (
                      <label
                        key={pt.id}
                        htmlFor={`pt-${pt.id}`}
                        className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <Checkbox
                          id={`pt-${pt.id}`}
                          checked={checked}
                          onCheckedChange={(c) => {
                            setSelectedPtIds((prev) => {
                              const next = new Set(prev)
                              if (c) next.add(pt.id)
                              else next.delete(pt.id)
                              return next
                            })
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 text-xs font-mono overflow-hidden">
                            <span className="font-medium truncate min-w-0">{pt.part_no ?? pt.product_id}</span>
                            {typeof pt.similarity === 'number' && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                                {Math.round(pt.similarity * 100)}%
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{pt.title}</p>
                        </div>
                      </label>
                    )
                  })
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 mt-3 border-t">
              <span className="text-xs text-muted-foreground">
                {selectedPtIds.size > 0
                  ? `${selectedPtIds.size} ürün seçildi`
                  : 'Seçim yapmak için kutuları işaretleyin'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleApproveWithoutMatch}
                  disabled={matchingLoading}
                  className="h-8 px-3 text-xs"
                  title="Eşleşme olmadan APPROVED olarak işaretle"
                >
                  {matchingLoading ? (
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle2 className="size-3.5 mr-1.5" />
                  )}
                  Eşleşmesiz Onayla
                </Button>
                <Button
                  size="sm"
                  onClick={handleBulkLink}
                  disabled={selectedPtIds.size === 0 || matchingLoading}
                  className="h-8 px-3 text-xs"
                >
                  {matchingLoading ? (
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Link2 className="size-3.5 mr-1.5" />
                  )}
                  Seçilenleri Eşleştir ({selectedPtIds.size})
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {bulkDialogOpen && (
        <Dialog open={bulkDialogOpen} onOpenChange={setBulkDialogOpen}>
          <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-[95vw] overflow-hidden">
            <DialogHeader className="min-w-0">
              <DialogTitle>Toplu Eşleştir — İncele ve Onayla</DialogTitle>
              <DialogDescription className="text-xs">
                Seçili marka için trigram benzerliğine göre aday (DNMK ↔ PT) çiftleri. Kanıt için part_no'ları yan yana kontrol edin, onaylamak istediklerinizi işaretleyin.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  {bulkLoading
                    ? 'Adaylar yükleniyor...'
                    : `Toplam ${bulkPagination.total} aday çift · ${bulkSelectedKeys.size} seçili`}
                </div>
                {!bulkLoading && bulkPairs.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        const allKeys = bulkPairs.map((r) => `${r.dnmk_id}:${r.ptdrk_id}`)
                        syncBulkSelectedKeysRef(new Set([...bulkSelectedKeysRef.current, ...allKeys]))
                      }}
                    >
                      Sayfayı Seç
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => syncBulkSelectedKeysRef(new Set())}
                    >
                      Seçimi Temizle
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        syncBulkSelectedKeysRef(new Set(
                          bulkPairs.filter((r) => r.similarity >= 0.7).map((r) => `${r.dnmk_id}:${r.ptdrk_id}`)
                        ))
                      }}
                    >
                      Yalnız ≥%70
                    </Button>
                  </div>
                )}
              </div>

              <div className="max-h-[55vh] overflow-auto border rounded-md">
                {bulkLoading ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Adaylar yükleniyor...
                  </div>
                ) : bulkPairs.length === 0 ? (
                  <div className="py-12 text-sm text-muted-foreground text-center">
                    Benzer part_no çifti bulunamadı. Eşiği düşürmek için farklı bir marka deneyin veya tek tek eşleştirin.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/50 backdrop-blur">
                      <tr className="text-left">
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2">Marka</th>
                        <th className="px-3 py-2 font-mono">DNMK Part No</th>
                        <th className="px-3 py-2 font-mono">PTDRK Part No</th>
                        <th className="px-3 py-2 w-16 text-center">Benzerlik</th>
                        <th className="px-3 py-2">DNMK Açıklama</th>
                        <th className="px-3 py-2">PTDRK Açıklama</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {bulkPairs.map((row) => {
                        const key = `${row.dnmk_id}:${row.ptdrk_id}`
                        const checked = bulkSelectedKeys.has(key)
                        return (
                          <tr
                            key={key}
                            className={`cursor-pointer hover:bg-muted/40 transition-colors ${checked ? 'bg-primary/5' : ''}`}
                            onClick={() => {
                              const next = new Set(bulkSelectedKeysRef.current)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              syncBulkSelectedKeysRef(next)
                            }}
                          >
                            <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(c) => {
                                  const next = new Set(bulkSelectedKeysRef.current)
                                  if (c) next.add(key)
                                  else next.delete(key)
                                  syncBulkSelectedKeysRef(next)
                                }}
                              />
                            </td>
                            <td className="px-3 py-2 truncate max-w-[80px]">{row.brand_name}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{row.dnmk_part_no ?? row.dnmk_stock_code}</td>
                            <td className="px-3 py-2 font-mono whitespace-nowrap">{row.ptdrk_part_no ?? row.ptdrk_product_id}</td>
                            <td className="px-3 py-2 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                                row.similarity >= 0.7
                                  ? 'bg-green-100 text-green-700'
                                  : row.similarity >= 0.5
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-muted text-muted-foreground'
                              }`}>
                                {Math.round(row.similarity * 100)}%
                              </span>
                            </td>
                            <td className="px-3 py-2 max-w-[200px] text-muted-foreground">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="truncate block cursor-help">
                                    {row.dnmk_stock_name ?? '-'}
                                  </span>
                                </TooltipTrigger>
                                {row.dnmk_stock_name && (
                                  <TooltipContent className="max-w-md whitespace-normal text-left">
                                    {row.dnmk_stock_name}
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </td>
                            <td className="px-3 py-2 max-w-[240px] text-muted-foreground">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="truncate block cursor-help">
                                    {row.ptdrk_title}
                                  </span>
                                </TooltipTrigger>
                                {row.ptdrk_title && (
                                  <TooltipContent className="max-w-md whitespace-normal text-left">
                                    {row.ptdrk_title}
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {!bulkLoading && bulkPairs.length > 0 && (
                <DataTablePagination
                  page={bulkPagination.page}
                  pages={bulkPagination.pages}
                  totalRows={bulkPagination.total}
                  onPageChange={handleBulkPageChange}
                />
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 mt-1 border-t">
              <span className="text-xs text-muted-foreground">
                {bulkSelectedKeys.size > 0
                  ? `${bulkSelectedKeys.size} çift seçili — onaylayınca product_mappings'e APPROVED yazılır (v0.products transferi en son toplu yapılır)`
                  : 'Onaylamak için en az bir çift seçin'}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => setBulkDialogOpen(false)}
                  disabled={bulkApproving}
                >
                  İptal
                </Button>
                <Button
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={handleBulkApprove}
                  disabled={bulkSelectedKeys.size === 0 || bulkApproving}
                >
                  {bulkApproving ? (
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                  ) : (
                    <CheckCircle2 className="size-3.5 mr-1.5" />
                  )}
                  Seçilenleri Onayla ({bulkSelectedKeys.size})
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

    </div>
  )
}
