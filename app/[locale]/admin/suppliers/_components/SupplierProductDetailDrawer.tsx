'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent
} from 'react'
import { ArrowRight, Loader2, Search } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RegionalStockSummary } from '@/components/admin/regional-stock-summary'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import {
  getSupplierProductMappingDetail,
  ignoreSupplierMapping,
  manualMapDinamikProductToPart,
  manualMapSupplierProductToPart,
  saveSupplierProductManualOems,
  searchPartsForSupplierMappingAdvanced
} from '@/lib/actions/admin-suppliers'
import type {
  MappingCandidate,
  SupplierProductMappingDetail,
  SupplierProductMappingRow
} from '@/lib/types/admin-products'
import { SupplierReferenceCloneDrawer } from './SupplierReferenceCloneDrawer'

interface SupplierProductDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  providerCode: string
  row: SupplierProductMappingRow | null
  onSaved?: () => void
}

function splitCodeLines(text: string) {
  return text
    .split(/[\n,;]+/g)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function SupplierProductDetailDrawer({
  open,
  onOpenChange,
  providerCode,
  row,
  onSaved
}: SupplierProductDetailDrawerProps) {
  const router = useRouter()
  const pathname = usePathname()

  const [loadingSource, setLoadingSource] = useState(false)
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [savingMap, setSavingMap] = useState(false)
  const [savingManualOems, setSavingManualOems] = useState(false)
  const [savingIgnore, setSavingIgnore] = useState(false)

  const [partCandidates, setPartCandidates] = useState<MappingCandidate[]>([])
  const [selectedPartId, setSelectedPartId] = useState<string | null>(null)
  const [sourceDetail, setSourceDetail] =
    useState<SupplierProductMappingDetail | null>(null)
  const [referenceCloneOpen, setReferenceCloneOpen] = useState(false)
  const [referenceClonePartId, setReferenceClonePartId] = useState<string | null>(null)

  const [partSearchQuery, setPartSearchQuery] = useState('')
  const [oemSearchInput, setOemSearchInput] = useState('')
  const [refSearchInput, setRefSearchInput] = useState('')
  const [manualOemInput, setManualOemInput] = useState('')
  const [manualOemBrand, setManualOemBrand] = useState('')
  const [showAdvancedSearch, setShowAdvancedSearch] = useState(false)

  const candidateSearchRequestRef = useRef(0)
  const lastCandidateSearchKeyRef = useRef('')
  const sourceLoadInFlightKeyRef = useRef<string | null>(null)

  const sourceSummary = useMemo(() => {
    if (!row) return '-'
    return `${row.stockCode}${row.partNo ? ` / ${row.partNo}` : ''}`
  }, [row])

  const effectiveSupplierProductId = useMemo(() => {
    if (sourceDetail?.supplierProduct.id) return sourceDetail.supplierProduct.id
    if (row?.supplierProductId && row.supplierProductId > 0) return row.supplierProductId
    return null
  }, [row?.supplierProductId, sourceDetail?.supplierProduct.id])

  const locale = useMemo(() => {
    const pathToken = pathname.split('/')[1]
    return pathToken === 'en' || pathToken === 'tr' ? pathToken : 'tr'
  }, [pathname])

  const executeCandidateSearch = useCallback(
    async (
      input: {
        query: string
        oemCodes: string[]
        refCodes: string[]
      },
      options?: { force?: boolean; silentEmpty?: boolean }
    ) => {
      if (!row) return

      const searchKey = [
        row.providerCode,
        row.stockCode,
        input.query.trim().toLocaleLowerCase('tr'),
        input.oemCodes.map((item) => item.toLocaleLowerCase('tr')).join('|'),
        input.refCodes.map((item) => item.toLocaleLowerCase('tr')).join('|')
      ].join('::')

      if (!options?.force && lastCandidateSearchKeyRef.current === searchKey) {
        return
      }
      lastCandidateSearchKeyRef.current = searchKey

      const requestId = ++candidateSearchRequestRef.current
      setLoadingCandidates(true)

      const candidates = await searchPartsForSupplierMappingAdvanced({
        providerCode,
        supplierProductId:
          row.supplierProductId > 0 ? row.supplierProductId : undefined,
        q: input.query,
        oemCodes: input.oemCodes,
        refCodes: input.refCodes,
        limit: 20
      })

      if (requestId !== candidateSearchRequestRef.current) return

      setLoadingCandidates(false)
      setPartCandidates(candidates)

      if (!options?.silentEmpty && candidates.length === 0) {
        toast.message(
          'Aday part bulunamadı. Gelişmiş alana OEM/Referans ekleyip tekrar deneyin.'
        )
      }
    },
    [providerCode, row]
  )

  const runCandidateSearch = useCallback(
    async (
      overrides?: {
        query?: string
        oemCodes?: string[]
        refCodes?: string[]
      },
      options?: { force?: boolean; silentEmpty?: boolean }
    ) => {
      const query = overrides?.query ?? partSearchQuery
      const oemCodes = overrides?.oemCodes ?? splitCodeLines(oemSearchInput)
      const refCodes = overrides?.refCodes ?? splitCodeLines(refSearchInput)

      await executeCandidateSearch(
        {
          query,
          oemCodes,
          refCodes
        },
        options
      )
    },
    [executeCandidateSearch, oemSearchInput, partSearchQuery, refSearchInput]
  )

  const loadSource = useCallback(async () => {
    if (!row) return
    const loadKey = `${providerCode}::${row.supplierProductId}::${row.stockCode}`
    if (sourceLoadInFlightKeyRef.current === loadKey) return
    sourceLoadInFlightKeyRef.current = loadKey

    const fallbackQuery = row.partNo || row.stockCode || ''
    const resetCandidateState = async () => {
      setPartCandidates([])
      setSelectedPartId(null)
      setSourceDetail(null)
      setReferenceClonePartId(null)
      setLoadingCandidates(false)
      setPartSearchQuery(fallbackQuery)
      setOemSearchInput('')
      setRefSearchInput('')
      setManualOemInput('')
      setManualOemBrand('')
      setShowAdvancedSearch(false)

      candidateSearchRequestRef.current += 1
      lastCandidateSearchKeyRef.current = ''
    }

    try {
      setLoadingSource(true)
      await resetCandidateState()

      const sourceResult = await getSupplierProductMappingDetail({
        providerCode,
        supplierProductId:
          row.supplierProductId > 0 ? row.supplierProductId : null,
        stockCode: row.stockCode,
        queryBrand: row.queryBrand,
        includeOptions: false,
        includeFallbackPart: false
      })

      setLoadingSource(false)

      if (!sourceResult.success || !sourceResult.data) {
        setSourceDetail(null)
        toast.error(sourceResult.message || 'Supplier ürün detayı alınamadı.')
        return
      }

      const data = sourceResult.data
      setSourceDetail(data)
      const nextQuery = data.suggestedQuery || fallbackQuery
      const nextOemCodes = data.suggestedOemCodes
      const nextRefCodes = data.suggestedRefCodes

      setSelectedPartId(data.row.matchedPart?.id || null)
      setReferenceClonePartId(data.referenceClone?.partId || null)
      setPartSearchQuery(nextQuery)
      setOemSearchInput(nextOemCodes.join('\n'))
      setRefSearchInput(nextRefCodes.join('\n'))
      const nextManualOemCodes = data.manualOemCodes ?? nextOemCodes
      setManualOemInput(nextManualOemCodes.join('\n'))
      setManualOemBrand(data.supplierProduct.brand || '')
      setShowAdvancedSearch(nextOemCodes.length > 0 || nextRefCodes.length > 0)

      if (data.row.matchedPart) {
        setPartCandidates([
          {
            partId: data.row.matchedPart.id,
            articleLinkId: data.row.matchedPart.articleLinkId,
            name: data.row.matchedPart.name,
            brand: data.row.matchedPart.brand,
            confidence: 1,
            reasons: ['current_mapping']
          }
        ])
      }
    } finally {
      sourceLoadInFlightKeyRef.current = null
    }
  }, [executeCandidateSearch, providerCode, row])

  useEffect(() => {
    if (!open || !row) return
    void loadSource()
  }, [loadSource, open, row])

  const handleSearchInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    if (event.key !== 'Enter') return

    const isTextarea = event.currentTarget instanceof HTMLTextAreaElement
    if (isTextarea && !event.metaKey && !event.ctrlKey) return

    event.preventDefault()
    void runCandidateSearch()
  }

  const mapWithSelectedPart = async () => {
    if (!row) return
    if (!selectedPartId) {
      toast.error('Önce bir public part seçin.')
      return
    }

    setSavingMap(true)

    const result =
      providerCode === 'dinamik' && row.supplierProductId <= 0
        ? await manualMapDinamikProductToPart({
            stockCode: row.stockCode,
            queryBrand: row.queryBrand,
            partId: selectedPartId,
            note: 'manual:supplier-mapping-drawer'
          })
        : row.supplierProductId > 0
          ? await manualMapSupplierProductToPart({
              providerCode,
              supplierProductId: row.supplierProductId,
              partId: selectedPartId,
              note: 'manual:supplier-mapping-drawer'
            })
          : {
              success: false,
              message: 'Supplier ürün id bulunamadı.'
            }

    setSavingMap(false)

    if (!result.success) {
      toast.error(result.message || 'Eşleştirme kaydedilemedi.')
      return
    }

    toast.success(result.message)
    onSaved?.()
    onOpenChange(false)
  }

  const handleIgnoreMapping = async () => {
    if (!sourceDetail?.mapping?.id) return

    setSavingIgnore(true)
    const result = await ignoreSupplierMapping({
      mappingId: sourceDetail.mapping.id
    })
    setSavingIgnore(false)

    if (!result.success) {
      toast.error(result.message || 'Mapping yoksayılamadı.')
      return
    }

    toast.success(result.message || 'Mapping yoksayıldı.')
    onSaved?.()
    onOpenChange(false)
  }

  const handleSelectMap = (partId: string) => {
    setSelectedPartId(partId)
  }

  const openReferenceCloneFromSelected = () => {
    if (!selectedPartId) {
      toast.error('Önce bir referans part seçin.')
      return
    }

    setReferenceCloneOpen(true)
  }

  const openProductsOperation = () => {
    if (selectedPartId) {
      router.push(`/${locale}/admin/products?q=${selectedPartId}`)
      onOpenChange(false)
      return
    }

    router.push(`/${locale}/admin/products`)
    onOpenChange(false)
  }

  const saveManualOems = async () => {
    if (!row) return
    if (!effectiveSupplierProductId) {
      toast.error('Supplier ürün id bulunamadı. Önce detay yüklenmeli.')
      return
    }

    const oemCodes = splitCodeLines(manualOemInput)
    if (oemCodes.length === 0) {
      toast.error('En az bir OEM kodu girin.')
      return
    }

    setSavingManualOems(true)
    const result = await saveSupplierProductManualOems({
      providerCode,
      supplierProductId: effectiveSupplierProductId,
      oemCodes,
      oemBrand: manualOemBrand.trim() || null
    })
    setSavingManualOems(false)

    if (!result.success) {
      toast.error(result.message || 'Manuel OEM kodları kaydedilemedi.')
      return
    }

    if (result.data?.autoMatch?.matched) {
      toast.success(result.message || 'OEM kodları kaydedildi ve otomatik eşleşme yapıldı.')
      await loadSource()
      onSaved?.()
      return
    }

    toast.success(result.message || 'Manuel OEM kodları kaydedildi.')
    setOemSearchInput(oemCodes.join('\n'))
    setShowAdvancedSearch(true)
    await loadSource()
    await runCandidateSearch(
      {
        oemCodes,
        query: partSearchQuery,
        refCodes: splitCodeLines(refSearchInput)
      },
      { force: true, silentEmpty: true }
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto bg-muted sm:max-w-[860px]"
      >
        <SheetHeader>
          <SheetTitle>Supplier Ürün Detayı</SheetTitle>
          <SheetDescription>
            {row
              ? `${row.providerName} kaynağı: ${sourceSummary}`
              : 'Satır seçilmedi.'}
          </SheetDescription>
        </SheetHeader>

        {!row ? (
          <div className="mt-6 text-sm text-muted-foreground">
            Ürün satırı seçilmedi.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="rounded-xl border border-border bg-muted p-3 text-xs text-muted-foreground">
              <p>
                Supplier Ürün:{' '}
                <span className="font-semibold text-foreground">
                  {row.stockName || '-'}
                </span>
              </p>
              <p className="mt-1">
                SKU:{' '}
                <span className="font-semibold text-foreground">
                  {row.stockCode}
                </span>
              </p>
              {sourceDetail?.mapping?.workflowStatus ? (
                <p className="mt-1">
                  Workflow:{' '}
                  <span className="font-semibold text-foreground">
                    {sourceDetail.mapping.workflowStatus}
                  </span>
                </p>
              ) : null}
              <p className="mt-1">
                Seçili Part:{' '}
                <span className="font-semibold text-foreground">
                  {selectedPartId
                    ? sourceDetail?.row?.matchedPart?.name
                      ? `${sourceDetail.row.matchedPart.name} (#${selectedPartId})`
                      : `#${selectedPartId}`
                    : 'Yok'}
                </span>
              </p>
            </div>

            <RegionalStockSummary
              title="Bolgesel Stok"
              regionalStock={sourceDetail?.supplierProduct.regionalStock}
            />

            <div className="rounded-xl border border-border bg-background p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-foreground">
                1) Mevcut Public Part ile Eşleştir
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Dinamik ürünü `public.parts` adayı ile bağlar. Bu adım sadece
                eşleştirme kaydını hedefler ve hızlı çalışır.
              </p>

              <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    value={partSearchQuery}
                    onChange={(event) => setPartSearchQuery(event.target.value)}
                    onKeyDown={handleSearchInputKeyDown}
                    placeholder="Stok kodu / ürün adı"
                    className="h-9 pl-7"
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  onClick={() => void runCandidateSearch()}
                  disabled={loadingCandidates || loadingSource}
                >
                  {loadingCandidates ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Search size={14} className="mr-2" />
                  )}
                  Aday Ara
                </Button>
              </div>

              <div className="mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2"
                  onClick={() => setShowAdvancedSearch((prev) => !prev)}
                >
                  {showAdvancedSearch
                    ? 'Gelişmiş adayı gizle'
                    : 'Gelişmiş aday arama'}
                </Button>
              </div>

              {showAdvancedSearch ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      OEM kodları (opsiyonel)
                    </p>
                    <Textarea
                      value={oemSearchInput}
                      onChange={(event) =>
                        setOemSearchInput(event.target.value)
                      }
                      onKeyDown={handleSearchInputKeyDown}
                      placeholder="Her satıra bir OEM kodu"
                      rows={3}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      Referans kodları (opsiyonel)
                    </p>
                    <Textarea
                      value={refSearchInput}
                      onChange={(event) =>
                        setRefSearchInput(event.target.value)
                      }
                      onKeyDown={handleSearchInputKeyDown}
                      placeholder="Her satıra bir referans kodu"
                      rows={3}
                    />
                  </div>
                  <p className="md:col-span-2 text-xs text-muted-foreground">
                    Bu alanlar sadece aday aramayı genişletir; ürün oluşturma
                    veya teknik veri güncelleme yapmaz.
                  </p>
                </div>
              ) : null}

              <div className="mt-3 rounded-md border border-border bg-muted p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">
                    Kalıcı OEM Kodları (source=MANUAL)
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8"
                    onClick={saveManualOems}
                    disabled={loadingSource || savingManualOems || !effectiveSupplierProductId}
                  >
                    {savingManualOems ? (
                      <Loader2 size={14} className="mr-2 animate-spin" />
                    ) : null}
                    OEM Kaydet
                  </Button>
                </div>

                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_220px]">
                  <Textarea
                    value={manualOemInput}
                    onChange={(event) => setManualOemInput(event.target.value)}
                    placeholder="Her satıra bir OEM kodu"
                    rows={4}
                  />
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">
                      OEM Marka (opsiyonel)
                    </p>
                    <Input
                      value={manualOemBrand}
                      onChange={(event) => setManualOemBrand(event.target.value)}
                      placeholder="Örn: ATE"
                      className="h-9"
                    />
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Bu kayıtlar API senkronunda ezilmez.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border bg-background hover:bg-background">
                      <TableHead className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Part
                      </TableHead>
                      <TableHead className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Marka
                      </TableHead>
                      <TableHead className="px-3 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                        Güven
                      </TableHead>
                      <TableHead className="px-3 py-2 text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                        Seç
                      </TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {partCandidates.map((candidate) => (
                      <TableRow
                        key={candidate.partId}
                        className="border-b border-border hover:bg-muted/70"
                      >
                        <TableCell className="px-3 py-2">
                          <p
                            className="max-w-[360px] truncate font-medium text-foreground"
                            title={candidate.name}
                          >
                            {candidate.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            #{candidate.partId} | PART NO:{' '}
                            {candidate.partNo || '-'}
                          </p>
                          {candidate.reasons.length > 0 ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {candidate.reasons.map((r) => (
                                <span
                                  key={r}
                                  className="inline-flex items-center rounded border border-border bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary"
                                >
                                  {r}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-3 py-2 text-foreground">
                          {candidate.brand || '-'}
                        </TableCell>
                        <TableCell className="px-3 py-2">
                          {(candidate.confidence * 100).toFixed(0)}%
                        </TableCell>
                        <TableCell className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              className="h-8"
                              variant={
                                selectedPartId === candidate.partId
                                  ? 'default'
                                  : 'outline'
                              }
                              onClick={() => handleSelectMap(candidate.partId)}
                              title="Bu productı seç"
                            >
                              Eşleştir
                            </Button>
                            <Button
                              size="sm"
                              className="h-8"
                              variant="secondary"
                              onClick={() => {
                                setSelectedPartId(candidate.partId)
                                setReferenceCloneOpen(true)
                              }}
                              title="Bu parttan referans klon taslağı oluştur"
                            >
                              Referans Klon
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}

                    {partCandidates.length === 0 ? (
                      <TableRow className="hover:bg-background">
                        <TableCell
                          colSpan={4}
                          className="px-3 py-6 text-center text-muted-foreground"
                        >
                          {loadingSource
                            ? 'Kaynak verisi yükleniyor...'
                            : 'Henüz aday yok.'}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                {sourceDetail?.mapping &&
                sourceDetail.mapping.status !== 'IGNORED' ? (
                  <Button
                    variant="outline"
                    className="h-9 border-destructive/20 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => void handleIgnoreMapping()}
                    disabled={savingIgnore || loadingSource}
                  >
                    {savingIgnore ? (
                      <Loader2 size={14} className="mr-2 animate-spin" />
                    ) : null}
                    Yoksay
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={openProductsOperation}
                >
                  Ürün Operasyonu ekranında aç
                  <ArrowRight size={14} className="ml-2" />
                </Button>
                <Button
                  onClick={mapWithSelectedPart}
                  disabled={savingMap || loadingSource || !selectedPartId}
                  className="h-9"
                >
                  {savingMap ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : null}
                  Seçili Part ile Eşleştir
                </Button>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-3 sm:p-4">
              <h3 className="text-sm font-semibold text-foreground">
                2) Referans Klon Taslağı Oluştur / Düzenle
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Seçili public part tam kopya ile yeni bir draft ürüne çevrilir.
                Ürün supplier adıyla gelir, tüm child tablolar düzenlenebilir ve
                başlangıçta gizli kalır.
              </p>

              <div className="mt-3 rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
                <p>
                  Seçili referans part:{' '}
                  <span className="font-semibold text-foreground">
                    {selectedPartId || 'Yok'}
                  </span>
                </p>
                <p className="mt-1">
                  Mevcut referans klon:{' '}
                  <span className="font-semibold text-foreground">
                    {referenceClonePartId || 'Yok'}
                  </span>
                </p>
              </div>

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {referenceClonePartId ? (
                  <Button
                    variant="outline"
                    className="h-9"
                    onClick={() => setReferenceCloneOpen(true)}
                  >
                    Mevcut Klonu Düzenle
                  </Button>
                ) : null}
                <Button
                  onClick={openReferenceCloneFromSelected}
                  disabled={loadingSource || !selectedPartId}
                  className="h-9"
                >
                  Referans Klon Editörünü Aç
                </Button>
              </div>
            </div>

            <div className="flex justify-end border-t pt-3">
              <Button
                variant="outline"
                className="h-9"
                onClick={() => onOpenChange(false)}
              >
                Kapat
              </Button>
            </div>

            <SupplierReferenceCloneDrawer
              open={referenceCloneOpen}
              onOpenChange={setReferenceCloneOpen}
              providerCode={providerCode}
              supplierProductId={row.supplierProductId}
              sourcePartId={selectedPartId}
              existingPartId={referenceClonePartId}
              onSaved={() => {
                void loadSource()
                onSaved?.()
              }}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
