'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Link2, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
}

interface BsbgProductRow {
  id: number
  malzeme_no: string
  part_no: string | null
  aciklama: string | null
  brand: string
  brand_list_id: number
}

interface PtdrkProductRow {
  id: number
  product_id: string
  part_no: string | null
  title: string
  brand: string
  brand_list_id: number
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isApproved = (s: string | null) => s === 'APPROVED' || s === 'APPROVED_MANUAL'
const isPending = (s: string | null) => s === 'PENDING'

function statusColor(status: string | null): string {
  if (isApproved(status)) return 'text-green-600 bg-green-50 border-green-200'
  if (isPending(status)) return 'text-amber-600 bg-amber-50 border-amber-200'
  return 'text-muted-foreground bg-muted border-border'
}

function statusLabel(status: string | null, matchMethod: string | null): string {
  if (isApproved(status)) {
    return matchMethod === 'NO_MATCH' ? 'Onaylandı' : 'Eşleşmiş'
  }
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

  const handlePageChange = useCallback((p: number) => {
    void fetchRows(filters, searchValue, p, activeTab)
  }, [filters, searchValue, activeTab])

  // ─── Render helpers ────────────────────────────────────────────────────────

  const renderDnmkActions = () => <span className="text-xs text-muted-foreground">-</span>

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

      <AdminFilterBar onReset={handleFilterReset}>
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
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(null)}`}>
                      {statusIcon(null)}
                      {statusLabel(null, null)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-medium">{row.brand}</td>
                  <td className="px-4 py-2.5 font-mono text-xs whitespace-nowrap">{row.stock_code}</td>
                  <td className="px-4 py-2.5 font-mono text-xs">{row.part_no ?? '-'}</td>
                  <td className="px-4 py-2.5 truncate max-w-[300px]">{row.stock_name ?? '-'}</td>
                  <td className="px-4 py-2.5">{renderDnmkActions()}</td>
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
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(null)}`}>
                      {statusIcon(null)}
                      {statusLabel(null, null)}
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
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(null)}`}>
                      {statusIcon(null)}
                      {statusLabel(null, null)}
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

    </div>
  )
}
