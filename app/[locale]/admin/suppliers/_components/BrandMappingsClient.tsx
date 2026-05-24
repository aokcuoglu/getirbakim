'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, Search, SlidersHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Pagination } from '@/components/ui/Pagination'
import { AdminLoadingState } from '@/components/admin/admin-loading-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  MobileDataCard,
  ResponsiveDataView
} from '@/components/admin/responsive-data-view'
import {
  autoMapDinamikBrandsByName,
  getDinamikBrandMappings,
  saveDinamikBrandMapping,
  searchPublicPartBrandsForSupplierMapping
} from '@/lib/actions/admin-suppliers'

interface BrandMappingRow {
  supplierBrand: string
  mappedPartBrand: { id: number; name: string } | null
  exactCandidate: { id: number; name: string } | null
  status: 'APPROVED' | 'PENDING' | 'UNMAPPED'
  confidence: number | null
  updatedAt: string | null
}

interface BrandMappingsClientProps {
  initialLoaded: boolean
  initialRows: BrandMappingRow[]
  initialPagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  initialSummary: {
    total: number
    mapped: number
    pending: number
    unmapped: number
  }
  initialFilters: {
    q: string
    status: 'all' | 'mapped' | 'unmapped' | 'pending'
  }
}

export function BrandMappingsClient({
  initialLoaded,
  initialRows,
  initialPagination,
  initialSummary,
  initialFilters
}: BrandMappingsClientProps) {
  const [isPending, startTransition] = useTransition()
  const [rows, setRows] = useState<BrandMappingRow[]>(initialRows)
  const [pagination, setPagination] = useState(initialPagination)
  const [summary, setSummary] = useState(initialSummary)
  const [query, setQuery] = useState(initialFilters.q)
  const [status, setStatus] = useState<'all' | 'mapped' | 'unmapped' | 'pending'>(
    initialFilters.status
  )

  const [selectedSupplierBrand, setSelectedSupplierBrand] = useState<string | null>(null)
  const [partBrandQuery, setPartBrandQuery] = useState('')
  const [partBrandResults, setPartBrandResults] = useState<Array<{ id: number; name: string }>>(
    []
  )
  const latestBrandSearchRef = useRef(0)

  const closeManualMap = () => {
    latestBrandSearchRef.current += 1
    setSelectedSupplierBrand(null)
    setPartBrandQuery('')
    setPartBrandResults([])
  }

  const searchPartBrands = (q: string, showEmptyToast = false) => {
    const queryValue = q.trim()
    if (!queryValue) {
      setPartBrandResults([])
      return
    }

    startTransition(async () => {
      const requestId = latestBrandSearchRef.current + 1
      latestBrandSearchRef.current = requestId
      const result = await searchPublicPartBrandsForSupplierMapping({
        q: queryValue,
        limit: 20
      })
      if (latestBrandSearchRef.current !== requestId) return
      setPartBrandResults(result)
      if (showEmptyToast && result.length === 0) {
        toast.message('Public marka bulunamadı.')
      }
    })
  }

  const loadRows = (
    page: number,
    overrides?: {
      q?: string
      status?: 'all' | 'mapped' | 'unmapped' | 'pending'
    },
    options?: { silentEmpty?: boolean }
  ) => {
    const nextQ = (overrides?.q ?? query).trim()
    const nextStatus = overrides?.status ?? status

    startTransition(async () => {
      const result = await getDinamikBrandMappings({
        q: nextQ || undefined,
        status: nextStatus,
        page,
        limit: pagination.limit
      })

      setRows(result.rows)
      setPagination(result.pagination)
      setSummary(result.summary)
      if (result.rows.length === 0 && !options?.silentEmpty) {
        toast.message('Marka sonucu bulunamadı.')
      }
    })
  }

  const runSearch = () => {
    loadRows(1)
  }

  const runAutoMap = () => {
    startTransition(async () => {
      const result = await autoMapDinamikBrandsByName({
        q: query.trim() || undefined,
        limit: 3000
      })

      if (!result.success) {
        toast.error(result.message || 'Otomatik marka eşleştirmesi başarısız.')
        return
      }

      toast.success(result.message)
      loadRows(1)
    })
  }

  const quickMapExact = (row: BrandMappingRow) => {
    if (!row.exactCandidate) {
      toast.error('Bu marka için birebir aday bulunamadı.')
      return
    }

    startTransition(async () => {
      const result = await saveDinamikBrandMapping({
        supplierBrand: row.supplierBrand,
        partBrandId: row.exactCandidate?.id
      })

      if (!result.success) {
        toast.error(result.message || 'Kaydetme başarısız.')
        return
      }

      toast.success(result.message)
      loadRows(pagination.page)
    })
  }

  const openManualMap = (row: BrandMappingRow) => {
    const lookup = row.exactCandidate?.name || row.mappedPartBrand?.name || row.supplierBrand
    setPartBrandQuery(lookup)
    setSelectedSupplierBrand(row.supplierBrand)
    setPartBrandResults([])
  }

  const applyManualMap = (partBrandId: number) => {
    if (!selectedSupplierBrand) return

    startTransition(async () => {
      const result = await saveDinamikBrandMapping({
        supplierBrand: selectedSupplierBrand,
        partBrandId
      })

      if (!result.success) {
        toast.error(result.message || 'Kaydetme başarısız.')
        return
      }

      toast.success(result.message)
      closeManualMap()
      loadRows(pagination.page)
    })
  }

  const clearBrandMap = (supplierBrand: string) => {
    startTransition(async () => {
      const result = await saveDinamikBrandMapping({
        supplierBrand,
        partBrandId: null
      })
      if (!result.success) {
        toast.error(result.message || 'Temizleme başarısız.')
        return
      }
      toast.success(result.message)
      loadRows(pagination.page)
    })
  }

  useEffect(() => {
    if (!selectedSupplierBrand) return

    const lookup = partBrandQuery.trim() || selectedSupplierBrand
    const timer = setTimeout(() => {
      searchPartBrands(lookup)
    }, 200)

    return () => clearTimeout(timer)
  }, [partBrandQuery, selectedSupplierBrand])

  useEffect(() => {
    if (initialLoaded) return
    loadRows(1, undefined, { silentEmpty: true })
  }, [initialLoaded])

  const hasActiveFilters = Boolean(query.trim()) || status !== 'all'

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-slate-900">Marka Listesi</h3>
              <p className="mt-1 text-sm text-slate-500">
                Dinamik marka adlarını tek yerde yönetin ve public marka eşleşmelerini hızla düzeltin.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={runSearch} disabled={isPending}>
                {isPending ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : (
                  <Search size={14} className="mr-2" />
                )}
                Yenile
              </Button>
              <Button onClick={runAutoMap} disabled={isPending}>
                Otomatik Eşleştir
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <BrandMetric label="Toplam" value={summary.total} loading={isPending && rows.length === 0} accentClass="bg-slate-500" />
            <BrandMetric label="Eşleşen" value={summary.mapped} loading={isPending && rows.length === 0} accentClass="bg-emerald-500" />
            <BrandMetric label="Pending" value={summary.pending} loading={isPending && rows.length === 0} accentClass="bg-amber-500" />
            <BrandMetric label="Eşleşmeyen" value={summary.unmapped} loading={isPending && rows.length === 0} accentClass="bg-rose-500" />
          </div>
        </div>

        <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="grid gap-2 lg:grid-cols-[minmax(280px,2fr)_auto]">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Dinamik marka ara"
              className="h-9 border-slate-200 bg-white"
            />

            <Button
              type="button"
              variant="outline"
              className="h-9"
              onClick={runSearch}
              disabled={isPending}
            >
              {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Search size={14} className="mr-2" />}
              Listele
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={status === 'all' ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => {
                setStatus('all')
                loadRows(1, { status: 'all' }, { silentEmpty: true })
              }}
            >
              Tümü
            </Button>

            <Button
              type="button"
              variant={status === 'mapped' ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => {
                setStatus('mapped')
                loadRows(1, { status: 'mapped' }, { silentEmpty: true })
              }}
            >
              Eşleşen
            </Button>

            <Button
              type="button"
              variant={status === 'unmapped' ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => {
                setStatus('unmapped')
                loadRows(1, { status: 'unmapped' }, { silentEmpty: true })
              }}
            >
              Eşleşmeyen
            </Button>

            <Button
              type="button"
              variant={status === 'pending' ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() => {
                setStatus('pending')
                loadRows(1, { status: 'pending' }, { silentEmpty: true })
              }}
            >
              Pending
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-full border-slate-300 px-3 text-xs"
              disabled={!hasActiveFilters}
              onClick={() => {
                setQuery('')
                setStatus('all')
                loadRows(
                  1,
                  {
                    q: '',
                    status: 'all'
                  },
                  { silentEmpty: true }
                )
              }}
            >
              <SlidersHorizontal size={13} className="mr-1.5" />
              Filtreleri Sıfırla
            </Button>
          </div>
        </div>

        <ResponsiveDataView
          mobile={
            isPending && rows.length === 0 ? (
              <AdminLoadingState minHeight="min-h-[240px]" />
            ) : rows.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-500">
                Marka eşleştirme sonucu bulunamadı.
              </div>
            ) : (
              <div className="space-y-3 px-4 py-4">
                {rows.map((row) => (
                  <MobileDataCard key={row.supplierBrand}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 truncate">
                          {row.supplierBrand}
                        </p>
                        <p className="text-xs text-slate-600 truncate">
                          Public: {row.mappedPartBrand ? row.mappedPartBrand.name : '-'}
                        </p>
                        <p className="text-xs text-slate-600 truncate">
                          Aday: {row.exactCandidate ? row.exactCandidate.name : '-'}
                        </p>
                      </div>
                      <BrandStatusBadge status={row.status} />
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!row.exactCandidate || isPending}
                        onClick={() => quickMapExact(row)}
                      >
                        Aday
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => openManualMap(row)}
                      >
                        Manuel
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        disabled={!row.mappedPartBrand}
                        onClick={() => clearBrandMap(row.supplierBrand)}
                      >
                        Temizle
                      </Button>
                    </div>
                  </MobileDataCard>
                ))}
              </div>
            )
          }
          desktop={
            <Table>
              <TableHeader>
                <TableRow className="border-b border-gray-200/80 bg-gray-50/90 hover:bg-gray-50/90">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Marka</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Public</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Aday</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Durum</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {isPending && rows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={5} className="p-0">
                      <AdminLoadingState minHeight="min-h-[240px]" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow className="hover:bg-white">
                    <TableCell
                      colSpan={5}
                      className="px-4 py-12 text-center text-slate-500"
                    >
                      Marka eşleştirme sonucu bulunamadı.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={row.supplierBrand}
                      className="group transition-colors duration-150"
                    >
                      <TableCell>
                        <span className="text-sm font-semibold text-gray-900">
                          {row.supplierBrand}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-700">
                          {row.mappedPartBrand ? row.mappedPartBrand.name : <span className="text-gray-400">—</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-gray-700">
                          {row.exactCandidate ? row.exactCandidate.name : <span className="text-gray-400">—</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        <BrandStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs font-medium text-gray-500 hover:text-gray-900"
                            disabled={!row.exactCandidate || isPending}
                            onClick={() => quickMapExact(row)}
                          >
                            Aday
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs font-medium text-gray-500 hover:text-gray-900"
                            onClick={() => openManualMap(row)}
                          >
                            Manuel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs font-medium text-gray-500 hover:text-rose-600"
                            disabled={!row.mappedPartBrand}
                            onClick={() => clearBrandMap(row.supplierBrand)}
                          >
                            Temizle
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          }
        />

        <div className="border-t border-slate-200 px-5">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.pages}
            totalItems={pagination.total}
            itemsPerPage={pagination.limit}
            onPageChange={(page) => loadRows(page, undefined, { silentEmpty: true })}
          />
        </div>
      </section>

      <Dialog open={Boolean(selectedSupplierBrand)} onOpenChange={(open) => !open && closeManualMap()}>
        <DialogContent className="max-w-2xl overflow-hidden border-slate-200 bg-slate-50 p-0">
          <DialogHeader className="border-b border-slate-200 bg-white px-4 py-3">
            <DialogTitle className="text-sm text-[#101828]">
              Manuel Marka Eşleme{selectedSupplierBrand ? ` - ${selectedSupplierBrand}` : ''}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Public marka adını yazın, listeden seçip hemen eşleyin.
            </DialogDescription>
          </DialogHeader>

          <div className="p-4">
            <Command shouldFilter={false} className="rounded-lg border border-slate-200 bg-white">
              <CommandInput
                value={partBrandQuery}
                onValueChange={setPartBrandQuery}
                placeholder="Public marka adı ile ara..."
              />
              <CommandList className="max-h-80">
                <CommandEmpty>Sonuç yok.</CommandEmpty>
                <CommandGroup heading="Public Markalar">
                  {partBrandResults.map((brand) => (
                    <CommandItem
                      key={brand.id}
                      value={`${brand.id}-${brand.name}`}
                      onSelect={() => applyManualMap(brand.id)}
                      className="flex items-center justify-between"
                    >
                      <span>{brand.name}</span>
                      <span className="text-xs font-semibold text-emerald-700">Bağla</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>

            {isPending && (
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <Loader2 size={14} className="animate-spin" />
                Marka sonuçları güncelleniyor...
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BrandMetric({
  label,
  value,
  loading,
  accentClass
}: {
  label: string
  value: number
  loading: boolean
  accentClass: string
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      {loading ? (
        <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <p className="mt-2 text-2xl font-semibold text-slate-900">{value.toLocaleString('tr-TR')}</p>
      )}
      <div className={`mt-2 h-1 w-10 rounded-full ${accentClass}`} />
    </div>
  )
}

function BrandStatusBadge({ status }: { status: 'APPROVED' | 'PENDING' | 'UNMAPPED' }) {
  if (status === 'APPROVED') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/10">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Eşleşti
      </span>
    )
  }

  if (status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/10">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        Bekliyor
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/10">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
      Eşleşmeyen
    </span>
  )
}
