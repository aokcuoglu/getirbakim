'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import type { OemCoverageBrandRow } from '@/lib/admin/oem-brand-coverage'

const tr = (n: number) => n.toLocaleString('tr-TR')

/** Kaynak site kimliğinin panelde okunur karşılığı. */
const SOURCE_LABEL: Record<string, string> = {
  'repxpert.com.tr': 'REPXPERT',
  'partsfinder.bilsteingroup.com': 'bilstein',
  'tecalliance-catalog': 'TecAlliance',
  'tecdoc-archive': 'tecdoc-archive'
}

/**
 * Markanın OEM'siz ürünlerinden ne kadarının önerisi var.
 *
 * Neden gerekli: kapsam tablosu ikili — kaynak ya markayı kapsar ya kapsamaz.
 * Ama part_no'su zaten OEM olan markalarda (PSA, THAL, ORIJINAL) kaynak
 * ürünlerin yalnız bir kısmına yetişiyor: PSA'nın 65.609 OEM'siz ürününden
 * 6.751'i. Bunu "kapsanan" göstermek de "elle" göstermek de yanlış olur —
 * biri kalan 59 bin ürünü gizler, diğeri çalışan kaynağı yok sayar.
 */
function coverageRatio(missingOem: number, pendingProducts: number): number | null {
  if (missingOem <= 0 || pendingProducts <= 0) return null
  return Math.min(100, Math.round((pendingProducts / missingOem) * 100))
}

/** Kapsamın nereden bilindiği — arama sonucu elle düzeltilebilir, arşiv sabittir. */
const RESOLVED_LABEL: Record<string, string> = {
  archive: 'arşiv',
  search: 'arama',
  builtin: 'sabit'
}

type Filter = 'pending' | 'uncovered' | 'covered' | 'all'

const FILTERS: { key: Filter; label: string; hint: string }[] = [
  { key: 'pending', label: 'Bekleyen öneri', hint: 'Öneri kuyruğunda kaydı olan markalar' },
  { key: 'uncovered', label: 'Kapsam dışı', hint: 'OEM"i elle araştırılacak markalar' },
  { key: 'covered', label: 'Kapsanan', hint: 'Scraper"ın çekebildiği markalar' },
  { key: 'all', label: 'Tümü', hint: '' }
]

/** Katlanmış görünümde gösterilen satır sayısı — tablo listeye dönüşmesin. */
const COMPACT_ROWS = 8

export interface OemCoveragePanelProps {
  /** Alttaki öneri kuyruğunu süren seçim; null = tüm markalar. */
  selectedBrand: string | null
  onSelectBrand: (brand: string | null) => void
}

/**
 * Marka bazında OEM kaynak kapsamı — öneri kuyruğunun seçicisi.
 *
 * Panel işi ikiye ayırır: kapsanan markalarda beklemek yeter, KAPSAM DIŞI
 * markaların OEM'i elle bulunmalı. Satıra tıklamak alttaki "Web önerileri"
 * kuyruğunu o markaya daraltır — iki tablo aynı verinin iki ucu.
 *
 * Tüm markalar tek seferde çekilir (~600 satır), filtre/arama istemcide çalışır:
 * her sekme değişiminde sunucuya gitmenin anlamı yok.
 *
 * Veri server action ile değil GET ile çekilir: action'lar istemcide kuyruğa
 * alındığı için bu panel kapsam kartlarının arkasında sıra beklerdi.
 */
export function OemCoveragePanel({ selectedBrand, onSelectBrand }: OemCoveragePanelProps) {
  const [rows, setRows] = useState<OemCoverageBrandRow[]>([])
  const [filter, setFilter] = useState<Filter>('pending')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (fresh = false) => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/admin/eslestirme/enrichment/oem-coverage${fresh ? '?fresh=1' : ''}`
      )
      // Gövde JSON olmayabilir (gövdesiz 500 gibi) — parse hatası sebebi yutmasın.
      const data = await res.json().catch(() => null)
      if (!res.ok || data?.error) {
        toast.error(data?.error?.message || `Kaynak kapsamı yüklenemedi. (HTTP ${res.status})`)
        return
      }
      const next = (data.rows ?? []) as OemCoverageBrandRow[]
      setRows(next)
      // Kuyruk boşken "Bekleyen öneri" sekmesi boş tablo gösterirdi; işin
      // gerçekten olduğu yere düş.
      if (!next.some((r) => r.pendingSuggestions > 0)) setFilter('uncovered')
    } catch {
      toast.error('Kaynak kapsamı yüklenirken hata oluştu.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    const matches = rows.filter((r) => {
      if (q && !r.brand.toUpperCase().includes(q)) return false
      if (filter === 'pending') return r.pendingSuggestions > 0
      if (filter === 'uncovered') return !r.sourceSite
      if (filter === 'covered') return Boolean(r.sourceSite)
      return true
    })
    return filter === 'pending'
      ? [...matches].sort((a, b) => b.pendingSuggestions - a.pendingSuggestions)
      : matches
  }, [rows, query, filter])

  const totals = useMemo(
    () =>
      visible.reduce(
        (acc, r) => ({
          missing: acc.missing + r.missingOem,
          pending: acc.pending + r.pendingSuggestions
        }),
        { missing: 0, pending: 0 }
      ),
    [visible]
  )

  const shown = expanded ? visible : visible.slice(0, COMPACT_ROWS)
  const pendingCount = useMemo(
    () => rows.filter((r) => r.pendingSuggestions > 0).length,
    [rows]
  )

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="mr-auto">
          <p className="text-sm font-semibold text-foreground">Kaynak kapsamı</p>
          <p className="text-xs text-muted-foreground">
            Hangi markanın OEM&apos;i web kaynağından çekilebiliyor, hangisi elle araştırılmalı.
            Satıra tıklayın: aşağıdaki öneriler o markaya daralır.
          </p>
        </div>

        <div className="flex rounded-md border border-border p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              title={f.hint}
              onClick={() => {
                setFilter(f.key)
                setExpanded(false)
              }}
              className={`rounded px-3 py-1 text-xs font-semibold transition ${
                filter === f.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {f.label}
              {f.key === 'pending' && pendingCount > 0 ? ` (${tr(pendingCount)})` : ''}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Marka ara"
            className="h-8 w-40 pl-7 text-xs"
          />
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => void load(true)}
          disabled={loading}
          className="h-8"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-2 text-xs text-muted-foreground">
        <span>
          <span className="font-semibold text-foreground">{tr(visible.length)}</span> marka
        </span>
        <span>
          OEM&apos;siz ürün:{' '}
          <span className="font-semibold text-foreground">{tr(totals.missing)}</span>
        </span>
        <span>
          Bekleyen öneri:{' '}
          <span className="font-semibold text-foreground">{tr(totals.pending)}</span>
        </span>
        {selectedBrand && (
          <button
            type="button"
            onClick={() => onSelectBrand(null)}
            className="ml-auto text-xs font-semibold text-primary hover:underline"
          >
            Seçimi kaldır ({selectedBrand})
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Yükleniyor…
        </div>
      ) : visible.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Kayıt yok.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Marka</th>
                  <th className="px-4 py-2 font-medium">Kaynak</th>
                  <th className="px-4 py-2 text-right font-medium">Ürün</th>
                  <th className="px-4 py-2 text-right font-medium">OEM&apos;siz</th>
                  <th className="px-4 py-2 text-right font-medium">Bekleyen öneri</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const active = selectedBrand === r.brand
                  const partialRatio = coverageRatio(r.missingOem, r.pendingProducts)
                  return (
                    <tr
                      key={r.brandId}
                      onClick={() => onSelectBrand(active ? null : r.brand)}
                      className={`cursor-pointer border-b border-border/50 last:border-0 transition ${
                        active ? 'bg-primary/10' : 'hover:bg-muted/50'
                      }`}
                    >
                      <td className="px-4 py-2 font-medium text-foreground">{r.brand}</td>
                      <td className="px-4 py-2">
                        {r.sourceSite ? (
                          <span className="flex items-center gap-1.5">
                            <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                              {SOURCE_LABEL[r.sourceSite] ?? r.sourceSite}
                            </Badge>
                            {r.resolvedBy ? (
                              <span className="text-[11px] text-muted-foreground">
                                {RESOLVED_LABEL[r.resolvedBy] ?? r.resolvedBy}
                              </span>
                            ) : null}
                            {/* Kapsanan markada da oran gösterilir: kaynak
                                markayı destekliyor olsa bile süpürme takılmış
                                olabilir (bir markada 13.774 OEM'siz üründen
                                yalnız 65'i işlenmişti). Oran olmadan bu durum
                                "kapsanan" rozetinin arkasında görünmez kalır. */}
                            {partialRatio !== null ? (
                              <span
                                className="text-[11px] tabular-nums text-muted-foreground"
                                title={`${tr(r.pendingProducts)} / ${tr(r.missingOem)} OEM'siz ürün kapsandı`}
                              >
                                · %{partialRatio}
                              </span>
                            ) : null}
                          </span>
                        ) : partialRatio !== null && r.suggestionSource ? (
                          // Kapsam tablosunda kaynak yok ama kuyruğa yazan bir
                          // kaynak var: kısmi kapsam. Oran olmadan gösterilirse
                          // "bu marka çözüldü" sanılır.
                          <span className="flex items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className="border-sky-500/25 bg-sky-500/15 text-sky-600 dark:text-sky-400"
                              title={`${tr(r.pendingProducts)} / ${tr(r.missingOem)} OEM'siz ürün kapsandı`}
                            >
                              {SOURCE_LABEL[r.suggestionSource] ?? r.suggestionSource} · %{partialRatio}
                            </Badge>
                            <span className="text-[11px] text-muted-foreground">kısmi</span>
                          </span>
                        ) : (
                          <Badge variant="outline" className="border-amber-500/25 bg-amber-500/15 text-amber-600 dark:text-amber-400">
                            elle
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {tr(r.products)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-foreground">
                        {tr(r.missingOem)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          r.pendingSuggestions > 0
                            ? 'font-semibold text-warning'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {r.pendingSuggestions > 0 ? tr(r.pendingSuggestions) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {visible.length > COMPACT_ROWS && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex w-full items-center justify-center gap-1 border-t border-border py-2 text-xs font-semibold text-muted-foreground transition hover:bg-muted/50 hover:text-foreground"
            >
              {expanded ? (
                <>
                  <ChevronUp className="size-3.5" /> Daralt
                </>
              ) : (
                <>
                  <ChevronDown className="size-3.5" /> Kalan {tr(visible.length - COMPACT_ROWS)}{' '}
                  markayı göster
                </>
              )}
            </button>
          )}
        </>
      )}
    </div>
  )
}
