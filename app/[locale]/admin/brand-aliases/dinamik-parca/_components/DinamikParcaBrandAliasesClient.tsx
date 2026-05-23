'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import {
  Check,
  X,
  Ban,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  Link2,
  Unlink,
  CheckCircle
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

type AliasStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'IGNORED'

interface AliasRow {
  id: number
  dinamikBrand: string
  normalizedDinamikBrand: string
  parcatedarikManufacturerId: number
  parcatedarikManufacturerName: string
  normalizedPcManufacturer: string
  mappingStatus: string
  confidence: number
  matchMethod: string | null
  approvedBy: string | null
  approvedAt: string | null
  updatedAt: string | null
}

interface AliasSummary {
  total: number
  approved: number
  pending: number
  rejected: number
  ignored: number
  totalDinamikBrands: number
  totalPcManufacturers: number
  matchedBrands: number
  unmatchedBrands: number
}

interface Manufacturer {
  id: number
  name: string
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Beklemede',
  APPROVED: 'Onaylandı',
  REJECTED: 'Reddedildi',
  IGNORED: 'Yoksayıldı',
  UNMATCHED: 'Eşleşmeyen'
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-600/10',
  APPROVED: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
  REJECTED: 'bg-rose-50 text-rose-700 ring-rose-600/10',
  IGNORED: 'bg-slate-50 text-slate-600 ring-slate-500/10',
  UNMATCHED: 'bg-orange-50 text-orange-700 ring-orange-600/10'
}

const METHOD_LABELS: Record<string, string> = {
  EXACT_NORMALIZED: 'Birebir (Normalize)',
  CASE_INSENSITIVE: 'Büyük/Küçük Harf',
  NORMALIZED_BRAND_NAME: 'Marka Adı (Normalize)',
  MANUAL: 'Manuel'
}

export function DinamikParcaBrandAliasesClient() {
  const [isPending, startTransition] = useTransition()
  const [aliases, setAliases] = useState<AliasRow[]>([])
  const [summary, setSummary] = useState<AliasSummary | null>(null)
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const [filters, setFilters] = useState({
    q: '',
    status: 'all',
    page: 1,
    limit: 50
  })
  const filtersRef = useRef(filters)
  useEffect(() => { filtersRef.current = filters }, [filters])

  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateTarget, setUpdateTarget] = useState<AliasRow | null>(null)
  const [manufacturerSearch, setManufacturerSearch] = useState('')
  const [manufacturerResults, setManufacturerResults] = useState<Manufacturer[]>([])
  const [manufacturerSearching, setManufacturerSearching] = useState(false)

  const loadAliases = useCallback(async (f: typeof filters) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (f.q) params.set('q', f.q)
      if (f.status !== 'all') params.set('status', f.status)
      params.set('page', String(f.page))
      params.set('limit', String(f.limit))

      const res = await fetch(`/api/admin/brand-aliases/dinamik-parca?${params}`)
      if (!res.ok) {
        toast.error(`Eşleştirmeler yüklenemedi (${res.status})`)
        setLoading(false)
        return
      }

      const data = await res.json()
      if (!data.error) {
        setAliases(data.rows || [])
        setPagination(data.pagination || { page: 1, limit: 50, total: 0, pages: 1 })
        setSummary(data.summary || null)
      } else {
        toast.error(data.error?.message || 'Eşleştirmeler yüklenemedi')
      }
    } catch (err) {
      console.error('Failed to load aliases:', err)
      toast.error('Eşleştirmeler yüklenemedi')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAliases(filters)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = useCallback((patch: Partial<typeof filters>) => {
    const next = { ...filtersRef.current, ...patch }
    setFilters(next)
    setSelectedIds(new Set())
    void loadAliases(next)
  }, [loadAliases])

  const handleAction = useCallback(async (id: number, action: string) => {
    try {
      const res = await fetch(`/api/admin/brand-aliases/dinamik-parca/${id}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })
      const data = await res.json()
      if (!data.error) {
        toast.success(data.message || `İşlem başarılı: ${action}`)
        void loadAliases(filtersRef.current)
      } else {
        toast.error(data.error?.message || 'İşlem başarısız')
      }
    } catch {
      toast.error('İşlem başarısız')
    }
  }, [loadAliases])

  const handleUpdate = useCallback(async () => {
    if (!updateTarget || !manufacturerSearch) return
    const mfrId = parseInt(manufacturerSearch, 10)
    if (isNaN(mfrId)) return

    try {
      if (updateTarget.mappingStatus === 'UNMATCHED' || updateTarget.id === 0) {
        const res = await fetch('/api/admin/brand-aliases/dinamik-parca/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dinamikBrand: updateTarget.dinamikBrand,
            parcatedarikManufacturerId: mfrId,
            confidence: 0.95
          })
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || 'Marka eşleştirmesi oluşturuldu')
          setUpdateDialogOpen(false)
          void loadAliases(filtersRef.current)
        } else {
          toast.error(data.error?.message || 'Eşleştirme başarısız')
        }
      } else {
        const res = await fetch(`/api/admin/brand-aliases/dinamik-parca/${updateTarget.id}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ parcatedarikManufacturerId: mfrId })
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || 'Eşleştirme güncellendi')
          setUpdateDialogOpen(false)
          void loadAliases(filtersRef.current)
        } else {
          toast.error(data.error?.message || 'Güncelleme başarısız')
        }
      }
    } catch {
      toast.error('Güncelleme başarısız')
    }
  }, [updateTarget, manufacturerSearch, loadAliases])

  const handleAcceptAsIs = useCallback(async (dinamikBrand: string) => {
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/brand-aliases/dinamik-parca/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dinamikBrand, acceptAsIs: true, confidence: 0.95 })
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || 'Dinamik markası olduğu gibi kabul edildi')
          void loadAliases(filtersRef.current)
        } else {
          toast.error(data.error?.message || 'İşlem başarısız')
        }
      } catch {
        toast.error('İşlem başarısız')
      }
    })
  }, [loadAliases])

  const handleGenerate = useCallback(() => {
    setGenerating(true)
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/brand-aliases/dinamik-parca', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate' })
        })
        const data = await res.json()
        if (!data.error) {
          toast.success('Marka eşleştirmeleri oluşturuldu')
          void loadAliases(filtersRef.current)
        } else {
          toast.error(data.error?.message || 'Oluşturma başarısız')
        }
      } catch {
        toast.error('Oluşturma başarısız')
      } finally {
        setGenerating(false)
      }
    })
  }, [loadAliases])

  const handleBulkApprove = useCallback(() => {
    if (selectedIds.size === 0) {
      toast.error('En az bir eşleştirme seçin')
      return
    }
    startTransition(async () => {
      try {
        const res = await fetch('/api/admin/brand-aliases/dinamik-parca', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'bulk-approve', ids: Array.from(selectedIds), minConfidence: 0.85 })
        })
        const data = await res.json()
        if (!data.error) {
          toast.success(data.message || `${data.approved} eşleştirme onaylandı`)
          setSelectedIds(new Set())
          void loadAliases(filtersRef.current)
        } else {
          toast.error(data.error?.message || 'Toplu onay başarısız')
        }
      } catch {
        toast.error('Toplu onay başarısız')
      }
    })
  }, [selectedIds, loadAliases])

  const searchManufacturers = useCallback(async (q: string) => {
    if (!q || q.length < 2) {
      setManufacturerResults([])
      return
    }
    setManufacturerSearching(true)
    try {
      const num = parseInt(q, 10)
      const params = new URLSearchParams()
      if (!isNaN(num)) {
        params.set('q', '')
      } else {
        params.set('q', q)
      }
      params.set('limit', '20')
      const res = await fetch(`/api/admin/brand-aliases/dinamik-parca/manufacturers?${params}`)
      if (res.ok) {
        const data = await res.json()
        setManufacturerResults(data || [])
      }
    } catch {
      // ignore
    }
    setManufacturerSearching(false)
  }, [])

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const summaryCards = summary
    ? [
        { label: 'Toplam Eşleştirme', value: summary.total, color: 'bg-slate-500' },
        { label: 'Dinamik Markalar', value: summary.totalDinamikBrands, color: 'bg-blue-500' },
        { label: 'PT Üreticiler', value: summary.totalPcManufacturers, color: 'bg-violet-500' },
        { label: 'Eşleşen Markalar', value: summary.matchedBrands, color: 'bg-teal-500' },
        { label: 'Eşleşmeyen', value: summary.unmatchedBrands, color: 'bg-orange-500' },
        { label: 'Onaylandı', value: summary.approved, color: 'bg-emerald-500' },
        { label: 'Beklemede', value: summary.pending, color: 'bg-amber-500' },
        { label: 'Reddedildi', value: summary.rejected, color: 'bg-rose-500' }
      ]
    : []

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {loading && !summary ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="mt-2 h-7 w-16" />
            </div>
          ))
        ) : (
          summaryCards.map((card, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-xs font-medium text-slate-500">{card.label}</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-slate-900">
                  {typeof card.value === 'number' ? card.value.toLocaleString('tr-TR') : card.value}
                </span>
                <span className={`inline-block h-2 w-2 rounded-full ${card.color}`} />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleGenerate}
          disabled={generating}
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${generating ? 'animate-spin' : ''}`} />
          {generating ? 'Oluşturuluyor...' : 'Otomatik Eşleştir'}
        </Button>
        {selectedIds.size > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleBulkApprove}
            disabled={isPending}
          >
            <Check className="mr-1.5 h-3.5 w-3.5" />
            Seçilenleri Onayla ({selectedIds.size})
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              <Search className="mr-1 inline h-3 w-3" />
              Marka / Üretici Ara
            </label>
            <Input
              value={filters.q}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') applyFilters({ q: filters.q }) }}
              placeholder="Ara..."
              className="h-8 text-sm"
            />
          </div>
          <div className="w-40">
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Durum</label>
            <Select value={filters.status} onValueChange={v => applyFilters({ status: v, page: 1 })}>
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tümü</SelectItem>
                <SelectItem value="pending">Beklemede</SelectItem>
                <SelectItem value="approved">Onaylandı</SelectItem>
                <SelectItem value="rejected">Reddedildi</SelectItem>
                <SelectItem value="ignored">Yoksayıldı</SelectItem>
                <SelectItem value="unmatched">Eşleşmeyen</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" className="h-8" onClick={() => applyFilters({ q: filters.q })}>
            <Search className="mr-1.5 h-3.5 w-3.5" />
            Filtrele
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Dinamik Marka</TableHead>
                <TableHead>Normalize</TableHead>
                <TableHead>PT Üretici</TableHead>
                <TableHead>Normalize</TableHead>
                <TableHead>Güven</TableHead>
                <TableHead>Yöntem</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : aliases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-slate-500">
                    Eşleştirme bulunamadı
                  </TableCell>
                </TableRow>
              ) : (
                aliases.map(alias => (
                  <TableRow key={alias.id || `unmatched-${alias.dinamikBrand}`} className={selectedIds.has(alias.id) ? 'bg-blue-50/50' : ''}>
                    <TableCell>
                      {alias.id > 0 && (
                        <input
                          type="checkbox"
                          checked={selectedIds.has(alias.id)}
                          onChange={() => toggleSelect(alias.id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      )}
                    </TableCell>
                    <TableCell className="font-medium text-sm">{alias.dinamikBrand}</TableCell>
                    <TableCell className="text-xs text-slate-500 font-mono">{alias.normalizedDinamikBrand}</TableCell>
                    <TableCell className="text-sm">
                      {alias.parcatedarikManufacturerName || (
                        <span className="text-slate-400 italic">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 font-mono">
                      {alias.normalizedPcManufacturer || '—'}
                    </TableCell>
                    <TableCell>
                      {alias.confidence > 0 ? (
                        <span className={`text-xs font-medium ${
                          alias.confidence >= 0.95 ? 'text-emerald-700' :
                          alias.confidence >= 0.85 ? 'text-amber-700' :
                          'text-slate-600'
                        }`}>
                          {alias.confidence.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {alias.matchMethod ? METHOD_LABELS[alias.matchMethod] || alias.matchMethod : '-'}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_COLORS[alias.mappingStatus] || 'bg-slate-50 text-slate-600'}`}>
                        {STATUS_LABELS[alias.mappingStatus] || alias.mappingStatus}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {alias.mappingStatus === 'PENDING' && alias.id > 0 && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-emerald-600 hover:text-emerald-700"
                              onClick={() => handleAction(alias.id, 'approve')}
                              title="Onayla"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-rose-600 hover:text-rose-700"
                              onClick={() => handleAction(alias.id, 'reject')}
                              title="Reddet"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-slate-500 hover:text-slate-700"
                              onClick={() => handleAction(alias.id, 'ignore')}
                              title="Yoksay"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                        {(alias.mappingStatus !== 'UNMATCHED' || alias.id > 0) && alias.id > 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-blue-600 hover:text-blue-700"
                            onClick={() => {
                              setUpdateTarget(alias)
                              setManufacturerSearch(String(alias.parcatedarikManufacturerId))
                              setUpdateDialogOpen(true)
                            }}
                            title="Eşleştirmeyi Değiştir"
                          >
                            <Link2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {alias.mappingStatus === 'UNMATCHED' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-blue-600 hover:text-blue-700"
                            onClick={() => {
                              setUpdateTarget(alias)
                              setManufacturerSearch('')
                              setUpdateDialogOpen(true)
                            }}
                            title="Üretici Eşleştir"
                          >
                            <Link2 className="mr-1 h-3.5 w-3.5" />
                            Eşleştir
                          </Button>
                        )}
                        {alias.mappingStatus === 'UNMATCHED' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 px-2 text-emerald-600 hover:text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                            onClick={() => handleAcceptAsIs(alias.dinamikBrand)}
                            disabled={isPending}
                            title="Dinamik markasını olduğu gibi kabul et (PT üreticisi aramadan)"
                          >
                            <CheckCircle className="mr-1 h-3.5 w-3.5" />
                            Olduğu Gibi
                          </Button>
                        )}
                        {alias.id > 0 && alias.mappingStatus !== 'UNMATCHED' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-slate-400 hover:text-rose-600"
                            onClick={() => handleAction(alias.id, 'delete')}
                            title="Sil"
                          >
                            <Unlink className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <div className="text-xs text-slate-500">
            Toplam {pagination.total.toLocaleString('tr-TR')} eşleştirme
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={pagination.page <= 1 || loading}
              onClick={() => applyFilters({ page: pagination.page - 1 })}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs text-slate-600">
              {pagination.page} / {pagination.pages}
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={pagination.page >= pagination.pages || loading}
              onClick={() => applyFilters({ page: pagination.page + 1 })}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Update Dialog */}
      <Dialog open={updateDialogOpen} onOpenChange={setUpdateDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Eşleştirmeyi Değiştir</DialogTitle>
            <DialogDescription>
              {updateTarget && (
                <span>&quot;{updateTarget.dinamikBrand}&quot; markası için ParçaTedarik üreticisi değiştir</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                ParçaTedarik Üretici ID veya Adı
              </label>
              <Input
                value={manufacturerSearch}
                onChange={e => {
                  setManufacturerSearch(e.target.value)
                  if (e.target.value.length >= 2) {
                    void searchManufacturers(e.target.value)
                  }
                }}
                placeholder="Üretici adı veya ID ara..."
                className="h-9"
              />
            </div>
            {manufacturerResults.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded border border-slate-200">
                {manufacturerResults.map(mfr => (
                  <button
                    key={mfr.id}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => {
                      setManufacturerSearch(String(mfr.id))
                      setManufacturerResults([])
                    }}
                  >
                    <span className="text-slate-400">#{mfr.id}</span>
                    <span className="font-medium">{mfr.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setUpdateDialogOpen(false)}>
              İptal
            </Button>
            <Button size="sm" onClick={handleUpdate} disabled={isPending}>
              {isPending ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}