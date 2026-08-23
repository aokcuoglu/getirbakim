'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Check, ExternalLink, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { useDebouncedCallback } from 'use-debounce'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DataTablePagination } from '@/components/admin/data-table/data-table-pagination'
import {
  getCandidateProductPartLinks,
  getRefSuggestionIds,
  getRefSuggestionSummary,
  getRefSuggestions,
  reviewProductPartLink,
  reviewRefSuggestions,
  type CandidateLinkRow,
  type RefSuggestionRow,
  type RefSuggestionSummary
} from '@/lib/actions/admin-catalog'

const tr = (n: number) => n.toLocaleString('tr-TR')
/** reviewRefSuggestions batch üst sınırıyla aynı — 'use server' dosyasından const export edilemez. */
const SELECT_ALL_LIMIT = 1000

const CONFIDENCE_STYLE: Record<string, string> = {
  HIGH: 'border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  MEDIUM: 'border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400',
  LOW: 'border-rose-500/25 bg-rose-500/15 text-rose-600 dark:text-rose-400'
}

/**
 * LINK  = katalog ürünü ↔ public.parts eşleşmesi (resim/özellik/araç açar)
 * OEM   = web'den toplanan OEM önerisi (source='WEB' ile yazılır)
 * NAME  = web'den toplanan SEO başlık önerisi (name_override'a geçer)
 */
type Mode = 'LINK' | 'OEM' | 'NAME'

const PAGE_SIZE = 50

export interface ApprovalQueueProps {
  /** Kapsam tablosundan seçilen marka; null = tüm markalar. */
  brand: string | null
  onClearBrand: () => void
  /** Bekleyen eşleşme linki sayısı (kapsam kırılımından). */
  pendingLinks: number
}

/**
 * Zenginleştirmenin tek onay kuyruğu.
 *
 * Üç kaynak da aynı işi yapıyordu — ürünü zenginleştirmek — ama üç ayrı başlık
 * altındaydı. Tek liste, üstte kaynak seçici: marka filtresi hepsinde ortak.
 */
export function ApprovalQueue({ brand, onClearBrand, pendingLinks }: ApprovalQueueProps) {
  const [mode, setMode] = useState<Mode>('LINK')
  const [links, setLinks] = useState<CandidateLinkRow[]>([])
  const [suggestions, setSuggestions] = useState<RefSuggestionRow[]>([])
  const [summary, setSummary] = useState<RefSuggestionSummary | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()
  const [searchValue, setSearchValue] = useState('')
  const [query, setQuery] = useState('')
  const [isSearchPending, setIsSearchPending] = useState(false)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [selectingAll, setSelectingAll] = useState(false)
  /** Filtreye uyan toplu seçim yapıldıysa true — sayfa değişince seçim korunur. */
  const [allMatchingSelected, setAllMatchingSelected] = useState(false)

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    setAllMatchingSelected(false)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Öneri sayıları sekme rozetlerinde durur; hangi sekmede olursak olalım çekilir.
      const summaryPromise = getRefSuggestionSummary(brand)
      if (mode === 'LINK') {
        const [sum, result] = await Promise.all([
          summaryPromise,
          getCandidateProductPartLinks({ brand, q: query || null, page, limit: PAGE_SIZE })
        ])
        setSummary(sum)
        setLinks(result.rows)
        setTotal(result.total)
        setPages(result.pages)
        if (result.pages > 0 && page > result.pages) {
          setPage(result.pages)
          return
        }
      } else {
        const [sum, result] = await Promise.all([
          summaryPromise,
          getRefSuggestions({
            brand,
            kind: mode,
            status: 'PENDING',
            q: query || null,
            page,
            limit: PAGE_SIZE
          })
        ])
        setSummary(sum)
        setSuggestions(result.rows)
        setTotal(result.total)
        setPages(result.pages)
        if (result.pages > 0 && page > result.pages) {
          setPage(result.pages)
          return
        }
      }
    } catch {
      toast.error('Onay kuyruğu yüklenemedi.')
    } finally {
      setLoading(false)
      setIsSearchPending(false)
    }
  }, [brand, mode, page, query])

  useEffect(() => {
    void load()
  }, [load])

  // Marka filtresi dışarıdan değişince sayfa/arama/seçim eski kalmasın.
  useEffect(() => {
    setPage(1)
    setSearchValue('')
    setQuery('')
    setIsSearchPending(false)
    clearSelection()
  }, [brand, clearSelection])

  const onSearch = useDebouncedCallback((term: string) => {
    setQuery(term.trim())
    setPage(1)
    clearSelection()
  }, 300)

  const changeMode = (next: Mode) => {
    setMode(next)
    setPage(1)
    setSearchValue('')
    setQuery('')
    setIsSearchPending(false)
    clearSelection()
  }

  const reviewLink = (linkId: string, decision: 'APPROVE' | 'REJECT') => {
    startTransition(async () => {
      const res = await reviewProductPartLink({ linkId, decision })
      if (!res.success) {
        toast.error(res.message)
        return
      }
      toast.success(res.message)
      setLinks((prev) => prev.filter((c) => c.linkId !== linkId))
      setTotal((prev) => Math.max(0, prev - 1))
    })
  }

  const reviewSuggestions = (ids: string[], decision: 'APPROVE' | 'REJECT') => {
    if (ids.length === 0) return
    startTransition(async () => {
      try {
        const res = await reviewRefSuggestions({ ids, decision })
        if (!res.success) {
          toast.error(res.message)
          return
        }
        toast.success(res.message)
        clearSelection()
        await load()
        void getRefSuggestionSummary(brand).then(setSummary).catch(() => undefined)
      } catch {
        toast.error('Öneriler işlenirken bir hata oluştu.')
      }
    })
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setAllMatchingSelected(false)
      return next
    })

  const pageIds = suggestions.map((r) => r.id)
  const pageAllSelected =
    pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const selectableTotal = Math.min(total, SELECT_ALL_LIMIT)

  const togglePageSelection = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (pageAllSelected) {
        for (const id of pageIds) next.delete(id)
      } else {
        for (const id of pageIds) next.add(id)
      }
      return next
    })
    setAllMatchingSelected(false)
  }

  const selectAllMatching = async () => {
    if (allMatchingSelected && selected.size > 0) {
      clearSelection()
      return
    }
    setSelectingAll(true)
    try {
      const result = await getRefSuggestionIds({
        brand,
        kind: mode === 'LINK' ? null : mode,
        status: 'PENDING',
        q: query || null,
        limit: SELECT_ALL_LIMIT
      })
      setSelected(new Set(result.ids))
      setAllMatchingSelected(true)
      if (result.capped) {
        toast.message(`Filtreye ${tr(result.total)} kayıt uyuyor; ilk ${tr(result.ids.length)} seçildi.`)
      }
    } catch {
      toast.error('Toplu seçim yüklenemedi.')
    } finally {
      setSelectingAll(false)
    }
  }

  const tabs = useMemo(
    () =>
      [
        // Eşleşme sayısı kapsam kırılımından gelir; o kırılım marka bazlı
        // değil, bu yüzden marka seçiliyken rozet gösterilmez — yanlış sayı
        // göstermektense hiç göstermemek doğru.
        { key: 'LINK' as const, label: 'Eşleşme', count: brand ? null : pendingLinks },
        { key: 'OEM' as const, label: 'Web OEM', count: summary?.pendingOem ?? 0 },
        { key: 'NAME' as const, label: 'Web ad', count: summary?.pendingName ?? 0 }
      ] satisfies { key: Mode; label: string; count: number | null }[],
    [brand, pendingLinks, summary]
  )

  const rowCount = mode === 'LINK' ? links.length : suggestions.length
  const searchPlaceholder =
    mode === 'LINK'
      ? 'Marka / parça no / ürün / eşleşen kod ara…'
      : 'Marka / parça no / ürün / öneri ara…'

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            {/* mb: çip satır yüksekliğini aşıyor, alttaki açıklamaya değiyordu. */}
            <h3 className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
              Onay kuyruğu
              {brand ? (
                <button
                  type="button"
                  onClick={onClearBrand}
                  title="Marka filtresini kaldır"
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
                >
                  {brand}
                  <X className="size-3" />
                </button>
              ) : (
                <span className="text-xs font-normal text-muted-foreground">tüm markalar</span>
              )}
            </h3>
            <p className="max-w-2xl text-xs text-muted-foreground">
              {mode === 'LINK'
                ? 'Onay anında resim/özellik/araç uyumluluğu görünür olur.'
                : "Onay = uygulama: OEM source='WEB' ile yazılır, ad isim override alanına geçer."}{' '}
              <span className="whitespace-nowrap">Sayfa başına {PAGE_SIZE} kayıt.</span>
            </p>
          </div>

          {/* Kontroller tek grup: dar ekranda alta iner, kendi içinde hizalı kalır. */}
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
            <div className="flex shrink-0 rounded-md border border-border p-0.5">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => changeMode(t.key)}
                  className={`whitespace-nowrap rounded px-2.5 py-1 text-xs font-semibold transition sm:px-3 ${
                    mode === t.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t.label}
                  {t.count == null ? '' : ` (${tr(t.count)})`}
                </button>
              ))}
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none lg:w-72">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchValue}
                  onChange={(e) => {
                    const next = e.target.value
                    setSearchValue(next)
                    setIsSearchPending(true)
                    onSearch(next)
                  }}
                  placeholder={searchPlaceholder}
                  className="h-8 w-full pl-7 pr-8 text-xs"
                  aria-label="Onay kuyruğunda ara"
                />
                {(isSearchPending || loading) && (
                  <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0"
                onClick={() => {
                  clearSelection()
                  void load()
                }}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {mode !== 'LINK' && (rowCount > 0 || selected.size > 0) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <span className="text-xs text-muted-foreground">
            Uygulanmış:{' '}
            {tr(mode === 'OEM' ? (summary?.appliedOem ?? 0) : (summary?.appliedName ?? 0))} ·
            Reddedilmiş: {tr(summary?.rejected ?? 0)}
            {selected.size > 0 ? (
              <>
                {' '}
                · Seçili: <span className="font-semibold text-foreground">{tr(selected.size)}</span>
                {allMatchingSelected && total > SELECT_ALL_LIMIT
                  ? ` (ilk ${tr(SELECT_ALL_LIMIT)})`
                  : null}
              </>
            ) : null}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={pending || selectingAll || pageIds.length === 0}
              onClick={togglePageSelection}
            >
              {pageAllSelected ? 'Sayfa seçimini bırak' : `Sayfadakileri seç (${tr(pageIds.length)})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || selectingAll || total === 0}
              onClick={() => void selectAllMatching()}
              title={
                total > SELECT_ALL_LIMIT
                  ? `Filtreye uyan ${tr(total)} kayıttan ilk ${tr(SELECT_ALL_LIMIT)} seçilir (onay batch limiti).`
                  : 'Mevcut filtreye uyan tüm bekleyenleri seç'
              }
            >
              {selectingAll ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : allMatchingSelected && selected.size > 0 ? (
                'Seçimi bırak'
              ) : total > SELECT_ALL_LIMIT ? (
                `İlk ${tr(SELECT_ALL_LIMIT)}'ini seç`
              ) : (
                `Tümünü seç (${tr(selectableTotal)})`
              )}
            </Button>
            <Button
              size="sm"
              disabled={pending || selectingAll || selected.size === 0}
              onClick={() => reviewSuggestions([...selected], 'APPROVE')}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Seçileni onayla ({tr(selected.size)})
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending || selectingAll || selected.size === 0}
              onClick={() => reviewSuggestions([...selected], 'REJECT')}
            >
              <X className="h-4 w-4" />
              Reddet
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Yükleniyor…
        </div>
      ) : rowCount === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          {query
            ? `"${query}" için sonuç yok.`
            : brand
              ? `${brand} markasında bekleyen kayıt yok.`
              : 'Bekleyen kayıt yok.'}
        </p>
      ) : mode === 'LINK' ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Katalog ürünü</th>
                <th className="px-4 py-2 text-left font-medium">Eşleşen parça</th>
                <th className="px-4 py-2 text-left font-medium">Yöntem</th>
                <th className="px-4 py-2 text-right font-medium">OEM</th>
                <th className="px-4 py-2 text-right font-medium">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {links.map((c) => (
                <tr key={c.linkId} className="border-t border-border">
                  <td className="px-4 py-2">
                    <div className="font-medium">
                      {c.brandName} <span className="font-mono text-xs">{c.partNo}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{c.productName}</div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{c.partBrandName}</div>
                    <div className="text-xs text-muted-foreground">{c.partName}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className="font-mono text-xs">{c.matchMethod}</span>
                    {c.confidence != null && (
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({c.confidence.toFixed(2)})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{tr(c.oemCount)}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewLink(c.linkId, 'APPROVE')}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewLink(c.linkId, 'REJECT')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium">Ürün</th>
                <th className="px-3 py-2 text-left font-medium">
                  {mode === 'OEM' ? 'Önerilen OEM' : 'Önerilen başlık'}
                </th>
                <th className="px-3 py-2 text-left font-medium">Kaynak</th>
                <th className="px-3 py-2 text-right font-medium">İşlem</th>
              </tr>
            </thead>
            <tbody>
              {suggestions.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      className="h-4 w-4 accent-foreground"
                      aria-label="Öneriyi seç"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">
                      {r.brandName} <span className="font-mono text-xs">{r.partNo}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{r.currentName}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {r.oemBrand && (
                        <span className="text-xs font-semibold text-muted-foreground">
                          {r.oemBrand}
                        </span>
                      )}
                      <span
                        className={mode === 'OEM' ? 'font-mono text-sm font-semibold' : 'text-sm'}
                      >
                        {r.value}
                      </span>
                      <Badge variant="outline" className={CONFIDENCE_STYLE[r.confidence] ?? ''}>
                        {r.confidence}
                      </Badge>
                    </div>
                    {r.evidence && (
                      <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {r.evidence}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {r.sourceUrl ? (
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {r.sourceSite}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.sourceSite}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewSuggestions([r.id], 'APPROVE')}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => reviewSuggestions([r.id], 'REJECT')}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="border-t border-border px-2">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-2 text-xs text-muted-foreground">
            <span>
              {tr(total)} kayıt (sayfa {page} / {pages})
            </span>
          </div>
          <DataTablePagination
            totalRows={total}
            page={page}
            pages={pages}
            onPageChange={setPage}
          />
        </div>
      )}
    </section>
  )
}
