'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import {
  Check,
  X,
  AlertTriangle,
  Eye,
  Filter,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'

type MatchStatus = 'CANDIDATE' | 'APPROVED' | 'REJECTED' | 'NEEDS_REVIEW' | 'IGNORED'
type MatchReason =
  | 'BARCODE_1_MODEL_EXACT'
  | 'BARCODE_2_MODEL_EXACT'
  | 'BARCODE_3_MODEL_EXACT'
  | 'MULTIPLE_PARCA_MODEL_MATCHES'

interface MatchRow {
  id: string
  dinamikProductId: string
  parcatedarikProductId: string
  dinamikBarcodeField: string
  dinamikBarcodeValue: string
  normalizedBarcodeValue: string
  parcatedarikModel: string
  normalizedModel: string
  matchReason: MatchReason
  confidence: number
  status: MatchStatus
  reviewNote: string | null
  approvedBy: string | null
  approvedAt: string | null
  rejectedBy: string | null
  rejectedAt: string | null
  createdAt: string
  updatedAt: string
  dinamik: {
    stockCode: string | null
    stockName: string | null
    brand: string | null
    price: string | null
    barcode1: string | null
    barcode2: string | null
    barcode3: string | null
  }
  parcatedarik: {
    title: string
    refNo: string | null
    manufacturerName: string
  }
}

interface Summary {
  total: number
  byStatus: Record<string, number>
  dinamikProducts: { total: number; withBarcode: number }
  parcatedarikProductsWithModel: number
  uniqueExactMatches: number
  multipleMatches: number
}

interface Filters {
  status: string
  barcodeField: string
  confidenceMin: string
  confidenceMax: string
  dinamikBarcode: string
  matchReason: string
  page: number
  limit: number
}

const STATUS_LABELS: Record<MatchStatus, string> = {
  CANDIDATE: 'Aday',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  NEEDS_REVIEW: 'İnceleme Gerekli',
  IGNORED: 'Yoksayıldı'
}

const STATUS_COLORS: Record<MatchStatus, string> = {
  CANDIDATE: 'bg-blue-50 text-blue-700 ring-blue-600/10',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-600/10',
  NEEDS_REVIEW: 'bg-amber-50 text-amber-700 ring-amber-600/10',
  IGNORED: 'bg-slate-50 text-slate-600 ring-slate-500/10'
}

export function DinamikParcaTedarikModelMatchingClient() {
  const [isPending, startTransition] = useTransition()
  const [matches, setMatches] = useState<MatchRow[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [detailRow, setDetailRow] = useState<MatchRow | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [partCandidates, setPartCandidates] = useState<Array<{
    partId: string
    matchType: string
    confidence: number
    ambiguous: boolean
    matchedToken: string
  }> | null>(null)
  const [partCandidatesLoading, setPartCandidatesLoading] = useState(false)

  const [filters, setFilters] = useState<Filters>({
    status: 'all',
    barcodeField: 'all',
    confidenceMin: '',
    confidenceMax: '',
    dinamikBarcode: '',
    matchReason: 'all',
    page: 1,
    limit: 20
  })
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])

  const loadMatches = useCallback(async (f: Filters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.status !== 'all') params.set('status', f.status)
      if (f.barcodeField !== 'all') params.set('barcode_field', f.barcodeField)
      if (f.confidenceMin) params.set('confidence_min', f.confidenceMin)
      if (f.confidenceMax) params.set('confidence_max', f.confidenceMax)
      if (f.dinamikBarcode) params.set('dinamik_barcode', f.dinamikBarcode)
      if (f.matchReason !== 'all') params.set('match_reason', f.matchReason)
      params.set('page', String(f.page))
      params.set('limit', String(f.limit))

      const res = await fetch(`/api/admin/supplier-matching/dinamik-parcatedarik?${params}`)

      if (!res.ok) {
        toast.error(`Eşleşmeler yüklenemedi (${res.status})`)
        setLoading(false)
        return
      }

      const data = await res.json()

      if (!data.error) {
        setMatches(data.rows || [])
        setPagination(data.pagination || { page: 1, limit: 20, total: 0, pages: 1 })
        setSummary(data.summary || null)
      } else {
        toast.error(data.error?.message || 'Eşleşmeler yüklenemedi')
      }
    } catch (err) {
      console.error('Failed to load matches:', err)
      toast.error('Eşleşmeler yüklenemedi')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMatches(filters)
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = useCallback((patch: Partial<Filters>) => {
    const next = { ...filtersRef.current, ...patch }
    setFilters(next)
    setSelectedIds(new Set())
    void loadMatches(next)
  }, [loadMatches])

  const handleAction = useCallback(async (id: string, action: string) => {
    try {
      const res = await fetch(`/api/admin/supplier-matching/dinamik-parcatedarik/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (!data.error) {
        toast.success(`Eşleşme ${action === 'approve' ? 'onaylandı' : action === 'reject' ? 'reddedildi' : action === 'ignore' ? 'yoksayıldı' : 'güncellendi'}`)
        if (data.partCandidates > 0) {
          toast.info(`${data.partCandidates} parça adayı bulundu`)
        }
        if (data.action === 'needs_review') {
          toast.warning('Birden fazla parça adayı bulundu - manuel inceleme gerekli')
        }
        void loadMatches(filtersRef.current)
      } else {
        toast.error(data.error?.message || 'İşlem başarısız')
      }
    } catch {
      toast.error('İşlem başarısız')
    }
  }, [])

  const handleBulkApprove = useCallback(() => {
    if (selectedIds.size === 0) {
      toast.error('En az bir eşleşme seçin')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/supplier-matching/dinamik-parcatedarik/bulk-approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: Array.from(selectedIds),
            minConfidence: 0.96
          })
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(`${data.updatedCount} eşleşme onaylandı`)
          setSelectedIds(new Set())
          void loadMatches(filtersRef.current)
        } else {
          toast.error(data.error?.message || 'Toplu onay başarısız')
        }
      } catch {
        toast.error('Toplu onay başarısız')
      }
    })
  }, [selectedIds, loadMatches])

  const loadPartCandidates = useCallback(async (row: MatchRow) => {
    setDetailRow(row)
    setDetailOpen(true)
    setPartCandidates(null)
    setPartCandidatesLoading(true)
    try {
      const res = await fetch(`/api/admin/supplier-matching/dinamik-parcatedarik?limit=1&page=1`)
    } catch {
      // Part candidates loaded from match detail
    }
    setPartCandidatesLoading(false)
    setPartCandidates([])
  }, [])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const summaryCards = summary
    ? [
        { label: 'Toplam Eşleşme', value: summary.total, color: 'bg-slate-500' },
        { label: 'Dinamik Ürünler', value: summary.dinamikProducts.total, color: 'bg-blue-500' },
        { label: 'Barkodlu Ürünler', value: summary.dinamikProducts.withBarcode, color: 'bg-indigo-500' },
        { label: 'PT Model Verisi', value: summary.parcatedarikProductsWithModel.toLocaleString('tr-TR'), color: 'bg-violet-500' },
        { label: 'Onaylanabilir', value: summary.byStatus?.CANDIDATE ?? 0, color: 'bg-blue-500' },
        { label: 'Onaylı', value: summary.byStatus?.APPROVED ?? 0, color: 'bg-emerald-500' },
        { label: 'İnceleme Gerekli', value: summary.byStatus?.NEEDS_REVIEW ?? 0, color: 'bg-amber-500' },
        { label: 'Reddedildi', value: summary.byStatus?.REJECTED ?? 0, color: 'bg-rose-500' },
        { label: 'Benzersiz Eşleşme', value: summary.uniqueExactMatches, color: 'bg-teal-500' },
        { label: 'Çoklu Eşleşme', value: summary.multipleMatches, color: 'bg-orange-500' }
      ]
    : []

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading && !summary ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-16" />
            </div>
          ))
        ) : (
          summaryCards.slice(0, 5).map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{card.value}</p>
              <div className={`mt-1.5 h-1 w-10 rounded-full ${card.color}`} />
            </div>
          ))
        )}
      </div>

      {summary && summaryCards.length > 5 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {summaryCards.slice(5).map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{card.value}</p>
              <div className={`mt-1.5 h-1 w-10 rounded-full ${card.color}`} />
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-4">
          <h3 className="text-sm font-semibold text-slate-900">Filtreler</h3>
        </div>
        <div className="px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Durum</label>
              <Select
                value={filters.status}
                onValueChange={(v) => applyFilters({ status: v, page: 1 })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="CANDIDATE">Aday</SelectItem>
                  <SelectItem value="APPROVED">Onaylandı</SelectItem>
                  <SelectItem value="REJECTED">Reddedildi</SelectItem>
                  <SelectItem value="NEEDS_REVIEW">İnceleme Gerekli</SelectItem>
                  <SelectItem value="IGNORED">Yoksayıldı</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Barkod Alanı</label>
              <Select
                value={filters.barcodeField}
                onValueChange={(v) => applyFilters({ barcodeField: v, page: 1 })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="barcode_1">Barkod 1</SelectItem>
                  <SelectItem value="barcode_2">Barkod 2</SelectItem>
                  <SelectItem value="barcode_3">Barkod 3</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Eşleşme Nedeni</label>
              <Select
                value={filters.matchReason}
                onValueChange={(v) => applyFilters({ matchReason: v, page: 1 })}
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Tümü" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  <SelectItem value="BARCODE_1_MODEL_EXACT">Barkod 1 Model Eşleşmesi</SelectItem>
                  <SelectItem value="BARCODE_2_MODEL_EXACT">Barkod 2 Model Eşleşmesi</SelectItem>
                  <SelectItem value="BARCODE_3_MODEL_EXACT">Barkod 3 Model Eşleşmesi</SelectItem>
                  <SelectItem value="MULTIPLE_PARCA_MODEL_MATCHES">Çoklu Model Eşleşmesi</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">Barkod Ara</label>
              <Input
                placeholder="Barkod değeri..."
                value={filters.dinamikBarcode}
                onChange={(e) => {
                  const v = e.target.value
                  setFilters(prev => ({ ...prev, dinamikBarcode: v }))
                }}
                onBlur={() => applyFilters({ dinamikBarcode: filters.dinamikBarcode, page: 1 })}
                onKeyDown={(e) => { if (e.key === 'Enter') applyFilters({ dinamikBarcode: filters.dinamikBarcode, page: 1 }) }}
                className="h-9"
              />
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const next = { status: 'all', barcodeField: 'all', confidenceMin: '', confidenceMax: '', dinamikBarcode: '', matchReason: 'all', page: 1, limit: 20 }
                setFilters(next)
                void loadMatches(next)
              }}
            >
              <Filter size={14} className="mr-1" />
              Filtreleri Sıfırla
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadMatches(filters)}
              disabled={loading}
            >
              <RefreshCw size={14} className={`mr-1 ${loading ? 'animate-spin' : ''}`} />
              Yenile
            </Button>

            {selectedIds.size > 0 && (
              <Button
                size="sm"
                onClick={handleBulkApprove}
                disabled={isPending}
              >
                {isPending ? <Loader2 size={14} className="mr-1 animate-spin" /> : <Check size={14} className="mr-1" />}
                Seçilenleri Onayla ({selectedIds.size})
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Match Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-slate-200 bg-slate-50/90">
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.size > 0 && matches.length > 0 && matches.every(m => selectedIds.has(m.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedIds(new Set(matches.filter(m => m.status === 'CANDIDATE').map(m => m.id)))
                      } else {
                        setSelectedIds(new Set())
                      }
                    }}
                    className="rounded border-slate-300"
                  />
                </TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Durum</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Güven</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Neden</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Dinamik</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Barkod</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">ParçaTedarik</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Model</TableHead>
                <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 text-right">İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && matches.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={`loading-${i}`}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={`loading-${i}-${j}`}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : matches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-14 text-center text-slate-500">
                    Eşleşme bulunamadı.
                  </TableCell>
                </TableRow>
              ) : (
                matches.map((match) => (
                  <TableRow key={match.id} className="group">
                    <TableCell>
                      {match.status === 'CANDIDATE' && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(match.id)}
                          onChange={() => toggleSelect(match.id)}
                          className="rounded border-slate-300"
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${STATUS_COLORS[match.status] || 'bg-slate-50 text-slate-600'}`}>
                        {STATUS_LABELS[match.status] || match.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm">{match.confidence.toFixed(4)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-slate-600">{match.matchReason.replace(/_/g, ' ')}</span>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{match.dinamik.stockCode || '-'}</p>
                        <p className="truncate text-xs text-slate-500">{match.dinamik.brand || '-'}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-mono text-xs">{match.dinamikBarcodeField}: {match.dinamikBarcodeValue}</p>
                    </TableCell>
                    <TableCell>
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-900">{match.parcatedarik.title.slice(0, 50)}</p>
                        <p className="truncate text-xs text-slate-500">{match.parcatedarik.manufacturerName}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-mono text-xs">{match.normalizedModel}</p>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {match.status === 'CANDIDATE' || match.status === 'NEEDS_REVIEW' ? (
                          <>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-emerald-600 hover:text-emerald-700" onClick={() => handleAction(match.id, 'approve')}>
                              <Check size={12} />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs text-rose-500 hover:text-rose-600" onClick={() => handleAction(match.id, 'reject')}>
                              <X size={12} />
                            </Button>
                          </>
                        ) : null}
                        {match.status === 'CANDIDATE' && (
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-slate-500" onClick={() => handleAction(match.id, 'ignore')}>
                            <AlertTriangle size={12} />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => loadPartCandidates(match)}>
                          <Eye size={12} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
          <p className="text-sm text-slate-500">
            Toplam {pagination.total.toLocaleString('tr-TR')} eşleşme
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1 || loading}
              onClick={() => applyFilters({ page: pagination.page - 1 })}
            >
              <ChevronLeft size={14} />
            </Button>
            <span className="text-sm text-slate-600">
              {pagination.page} / {pagination.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pages || loading}
              onClick={() => applyFilters({ page: pagination.page + 1 })}
            >
              <ChevronRight size={14} />
            </Button>
          </div>
        </div>
      </div>

      {/* Detail Drawer */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Eşleşme Detayı</DialogTitle>
            <DialogDescription>
              Dinamik - ParçaTedarik eşleşme detayları
            </DialogDescription>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-4 text-sm">
              <div>
                <h4 className="font-semibold text-slate-900">Dinamik Ürün</h4>
                <div className="mt-1 space-y-1 text-slate-600">
                  <p>Stok Kodu: <span className="font-mono">{detailRow.dinamik.stockCode}</span></p>
                  <p>Ürün Adı: {detailRow.dinamik.stockName || '-'}</p>
                  <p>Marka: {detailRow.dinamik.brand || '-'}</p>
                  <p>Fiyat: {detailRow.dinamik.price || '-'}</p>
                  <p>Barkod 1: <span className="font-mono">{detailRow.dinamik.barcode1 || '-'}</span></p>
                  <p>Barkod 2: <span className="font-mono">{detailRow.dinamik.barcode2 || '-'}</span></p>
                  <p>Barkod 3: <span className="font-mono">{detailRow.dinamik.barcode3 || '-'}</span></p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900">ParçaTedarik Ürün</h4>
                <div className="mt-1 space-y-1 text-slate-600">
                  <p>ID: {detailRow.parcatedarikProductId}</p>
                  <p>Başlık: {detailRow.parcatedarik.title}</p>
                  <p>Üretici: {detailRow.parcatedarik.manufacturerName}</p>
                  <p>ref_no: <span className="font-mono">{detailRow.parcatedarik.refNo || '-'}</span></p>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900">Eşleşme Bilgisi</h4>
                <div className="mt-1 space-y-1 text-slate-600">
                  <p>Alan: {detailRow.dinamikBarcodeField}</p>
                  <p>Değer: <span className="font-mono">{detailRow.dinamikBarcodeValue}</span></p>
                  <p>Normalized: <span className="font-mono">{detailRow.normalizedBarcodeValue}</span></p>
                  <p>Model: <span className="font-mono">{detailRow.parcatedarikModel}</span></p>
                  <p>Güven: {detailRow.confidence.toFixed(4)}</p>
                  <p>Neden: {detailRow.matchReason}</p>
                  <p>Durum: {STATUS_LABELS[detailRow.status]}</p>
                  {detailRow.approvedBy && <p>Onaylayan: {detailRow.approvedBy}</p>}
                  {detailRow.reviewNote && <p>Not: {detailRow.reviewNote}</p>}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                {(detailRow.status === 'CANDIDATE' || detailRow.status === 'NEEDS_REVIEW') && (
                  <>
                    <Button size="sm" onClick={() => { handleAction(detailRow.id, 'approve'); setDetailOpen(false) }}>
                      Onayla
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { handleAction(detailRow.id, 'reject'); setDetailOpen(false) }}>
                      Reddet
                    </Button>
                    {detailRow.status === 'CANDIDATE' && (
                      <Button size="sm" variant="outline" onClick={() => { handleAction(detailRow.id, 'ignore'); setDetailOpen(false) }}>
                        Yoksay
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}