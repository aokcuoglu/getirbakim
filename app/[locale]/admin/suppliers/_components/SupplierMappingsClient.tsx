'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { Check, ChevronsUpDown, Download, Loader2, RefreshCw, Search, SlidersHorizontal } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useDebouncedCallback } from 'use-debounce'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
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
  autoMapDinamikProductsByPartNo,
  exportSupplierProductMappingsCsv,
  getSupplierProductMappingBrandOptions,
  getSupplierProductMappingsList,
  getSupplierProductMappingsSummary
} from '@/lib/actions/admin-suppliers'
import type { SupplierProductMappingRow } from '@/lib/types/admin-products'

const SupplierProductDetailDrawer = dynamic(
  () =>
    import('./SupplierProductDetailDrawer').then((module) => ({
      default: module.SupplierProductDetailDrawer
    })),
  { ssr: false }
)

type MappingStatusFilter = 'all' | 'approved' | 'ignored' | 'candidate' | 'unmatched'

interface ProductFiltersState {
  providerCode: string
  q: string
  brand: string
  matchState: 'all' | 'matched' | 'unmatched'
  status: MappingStatusFilter
  page: number
  limit: number
}

interface ProductTabListResult {
  success: boolean
  message: string | null
  providerCode: string
  provider: { id: number; code: string; name: string } | null
  providers: Array<{ code: string; name: string }>
  rows: SupplierProductMappingRow[]
  pagination: {
    page: number
    limit: number
    total: number
    pages: number
  }
  currentQuery: string
  currentBrand: string
  currentMatchState: 'all' | 'matched' | 'unmatched'
  currentMappingStatus: MappingStatusFilter
  filters: {
    providerCode: string
    q: string
    queryBrand: string | null
    matchState: 'all' | 'matched' | 'unmatched'
    mappingStatus: MappingStatusFilter
  }
}

interface ProductSummary {
  total: number
  matched: number
  unmatched: number
}

interface SupplierMappingsClientProps {
  initialLoaded: boolean
  initialData: ProductTabListResult | null
  initialSummary?: { total: number; matched: number; unmatched: number } | null
  initialFilters: ProductFiltersState
}

export function SupplierMappingsClient({
  initialLoaded,
  initialData,
  initialSummary,
  initialFilters
}: SupplierMappingsClientProps) {
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [isExporting, startExportTransition] = useTransition()

  const [filters, setFilters] = useState<ProductFiltersState>(initialFilters)
  const filtersRef = useRef<ProductFiltersState>(initialFilters)
  const [searchInput, setSearchInput] = useState(initialFilters.q)

  const [loadingRows, setLoadingRows] = useState(!initialLoaded || !initialData)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [loadingBrandOptions, setLoadingBrandOptions] = useState(false)
  const [success, setSuccess] = useState(initialData?.success ?? true)
  const [message, setMessage] = useState(initialData?.message ?? null)
  const [provider, setProvider] = useState<{ id: number; code: string; name: string } | null>(
    initialData?.provider ?? null
  )
  const [providers, setProviders] = useState<Array<{ code: string; name: string }>>(
    initialData?.providers ?? []
  )
  const [rows, setRows] = useState<SupplierProductMappingRow[]>(initialData?.rows ?? [])
  const [pagination, setPagination] = useState(
    initialData?.pagination ?? {
      page: initialFilters.page,
      limit: initialFilters.limit,
      total: 0,
      pages: 1
    }
  )
  const [summary, setSummary] = useState(
    initialSummary ?? {
      total: 0,
      matched: 0,
      unmatched: 0
    }
  )
  const [brandOptions, setBrandOptions] = useState<Array<{ queryBrand: string; totalProducts: number }>>([])

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailRow, setDetailRow] = useState<SupplierProductMappingRow | null>(null)
  const [brandPickerOpen, setBrandPickerOpen] = useState(false)
  const [autoMapSummary, setAutoMapSummary] = useState<{
    scanned: number
    mapped: number
    policyUpdated: number
    ranAt: string
  } | null>(null)

  const requestIdRef = useRef(0)
  const summaryRequestIdRef = useRef(0)
  const brandOptionsRequestIdRef = useRef(0)
  const brandOptionsKeyRef = useRef('')

  const syncUrl = useCallback(
    (nextFilters: ProductFiltersState) => {
      if (typeof window === 'undefined') return

      const params = new URLSearchParams()
      params.set('tab', 'products')
      params.set('provider', nextFilters.providerCode)

      if (nextFilters.q) params.set('q', nextFilters.q)
      if (nextFilters.brand !== 'all') params.set('brand', nextFilters.brand)
      if (nextFilters.matchState !== 'all') params.set('matchState', nextFilters.matchState)
      if (nextFilters.status !== 'all') params.set('status', nextFilters.status)
      if (nextFilters.page > 1) params.set('page', String(nextFilters.page))
      if (nextFilters.limit !== 20) params.set('limit', String(nextFilters.limit))

      const query = params.toString()
      window.history.replaceState(null, '', query ? `${pathname}?${query}` : pathname)
    },
    [pathname]
  )

  const loadRows = useCallback(async (nextFilters: ProductFiltersState, silentEmpty = false) => {
    const requestId = ++requestIdRef.current
    setLoadingRows(true)

    const result = await getSupplierProductMappingsList({
      providerCode: nextFilters.providerCode,
      q: nextFilters.q || undefined,
      queryBrand: nextFilters.brand === 'all' ? null : nextFilters.brand,
      matchState: nextFilters.matchState,
      mappingStatus: nextFilters.status,
      page: nextFilters.page,
      limit: nextFilters.limit
    })

    if (requestId !== requestIdRef.current) return

    setSuccess(result.success)
    setMessage(result.success ? null : result.message || 'Veri yüklenemedi.')
    setProviders(result.providers)
    setRows(result.success ? result.rows : [])
    setPagination(
      result.success
        ? result.pagination
        : {
            page: nextFilters.page,
            limit: nextFilters.limit,
            total: 0,
            pages: 1
          }
    )
    setProvider(result.success ? result.provider : null)
    setLoadingRows(false)

    if (!silentEmpty && result.success && result.rows.length === 0) {
      toast.message('Seçili filtrelerde ürün bulunamadı.')
    }
  }, [])

  const loadSummary = useCallback(async (nextFilters: ProductFiltersState) => {
    const requestId = ++summaryRequestIdRef.current
    setLoadingSummary(true)

    const result = await getSupplierProductMappingsSummary({
      providerCode: nextFilters.providerCode,
      q: nextFilters.q || undefined,
      queryBrand: nextFilters.brand === 'all' ? null : nextFilters.brand
    })

    if (requestId !== summaryRequestIdRef.current) return
    setSummary(result)
    setLoadingSummary(false)
  }, [])

  const loadBrandOptions = useCallback(async (nextFilters: ProductFiltersState) => {
    const requestKey = [
      nextFilters.providerCode,
      nextFilters.q,
      nextFilters.matchState,
      nextFilters.status
    ].join('::')

    if (brandOptionsKeyRef.current === requestKey && brandOptions.length > 0) return

    const requestId = ++brandOptionsRequestIdRef.current
    brandOptionsKeyRef.current = requestKey
    setLoadingBrandOptions(true)

    const result = await getSupplierProductMappingBrandOptions({
      providerCode: nextFilters.providerCode,
      q: nextFilters.q || undefined,
      matchState: nextFilters.matchState,
      mappingStatus: nextFilters.status
    })

    if (requestId !== brandOptionsRequestIdRef.current) return
    setBrandOptions(result)
    setLoadingBrandOptions(false)
  }, [brandOptions.length])

  const applyFilters = useCallback(
    (patch: Partial<ProductFiltersState>, options?: { silentEmpty?: boolean }) => {
      const currentFilters = filtersRef.current
      const nextFilters = {
        ...currentFilters,
        ...patch
      }

      const shouldResetBrandOptions =
        nextFilters.providerCode !== currentFilters.providerCode ||
        nextFilters.q !== currentFilters.q ||
        nextFilters.matchState !== currentFilters.matchState ||
        nextFilters.status !== currentFilters.status

      filtersRef.current = nextFilters
      setFilters(nextFilters)
      if (shouldResetBrandOptions) {
        brandOptionsKeyRef.current = ''
        setBrandOptions([])
      }
      syncUrl(nextFilters)
      void loadRows(nextFilters, options?.silentEmpty ?? false)
      void loadSummary(nextFilters)
      if (brandPickerOpen) {
        void loadBrandOptions(nextFilters)
      }
    },
    [brandPickerOpen, loadBrandOptions, loadRows, loadSummary, syncUrl]
  )

  const onSearch = useDebouncedCallback((value: string) => {
    applyFilters({ q: value.trim(), page: 1 }, { silentEmpty: true })
  }, 300)

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  useEffect(() => {
    setSearchInput(filters.q)
  }, [filters.q])

  useEffect(() => {
    if (initialSummary) return

    if (!initialLoaded || !initialData) {
      void loadSummary(filtersRef.current)
      return
    }

    void loadSummary({
      providerCode: initialData.providerCode,
      q: initialData.currentQuery,
      brand: initialData.currentBrand,
      matchState: initialData.currentMatchState,
      status: initialData.currentMappingStatus,
      page: initialFilters.page,
      limit: initialFilters.limit
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, initialFilters.limit, initialFilters.page, initialLoaded, loadSummary])

  useEffect(() => {
    if (initialLoaded && initialData) {
      setLoadingRows(false)
      return
    }

    void loadRows(filtersRef.current, true)
  }, [initialData, initialLoaded, loadRows])

  useEffect(() => {
    if (!brandPickerOpen) return
    void loadBrandOptions(filtersRef.current)
  }, [brandPickerOpen, loadBrandOptions])

  const hasActiveFilters =
    Boolean(filters.q) ||
    filters.brand !== 'all' ||
    filters.matchState !== 'all' ||
    filters.status !== 'all' ||
    filters.page !== 1

  const runAutoMapByPartNo = () => {
    if (filters.providerCode !== 'dinamik') {
      toast.message('Bu aksiyon şu anda yalnızca Dinamik sağlayıcısı için aktif.')
      return
    }

    startTransition(async () => {
      const result = await autoMapDinamikProductsByPartNo({
        q: filters.q || undefined,
        queryBrand: filters.brand === 'all' ? undefined : filters.brand,
        limit: 3000
      })

      if (!result.success) {
        toast.error(result.message || 'Otomatik eşleştirme başarısız.')
        return
      }

      setAutoMapSummary({
        scanned: result.data?.scanned ?? 0,
        mapped: result.data?.mapped ?? 0,
        policyUpdated: result.data?.policyUpdated ?? 0,
        ranAt: new Date().toISOString()
      })
      toast.success(result.message)

      applyFilters({ matchState: 'unmatched', status: 'all', page: 1 }, { silentEmpty: true })
    })
  }

  const exportCsv = () => {
    startExportTransition(async () => {
      const result = await exportSupplierProductMappingsCsv({
        providerCode: filters.providerCode,
        q: filters.q || undefined,
        queryBrand: filters.brand === 'all' ? null : filters.brand,
        matchState: filters.matchState,
        mappingStatus: filters.status
      })

      if (!result.success || !result.csv || !result.filename) {
        toast.error(result.message || 'CSV dışa aktarma başarısız.')
        return
      }

      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', result.filename)
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      toast.success(result.message || 'CSV dosyası indirildi.')
    })
  }

  const openDetail = (row: SupplierProductMappingRow) => {
    setDetailRow(row)
    setDetailOpen(true)
  }

  const selectedBrandOption = brandOptions.find((brand) => brand.queryBrand === filters.brand) || null

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        <div className="border-b border-border px-5 py-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-foreground">Ürün Listesi</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Sağlayıcı ürünlerini hızlıca filtreleyin, eşleşmeyenleri tek ekrandan yönetin.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={runAutoMapByPartNo} disabled={isPending || loadingRows}>
                {isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
                Otomatik Eşleştir
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={exportCsv}
                disabled={isExporting || loadingRows}
              >
                {isExporting ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : (
                  <Download size={14} className="mr-2" />
                )}
                CSV İndir
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={loadingRows}
                onClick={() => {
                  void loadRows(filtersRef.current, true)
                  void loadSummary(filtersRef.current)
                }}
              >
                {loadingRows ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : (
                  <RefreshCw size={14} className="mr-2" />
                )}
                Yenile
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryMetric
              label="Toplam Ürün"
              value={summary.total}
              loading={loadingSummary}
              accentClass="bg-muted-foreground"
            />
            <SummaryMetric
              label="Eşleşen"
              value={summary.matched}
              loading={loadingSummary}
              accentClass="bg-success/100"
            />
            <SummaryMetric
              label="Eşleşmeyen"
              value={summary.unmatched}
              loading={loadingSummary}
              accentClass="bg-warning/100"
            />
            <div className="rounded-xl border border-border bg-muted px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Aktif Sağlayıcı</p>
              <p className="mt-2 truncate text-lg font-semibold text-foreground">{provider?.name || '-'}</p>
              <p className="mt-1 text-xs text-muted-foreground">{filters.providerCode}</p>
            </div>
          </div>

          {autoMapSummary ? (
            <div className="mt-4 rounded-md border border-border bg-accent p-3 text-xs text-foreground">
              <p className="font-semibold">Son otomatik eşleştirme özeti</p>
              <p className="mt-1">
                Taranan: {autoMapSummary.scanned.toLocaleString('tr-TR')} | Eşleşen:{' '}
                {autoMapSummary.mapped.toLocaleString('tr-TR')} | Policy güncellenen:{' '}
                {autoMapSummary.policyUpdated.toLocaleString('tr-TR')}
              </p>
              <p className="mt-1">Çalışma zamanı: {new Date(autoMapSummary.ranAt).toLocaleString('tr-TR')}</p>
              <p className="mt-1">Liste otomatik olarak `Eşleşmeyen` filtresine geçirildi.</p>
            </div>
          ) : null}
        </div>

        <div className="border-b border-border bg-muted/70 px-5 py-3">
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-[minmax(260px,2fr)_minmax(190px,1fr)_minmax(230px,1fr)_minmax(180px,1fr)]">
            <div className="relative">
              <Search
                size={14}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={searchInput}
                onChange={(event) => {
                  setSearchInput(event.target.value)
                  onSearch(event.target.value)
                }}
                placeholder="Stok kodu / ürün adı / barkod"
                className="h-9 border-border bg-background pl-7"
              />
            </div>

            <Select
              value={filters.providerCode}
              onValueChange={(value) => {
                onSearch.cancel()
                applyFilters(
                  {
                    providerCode: value,
                    brand: 'all',
                    page: 1
                  },
                  { silentEmpty: true }
                )
              }}
            >
              <SelectTrigger className="h-9 border-border bg-background">
                <SelectValue placeholder="Sağlayıcı" />
              </SelectTrigger>
              <SelectContent>
                {providers.map((item) => (
                  <SelectItem key={item.code} value={item.code}>
                    {item.name} ({item.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              variant="outline"
              className="h-9 justify-between border-border bg-background font-normal"
              onClick={() => setBrandPickerOpen(true)}
            >
              <span className="truncate text-left">
                {filters.brand === 'all'
                  ? 'Tüm Markalar'
                  : selectedBrandOption
                    ? `${selectedBrandOption.queryBrand} (${selectedBrandOption.totalProducts})`
                    : filters.brand}
              </span>
              <ChevronsUpDown size={14} className="ml-2 shrink-0 text-muted-foreground" />
            </Button>

            <Select
              value={filters.status}
              onValueChange={(value) =>
                applyFilters({ status: value as MappingStatusFilter, page: 1 }, { silentEmpty: true })
              }
            >
              <SelectTrigger className="h-9 border-border bg-background">
                <SelectValue placeholder="Durum" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Durum: Tümü</SelectItem>
                <SelectItem value="approved">Durum: Eşleşti</SelectItem>
                <SelectItem value="ignored">Durum: Yoksayıldı</SelectItem>
                <SelectItem value="candidate">Durum: Aday</SelectItem>
                <SelectItem value="unmatched">Durum: Eşleşmeyen</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={filters.matchState === 'all' ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() =>
                applyFilters(
                  {
                    matchState: 'all',
                    page: 1
                  },
                  { silentEmpty: true }
                )
              }
            >
              Tümü
            </Button>

            <Button
              type="button"
              variant={filters.matchState === 'matched' ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() =>
                applyFilters(
                  {
                    matchState: 'matched',
                    page: 1
                  },
                  { silentEmpty: true }
                )
              }
            >
              Eşleşen
            </Button>

            <Button
              type="button"
              variant={filters.matchState === 'unmatched' ? 'default' : 'outline'}
              className="h-8 rounded-full px-3 text-xs"
              onClick={() =>
                applyFilters(
                  {
                    matchState: 'unmatched',
                    page: 1
                  },
                  { silentEmpty: true }
                )
              }
            >
              Eşleşmeyen
            </Button>

            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-full border-input px-3 text-xs"
              disabled={!hasActiveFilters}
              onClick={() => {
                onSearch.cancel()
                setSearchInput('')
                applyFilters(
                  {
                    q: '',
                    brand: 'all',
                    matchState: 'all',
                    status: 'all',
                    page: 1
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

        <Dialog open={brandPickerOpen} onOpenChange={setBrandPickerOpen}>
          <DialogContent className="max-w-md border-border bg-muted p-0">
            <DialogHeader className="px-4 pt-4">
              <DialogTitle>Marka Seç</DialogTitle>
              <DialogDescription>Arayarak marka filtresini hızlıca seçin.</DialogDescription>
            </DialogHeader>
            <div className="px-4 pb-4">
              <Command>
                <CommandInput placeholder="Marka ara..." />
                <CommandList className="max-h-72">
                  <CommandEmpty>Marka bulunamadı.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="tum markalar"
                      onSelect={() => {
                        applyFilters({ brand: 'all', page: 1 }, { silentEmpty: true })
                        setBrandPickerOpen(false)
                      }}
                    >
                      <span className="flex-1">Tüm Markalar</span>
                      {filters.brand === 'all' ? <Check size={14} className="text-success" /> : null}
                    </CommandItem>
                    {loadingBrandOptions ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">Markalar yükleniyor...</div>
                    ) : null}
                    {brandOptions.map((brand) => (
                      <CommandItem
                        key={brand.queryBrand}
                        value={`${brand.queryBrand} ${brand.totalProducts}`}
                        onSelect={() => {
                          applyFilters({ brand: brand.queryBrand, page: 1 }, { silentEmpty: true })
                          setBrandPickerOpen(false)
                        }}
                      >
                        <span className="flex-1 truncate">{brand.queryBrand}</span>
                        <span className="mr-2 text-xs text-muted-foreground">{brand.totalProducts}</span>
                        {filters.brand === brand.queryBrand ? (
                          <Check size={14} className="text-success" />
                        ) : null}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </DialogContent>
        </Dialog>

        {!success && !loadingRows ? (
          <div className="border-b border-destructive/20 bg-destructive/10 px-5 py-3 text-sm text-destructive">
            {message || 'Veri yüklenemedi.'}
          </div>
        ) : null}

        <ResponsiveDataView
          mobile={
            loadingRows && rows.length === 0 ? (
              <AdminLoadingState minHeight="min-h-[240px]" />
            ) : rows.length === 0 ? (
              <div className="px-4 py-14 text-center text-muted-foreground">
                Seçili filtrelerde ürün bulunamadı.
              </div>
            ) : (
              <div className="space-y-3 px-4 py-4">
                {rows.map((row) => (
                  <MobileDataCard
                    key={`${row.providerCode}-${row.stockCode}-${row.supplierProductId}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {row.partNo || '-'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Stok: {row.stockCode}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.supplierProductId > 0
                            ? `#${row.supplierProductId}`
                            : 'Dinamik satır'}
                        </p>
                      </div>
                      <StatusBadge
                        status={row.mappingStatus}
                        hasMatchedPart={Boolean(row.matchedPart)}
                      />
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground truncate">
                        {row.stockName || '-'}
                      </p>
                      <p>Marka: {row.brand || row.queryBrand || '-'}</p>
                      <p>
                        Fiyat:{' '}
                        {row.price == null
                          ? '-'
                          : `${row.price.toLocaleString('tr-TR', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })} ${row.currency}`}
                      </p>
                      <p>Stok: {row.supplierStockQty.toLocaleString('tr-TR')}</p>
                      <p>
                        Part:{' '}
                        {row.matchedPart
                          ? `${row.matchedPart.name} (#${row.matchedPart.id})`
                          : 'Eşleşmedi'}
                      </p>
                      <p>
                        Güncel:{' '}
                        {row.updatedAt
                          ? new Date(row.updatedAt).toLocaleString('tr-TR')
                          : '-'}
                      </p>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => openDetail(row)}
                      >
                        Detay
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
                <TableRow className="border-b border-border/80 bg-muted/90 hover:bg-muted/90">
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">SKU</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-[280px]">Ürün</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Marka</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Fiyat</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Stok</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-[200px]">Part</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Durum</TableHead>
                  <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground text-right">İşlem</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {loadingRows && rows.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="p-0">
                      <AdminLoadingState minHeight="min-h-[240px]" />
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow className="hover:bg-background">
                    <TableCell
                      colSpan={8}
                      className="px-4 py-14 text-center text-muted-foreground"
                    >
                      Seçili filtrelerde ürün bulunamadı.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow
                      key={`${row.providerCode}-${row.stockCode}-${row.supplierProductId}`}
                      className="group transition-colors duration-150"
                    >
                      <TableCell>
                        <p className="font-semibold text-foreground text-sm">
                          {row.partNo || '-'}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono">
                          {row.stockCode}
                          {row.supplierProductId > 0 ? ` · #${row.supplierProductId}` : ''}
                        </p>
                      </TableCell>
                      <TableCell className="max-w-[280px]">
                        <p
                          className="truncate font-medium text-foreground text-sm"
                          title={row.stockName || '-'}
                        >
                          {row.stockName || '-'}
                        </p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {row.updatedAt
                            ? new Date(row.updatedAt).toLocaleString('tr-TR')
                            : '-'}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-medium text-foreground">
                          {row.brand || row.queryBrand || '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-medium text-foreground">
                          {row.price == null
                            ? <span className="text-muted-foreground">—</span>
                            : `${row.price.toLocaleString('tr-TR', {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2
                              })} ${row.currency}`}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-foreground">
                          {row.supplierStockQty.toLocaleString('tr-TR')}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        {row.matchedPart ? (
                          <div className="min-w-0">
                            <p className="font-medium text-foreground text-sm truncate">
                              {row.matchedPart.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground font-mono truncate">
                              #{row.matchedPart.id} · {row.matchedPart.articleLinkId}
                            </p>
                          </div>
                        ) : (
                          <Badge variant="outline" className="gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20">
                            <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                            Eşleşmedi
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          status={row.mappingStatus}
                          hasMatchedPart={Boolean(row.matchedPart)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs font-medium text-muted-foreground hover:text-foreground"
                          onClick={() => openDetail(row)}
                        >
                          Detay
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          }
        />

        <div className="border-t border-border px-5">
          <Pagination
            currentPage={pagination.page}
            totalPages={pagination.pages}
            totalItems={pagination.total}
            itemsPerPage={pagination.limit}
            onPageChange={(page) => applyFilters({ page }, { silentEmpty: true })}
          />
        </div>
      </section>

      {detailRow ? (
        <SupplierProductDetailDrawer
          open={detailOpen}
          onOpenChange={setDetailOpen}
          providerCode={filters.providerCode}
          row={detailRow}
          onSaved={() => {
            void loadRows(filtersRef.current, true)
            void loadSummary(filtersRef.current)
          }}
        />
      ) : null}
    </div>
  )
}

function SummaryMetric({
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
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      {loading ? (
        <Loader2 className="mt-2 h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <p className="mt-2 text-2xl font-semibold text-foreground">{value.toLocaleString('tr-TR')}</p>
      )}
      <div className={`mt-2 h-1 w-10 rounded-full ${accentClass}`} />
    </div>
  )
}

function StatusBadge({
  status,
  hasMatchedPart
}: {
  status: 'QUEUE' | 'APPROVED' | 'IGNORED' | null
  hasMatchedPart: boolean
}) {
  if (status === 'APPROVED') {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] bg-success/10 text-success border-success/20">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        Eşleşti
      </Badge>
    )
  }

  if (status === 'IGNORED') {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] bg-destructive/10 text-destructive border-destructive/20">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        Yoksayıldı
      </Badge>
    )
  }

  if (hasMatchedPart) {
    return (
      <Badge variant="outline" className="gap-1.5 text-[10px] bg-accent text-primary border-primary/20">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" />
        Aday
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className="gap-1.5 text-[10px] bg-warning/10 text-warning border-warning/20">
      <span className="h-1.5 w-1.5 rounded-full bg-warning" />
      Eşleşmeyen
    </Badge>
  )
}
